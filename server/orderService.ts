import crypto from 'node:crypto';
import { getDb, syncProductStockCount, withTransaction } from './db.ts';
import { getRuntimeConfig } from './runtimeEnv.ts';
import { sha256Hex, verifyHmacSignature } from './security.ts';
import { enqueueWhatsAppOutbox, processWhatsAppOutboxBatch } from './whatsappBotBridge.ts';

export interface CreateOrderInput {
  userId: string;
  userRole: 'CUSTOMER' | 'PARTNER' | 'ADMIN';
  userWhatsapp: string;
  userEmail: string;
  customerUsername?: string;
  productId: string;
  quantity: number;
  idempotencyKey: string;
  notes?: string;
  channel?: 'STORE_WEB' | 'PARTNER_PORTAL' | 'PARTNER_API';
}

export class CommerceError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function buildDynamicQrisString(params: {
  merchantName: string;
  merchantId: string;
  orderNumber: string;
  amount: number;
}): string {
  const cleanMerchant = params.merchantName.slice(0, 25).toUpperCase();
  return [
    '000201010212',
    `26600016ID.CO.QRIS.WWW0118${params.merchantId}0215${params.orderNumber}`,
    '520458175303360',
    `54${String(params.amount).length.toString().padStart(2, '0')}${params.amount}`,
    '5802ID',
    `59${String(cleanMerchant.length).padStart(2, '0')}${cleanMerchant}`,
    '6007JAKARTA',
    `62190115${params.orderNumber}`,
    '6304A1B2',
  ].join('');
}

export function expireOverdueOrders(): number {
  const now = new Date().toISOString();
  return withTransaction((db) => {
    const overdueOrders = db
      .prepare(
        `SELECT id, order_number, user_id FROM orders
         WHERE status = 'PENDING_PAYMENT' AND expires_at <= ?`
      )
      .all(now) as Array<{ id: string; order_number: string; user_id: string }>;

    for (const ord of overdueOrders) {
      releaseReservedOrderStock(db, ord.id, 'Order melewati batas waktu pembayaran QRIS (Expired)');
      db.prepare(`UPDATE orders SET status = 'EXPIRED', updated_at = ? WHERE id = ?`).run(
        now,
        ord.id
      );
      db.prepare(`UPDATE payments SET status = 'EXPIRED', updated_at = ? WHERE order_id = ?`).run(
        now,
        ord.id
      );
      db.prepare(
        `INSERT INTO order_status_history (id, order_id, from_status, to_status, actor_type, actor_id, note, created_at)
         VALUES (?, ?, 'PENDING_PAYMENT', 'EXPIRED', 'SYSTEM', 'EXPIRY_WORKER', 'Batas waktu pembayaran berakhir, reservasi stok dikembalikan.', ?)`
      ).run(`osh_${crypto.randomUUID()}`, ord.id, now);
    }

    return overdueOrders.length;
  });
}

function releaseReservedOrderStock(
  db: ReturnType<typeof getDb>,
  orderId: string,
  reason: string
) {
  const now = new Date().toISOString();
  const items = db
    .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
    .all(orderId) as Array<{ product_id: string; quantity: number }>;

  db.prepare(
    `UPDATE inventory_items
     SET status = 'AVAILABLE', reserved_order_id = NULL
     WHERE reserved_order_id = ? AND status = 'RESERVED'`
  ).run(orderId);

  for (const item of items) {
    const prevProduct = db
      .prepare(`SELECT stock_count FROM products WHERE id = ?`)
      .get(item.product_id) as { stock_count: number } | undefined;
    const prevStock = Number(prevProduct?.stock_count ?? 0);
    const updated = syncProductStockCount(db, item.product_id);

    db.prepare(
      `INSERT INTO stock_audit_logs (
        id, product_id, actor_user_id, change_type, delta, previous_stock, new_stock, reference_order_id, reason, created_at
      ) VALUES (?, ?, NULL, 'RELEASE', ?, ?, ?, ?, ?, ?)`
    ).run(
      `sal_${crypto.randomUUID()}`,
      item.product_id,
      item.quantity,
      prevStock,
      updated.available,
      orderId,
      reason,
      now
    );
  }
}

