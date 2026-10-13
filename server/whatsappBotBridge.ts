import crypto from 'node:crypto';
import { getDb } from './db.ts';
import { getRuntimeConfig } from './runtimeEnv.ts';
import { computeHmacSha256 } from './security.ts';

export interface OutboxEnqueueParams {
  idempotencyKey: string;
  orderId?: string | null;
  targetType: 'CUSTOMER_PRIVATE' | 'ADMIN_GROUP';
  recipient: string;
  eventType:
    | 'PAYMENT_PROOF_SUBMITTED'
    | 'ORDER_CREATED'
    | 'PAYMENT_VERIFIED'
    | 'FULFILLMENT_COMPLETED'
    | 'FULFILLMENT_FAILED'
    | 'STOCK_CHANGED'
    | 'CRITICAL_ALERT';
  payload: Record<string, unknown>;
}

/**
 * Enqueues a WhatsApp notification in the database outbox table.
 * Ensures idempotency so duplicate events never trigger duplicate WhatsApp messages,
 * and ensures database transactions never fail if the Pterodactyl v32 bot is offline.
 */
export function enqueueWhatsAppOutbox(params: OutboxEnqueueParams): {
  queued: boolean;
  outboxId: string;
} {
  const db = getDb();
  const now = new Date().toISOString();

  // Safety guard: NEVER allow secret credentials in ADMIN_GROUP messages
  const safePayload = { ...params.payload };
  if (params.targetType === 'ADMIN_GROUP') {
    delete safePayload.credentials;
    delete safePayload.credentialPayload;
    delete safePayload.licenseKeys;
    delete safePayload.password;
    delete safePayload.secret;
  }

  const existing = db
    .prepare(`SELECT id FROM whatsapp_outbox WHERE idempotency_key = ?`)
    .get(params.idempotencyKey) as { id: string } | undefined;

  if (existing) {
    return { queued: false, outboxId: existing.id };
  }

  const outboxId = `wa_${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO whatsapp_outbox (
      id, idempotency_key, order_id, target_type, recipient, event_type,
      payload_json, status, attempts, max_attempts, next_retry_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 5, ?, ?, ?)`
  ).run(
    outboxId,
    params.idempotencyKey,
    params.orderId || null,
    params.targetType,
    params.recipient,
    params.eventType,
    JSON.stringify(safePayload),
    now,
    now,
    now
  );

  return { queued: true, outboxId };
}

/**
 * Processes pending or retryable items in the WhatsApp v32 outbox.
 * Uses HMAC-SHA256 authentication header X-Adviora-Bot-Signature and timeout guard.
 */