export function createOrder(input: CreateOrderInput) {
  const config = getRuntimeConfig();

  if (config.qris.mode === 'UNCONFIGURED') {
    throw new CommerceError(
      'PAYMENT_PROVIDER_UNCONFIGURED',
      'Konfigurasi gateway pembayaran QRIS belum diaktifkan oleh Administrator. Pembayaran publik dinonaktifkan sementara demi keamanan.',
      503
    );
  }

  const quantity = Math.floor(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
    throw new CommerceError(
      'INVALID_QUANTITY',
      'Jumlah pembelian harus antara 1 hingga 10 unit per transaksi.',
      400
    );
  }

  const cleanIdempotencyKey = String(input.idempotencyKey || '').trim();
  if (!cleanIdempotencyKey || cleanIdempotencyKey.length < 8 || cleanIdempotencyKey.length > 120) {
    throw new CommerceError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key wajib disertakan untuk mencegah duplikasi pesanan.',
      400
    );
  }

  expireOverdueOrders();

  const orderResult = withTransaction((db) => {
    // 1. Check idempotency key first
    const existingOrder = db
      .prepare(`SELECT * FROM orders WHERE idempotency_key = ?`)
      .get(cleanIdempotencyKey) as Record<string, unknown> | undefined;

    if (existingOrder) {
      if (existingOrder.user_id !== input.userId) {
        throw new CommerceError(
          'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key sudah digunakan.',
          409
        );
      }
      return { orderId: String(existingOrder.id), idempotentHit: true };
    }

    // 2. Fetch product from database and verify publication status
    const product = db
      .prepare(`SELECT * FROM products WHERE id = ? AND is_published = 1`)
      .get(input.productId) as
      | {
          id: string;
          slug: string;
          name: string;
          retail_price: number;
          partner_price: number;
          stock_count: number;
          warranty_days: number;
          terms_and_conditions: string;
        }
      | undefined;

    if (!product) {
      throw new CommerceError(
        'PRODUCT_NOT_FOUND',
        'Produk tidak ditemukan atau sedang tidak dipublikasikan.',
        404
      );
    }

    // 3. Atomic stock verification against real vault items
    const availableVaultItems = db
      .prepare(
        `SELECT id FROM inventory_items
         WHERE product_id = ? AND status = 'AVAILABLE'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(product.id, quantity) as Array<{ id: string }>;

    if (availableVaultItems.length < quantity) {
      syncProductStockCount(db, product.id);
      throw new CommerceError(
        'INSUFFICIENT_STOCK',
        availableVaultItems.length === 0
          ? 'Stok produk ini telah habis.'
          : `Stok tersedia (${availableVaultItems.length} unit) tidak mencukupi jumlah permintaan (${quantity} unit).`,
        409
      );
    }

    // 4. Server-authoritative price calculation
    const unitPrice =
      input.userRole === 'PARTNER' ? Number(product.partner_price) : Number(product.retail_price);
    const subtotalAmount = unitPrice * quantity;
    // Deterministic 2-digit unique verification code for static webhook mode, 0 for dynamic/sandbox
    const uniqueCode =
      config.qris.mode === 'STATIC_VERIFIED_WEBHOOK'
        ? (crypto.randomInt(11, 99) as number)
        : 0;
    const totalAmount = subtotalAmount + uniqueCode;

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtIso = new Date(
      now.getTime() + config.qris.expiryMinutes * 60 * 1000
    ).toISOString();

    const datePart = nowIso.slice(0, 10).replace(/-/g, '');
    const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const orderNumber = `ADV-${datePart}-${randomSuffix}`;
    const orderId = `ord_${crypto.randomUUID()}`;

    // 5. Reserve exact vault items atomically
    const reserveStmt = db.prepare(
      `UPDATE inventory_items
       SET status = 'RESERVED', reserved_order_id = ?
       WHERE id = ? AND status = 'AVAILABLE'`
    );
    for (const vItem of availableVaultItems) {
      const info = reserveStmt.run(orderId, vItem.id);
      if (info.changes !== 1) {
        throw new CommerceError(
          'CONCURRENT_STOCK_CONFLICT',
          'Stok baru saja diklaim oleh pembeli lain. Silakan ulangi checkout.',
          409
        );
      }
    }

    const prevStock = Number(product.stock_count);
    const updatedStock = syncProductStockCount(db, product.id);

    // 6. Insert Order
    db.prepare(
      `INSERT INTO orders (
        id, order_number, idempotency_key, user_id, channel, status,
        subtotal_amount, unique_code, total_amount, currency,
        customer_whatsapp, customer_email, notes, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?, 'IDR', ?, ?, ?, ?, ?, ?)`
    ).run(
      orderId,
      orderNumber,
      cleanIdempotencyKey,
      input.userId,
      input.channel || 'STORE_WEB',
      subtotalAmount,
      uniqueCode,
      totalAmount,
      input.userWhatsapp,
      input.userEmail,
      input.notes ? String(input.notes).slice(0, 300) : null,
      expiresAtIso,
      nowIso,
      nowIso
    );

    // 7. Insert Order Item Snapshot
    db.prepare(
      `INSERT INTO order_items (
        id, order_id, product_id, product_name_snapshot, product_slug_snapshot,
        unit_price_snapshot, quantity, total_price_snapshot, warranty_days_snapshot, terms_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `oit_${crypto.randomUUID()}`,
      orderId,
      product.id,
      product.name,
      product.slug,
      unitPrice,
      quantity,
      subtotalAmount,
      product.warranty_days,
      product.terms_and_conditions
    );

    // 8. Insert Stock Audit Log
    db.prepare(
      `INSERT INTO stock_audit_logs (
        id, product_id, actor_user_id, change_type, delta, previous_stock, new_stock, reference_order_id, reason, created_at
      ) VALUES (?, ?, ?, 'RESERVE', ?, ?, ?, ?, ?, ?)`
    ).run(
      `sal_${crypto.randomUUID()}`,
      product.id,
      input.userId,
      -quantity,
      prevStock,
      updatedStock.available,
      orderId,
      `Reservasi stok otomatis untuk pesanan ${orderNumber}`,
      nowIso
    );

    // 9. Insert Payment Record with QRIS Payload
    const providerRef = `QRIS-${orderNumber}`;
    const qrisPayload = buildDynamicQrisString({
      merchantName: config.qris.merchantName,
      merchantId: config.qris.merchantId,
      orderNumber,
      amount: totalAmount,
    });

    db.prepare(
      `INSERT INTO payments (
        id, order_id, provider, merchant_id, provider_reference, amount, currency,
        qris_payload, qris_url, status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'IDR', ?, ?, 'PENDING', ?, ?, ?)`
    ).run(
      `pay_${crypto.randomUUID()}`,
      orderId,
      config.qris.mode,
      config.qris.merchantId,
      providerRef,
      totalAmount,
      qrisPayload,
      config.qris.staticUrl || null,
      expiresAtIso,
      nowIso,
      nowIso
    );

    // 10. Insert Order Status History
    db.prepare(
      `INSERT INTO order_status_history (
        id, order_id, from_status, to_status, actor_type, actor_id, note, created_at
      ) VALUES (?, ?, NULL, 'PENDING_PAYMENT', 'CUSTOMER', ?, ?, ?)`
    ).run(
      `osh_${crypto.randomUUID()}`,
      orderId,
      input.userId,
      `Order dibuat (${quantity}x ${product.name}). Menunggu pemeriksaan pembayaran QRIS Rp ${totalAmount.toLocaleString('id-ID')}.`,
      nowIso
    );

    // 11. User Notification & Sanitized Admin Group Outbox
    db.prepare(
      `INSERT INTO notifications (
        id, user_id, scope, title, message, category, link_url, is_read, created_at
      ) VALUES (?, ?, 'USER', ?, ?, 'ORDER', ?, 0, ?)`
    ).run(
      `ntf_${crypto.randomUUID()}`,
      input.userId,
      `Menunggu Pembayaran: ${orderNumber}`,
      `Pesanan ${product.name} (${quantity} unit) sebesar Rp ${totalAmount.toLocaleString('id-ID')} menunggu pembayaran QRIS sebelum batas waktu.`,
      `/orders/${orderId}`,
      nowIso
    );

    if (config.waBotV32.adminJid) {
      enqueueWhatsAppOutbox({
        idempotencyKey: `wa_admin_order_created_${orderNumber}`,
        orderId,
        targetType: 'CUSTOMER_PRIVATE',
        recipient: config.waBotV32.adminJid,
        eventType: 'ORDER_CREATED',
        payload: {
          orderNumber,
          productName: product.name,
          quantity,
          totalAmount,
          currency: 'IDR',
          status: 'PENDING_PAYMENT',
          customerUsername: String(input.customerUsername || ''),
          customerWhatsapp: input.userWhatsapp,
          customerEmail: input.userEmail,
          buyerNotes: input.notes || '',
        },
      });
    }

    return { orderId, idempotentHit: false };
  });

  // Trigger background outbox flush without blocking order creation
  void processWhatsAppOutboxBatch(5).catch(() => {});

  return getOrderDetailForUser(orderResult.orderId, input.userId, input.userRole);
}