export async function processWhatsAppOutboxBatch(limit = 10): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  const db = getDb();
  const config = getRuntimeConfig();
  const now = new Date().toISOString();

  const rows = db
    .prepare(
      `SELECT * FROM whatsapp_outbox
       WHERE status IN ('PENDING', 'FAILED_RETRYABLE')
         AND next_retry_at <= ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(now, limit) as Array<{
    id: string;
    idempotency_key: string;
    order_id: string | null;
    target_type: 'CUSTOMER_PRIVATE' | 'ADMIN_GROUP';
    recipient: string;
    event_type: string;
    payload_json: string;
    attempts: number;
    max_attempts: number;
  }>;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    const attemptNum = row.attempts + 1;

    if (!config.waBotV32.enabled) {
      // When bot v32 is not yet enabled in environment, keep in FAILED_RETRYABLE state safely
      const nextRetry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      db.prepare(
        `UPDATE whatsapp_outbox
         SET status = 'FAILED_RETRYABLE',
             attempts = ?,
             next_retry_at = ?,
             last_error = 'WA_BOT_V32_ENABLED=false (Menunggu koneksi bot Pterodactyl v32)',
             updated_at = ?
         WHERE id = ?`
      ).run(attemptNum, nextRetry, new Date().toISOString(), row.id);
      failed += 1;
      continue;
    }

    const requestBody = JSON.stringify({
      outboxId: row.id,
      idempotencyKey: row.idempotency_key,
      targetType: row.target_type,
      recipient: row.recipient,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json),
      timestamp: Date.now(),
    });

    const signature = computeHmacSha256(requestBody, config.waBotV32.sharedSecret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.waBotV32.timeoutMs);

    try {
      const endpoint = `${config.waBotV32.url.replace(/\/$/, '')}/internal/v32/dispatch`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Adviora-Bot-Signature': signature,
          'X-Adviora-Idempotency-Key': row.idempotency_key,
        },
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const sentAt = new Date().toISOString();
        db.prepare(
          `UPDATE whatsapp_outbox
           SET status = 'SENT', attempts = ?, sent_at = ?, last_error = NULL, updated_at = ?
           WHERE id = ?`
        ).run(attemptNum, sentAt, sentAt, row.id);

        if (row.order_id && row.target_type === 'CUSTOMER_PRIVATE') {
          db.prepare(
            `UPDATE fulfillments SET whatsapp_delivery_status = 'SENT', updated_at = ? WHERE order_id = ?`
          ).run(sentAt, row.order_id);
        }
        sent += 1;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      clearTimeout(timer);
      const errMsg = err instanceof Error ? err.message : 'Unknown network error';
      const isDead = attemptNum >= row.max_attempts;
      const backoffSec = Math.min(3600, Math.pow(2, attemptNum) * 15);
      const nextRetry = new Date(Date.now() + backoffSec * 1000).toISOString();
      const updatedNow = new Date().toISOString();

      db.prepare(
        `UPDATE whatsapp_outbox
         SET status = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        isDead ? 'DEAD_LETTER' : 'FAILED_RETRYABLE',
        attemptNum,
        nextRetry,
        errMsg.slice(0, 240),
        updatedNow,
        row.id
      );

      if (row.order_id && row.target_type === 'CUSTOMER_PRIVATE') {
        db.prepare(
          `UPDATE fulfillments SET whatsapp_delivery_status = 'FAILED', updated_at = ? WHERE order_id = ?`
        ).run(updatedNow, row.order_id);
      }
      failed += 1;
    }
  }

  return { processed: rows.length, sent, failed };
}

export async function checkWhatsAppBotHealth(): Promise<{
  enabled: boolean;
  reachable: boolean;
  statusText: string;
  queueStats: {
    pending: number;
    sent: number;
    retryable: number;
    deadLetter: number;
  };
}> {
  const db = getDb();
  const config = getRuntimeConfig();

  const statsRows = db
    .prepare(`SELECT status, COUNT(*) as cnt FROM whatsapp_outbox GROUP BY status`)
    .all() as Array<{ status: string; cnt: number }>;

  const queueStats = {
    pending: 0,
    sent: 0,
    retryable: 0,
    deadLetter: 0,
  };
  for (const r of statsRows) {
    if (r.status === 'PENDING') queueStats.pending = Number(r.cnt);
    if (r.status === 'SENT') queueStats.sent = Number(r.cnt);
    if (r.status === 'FAILED_RETRYABLE') queueStats.retryable = Number(r.cnt);
    if (r.status === 'DEAD_LETTER') queueStats.deadLetter = Number(r.cnt);
  }

  if (!config.waBotV32.enabled) {
    return {
      enabled: false,
      reachable: false,
      statusText: 'DISABLED_IN_ENV (Outbox Queue Aktif)',
      queueStats,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${config.waBotV32.url.replace(/\/$/, '')}/internal/v32/health`, {
      headers: {
        'X-Adviora-Bot-Signature': computeHmacSha256('health', config.waBotV32.sharedSecret),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return {
      enabled: true,
      reachable: res.ok,
      statusText: res.ok ? 'CONNECTED_V32_READY' : `UNHEALTHY_HTTP_${res.status}`,
      queueStats,
    };
  } catch {
    clearTimeout(timer);
    return {
      enabled: true,
      reachable: false,
      statusText: 'OFFLINE_OUTBOX_BUFFERING',
      queueStats,
    };
  }
}