export function getOrderDetailForUser(
  orderIdOrNumber: string,
  requestingUserId: string,
  requestingRole: 'CUSTOMER' | 'PARTNER' | 'ADMIN'
) {
  expireOverdueOrders();
  const db = getDb();

  const order = db
    .prepare(`SELECT * FROM orders WHERE id = ? OR order_number = ? LIMIT 1`)
    .get(orderIdOrNumber, orderIdOrNumber) as Record<string, unknown> | undefined;

  if (!order) {
    throw new CommerceError('ORDER_NOT_FOUND', 'Pesanan tidak ditemukan.', 404);
  }

  // Strict authorization boundary: Customer A CANNOT view Customer B's order!
  if (requestingRole !== 'ADMIN' && order.user_id !== requestingUserId) {
    throw new CommerceError(
      'FORBIDDEN_ORDER_ACCESS',
      'Anda tidak memiliki izin untuk mengakses detail pesanan ini.',
      403
    );
  }

  const items = db
    .prepare(`SELECT * FROM order_items WHERE order_id = ?`)
    .all(String(order.id)) as Array<Record<string, unknown>>;

  const payment = db
    .prepare(`SELECT * FROM payments WHERE order_id = ?`)
    .get(String(order.id)) as Record<string, unknown> | undefined;

  const fulfillment = db
    .prepare(`SELECT * FROM fulfillments WHERE order_id = ?`)
    .get(String(order.id)) as Record<string, unknown> | undefined;

  const history = db
    .prepare(`SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC`)
    .all(String(order.id)) as Array<Record<string, unknown>>;

  // Credentials are ONLY exposed if order status is COMPLETED and payment is PAID
  let deliveredCredentials: string[] = [];
  if (
    (order.status === 'COMPLETED' || order.status === 'PAID') &&
    payment?.status === 'PAID' &&
    fulfillment?.status === 'SUCCESS' &&
    typeof fulfillment.delivered_credentials_json === 'string'
  ) {
    try {
      deliveredCredentials = JSON.parse(fulfillment.delivered_credentials_json);
    } catch {
      deliveredCredentials = [];
    }
  }

  return {
    id: String(order.id),
    orderNumber: String(order.order_number),
    userId: String(order.user_id),
    channel: String(order.channel),
    status: String(order.status),
    subtotalAmount: Number(order.subtotal_amount),
    uniqueCode: Number(order.unique_code),
    totalAmount: Number(order.total_amount),
    currency: String(order.currency),
    customerWhatsapp: String(order.customer_whatsapp),
    customerEmail: String(order.customer_email),
    notes: order.notes ? String(order.notes) : null,
    expiresAt: String(order.expires_at),
    paidAt: order.paid_at ? String(order.paid_at) : null,
    completedAt: order.completed_at ? String(order.completed_at) : null,
    createdAt: String(order.created_at),
    updatedAt: String(order.updated_at),
    items: items.map((it) => ({
      id: String(it.id),
      productId: String(it.product_id),
      productName: String(it.product_name_snapshot),
      productSlug: String(it.product_slug_snapshot),
      unitPrice: Number(it.unit_price_snapshot),
      quantity: Number(it.quantity),
      totalPrice: Number(it.total_price_snapshot),
      warrantyDays: Number(it.warranty_days_snapshot),
      terms: String(it.terms_snapshot),
    })),
    payment: payment
      ? {
          id: String(payment.id),
          provider: String(payment.provider),
          merchantId: String(payment.merchant_id),
          providerReference: String(payment.provider_reference),
          amount: Number(payment.amount),
          currency: String(payment.currency),
          qrisPayload: String(payment.qris_payload),
          qrisUrl: payment.qris_url ? String(payment.qris_url) : null,
          status: String(payment.status),
          expiresAt: String(payment.expires_at),
          verifiedAt: payment.verified_at ? String(payment.verified_at) : null,
        }
      : null,
    fulfillment: fulfillment
      ? {
          id: String(fulfillment.id),
          provider: String(fulfillment.provider),
          status: String(fulfillment.status),
          attemptCount: Number(fulfillment.attempt_count),
          whatsappDeliveryStatus: String(fulfillment.whatsapp_delivery_status),
          errorMessage: fulfillment.error_message ? String(fulfillment.error_message) : null,
          completedAt: fulfillment.completed_at ? String(fulfillment.completed_at) : null,
          credentials: deliveredCredentials,
        }
      : null,
    history: history.map((h) => ({
      id: String(h.id),
      fromStatus: h.from_status ? String(h.from_status) : null,
      toStatus: String(h.to_status),
      actorType: String(h.actor_type),
      note: String(h.note),
      createdAt: String(h.created_at),
    })),
  };
}

export interface WebhookPaymentPayload {
  eventId: string;
  orderNumber: string;
  providerReference: string;
  merchantId: string;
  amount: number;
  currency: string;
  paymentStatus: 'PAID' | 'FAILED' | 'EXPIRED';
  timestamp: number;
}

/**
 * Verifies and processes an incoming QRIS payment callback/webhook.
 * Enforces:
 * 1. HMAC-SHA256 cryptographic signature check
 * 2. Replay window protection (max 5 minutes skew)
 * 3. Event ID idempotency (duplicate webhooks never re-trigger fulfillment)
 * 4. Merchant ID, Currency, Order Reference, and Exact Amount verification
 * 5. Atomic stock claim & single fulfillment execution
 */
export function processPaymentWebhook(params: {
  rawBody: string;
  signatureHeader: string;
  payload: WebhookPaymentPayload;
  actorType?: 'WEBHOOK' | 'ADMIN';
  actorId?: string;
}) {
  const config = getRuntimeConfig();
  const { rawBody, signatureHeader, payload } = params;

  // 1. Validate HMAC-SHA256 signature
  if (!verifyHmacSignature(rawBody, signatureHeader, config.qris.webhookSecret)) {
    throw new CommerceError(
      'INVALID_WEBHOOK_SIGNATURE',
      'Signature webhook pembayaran tidak valid atau ditolak.',
      401
    );
  }

  // 2. Validate required fields & replay timestamp window
  if (
    !payload ||
    !payload.eventId ||
    !payload.orderNumber ||
    !payload.merchantId ||
    typeof payload.amount !== 'number' ||
    typeof payload.timestamp !== 'number'
  ) {
    throw new CommerceError('MALFORMED_WEBHOOK_PAYLOAD', 'Payload webhook tidak lengkap.', 400);
  }

  const nowMs = Date.now();
  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(nowMs - payload.timestamp) > maxSkewMs) {
    throw new CommerceError(
      'WEBHOOK_TIMESTAMP_EXPIRED',
      'Timestamp webhook di luar batas aman (Replay Protection).',
      400
    );
  }

  // 3. Validate Merchant ID & Currency
  if (payload.merchantId !== config.qris.merchantId) {
    throw new CommerceError('MERCHANT_MISMATCH', 'Merchant ID tidak sesuai.', 400);
  }
  if (payload.currency !== 'IDR') {
    throw new CommerceError('CURRENCY_MISMATCH', 'Mata uang pembayaran harus IDR.', 400);
  }

  const payloadHash = sha256Hex(rawBody);

  const result = withTransaction((db) => {
    const nowIso = new Date().toISOString();

    // 4. Check Webhook Idempotency Table
    const existingEvent = db
      .prepare(`SELECT id, status FROM payment_webhook_events WHERE event_id = ?`)
      .get(payload.eventId) as { id: string; status: string } | undefined;

    if (existingEvent) {
      return {
        idempotentDuplicate: true,
        orderNumber: payload.orderNumber,
        status: existingEvent.status,
      };
    }

    const order = db
      .prepare(`SELECT * FROM orders WHERE order_number = ? LIMIT 1`)
      .get(payload.orderNumber) as Record<string, unknown> | undefined;

    if (!order) {
      throw new CommerceError('ORDER_NOT_FOUND', 'Order reference tidak ditemukan.', 404);
    }

    const payment = db
      .prepare(`SELECT * FROM payments WHERE order_id = ? LIMIT 1`)
      .get(String(order.id)) as Record<string, unknown> | undefined;

    if (!payment) {
      throw new CommerceError('PAYMENT_RECORD_NOT_FOUND', 'Data pembayaran tidak ditemukan.', 404);
    }

    // 5. Verify Exact Nominal Amount
    const expectedAmount = Number(order.total_amount);
    if (Number(payload.amount) !== expectedAmount) {
      throw new CommerceError(
        'AMOUNT_MISMATCH',
        `Nominal webhook (${payload.amount}) tidak cocok dengan total tagihan order (${expectedAmount}).`,
        400
      );
    }

    // Record the validated webhook event idempotently
    db.prepare(
      `INSERT INTO payment_webhook_events (
        id, event_id, provider, order_number, signature_valid, payload_hash, status, processed_at, raw_summary, created_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).run(
      `pwe_${crypto.randomUUID()}`,
      payload.eventId,
      String(payment.provider),
      payload.orderNumber,
      payloadHash,
      payload.paymentStatus,
      nowIso,
      JSON.stringify({
        eventId: payload.eventId,
        amount: payload.amount,
        paymentStatus: payload.paymentStatus,
      }),
      nowIso
    );

    // If order is already COMPLETED or PAID, do not re-run fulfillment!
    if (order.status === 'COMPLETED' || order.status === 'PAID') {
      return {
        idempotentDuplicate: true,
        orderNumber: payload.orderNumber,
        status: String(order.status),
      };
    }

    if (order.status === 'EXPIRED' || order.status === 'FAILED' || order.status === 'REFUNDED') {
      throw new CommerceError(
        'INVALID_ORDER_STATE_TRANSITION',
        `Order dalam status ${order.status} tidak dapat diubah menjadi PAID secara otomatis.`,
        409
      );
    }

    if (payload.paymentStatus === 'FAILED' || payload.paymentStatus === 'EXPIRED') {
      const targetStatus = payload.paymentStatus === 'EXPIRED' ? 'EXPIRED' : 'FAILED';
      releaseReservedOrderStock(
        db,
        String(order.id),
        `Pembayaran ${targetStatus} via callback gateway`
      );
      db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(
        targetStatus,
        nowIso,
        String(order.id)
      );
      db.prepare(`UPDATE payments SET status = ?, updated_at = ? WHERE order_id = ?`).run(
        targetStatus,
        nowIso,
        String(order.id)
      );
      db.prepare(
        `INSERT INTO order_status_history (
          id, order_id, from_status, to_status, actor_type, actor_id, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `osh_${crypto.randomUUID()}`,
        String(order.id),
        String(order.status),
        targetStatus,
        params.actorType || 'WEBHOOK',
        params.actorId || payload.eventId,
        `Status pembayaran diperbarui menjadi ${targetStatus}. Reservasi stok dilepas.`,
        nowIso
      );

      return {
        idempotentDuplicate: false,
        orderNumber: payload.orderNumber,
        status: targetStatus,
      };
    }

    // 6. Transition Order & Payment to PAID
    db.prepare(`UPDATE payments SET status = 'PAID', verified_at = ?, updated_at = ? WHERE order_id = ?`).run(
      nowIso,
      nowIso,
      String(order.id)
    );
    db.prepare(`UPDATE orders SET status = 'PAID', paid_at = ?, updated_at = ? WHERE id = ?`).run(
      nowIso,
      nowIso,
      String(order.id)
    );
    db.prepare(
      `INSERT INTO order_status_history (
        id, order_id, from_status, to_status, actor_type, actor_id, note, created_at
      ) VALUES (?, ?, ?, 'PAID', ?, ?, ?, ?)`
    ).run(
      `osh_${crypto.randomUUID()}`,
      String(order.id),
      String(order.status),
      params.actorType || 'WEBHOOK',
      params.actorId || payload.eventId,
      `Pembayaran QRIS sebesar Rp ${expectedAmount.toLocaleString('id-ID')} terverifikasi sah (Event: ${payload.eventId}).`,
      nowIso
    );

    // 7. Execute Atomic Fulfillment (Single Execution Guaranteed)
    const fulfillmentOutcome = executeAtomicFulfillmentInTx(db, String(order.id), nowIso);

    return {
      idempotentDuplicate: false,
      orderNumber: payload.orderNumber,
      status: fulfillmentOutcome.finalOrderStatus,
    };
  });

  void processWhatsAppOutboxBatch(5).catch(() => {});

  return result;
}

function executeAtomicFulfillmentInTx(
  db: ReturnType<typeof getDb>,
  orderId: string,
  nowIso: string
): { finalOrderStatus: string; credentials: string[] } {
  const config = getRuntimeConfig();

  // Guard: Check if fulfillment already exists and succeeded
  const existingFulfillment = db
    .prepare(`SELECT * FROM fulfillments WHERE order_id = ?`)
    .get(orderId) as Record<string, unknown> | undefined;

  if (existingFulfillment && existingFulfillment.status === 'SUCCESS') {
    const creds = existingFulfillment.delivered_credentials_json
      ? JSON.parse(String(existingFulfillment.delivered_credentials_json))
      : [];
    return { finalOrderStatus: 'COMPLETED', credentials: creds };
  }

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Record<
    string,
    unknown
  >;
  const orderItems = db
    .prepare(`SELECT * FROM order_items WHERE order_id = ?`)
    .all(orderId) as Array<Record<string, unknown>>;

  const claimedCredentials: string[] = [];

  for (const item of orderItems) {
    const productId = String(item.product_id);
    const qty = Number(item.quantity);

    // Claim the exact RESERVED items for this order
    let reservedRows = db
      .prepare(
        `SELECT id, credential_payload FROM inventory_items
         WHERE reserved_order_id = ? AND product_id = ? AND status = 'RESERVED'
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(orderId, productId, qty) as Array<{ id: string; credential_payload: string }>;

    // Fallback if not enough reserved (e.g. manual admin retry)
    if (reservedRows.length < qty) {
      const needed = qty - reservedRows.length;
      const extraAvailable = db
        .prepare(
          `SELECT id, credential_payload FROM inventory_items
           WHERE product_id = ? AND status = 'AVAILABLE'
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(productId, needed) as Array<{ id: string; credential_payload: string }>;
      reservedRows = [...reservedRows, ...extraAvailable];
    }

    if (reservedRows.length < qty) {
      // Fulfillment failed due to vault exhaustion; mark PROCESSING / MANUAL_REVIEW safely
      const errNote = 'Stok brankas tidak mencukupi saat klaim akhir. Memerlukan tinjauan Admin.';
      if (existingFulfillment) {
        db.prepare(
          `UPDATE fulfillments
           SET status = 'FAILED', attempt_count = attempt_count + 1, error_message = ?, updated_at = ?
           WHERE order_id = ?`
        ).run(errNote, nowIso, orderId);
      } else {
        db.prepare(
          `INSERT INTO fulfillments (
            id, order_id, attempt_count, provider, status, whatsapp_delivery_status, error_message, created_at, updated_at
          ) VALUES (?, ?, 1, ?, 'FAILED', 'SKIPPED', ?, ?, ?)`
        ).run(
          `ful_${crypto.randomUUID()}`,
          orderId,
          config.fulfillment.mode,
          errNote,
          nowIso,
          nowIso
        );
      }

      db.prepare(`UPDATE orders SET status = 'PROCESSING', updated_at = ? WHERE id = ?`).run(
        nowIso,
        orderId
      );
      db.prepare(
        `INSERT INTO order_status_history (
          id, order_id, from_status, to_status, actor_type, actor_id, note, created_at
        ) VALUES (?, ?, 'PAID', 'PROCESSING', 'SYSTEM', 'FULFILLMENT_ENGINE', ?, ?)`
      ).run(`osh_${crypto.randomUUID()}`, orderId, errNote, nowIso);

      if (config.waBotV32.adminGroupJid) {
        enqueueWhatsAppOutbox({
          idempotencyKey: `wa_admin_fulfill_failed_${order.order_number}`,
          orderId,
          targetType: 'ADMIN_GROUP',
          recipient: config.waBotV32.adminGroupJid,
          eventType: 'FULFILLMENT_FAILED',
          payload: {
            orderNumber: order.order_number,
            totalAmount: order.total_amount,
            reason: errNote,
          },
        });
      }

      return { finalOrderStatus: 'PROCESSING', credentials: [] };
    }

    const claimStmt = db.prepare(
      `UPDATE inventory_items
       SET status = 'CLAIMED', claimed_order_id = ?, claimed_at = ?
       WHERE id = ?`
    );
    for (const r of reservedRows) {
      claimStmt.run(orderId, nowIso, r.id);
      claimedCredentials.push(r.credential_payload);
    }

    const updatedStock = syncProductStockCount(db, productId);
    db.prepare(
      `INSERT INTO stock_audit_logs (
        id, product_id, actor_user_id, change_type, delta, previous_stock, new_stock, reference_order_id, reason, created_at
      ) VALUES (?, ?, ?, 'DEDUCT', ?, ?, ?, ?, ?, ?)`
    ).run(
      `sal_${crypto.randomUUID()}`,
      productId,
      String(order.user_id),
      -qty,
      updatedStock.available,
      updatedStock.available,
      orderId,
      `Klaim lisensi permanen untuk pesanan lunas ${order.order_number}`,
      nowIso
    );

    if (updatedStock.available === 0) {
      db.prepare(
        `INSERT INTO notifications (
          id, user_id, scope, title, message, category, link_url, is_read, created_at
        ) VALUES (?, NULL, 'PUBLIC_STOCK', ?, ?, 'STOCK', ?, 0, ?)`
      ).run(
        `ntf_${crypto.randomUUID()}`,
        `Stok Habis: ${item.product_name_snapshot}`,
        `Stok untuk produk ${item.product_name_snapshot} baru saja habis terjual.`,
        `/product/${item.product_slug_snapshot}`,
        nowIso
      );
    }
  }

  // Upsert fulfillment record
  if (existingFulfillment) {
    db.prepare(
      `UPDATE fulfillments
       SET status = 'SUCCESS',
           attempt_count = attempt_count + 1,
           delivered_credentials_json = ?,
           whatsapp_delivery_status = 'QUEUED',
           error_message = NULL,
           completed_at = ?,
           updated_at = ?
       WHERE order_id = ?`
    ).run(JSON.stringify(claimedCredentials), nowIso, nowIso, orderId);
  } else {
    db.prepare(
      `INSERT INTO fulfillments (
        id, order_id, attempt_count, provider, status, delivered_credentials_json,
        whatsapp_delivery_status, error_message, created_at, updated_at, completed_at
      ) VALUES (?, ?, 1, ?, 'SUCCESS', ?, 'QUEUED', NULL, ?, ?, ?)`
    ).run(
      `ful_${crypto.randomUUID()}`,
      orderId,
      config.fulfillment.mode,
      JSON.stringify(claimedCredentials),
      nowIso,
      nowIso,
      nowIso
    );
  }

  // Update Order to COMPLETED
  db.prepare(
    `UPDATE orders SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?`
  ).run(nowIso, nowIso, orderId);

  db.prepare(
    `INSERT INTO order_status_history (
      id, order_id, from_status, to_status, actor_type, actor_id, note, created_at
    ) VALUES (?, ?, 'PAID', 'COMPLETED', 'SYSTEM', 'FULFILLMENT_ENGINE', ?, ?)`
  ).run(
    `osh_${crypto.randomUUID()}`,
    orderId,
    `Pemenuhan order berhasil (${claimedCredentials.length} lisensi diklaim secara atomik). Detail dikirimkan ke kanal privat pelanggan.`,
    nowIso
  );

  // Create customer notification
  db.prepare(
    `INSERT INTO notifications (
      id, user_id, scope, title, message, category, link_url, is_read, created_at
    ) VALUES (?, ?, 'USER', ?, ?, 'FULFILLMENT', ?, 0, ?)`
  ).run(
    `ntf_${crypto.randomUUID()}`,
    String(order.user_id),
    `Pesanan Selesai: ${order.order_number}`,
    `Pembayaran Anda telah diverifikasi dan ${claimedCredentials.length} kode lisensi telah tersedia di halaman detail pesanan serta dikirim ke WhatsApp Anda.`,
    `/orders/${orderId}`,
    nowIso
  );

  // Enqueue PRIVATE WhatsApp message to Customer (ONLY place where credentials are sent)
  enqueueWhatsAppOutbox({
    idempotencyKey: `wa_cust_fulfill_${order.order_number}`,
    orderId,
    targetType: 'CUSTOMER_PRIVATE',
    recipient: String(order.customer_whatsapp),
    eventType: 'FULFILLMENT_COMPLETED',
    payload: {
      orderNumber: order.order_number,
      productName: orderItems[0]?.product_name_snapshot || 'Produk Digital AdViora',
      quantity: orderItems[0]?.quantity || 1,
      totalAmount: order.total_amount,
      credentials: claimedCredentials,
    },
  });

  // Enqueue SANITIZED Admin Group operational notification (NO credentials!)
  if (config.waBotV32.adminGroupJid) {
    enqueueWhatsAppOutbox({
      idempotencyKey: `wa_admin_fulfill_ok_${order.order_number}`,
      orderId,
      targetType: 'ADMIN_GROUP',
      recipient: config.waBotV32.adminGroupJid,
      eventType: 'FULFILLMENT_COMPLETED',
      payload: {
        orderNumber: order.order_number,
        productName: orderItems[0]?.product_name_snapshot || 'Produk Digital',
        quantity: orderItems[0]?.quantity || 1,
        totalAmount: order.total_amount,
        status: 'COMPLETED',
      },
    });
  }

  return { finalOrderStatus: 'COMPLETED', credentials: claimedCredentials };
}
