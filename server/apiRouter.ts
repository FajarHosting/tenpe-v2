import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { getDb, syncProductStockCount, withTransaction } from './db.ts';
import { getRuntimeConfig } from './runtimeEnv.ts';
import {
  computeHmacSha256,
  createRateLimiter,
  generateRandomToken,
  hashPassword,
  maskDisplayName,
  normalizeWhatsappPhone,
  parseCookies,
  sanitizeReturnUrl,
  serializeSessionCookie,
  sha256Hex,
  validateEmailFormat,
  validatePasswordStrength,
  validateUsernameFormat,
  verifyPassword,
} from './security.ts';
import {
  CommerceError,
  createOrder,
  expireOverdueOrders,
  getOrderDetailForUser,
  processPaymentWebhook,
  type WebhookPaymentPayload,
} from './orderService.ts';
import {
  checkWhatsAppBotHealth,
  enqueueWhatsAppOutbox,
  processWhatsAppOutboxBatch,
} from './whatsappBotBridge.ts';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  whatsapp: string;
  role: 'CUSTOMER' | 'PARTNER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW';
  companyName: string | null;
  partnerTier: string | null;
  walletBalance: number;
  apiKeyPrefix: string | null;
  forcePasswordRotation: boolean;
  sessionId: string;
  csrfToken: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

const SESSION_COOKIE_NAME = 'adviora_session';

function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1'
  );
}

function attachSessionUser(req: Request, _res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) {
    return next();
  }

  const db = getDb();
  const tokenHash = sha256Hex(rawToken);
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(
      `SELECT
         s.id as session_id,
         s.csrf_token,
         s.expires_at,
         s.revoked_at,
         u.id as user_id,
         u.username,
         u.email,
         u.whatsapp,
         u.role,
         u.status,
         u.company_name,
         u.partner_tier,
         u.wallet_balance,
         u.api_key_prefix,
         u.force_password_rotation
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
       LIMIT 1`
    )
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row) return next();
  if (row.revoked_at || String(row.expires_at) <= nowIso || row.status !== 'ACTIVE') {
    return next();
  }

  req.user = {
    id: String(row.user_id),
    username: String(row.username),
    email: String(row.email),
    whatsapp: String(row.whatsapp),
    role: row.role as 'CUSTOMER' | 'PARTNER' | 'ADMIN',
    status: row.status as 'ACTIVE' | 'SUSPENDED' | 'PENDING_REVIEW',
    companyName: row.company_name ? String(row.company_name) : null,
    partnerTier: row.partner_tier ? String(row.partner_tier) : null,
    walletBalance: Number(row.wallet_balance || 0),
    apiKeyPrefix: row.api_key_prefix ? String(row.api_key_prefix) : null,
    forcePasswordRotation: Boolean(row.force_password_rotation),
    sessionId: String(row.session_id),
    csrfToken: String(row.csrf_token),
  };

  return next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sesi autentikasi diperlukan. Silakan login terlebih dahulu.',
      },
    });
  }
  return next();
}

function requireRole(allowedRoles: Array<'CUSTOMER' | 'PARTNER' | 'ADMIN'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Sesi autentikasi diperlukan.',
        },
      });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: 'Akses ditolak. Akun Anda tidak memiliki izin untuk sumber daya ini.',
        },
      });
    }
    return next();
  };
}

function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Sesi tidak ditemukan.' },
    });
  }
  const headerToken = req.headers['x-csrf-token'];
  if (typeof headerToken !== 'string' || headerToken !== req.user.csrfToken) {
    return res.status(403).json({
      ok: false,
      error: {
        code: 'INVALID_CSRF_TOKEN',
        message: 'Token keamanan sesi (CSRF) tidak valid atau kedaluwarsa. Muat ulang halaman.',
      },
    });
  }
  return next();
}

function writeAuditLog(params: {
  actorUserId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (
      id, actor_user_id, actor_role, action, entity_type, entity_id, ip_address, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `aud_${crypto.randomUUID()}`,
    params.actorUserId,
    params.actorRole,
    params.action,
    params.entityType,
    params.entityId || null,
    params.ipAddress || '127.0.0.1',
    JSON.stringify(params.metadata || {}),
    new Date().toISOString()
  );
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Request ID & Security Headers
  router.use((req, res, next) => {
    const reqId = `req_${crypto.randomBytes(6).toString('hex')}`;
    req.requestId = reqId;
    res.setHeader('X-Request-Id', reqId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.use(attachSessionUser);

  const authRateLimiter = createRateLimiter({
    keyPrefix: 'auth',
    windowMs: 60 * 1000,
    maxRequests: 15,
    message: 'Terlalu banyak percobaan autentikasi. Silakan tunggu 1 menit sebelum mencoba kembali.',
  });

  const checkoutRateLimiter = createRateLimiter({
    keyPrefix: 'checkout',
    windowMs: 60 * 1000,
    maxRequests: 12,
    message: 'Terlalu banyak permintaan checkout dalam waktu singkat. Mohon tunggu sebentar.',
  });

  // ==========================================================================
  // 1. HEALTH & PUBLIC MARKETING / TRANSPARENCY ENDPOINTS
  // ==========================================================================

  router.get('/health', (_req, res) => {
    const db = getDb();
    const config = getRuntimeConfig();
    const migration = db
      .prepare(`SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1`)
      .get() as { version: string; applied_at: string } | undefined;

    res.json({
      ok: true,
      status: 'healthy',
      service: 'adviora-commerce-api',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        schemaVersion: migration?.version || 'unknown',
      },
      domains: {
        storeUrl: config.storeUrl,
        partnerUrl: config.partnerUrl,
      },
      paymentGatewayReady: config.qris.mode !== 'UNCONFIGURED',
    });
  });

  router.get('/public/overview', (_req, res) => {
    const db = getDb();
    const config = getRuntimeConfig();

    const announcements = db
      .prepare(
        `SELECT id, title, content, variant, target_audience, created_at
         FROM announcements
         WHERE is_active = 1 AND target_audience IN ('ALL', 'CUSTOMER')
         ORDER BY created_at DESC
         LIMIT 3`
      )
      .all() as Array<Record<string, unknown>>;

    const categories = db
      .prepare(
        `SELECT
           c.id,
           c.slug,
           c.name,
           c.description,
           COUNT(p.id) as product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.is_published = 1
         WHERE c.is_active = 1
         GROUP BY c.id
         ORDER BY c.sort_order ASC`
      )
      .all() as Array<Record<string, unknown>>;

    // Recent anonymized verified transactions (strictly real COMPLETED orders only, zero PII!)
    const recentVerifiedOrders = db
      .prepare(
        `SELECT
           o.completed_at,
           u.username,
           oi.product_name_snapshot,
           c.name as category_name
         FROM orders o
         JOIN users u ON u.id = o.user_id
         JOIN order_items oi ON oi.order_id = o.id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE o.status = 'COMPLETED'
         ORDER BY o.completed_at DESC
         LIMIT 8`
      )
      .all() as Array<{
      completed_at: string;
      username: string;
      product_name_snapshot: string;
      category_name: string;
    }>;

    const publicActivityFeed = recentVerifiedOrders.map((row, idx) => ({
      id: `feed_${idx}_${row.completed_at}`,
      anonymizedBuyer: maskDisplayName(row.username),
      productName: row.product_name_snapshot,
      categoryName: row.category_name,
      completedAt: row.completed_at,
    }));

    res.json({
      ok: true,
      data: {
        storeDomain: config.storeUrl,
        partnerDomain: config.partnerUrl,
        announcements: announcements.map((a) => ({
          id: String(a.id),
          title: String(a.title),
          content: String(a.content),
          variant: String(a.variant),
          createdAt: String(a.created_at),
        })),
        categories: categories.map((c) => ({
          id: String(c.id),
          slug: String(c.slug),
          name: String(c.name),
          description: String(c.description),
          productCount: Number(c.product_count || 0),
        })),
        publicActivityFeed,
      },
    });
  });

  router.post('/public/partner-applications', authRateLimiter, (req, res) => {
    const {
      applicantName,
      businessName,
      email,
      whatsapp,
      websiteOrChannel,
      estimatedMonthlyVolume,
      useCase,
    } = req.body || {};

    if (!applicantName || String(applicantName).trim().length < 3) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'Nama lengkap pendaftar minimal 3 karakter.' },
      });
    }
    if (!businessName || String(businessName).trim().length < 3) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'Nama entitas/usaha minimal 3 karakter.' },
      });
    }
    if (!validateEmailFormat(email)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_EMAIL', message: 'Format alamat email bisnis tidak valid.' },
      });
    }
    const phoneCheck = normalizeWhatsappPhone(whatsapp);
    if (!phoneCheck.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_WHATSAPP', message: phoneCheck.error },
      });
    }
    if (!useCase || String(useCase).trim().length < 15) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_USE_CASE',
          message: 'Jelaskan rencana distribusi / integrasi minimal 15 karakter.',
        },
      });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const appId = `pap_${crypto.randomUUID()}`;

    db.prepare(
      `INSERT INTO partner_applications (
        id, applicant_name, business_name, email, whatsapp,
        website_or_channel, estimated_monthly_volume, use_case, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?)`
    ).run(
      appId,
      String(applicantName).trim().slice(0, 80),
      String(businessName).trim().slice(0, 100),
      String(email).trim().toLowerCase(),
      phoneCheck.normalized,
      String(websiteOrChannel || '-').trim().slice(0, 140),
      String(estimatedMonthlyVolume || '10 - 50 Lisensi / Bulan').trim().slice(0, 60),
      String(useCase).trim().slice(0, 500),
      now,
      now
    );

    writeAuditLog({
      actorUserId: null,
      actorRole: 'PUBLIC',
      action: 'PARTNER_APPLICATION_SUBMITTED',
      entityType: 'PARTNER_APPLICATION',
      entityId: appId,
      ipAddress: getClientIp(req),
      metadata: { businessName: String(businessName).trim() },
    });

    return res.status(201).json({
      ok: true,
      data: {
        applicationId: appId,
        status: 'PENDING_REVIEW',
        message:
          'Permohonan kemitraan B2B Anda telah diterima dan sedang dalam antrean verifikasi tim Admin AdViora.',
      },
    });
  });

  // ==========================================================================
  // 2. CUSTOMER, PARTNER & ADMIN AUTHENTICATION (/api/auth/*)
  // ==========================================================================

  router.get('/auth/me', (req, res) => {
    if (!req.user) {
      return res.status(200).json({
        ok: true,
        authenticated: false,
        user: null,
        csrfToken: null,
      });
    }

    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        whatsapp: req.user.whatsapp,
        role: req.user.role,
        status: req.user.status,
        companyName: req.user.companyName,
        partnerTier: req.user.partnerTier,
        walletBalance: req.user.walletBalance,
        apiKeyPrefix: req.user.apiKeyPrefix,
        forcePasswordRotation: req.user.forcePasswordRotation,
      },
      csrfToken: req.user.csrfToken,
    });
  });

  router.post('/auth/register', authRateLimiter, (req, res) => {
    const { username, email, whatsapp, password, returnTo } = req.body || {};

    const unameCheck = validateUsernameFormat(username);
    if (!unameCheck.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_USERNAME', message: unameCheck.error },
      });
    }

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!validateEmailFormat(cleanEmail)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_EMAIL', message: 'Format alamat email tidak valid.' },
      });
    }

    const phoneCheck = normalizeWhatsappPhone(whatsapp);
    if (!phoneCheck.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_WHATSAPP', message: phoneCheck.error },
      });
    }

    const pwdCheck = validatePasswordStrength(password);
    if (!pwdCheck.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: 'WEAK_PASSWORD', message: pwdCheck.error },
      });
    }

    const db = getDb();
    const config = getRuntimeConfig();

    const conflictUser = db
      .prepare(`SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1`)
      .get(unameCheck.cleaned, cleanEmail) as { id: string } | undefined;

    if (conflictUser) {
      // Anti-enumeration: Do not specify whether username or email caused conflict
      return res.status(409).json({
        ok: false,
        error: {
          code: 'REGISTRATION_CONFLICT',
          message:
            'Pendaftaran tidak dapat dilanjutkan karena username atau email sudah terdaftar di sistem.',
        },
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const userId = `usr_${crypto.randomUUID()}`;
    const pwdHash = hashPassword(password);

    const rawSessionToken = generateRandomToken(32);
    const csrfToken = generateRandomToken(24);
    const sessionId = `ses_${crypto.randomUUID()}`;
    const ttlSeconds = config.sessionTtlHours * 3600;
    const expiresAtIso = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    withTransaction((txDb) => {
      txDb
        .prepare(
          `INSERT INTO users (
            id, username, email, whatsapp, password_hash, role, status,
            wallet_balance, force_password_rotation, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'CUSTOMER', 'ACTIVE', 0, 0, ?, ?)`
        )
        .run(userId, unameCheck.cleaned, cleanEmail, phoneCheck.normalized, pwdHash, nowIso, nowIso);

      txDb
        .prepare(
          `INSERT INTO sessions (
            id, token_hash, csrf_token, user_id, ip_address, user_agent, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          sessionId,
          sha256Hex(rawSessionToken),
          csrfToken,
          userId,
          getClientIp(req),
          String(req.headers['user-agent'] || '').slice(0, 200),
          expiresAtIso,
          nowIso
        );

      txDb
        .prepare(
          `INSERT INTO notifications (
            id, user_id, scope, title, message, category, link_url, is_read, created_at
          ) VALUES (?, ?, 'USER', ?, ?, 'SYSTEM', '/shop', 0, ?)`
        )
        .run(
          `ntf_${crypto.randomUUID()}`,
          userId,
          'Selamat Datang di AdViora',
          `Akun pelanggan @${unameCheck.cleaned} telah aktif. Nomor WhatsApp ${phoneCheck.normalized} siap menerima pengiriman lisensi otomatis.`,
          nowIso
        );
    });

    writeAuditLog({
      actorUserId: userId,
      actorRole: 'CUSTOMER',
      action: 'CUSTOMER_REGISTERED',
      entityType: 'USER',
      entityId: userId,
      ipAddress: getClientIp(req),
    });

    res.setHeader(
      'Set-Cookie',
      serializeSessionCookie(SESSION_COOKIE_NAME, rawSessionToken, ttlSeconds, config.isProduction)
    );

    return res.status(201).json({
      ok: true,
      user: {
        id: userId,
        username: unameCheck.cleaned,
        email: cleanEmail,
        whatsapp: phoneCheck.normalized,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        companyName: null,
        partnerTier: null,
        walletBalance: 0,
        forcePasswordRotation: false,
      },
      csrfToken,
      redirectTo: sanitizeReturnUrl(returnTo, '/shop'),
    });
  });

  router.post('/auth/login', authRateLimiter, (req, res) => {
    const { identifier, password, returnTo } = req.body || {};
    const cleanId = String(identifier || '').trim().toLowerCase();
    const rawPwd = String(password || '');

    if (!cleanId || !rawPwd) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Masukkan username/email beserta password Anda.',
        },
      });
    }

    const db = getDb();
    const config = getRuntimeConfig();

    const userRow = db
      .prepare(`SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1`)
      .get(cleanId, cleanId) as Record<string, unknown> | undefined;

    const validPwd = userRow
      ? verifyPassword(rawPwd, String(userRow.password_hash))
      : verifyPassword(rawPwd, 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128));

    if (!userRow || !validPwd) {
      // Anti-enumeration: identical response whether username/email exists or password wrong
      return res.status(401).json({
        ok: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Username/email atau password yang Anda masukkan tidak sesuai.',
        },
      });
    }

    if (userRow.status !== 'ACTIVE') {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Akun Anda sedang dinonaktifkan sementara. Hubungi dukungan pelanggan AdViora.',
        },
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const rawSessionToken = generateRandomToken(32);
    const csrfToken = generateRandomToken(24);
    const sessionId = `ses_${crypto.randomUUID()}`;
    const ttlSeconds = config.sessionTtlHours * 3600;
    const expiresAtIso = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    db.prepare(
      `INSERT INTO sessions (
        id, token_hash, csrf_token, user_id, ip_address, user_agent, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      sha256Hex(rawSessionToken),
      csrfToken,
      String(userRow.id),
      getClientIp(req),
      String(req.headers['user-agent'] || '').slice(0, 200),
      expiresAtIso,
      nowIso
    );

    writeAuditLog({
      actorUserId: String(userRow.id),
      actorRole: String(userRow.role),
      action: 'USER_LOGIN_SUCCESS',
      entityType: 'SESSION',
      entityId: sessionId,
      ipAddress: getClientIp(req),
    });

    res.setHeader(
      'Set-Cookie',
      serializeSessionCookie(SESSION_COOKIE_NAME, rawSessionToken, ttlSeconds, config.isProduction)
    );

    const role = String(userRow.role) as 'CUSTOMER' | 'PARTNER' | 'ADMIN';
    const defaultRedirect =
      role === 'ADMIN' ? '/admin' : role === 'PARTNER' ? '/partner' : '/shop';

    return res.status(200).json({
      ok: true,
      user: {
        id: String(userRow.id),
        username: String(userRow.username),
        email: String(userRow.email),
        whatsapp: String(userRow.whatsapp),
        role,
        status: String(userRow.status),
        companyName: userRow.company_name ? String(userRow.company_name) : null,
        partnerTier: userRow.partner_tier ? String(userRow.partner_tier) : null,
        walletBalance: Number(userRow.wallet_balance || 0),
        apiKeyPrefix: userRow.api_key_prefix ? String(userRow.api_key_prefix) : null,
        forcePasswordRotation: Boolean(userRow.force_password_rotation),
      },
      csrfToken,
      redirectTo: sanitizeReturnUrl(returnTo, defaultRedirect),
    });
  });

  router.post('/auth/logout', (req, res) => {
    const config = getRuntimeConfig();
    const cookies = parseCookies(req.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];

    if (rawToken) {
      const db = getDb();
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`).run(
        new Date().toISOString(),
        sha256Hex(rawToken)
      );
    }

    res.setHeader(
      'Set-Cookie',
      serializeSessionCookie(SESSION_COOKIE_NAME, '', 0, config.isProduction)
    );

    return res.status(200).json({ ok: true, message: 'Sesi berhasil diakhiri.' });
  });

  router.post('/auth/change-password', requireAuth, requireCsrf, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const db = getDb();
    const userRow = db
      .prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .get(req.user!.id) as { password_hash: string } | undefined;

    if (!userRow || !verifyPassword(String(currentPassword || ''), userRow.password_hash)) {
      return res.status(401).json({
        ok: false,
        error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Password saat ini tidak sesuai.' },
      });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({
        ok: false,
        error: { code: 'WEAK_PASSWORD', message: strength.error },
      });
    }

    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE users SET password_hash = ?, force_password_rotation = 0, updated_at = ? WHERE id = ?`
    ).run(hashPassword(newPassword), nowIso, req.user!.id);

    // Revoke other sessions for security
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ?`).run(
      nowIso,
      req.user!.id,
      req.user!.sessionId
    );

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: 'PASSWORD_ROTATED',
      entityType: 'USER',
      entityId: req.user!.id,
      ipAddress: getClientIp(req),
    });

    return res.json({ ok: true, message: 'Password berhasil diperbarui.' });
  });

  // ==========================================================================
  // 3. PROTECTED CATALOG & PRODUCT DETAIL (/api/shop/*)
  // ==========================================================================

  router.get('/shop/catalog', requireAuth, (req, res) => {
    expireOverdueOrders();
    const db = getDb();

    const search = String(req.query.q || '').trim().toLowerCase();
    const categorySlug = String(req.query.category || '').trim().toLowerCase();
    const sort = String(req.query.sort || 'newest').trim();
    const inStockOnly = req.query.inStockOnly === 'true';
    const page = Math.max(1, Math.floor(Number(req.query.page || 1)));
    const pageSize = Math.min(24, Math.max(1, Math.floor(Number(req.query.pageSize || 12))));

    const whereClauses: string[] = ['p.is_published = 1'];
    const params: Array<string | number> = [];

    if (search) {
      whereClauses.push(
        `(LOWER(p.name) LIKE ? OR LOWER(p.short_description) LIKE ? OR LOWER(p.sku) LIKE ?)`
      );
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    if (categorySlug && categorySlug !== 'all') {
      whereClauses.push(`c.slug = ?`);
      params.push(categorySlug);
    }

    if (inStockOnly) {
      whereClauses.push(`p.stock_count > 0`);
    }

    const whereSql = whereClauses.join(' AND ');

    let orderBySql = 'p.created_at DESC';
    if (sort === 'price_asc') orderBySql = 'p.retail_price ASC';
    else if (sort === 'price_desc') orderBySql = 'p.retail_price DESC';
    else if (sort === 'name_asc') orderBySql = 'p.name ASC';

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as total
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE ${whereSql}`
      )
      .get(...params) as { total: number };

    const totalItems = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;

    const rows = db
      .prepare(
        `SELECT
           p.*,
           c.name as category_name,
           c.slug as category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE ${whereSql}
         ORDER BY ${orderBySql}
         LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, offset) as Array<Record<string, unknown>>;

    const categories = db
      .prepare(`SELECT id, slug, name FROM categories WHERE is_active = 1 ORDER BY sort_order ASC`)
      .all() as Array<{ id: string; slug: string; name: string }>;

    const isPartner = req.user!.role === 'PARTNER';

    return res.json({
      ok: true,
      data: {
        items: rows.map((r) => ({
          id: String(r.id),
          slug: String(r.slug),
          sku: String(r.sku),
          name: String(r.name),
          categoryId: String(r.category_id),
          categoryName: String(r.category_name),
          categorySlug: String(r.category_slug),
          shortDescription: String(r.short_description),
          durationLabel: String(r.duration_label),
          warrantyDays: Number(r.warranty_days),
          imageUrl: String(r.image_url),
          price: isPartner ? Number(r.partner_price) : Number(r.retail_price),
          retailPrice: Number(r.retail_price),
          partnerPrice: Number(r.partner_price),
          stockCount: Number(r.stock_count),
          deliveryType: String(r.delivery_type),
        })),
        categories,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      },
    });
  });

  router.get('/shop/products/:slug', requireAuth, (req, res) => {
    expireOverdueOrders();
    const db = getDb();
    const slugOrId = String(req.params.slug || '').trim();

    const row = db
      .prepare(
        `SELECT
           p.*,
           c.name as category_name,
           c.slug as category_slug
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE (p.slug = ? OR p.id = ?) AND p.is_published = 1
         LIMIT 1`
      )
      .get(slugOrId, slugOrId) as Record<string, unknown> | undefined;

    if (!row) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: 'Produk tidak ditemukan atau sudah ditarik dari katalog.',
        },
      });
    }

    // Re-sync stock count from vault to guarantee accuracy
    const liveStock = syncProductStockCount(db, String(row.id));
    const isPartner = req.user!.role === 'PARTNER';
    const config = getRuntimeConfig();

    return res.json({
      ok: true,
      data: {
        id: String(row.id),
        slug: String(row.slug),
        sku: String(row.sku),
        name: String(row.name),
        categoryId: String(row.category_id),
        categoryName: String(row.category_name),
        categorySlug: String(row.category_slug),
        shortDescription: String(row.short_description),
        description: String(row.description),
        termsAndConditions: String(row.terms_and_conditions),
        durationLabel: String(row.duration_label),
        warrantyDays: Number(row.warranty_days),
        warrantyTerms: String(row.warranty_terms),
        imageUrl: String(row.image_url),
        price: isPartner ? Number(row.partner_price) : Number(row.retail_price),
        retailPrice: Number(row.retail_price),
        partnerPrice: Number(row.partner_price),
        stockCount: liveStock.available,
        reservedCount: liveStock.reserved,
        deliveryType: String(row.delivery_type),
        paymentGatewayReady: config.qris.mode !== 'UNCONFIGURED',
        qrisProviderMode: config.qris.mode,
      },
    });
  });

  // ==========================================================================
  // 4. PROTECTED CHECKOUT, ORDERS & QRIS WEBHOOKS (/api/orders/*, /api/webhooks/*)
  // ==========================================================================

  router.post('/orders', requireAuth, requireCsrf, checkoutRateLimiter, (req, res) => {
    try {
      const { productId, quantity, idempotencyKey, notes, channel } = req.body || {};
      const orderDetail = createOrder({
        userId: req.user!.id,
        userRole: req.user!.role,
        userWhatsapp: req.user!.whatsapp,
        userEmail: req.user!.email,
        productId: String(productId || ''),
        quantity: Number(quantity || 1),
        idempotencyKey: String(idempotencyKey || ''),
        notes: notes ? String(notes) : undefined,
        channel:
          channel === 'PARTNER_PORTAL' && req.user!.role === 'PARTNER'
            ? 'PARTNER_PORTAL'
            : 'STORE_WEB',
      });

      return res.status(201).json({
        ok: true,
        data: orderDetail,
      });
    } catch (err) {
      if (err instanceof CommerceError) {
        return res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        ok: false,
        error: {
          code: 'ORDER_CREATION_ERROR',
          message: 'Terjadi kesalahan saat memproses pesanan Anda.',
        },
      });
    }
  });

  router.get('/orders', requireAuth, (req, res) => {
    expireOverdueOrders();
    const db = getDb();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();

    const whereClauses = ['o.user_id = ?'];
    const params: Array<string | number> = [req.user!.id];

    if (statusFilter && statusFilter !== 'ALL') {
      whereClauses.push('o.status = ?');
      params.push(statusFilter);
    }

    const orders = db
      .prepare(
        `SELECT
           o.*,
           oi.product_name_snapshot,
           oi.product_slug_snapshot,
           oi.quantity
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY o.created_at DESC
         LIMIT 50`
      )
      .all(...params) as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: orders.map((o) => ({
        id: String(o.id),
        orderNumber: String(o.order_number),
        status: String(o.status),
        productName: String(o.product_name_snapshot || 'Produk Digital'),
        productSlug: String(o.product_slug_snapshot || ''),
        quantity: Number(o.quantity || 1),
        totalAmount: Number(o.total_amount),
        currency: String(o.currency),
        expiresAt: String(o.expires_at),
        paidAt: o.paid_at ? String(o.paid_at) : null,
        completedAt: o.completed_at ? String(o.completed_at) : null,
        createdAt: String(o.created_at),
      })),
    });
  });

  router.get('/orders/:id', requireAuth, (req, res) => {
    try {
      const detail = getOrderDetailForUser(
        String(req.params.id),
        req.user!.id,
        req.user!.role
      );
      const config = getRuntimeConfig();
      return res.json({
        ok: true,
        data: {
          ...detail,
          sandboxModeAvailable: config.qris.mode === 'SANDBOX_SIMULATOR',
        },
      });
    } catch (err) {
      if (err instanceof CommerceError) {
        return res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        ok: false,
        error: { code: 'ORDER_FETCH_ERROR', message: 'Gagal memuat detail pesanan.' },
      });
    }
  });

  router.post('/orders/:id/cancel', requireAuth, requireCsrf, (req, res) => {
    try {
      const detail = getOrderDetailForUser(
        String(req.params.id),
        req.user!.id,
        req.user!.role
      );
      if (detail.status !== 'PENDING_PAYMENT') {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'CANNOT_CANCEL_ORDER',
            message: 'Hanya pesanan dengan status menunggu pembayaran yang dapat dibatalkan.',
          },
        });
      }

      const config = getRuntimeConfig();
      const webhookPayload: WebhookPaymentPayload = {
        eventId: `evt_cancel_${detail.orderNumber}_${Date.now()}`,
        orderNumber: detail.orderNumber,
        providerReference: detail.payment?.providerReference || `QRIS-${detail.orderNumber}`,
        merchantId: config.qris.merchantId,
        amount: detail.totalAmount,
        currency: 'IDR',
        paymentStatus: 'EXPIRED',
        timestamp: Date.now(),
      };
      const rawBody = JSON.stringify(webhookPayload);
      const sig = computeHmacSha256(rawBody, config.qris.webhookSecret);

      processPaymentWebhook({
        rawBody,
        signatureHeader: sig,
        payload: webhookPayload,
        actorType: 'ADMIN',
        actorId: req.user!.id,
      });

      const updated = getOrderDetailForUser(detail.id, req.user!.id, req.user!.role);
      return res.json({ ok: true, data: updated });
    } catch (err) {
      if (err instanceof CommerceError) {
        return res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        ok: false,
        error: { code: 'CANCEL_ERROR', message: 'Gagal membatalkan pesanan.' },
      });
    }
  });

  router.post('/orders/:id/warranty-claim', requireAuth, requireCsrf, (req, res) => {
    try {
      const detail = getOrderDetailForUser(
        String(req.params.id),
        req.user!.id,
        req.user!.role
      );
      if (detail.status !== 'COMPLETED') {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'ORDER_NOT_ELIGIBLE',
            message: 'Klaim garansi hanya dapat diajukan untuk pesanan yang telah selesai (COMPLETED).',
          },
        });
      }

      const { reason, evidenceNote } = req.body || {};
      if (!reason || String(reason).trim().length < 5) {
        return res.status(400).json({
          ok: false,
          error: { code: 'INVALID_REASON', message: 'Alasan klaim garansi minimal 5 karakter.' },
        });
      }

      const db = getDb();
      const now = new Date().toISOString();
      const claimId = `wcl_${crypto.randomUUID()}`;

      db.prepare(
        `INSERT INTO warranty_claims (
          id, order_id, user_id, reason, evidence_note, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)`
      ).run(
        claimId,
        detail.id,
        req.user!.id,
        String(reason).trim().slice(0, 200),
        String(evidenceNote || '-').trim().slice(0, 500),
        now,
        now
      );

      writeAuditLog({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'WARRANTY_CLAIM_CREATED',
        entityType: 'WARRANTY_CLAIM',
        entityId: claimId,
        ipAddress: getClientIp(req),
        metadata: { orderNumber: detail.orderNumber },
      });

      return res.status(201).json({
        ok: true,
        data: { claimId, status: 'OPEN' },
      });
    } catch (err) {
      if (err instanceof CommerceError) {
        return res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        ok: false,
        error: { code: 'WARRANTY_CLAIM_ERROR', message: 'Gagal mengajukan klaim garansi.' },
      });
    }
  });

  // Server-to-Server QRIS Payment Webhook Endpoint
  router.post('/webhooks/qris', (req, res) => {
    try {
      const signature = String(req.headers['x-adviora-signature'] || '');
      const rawBody = JSON.stringify(req.body || {});
      const result = processPaymentWebhook({
        rawBody,
        signatureHeader: signature,
        payload: req.body as WebhookPaymentPayload,
        actorType: 'WEBHOOK',
      });
      return res.status(200).json({ ok: true, data: result });
    } catch (err) {
      if (err instanceof CommerceError) {
        return res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        ok: false,
        error: { code: 'WEBHOOK_INTERNAL_ERROR', message: 'Gagal memproses webhook pembayaran.' },
      });
    }
  });

  // Sandbox Gateway Callback Trigger (ONLY active when QRIS_PROVIDER_MODE=SANDBOX_SIMULATOR or Admin)
  router.post('/orders/:id/sandbox-settle', requireAuth, requireCsrf, (req, res) => {
    const config = getRuntimeConfig();
    if (config.qris.mode !== 'SANDBOX_SIMULATOR' && req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'SANDBOX_DISABLED',
          message:
            'Simulasi callback gateway dinonaktifkan pada mode produksi. Pembayaran hanya diverifikasi melalui webhook resmi provider.',
        },
      });
    }

    try {
      const detail = getOrderDetailForUser(
        String(req.params.id),
        req.user!.id,
        req.user!.role
      );

      if (detail.status !== 'PENDING_PAYMENT') {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'ORDER_NOT_PENDING',
            message: `Order sudah berada pada status ${detail.status}.`,
          },
        });
      }

      const webhookPayload: WebhookPaymentPayload = {
        eventId: `evt_qris_paid_${detail.orderNumber}`,
        orderNumber: detail.orderNumber,
        providerReference: detail.payment?.providerReference || `QRIS-${detail.orderNumber}`,
        merchantId: config.qris.merchantId,
        amount: detail.totalAmount,
        currency: 'IDR',
        paymentStatus: 'PAID',
        timestamp: Date.now(),
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = computeHmacSha256(rawBody, config.qris.webhookSecret);

      processPaymentWebhook({
        rawBody,
        signatureHeader: signature,
        payload: webhookPayload,
        actorType: 'WEBHOOK',
      });

      const updated = getOrderDetailForUser(detail.id, req.user!.id, req.user!.role);
      return res.json({
        ok: true,
        data: updated,
      });
    } catch (err) {
      if (err instanceof CommerceError) {
        return res.status(err.statusCode).json({
          ok: false,
          error: { code: err.code, message: err.message },
        });
      }
      return res.status(500).json({
        ok: false,
        error: { code: 'SANDBOX_SETTLE_ERROR', message: 'Gagal memverifikasi simulasi webhook.' },
      });
    }
  });

  // ==========================================================================
  // 5. NOTIFICATIONS CENTER (/api/notifications/*)
  // ==========================================================================

  router.get('/notifications', requireAuth, (req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM notifications
         WHERE user_id = ? OR scope = 'PUBLIC_STOCK'
         ORDER BY created_at DESC
         LIMIT 30`
      )
      .all(req.user!.id) as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((n) => ({
        id: String(n.id),
        scope: String(n.scope),
        title: String(n.title),
        message: String(n.message),
        category: String(n.category),
        linkUrl: n.link_url ? String(n.link_url) : null,
        isRead: Boolean(n.is_read),
        createdAt: String(n.created_at),
      })),
    });
  });

  router.post('/notifications/mark-read', requireAuth, requireCsrf, (req, res) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user!.id);
    return res.json({ ok: true });
  });

  // ==========================================================================
  // 6. PARTNER PORTAL B2B ENDPOINTS (/api/partner/*)
  // ==========================================================================

  router.get(
    '/partner/overview',
    requireAuth,
    requireRole(['PARTNER', 'ADMIN']),
    (req, res) => {
      const db = getDb();
      const userId = req.user!.id;

      const orderStats = db
        .prepare(
          `SELECT
             COUNT(*) as total_orders,
             COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_amount ELSE 0 END), 0) as total_spend
           FROM orders
           WHERE user_id = ?`
        )
        .get(userId) as { total_orders: number; total_spend: number };

      const claims = db
        .prepare(
          `SELECT wc.*, o.order_number
           FROM warranty_claims wc
           JOIN orders o ON o.id = wc.order_id
           WHERE wc.user_id = ?
           ORDER BY wc.created_at DESC
           LIMIT 20`
        )
        .all(userId) as Array<Record<string, unknown>>;

      return res.json({
        ok: true,
        data: {
          partnerProfile: {
            id: req.user!.id,
            username: req.user!.username,
            companyName: req.user!.companyName || 'Partner B2B AdViora',
            partnerTier: req.user!.partnerTier || 'STARTER',
            walletBalance: req.user!.walletBalance,
            apiKeyPrefix: req.user!.apiKeyPrefix,
          },
          metrics: {
            totalOrders: Number(orderStats?.total_orders || 0),
            totalSpend: Number(orderStats?.total_spend || 0),
          },
          warrantyClaims: claims.map((c) => ({
            id: String(c.id),
            orderId: String(c.order_id),
            orderNumber: String(c.order_number),
            reason: String(c.reason),
            evidenceNote: String(c.evidence_note),
            status: String(c.status),
            adminResolutionNote: c.admin_resolution_note ? String(c.admin_resolution_note) : null,
            createdAt: String(c.created_at),
          })),
        },
      });
    }
  );

  router.post(
    '/partner/rotate-api-key',
    requireAuth,
    requireRole(['PARTNER', 'ADMIN']),
    requireCsrf,
    (req, res) => {
      const db = getDb();
      const rawKey = `adv_live_${crypto.randomBytes(18).toString('hex')}`;
      const prefix = rawKey.slice(0, 14);
      const nowIso = new Date().toISOString();

      db.prepare(
        `UPDATE users SET api_key_hash = ?, api_key_prefix = ?, updated_at = ? WHERE id = ?`
      ).run(sha256Hex(rawKey), prefix, nowIso, req.user!.id);

      writeAuditLog({
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action: 'PARTNER_API_KEY_ROTATED',
        entityType: 'USER',
        entityId: req.user!.id,
        ipAddress: getClientIp(req),
      });

      return res.json({
        ok: true,
        data: {
          rawApiKey: rawKey,
          apiKeyPrefix: prefix,
          warning:
            'Simpan API Key ini di server Anda. Demi keamanan, kunci penuh hanya ditampilkan satu kali.',
        },
      });
    }
  );

  // ==========================================================================
  // 7. ADMIN DASHBOARD ENDPOINTS (/api/admin/* — STRICT ADMIN RBAC)
  // ==========================================================================

  router.use('/admin', requireAuth, requireRole(['ADMIN']));

  router.get('/admin/overview', async (_req, res) => {
    expireOverdueOrders();
    const db = getDb();
    const config = getRuntimeConfig();

    const summary = db
      .prepare(
        `SELECT
           COUNT(*) as total_orders,
           COALESCE(SUM(CASE WHEN status IN ('PAID', 'COMPLETED') THEN total_amount ELSE 0 END), 0) as total_revenue,
           SUM(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) as pending_orders,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
           SUM(CASE WHEN status = 'PROCESSING' OR status = 'FAILED' THEN 1 ELSE 0 END) as attention_orders
         FROM orders`
      )
      .get() as Record<string, number>;

    const customerCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role = 'CUSTOMER'`).get() as {
        cnt: number;
      }
    ).cnt;

    const partnerCount = (
      db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role = 'PARTNER'`).get() as {
        cnt: number;
      }
    ).cnt;

    const lowStockProducts = db
      .prepare(
        `SELECT id, name, sku, stock_count, reserved_count
         FROM products
         WHERE stock_count <= 3
         ORDER BY stock_count ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const recentAuditLogs = db
      .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 25`)
      .all() as Array<Record<string, unknown>>;

    const recentWebhooks = db
      .prepare(`SELECT * FROM payment_webhook_events ORDER BY created_at DESC LIMIT 15`)
      .all() as Array<Record<string, unknown>>;

    const waBotHealth = await checkWhatsAppBotHealth();

    return res.json({
      ok: true,
      data: {
        metrics: {
          totalOrders: Number(summary?.total_orders || 0),
          totalRevenue: Number(summary?.total_revenue || 0),
          pendingOrders: Number(summary?.pending_orders || 0),
          completedOrders: Number(summary?.completed_orders || 0),
          attentionOrders: Number(summary?.attention_orders || 0),
          customerCount: Number(customerCount || 0),
          partnerCount: Number(partnerCount || 0),
        },
        lowStockProducts: lowStockProducts.map((p) => ({
          id: String(p.id),
          name: String(p.name),
          sku: String(p.sku),
          stockCount: Number(p.stock_count),
          reservedCount: Number(p.reserved_count),
        })),
        systemStatus: {
          qrisProviderMode: config.qris.mode,
          qrisMerchantId: config.qris.merchantId,
          qrisMerchantName: config.qris.merchantName,
          webhookSecretConfigured: Boolean(config.qris.webhookSecret),
          fulfillmentMode: config.fulfillment.mode,
          waBotV32: waBotHealth,
        },
        recentWebhooks: recentWebhooks.map((w) => ({
          id: String(w.id),
          eventId: String(w.event_id),
          provider: String(w.provider),
          orderNumber: String(w.order_number),
          status: String(w.status),
          processedAt: String(w.processed_at),
        })),
        recentAuditLogs: recentAuditLogs.map((a) => ({
          id: String(a.id),
          actorUserId: a.actor_user_id ? String(a.actor_user_id) : null,
          actorRole: String(a.actor_role),
          action: String(a.action),
          entityType: String(a.entity_type),
          entityId: a.entity_id ? String(a.entity_id) : null,
          ipAddress: String(a.ip_address || ''),
          createdAt: String(a.created_at),
        })),
      },
    });
  });

  router.get('/admin/products', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.*, c.name as category_name
         FROM products p
         JOIN categories c ON c.id = p.category_id
         ORDER BY p.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const categories = db
      .prepare(`SELECT id, slug, name FROM categories ORDER BY sort_order ASC`)
      .all() as Array<{ id: string; slug: string; name: string }>;

    return res.json({
      ok: true,
      data: {
        products: rows.map((r) => ({
          id: String(r.id),
          slug: String(r.slug),
          sku: String(r.sku),
          name: String(r.name),
          categoryId: String(r.category_id),
          categoryName: String(r.category_name),
          shortDescription: String(r.short_description),
          description: String(r.description),
          termsAndConditions: String(r.terms_and_conditions),
          durationLabel: String(r.duration_label),
          warrantyDays: Number(r.warranty_days),
          warrantyTerms: String(r.warranty_terms),
          imageUrl: String(r.image_url),
          retailPrice: Number(r.retail_price),
          partnerPrice: Number(r.partner_price),
          stockCount: Number(r.stock_count),
          reservedCount: Number(r.reserved_count),
          isPublished: Boolean(r.is_published),
          deliveryType: String(r.delivery_type),
        })),
        categories,
      },
    });
  });

  router.post('/admin/products', requireCsrf, (req, res) => {
    const {
      name,
      slug,
      sku,
      categoryId,
      shortDescription,
      description,
      termsAndConditions,
      durationLabel,
      warrantyDays,
      warrantyTerms,
      imageUrl,
      retailPrice,
      partnerPrice,
      isPublished,
      deliveryType,
    } = req.body || {};

    if (!name || !slug || !sku || !categoryId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_PRODUCT_DATA', message: 'Nama, slug, SKU, dan kategori wajib diisi.' },
      });
    }

    const rPrice = Math.max(0, Math.floor(Number(retailPrice || 0)));
    const pPrice = Math.max(0, Math.floor(Number(partnerPrice || rPrice)));

    const db = getDb();
    const now = new Date().toISOString();
    const productId = `prd_${crypto.randomUUID()}`;

    try {
      db.prepare(
        `INSERT INTO products (
          id, slug, sku, name, category_id, short_description, description,
          terms_and_conditions, duration_label, warranty_days, warranty_terms,
          image_url, retail_price, partner_price, stock_count, reserved_count,
          is_published, delivery_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
      ).run(
        productId,
        String(slug).trim().toLowerCase(),
        String(sku).trim().toUpperCase(),
        String(name).trim(),
        String(categoryId),
        String(shortDescription || name).trim(),
        String(description || shortDescription || name).trim(),
        String(termsAndConditions || 'Mengikuti ketentuan layanan standar AdViora.').trim(),
        String(durationLabel || '1 Bulan (30 Hari)').trim(),
        Math.max(0, Math.floor(Number(warrantyDays ?? 30))),
        String(warrantyTerms || 'Garansi resmi sesuai masa aktif.').trim(),
        String(imageUrl || '/src/assets/images/product_cloud_workspace_1791793694973.jpg').trim(),
        rPrice,
        pPrice,
        isPublished === false ? 0 : 1,
        deliveryType === 'INSTANT_CREDENTIAL' || deliveryType === 'INVITE_LINK'
          ? deliveryType
          : 'LICENSE_KEY',
        now,
        now
      );

      writeAuditLog({
        actorUserId: req.user!.id,
        actorRole: 'ADMIN',
        action: 'PRODUCT_CREATED',
        entityType: 'PRODUCT',
        entityId: productId,
        ipAddress: getClientIp(req),
        metadata: { name, sku, retailPrice: rPrice },
      });

      return res.status(201).json({ ok: true, data: { productId } });
    } catch (err) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'DUPLICATE_SLUG_OR_SKU',
          message: err instanceof Error ? err.message : 'Slug atau SKU produk sudah digunakan.',
        },
      });
    }
  });

  router.put('/admin/products/:id', requireCsrf, (req, res) => {
    const productId = String(req.params.id);
    const {
      name,
      slug,
      sku,
      categoryId,
      shortDescription,
      description,
      termsAndConditions,
      durationLabel,
      warrantyDays,
      warrantyTerms,
      imageUrl,
      retailPrice,
      partnerPrice,
      isPublished,
    } = req.body || {};

    const db = getDb();
    const existing = db.prepare(`SELECT id FROM products WHERE id = ?`).get(productId);
    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'Produk tidak ditemukan.' },
      });
    }

    const rPrice = Math.max(0, Math.floor(Number(retailPrice || 0)));
    const pPrice = Math.max(0, Math.floor(Number(partnerPrice || rPrice)));
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE products
       SET name = ?, slug = ?, sku = ?, category_id = ?, short_description = ?,
           description = ?, terms_and_conditions = ?, duration_label = ?,
           warranty_days = ?, warranty_terms = ?, image_url = ?,
           retail_price = ?, partner_price = ?, is_published = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      String(name).trim(),
      String(slug).trim().toLowerCase(),
      String(sku).trim().toUpperCase(),
      String(categoryId),
      String(shortDescription).trim(),
      String(description).trim(),
      String(termsAndConditions).trim(),
      String(durationLabel).trim(),
      Math.max(0, Math.floor(Number(warrantyDays ?? 30))),
      String(warrantyTerms).trim(),
      String(imageUrl).trim(),
      rPrice,
      pPrice,
      isPublished ? 1 : 0,
      now,
      productId
    );

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: 'PRODUCT_UPDATED',
      entityType: 'PRODUCT',
      entityId: productId,
      ipAddress: getClientIp(req),
      metadata: { name, retailPrice: rPrice, isPublished: Boolean(isPublished) },
    });

    return res.json({ ok: true });
  });

  // Vault Inventory Management & Stock Audit
  router.get('/admin/products/:id/inventory', (req, res) => {
    const productId = String(req.params.id);
    const db = getDb();
    const items = db
      .prepare(
        `SELECT id, credential_payload, batch_note, status, reserved_order_id, claimed_order_id, claimed_at, created_at
         FROM inventory_items
         WHERE product_id = ?
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .all(productId) as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: items.map((i) => {
        const raw = String(i.credential_payload);
        const masked =
          raw.length > 8 ? `${raw.slice(0, 6)}••••${raw.slice(-4)}` : '••••••••';
        return {
          id: String(i.id),
          maskedPayload: masked,
          batchNote: i.batch_note ? String(i.batch_note) : null,
          status: String(i.status),
          reservedOrderId: i.reserved_order_id ? String(i.reserved_order_id) : null,
          claimedOrderId: i.claimed_order_id ? String(i.claimed_order_id) : null,
          claimedAt: i.claimed_at ? String(i.claimed_at) : null,
          createdAt: String(i.created_at),
        };
      }),
    });
  });

  router.post('/admin/products/:id/inventory', requireCsrf, (req, res) => {
    const productId = String(req.params.id);
    const { credentialsList, batchNote } = req.body || {};

    const rawLines = Array.isArray(credentialsList)
      ? credentialsList
      : String(credentialsList || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

    if (rawLines.length === 0) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'EMPTY_INVENTORY_BATCH',
          message: 'Masukkan minimal 1 baris kode lisensi / kredensial untuk ditambahkan ke brankas stok.',
        },
      });
    }

    const config = getRuntimeConfig();

    const result = withTransaction((db) => {
      const product = db
        .prepare(`SELECT id, name, slug, stock_count FROM products WHERE id = ?`)
        .get(productId) as
        | { id: string; name: string; slug: string; stock_count: number }
        | undefined;

      if (!product) {
        throw new CommerceError('PRODUCT_NOT_FOUND', 'Produk tidak ditemukan.', 404);
      }

      const prevStock = Number(product.stock_count);
      const now = new Date().toISOString();

      const insertStmt = db.prepare(
        `INSERT INTO inventory_items (
          id, product_id, credential_payload, batch_note, status, created_at
        ) VALUES (?, ?, ?, ?, 'AVAILABLE', ?)`
      );

      for (const cred of rawLines) {
        insertStmt.run(
          `inv_${crypto.randomUUID()}`,
          productId,
          String(cred).trim(),
          String(batchNote || 'Admin Restock').trim().slice(0, 120),
          now
        );
      }

      const updated = syncProductStockCount(db, productId);

      db.prepare(
        `INSERT INTO stock_audit_logs (
          id, product_id, actor_user_id, change_type, delta, previous_stock, new_stock, reference_order_id, reason, created_at
        ) VALUES (?, ?, ?, 'RESTOCK', ?, ?, ?, NULL, ?, ?)`
      ).run(
        `sal_${crypto.randomUUID()}`,
        productId,
        req.user!.id,
        rawLines.length,
        prevStock,
        updated.available,
        String(batchNote || `Penambahan ${rawLines.length} unit stok lisensi oleh Admin`),
        now
      );

      // Broadcast public stock restock notification
      db.prepare(
        `INSERT INTO notifications (
          id, user_id, scope, title, message, category, link_url, is_read, created_at
        ) VALUES (?, NULL, 'PUBLIC_STOCK', ?, ?, 'STOCK', ?, 0, ?)`
      ).run(
        `ntf_${crypto.randomUUID()}`,
        `Stok Tersedia Kembali: ${product.name}`,
        `Admin telah menambahkan +${rawLines.length} unit stok terverifikasi untuk ${product.name}. Total tersedia: ${updated.available} unit.`,
        `/product/${product.slug}`,
        now
      );

      if (config.waBotV32.adminGroupJid) {
        enqueueWhatsAppOutbox({
          idempotencyKey: `wa_admin_restock_${productId}_${Date.now()}`,
          targetType: 'ADMIN_GROUP',
          recipient: config.waBotV32.adminGroupJid,
          eventType: 'STOCK_CHANGED',
          payload: {
            productName: product.name,
            addedUnits: rawLines.length,
            previousStock: prevStock,
            newStock: updated.available,
          },
        });
      }

      return { added: rawLines.length, newStock: updated.available };
    });

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: 'INVENTORY_RESTOCKED',
      entityType: 'PRODUCT',
      entityId: productId,
      ipAddress: getClientIp(req),
      metadata: result,
    });

    return res.status(201).json({ ok: true, data: result });
  });

  router.get('/admin/stock-audit', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT sal.*, p.name as product_name, p.sku as product_sku, u.username as actor_username
         FROM stock_audit_logs sal
         JOIN products p ON p.id = sal.product_id
         LEFT JOIN users u ON u.id = sal.actor_user_id
         ORDER BY sal.created_at DESC
         LIMIT 60`
      )
      .all() as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r.id),
        productId: String(r.product_id),
        productName: String(r.product_name),
        productSku: String(r.product_sku),
        actorUsername: r.actor_username ? String(r.actor_username) : 'SYSTEM',
        changeType: String(r.change_type),
        delta: Number(r.delta),
        previousStock: Number(r.previous_stock),
        newStock: Number(r.new_stock),
        referenceOrderId: r.reference_order_id ? String(r.reference_order_id) : null,
        reason: String(r.reason),
        createdAt: String(r.created_at),
      })),
    });
  });

  router.get('/admin/orders', (req, res) => {
    expireOverdueOrders();
    const db = getDb();
    const status = String(req.query.status || '').trim().toUpperCase();
    const q = String(req.query.q || '').trim().toLowerCase();

    const whereClauses: string[] = ['1=1'];
    const params: Array<string | number> = [];

    if (status && status !== 'ALL') {
      whereClauses.push('o.status = ?');
      params.push(status);
    }
    if (q) {
      whereClauses.push(
        '(LOWER(o.order_number) LIKE ? OR LOWER(u.username) LIKE ? OR LOWER(o.customer_email) LIKE ?)'
      );
      const pat = `%${q}%`;
      params.push(pat, pat, pat);
    }

    const rows = db
      .prepare(
        `SELECT
           o.*,
           u.username as buyer_username,
           u.role as buyer_role,
           oi.product_name_snapshot,
           oi.quantity,
           p.status as payment_status,
           f.status as fulfillment_status,
           f.whatsapp_delivery_status
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN payments p ON p.order_id = o.id
         LEFT JOIN fulfillments f ON f.order_id = o.id
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY o.created_at DESC
         LIMIT 100`
      )
      .all(...params) as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r.id),
        orderNumber: String(r.order_number),
        buyerUsername: String(r.buyer_username),
        buyerRole: String(r.buyer_role),
        customerWhatsapp: String(r.customer_whatsapp),
        customerEmail: String(r.customer_email),
        productName: String(r.product_name_snapshot || 'Produk Digital'),
        quantity: Number(r.quantity || 1),
        totalAmount: Number(r.total_amount),
        status: String(r.status),
        paymentStatus: String(r.payment_status || 'PENDING'),
        fulfillmentStatus: r.fulfillment_status ? String(r.fulfillment_status) : null,
        whatsappDeliveryStatus: r.whatsapp_delivery_status
          ? String(r.whatsapp_delivery_status)
          : null,
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/admin/orders/:id/action', requireCsrf, (req, res) => {
    const orderId = String(req.params.id);
    const { action, note } = req.body || {};
    const cleanNote = String(note || '').trim();

    if (!cleanNote || cleanNote.length < 5) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'AUDIT_NOTE_REQUIRED',
          message: 'Catatan audit wajib diisi (minimal 5 karakter) untuk setiap tindakan manual Admin.',
        },
      });
    }

    const db = getDb();
    const config = getRuntimeConfig();
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as
      | Record<string, unknown>
      | undefined;

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: { code: 'ORDER_NOT_FOUND', message: 'Order tidak ditemukan.' },
      });
    }

    const nowIso = new Date().toISOString();

    if (action === 'VERIFY_AND_FULFILL') {
      const payload: WebhookPaymentPayload = {
        eventId: `evt_admin_manual_${order.order_number}_${Date.now()}`,
        orderNumber: String(order.order_number),
        providerReference: `ADMIN-MANUAL-${order.order_number}`,
        merchantId: config.qris.merchantId,
        amount: Number(order.total_amount),
        currency: 'IDR',
        paymentStatus: 'PAID',
        timestamp: Date.now(),
      };
      const rawBody = JSON.stringify(payload);
      const sig = computeHmacSha256(rawBody, config.qris.webhookSecret);

      processPaymentWebhook({
        rawBody,
        signatureHeader: sig,
        payload,
        actorType: 'ADMIN',
        actorId: req.user!.id,
      });

      writeAuditLog({
        actorUserId: req.user!.id,
        actorRole: 'ADMIN',
        action: 'ADMIN_MANUAL_ORDER_VERIFY',
        entityType: 'ORDER',
        entityId: orderId,
        ipAddress: getClientIp(req),
        metadata: { orderNumber: order.order_number, note: cleanNote },
      });

      return res.json({
        ok: true,
        data: getOrderDetailForUser(orderId, req.user!.id, 'ADMIN'),
      });
    }

    if (action === 'REFUND_ORDER') {
      withTransaction((txDb) => {
        txDb
          .prepare(`UPDATE orders SET status = 'REFUNDED', updated_at = ? WHERE id = ?`)
          .run(nowIso, orderId);
        txDb
          .prepare(`UPDATE payments SET status = 'REFUNDED', updated_at = ? WHERE order_id = ?`)
          .run(nowIso, orderId);
        txDb
          .prepare(
            `INSERT INTO order_status_history (
              id, order_id, from_status, to_status, actor_type, actor_id, note, created_at
            ) VALUES (?, ?, ?, 'REFUNDED', 'ADMIN', ?, ?, ?)`
          )
          .run(
            `osh_${crypto.randomUUID()}`,
            orderId,
            String(order.status),
            req.user!.id,
            `Order di-refund oleh Admin: ${cleanNote}`,
            nowIso
          );
      });

      writeAuditLog({
        actorUserId: req.user!.id,
        actorRole: 'ADMIN',
        action: 'ADMIN_ORDER_REFUNDED',
        entityType: 'ORDER',
        entityId: orderId,
        ipAddress: getClientIp(req),
        metadata: { orderNumber: order.order_number, note: cleanNote },
      });

      return res.json({
        ok: true,
        data: getOrderDetailForUser(orderId, req.user!.id, 'ADMIN'),
      });
    }

    return res.status(400).json({
      ok: false,
      error: { code: 'UNKNOWN_ACTION', message: 'Tindakan manual tidak dikenali.' },
    });
  });

  // Admin Customer & Partner Management
  router.get('/admin/customers', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT
           u.id, u.username, u.email, u.whatsapp, u.role, u.status,
           u.company_name, u.partner_tier, u.wallet_balance, u.created_at,
           COUNT(o.id) as order_count,
           COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.total_amount ELSE 0 END), 0) as total_spent
         FROM users u
         LEFT JOIN orders o ON o.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((u) => ({
        id: String(u.id),
        username: String(u.username),
        email: String(u.email),
        whatsapp: String(u.whatsapp),
        role: String(u.role),
        status: String(u.status),
        companyName: u.company_name ? String(u.company_name) : null,
        partnerTier: u.partner_tier ? String(u.partner_tier) : null,
        walletBalance: Number(u.wallet_balance || 0),
        orderCount: Number(u.order_count || 0),
        totalSpent: Number(u.total_spent || 0),
        createdAt: String(u.created_at),
      })),
    });
  });

  router.patch('/admin/customers/:id/status', requireCsrf, (req, res) => {
    const targetUserId = String(req.params.id);
    const { status, reason } = req.body || {};

    if (targetUserId === req.user!.id) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'CANNOT_SUSPEND_SELF',
          message: 'Anda tidak dapat menonaktifkan akun Admin Anda sendiri.',
        },
      });
    }

    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_STATUS', message: 'Status akun harus ACTIVE atau SUSPENDED.' },
      });
    }

    const db = getDb();
    const nowIso = new Date().toISOString();

    db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).run(
      status,
      nowIso,
      targetUserId
    );

    if (status === 'SUSPENDED') {
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ?`).run(nowIso, targetUserId);
    }

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: `USER_STATUS_${status}`,
      entityType: 'USER',
      entityId: targetUserId,
      ipAddress: getClientIp(req),
      metadata: { reason: String(reason || '') },
    });

    return res.json({ ok: true });
  });

  // Admin Partner Applications Review
  router.get('/admin/partner-applications', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM partner_applications ORDER BY created_at DESC`)
      .all() as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r.id),
        applicantName: String(r.applicant_name),
        businessName: String(r.business_name),
        email: String(r.email),
        whatsapp: String(r.whatsapp),
        websiteOrChannel: String(r.website_or_channel),
        estimatedMonthlyVolume: String(r.estimated_monthly_volume),
        useCase: String(r.use_case),
        status: String(r.status),
        reviewNote: r.review_note ? String(r.review_note) : null,
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/admin/partner-applications/:id/review', requireCsrf, (req, res) => {
    const appId = String(req.params.id);
    const { decision, reviewNote } = req.body || {};

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'Keputusan harus APPROVED atau REJECTED.' },
      });
    }

    const db = getDb();
    const nowIso = new Date().toISOString();
    const appRow = db
      .prepare(`SELECT * FROM partner_applications WHERE id = ?`)
      .get(appId) as Record<string, unknown> | undefined;

    if (!appRow) {
      return res.status(404).json({
        ok: false,
        error: { code: 'APPLICATION_NOT_FOUND', message: 'Permohonan partner tidak ditemukan.' },
      });
    }

    db.prepare(
      `UPDATE partner_applications
       SET status = ?, reviewed_by = ?, review_note = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      decision,
      req.user!.id,
      String(reviewNote || '').trim().slice(0, 300),
      nowIso,
      appId
    );

    if (decision === 'APPROVED') {
      // Upgrade existing user with matching email to PARTNER role if present
      db.prepare(
        `UPDATE users
         SET role = 'PARTNER', company_name = ?, partner_tier = 'PRO', updated_at = ?
         WHERE email = ? AND role = 'CUSTOMER'`
      ).run(String(appRow.business_name), nowIso, String(appRow.email).toLowerCase());
    }

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: `PARTNER_APPLICATION_${decision}`,
      entityType: 'PARTNER_APPLICATION',
      entityId: appId,
      ipAddress: getClientIp(req),
      metadata: { businessName: appRow.business_name, reviewNote },
    });

    return res.json({ ok: true });
  });

  // Admin Announcements CRUD
  router.get('/admin/announcements', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM announcements ORDER BY created_at DESC`)
      .all() as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((a) => ({
        id: String(a.id),
        title: String(a.title),
        content: String(a.content),
        variant: String(a.variant),
        targetAudience: String(a.target_audience),
        isActive: Boolean(a.is_active),
        createdAt: String(a.created_at),
      })),
    });
  });

  router.post('/admin/announcements', requireCsrf, (req, res) => {
    const { title, content, variant, targetAudience } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_ANNOUNCEMENT', message: 'Judul dan isi pengumuman wajib diisi.' },
      });
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = `ann_${crypto.randomUUID()}`;

    db.prepare(
      `INSERT INTO announcements (
        id, title, content, variant, target_audience, is_active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      id,
      String(title).trim().slice(0, 120),
      String(content).trim().slice(0, 400),
      ['INFO', 'PROMO', 'MAINTENANCE', 'WARNING'].includes(variant) ? variant : 'INFO',
      ['ALL', 'CUSTOMER', 'PARTNER'].includes(targetAudience) ? targetAudience : 'ALL',
      req.user!.id,
      now,
      now
    );

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: 'ANNOUNCEMENT_CREATED',
      entityType: 'ANNOUNCEMENT',
      entityId: id,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ ok: true, data: { id } });
  });

  router.patch('/admin/announcements/:id', requireCsrf, (req, res) => {
    const id = String(req.params.id);
    const { isActive } = req.body || {};
    const db = getDb();
    db.prepare(`UPDATE announcements SET is_active = ?, updated_at = ? WHERE id = ?`).run(
      isActive ? 1 : 0,
      new Date().toISOString(),
      id
    );
    return res.json({ ok: true });
  });

  router.delete('/admin/announcements/:id', requireCsrf, (req, res) => {
    const id = String(req.params.id);
    const db = getDb();
    db.prepare(`DELETE FROM announcements WHERE id = ?`).run(id);
    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: 'ANNOUNCEMENT_DELETED',
      entityType: 'ANNOUNCEMENT',
      entityId: id,
      ipAddress: getClientIp(req),
    });
    return res.json({ ok: true });
  });

  // Admin Warranty Claims Resolution
  router.get('/admin/warranty-claims', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT wc.*, o.order_number, u.username, u.whatsapp
         FROM warranty_claims wc
         JOIN orders o ON o.id = wc.order_id
         JOIN users u ON u.id = wc.user_id
         ORDER BY wc.created_at DESC`
      )
      .all() as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r.id),
        orderId: String(r.order_id),
        orderNumber: String(r.order_number),
        username: String(r.username),
        whatsapp: String(r.whatsapp),
        reason: String(r.reason),
        evidenceNote: String(r.evidence_note),
        status: String(r.status),
        adminResolutionNote: r.admin_resolution_note ? String(r.admin_resolution_note) : null,
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/admin/warranty-claims/:id/resolve', requireCsrf, (req, res) => {
    const claimId = String(req.params.id);
    const { status, resolutionNote } = req.body || {};
    if (!['INVESTIGATING', 'REPLACED', 'REFUNDED', 'REJECTED'].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_STATUS', message: 'Status resolusi garansi tidak valid.' },
      });
    }

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE warranty_claims SET status = ?, admin_resolution_note = ?, updated_at = ? WHERE id = ?`
    ).run(status, String(resolutionNote || '').trim().slice(0, 300), now, claimId);

    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: `WARRANTY_CLAIM_${status}`,
      entityType: 'WARRANTY_CLAIM',
      entityId: claimId,
      ipAddress: getClientIp(req),
    });

    return res.json({ ok: true });
  });

  // Admin WhatsApp Outbox Queue Inspection & Retry
  router.get('/admin/whatsapp-outbox', (_req, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, idempotency_key, order_id, target_type, recipient, event_type,
                status, attempts, max_attempts, next_retry_at, last_error, sent_at, created_at
         FROM whatsapp_outbox
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all() as Array<Record<string, unknown>>;

    return res.json({
      ok: true,
      data: rows.map((r) => ({
        id: String(r.id),
        idempotencyKey: String(r.idempotency_key),
        orderId: r.order_id ? String(r.order_id) : null,
        targetType: String(r.target_type),
        recipient: String(r.recipient),
        eventType: String(r.event_type),
        status: String(r.status),
        attempts: Number(r.attempts),
        maxAttempts: Number(r.max_attempts),
        nextRetryAt: String(r.next_retry_at),
        lastError: r.last_error ? String(r.last_error) : null,
        sentAt: r.sent_at ? String(r.sent_at) : null,
        createdAt: String(r.created_at),
      })),
    });
  });

  router.post('/admin/whatsapp-outbox/flush', requireCsrf, async (req, res) => {
    const db = getDb();
    // Reset next_retry_at so retryable items can be processed immediately
    db.prepare(
      `UPDATE whatsapp_outbox
       SET next_retry_at = ?
       WHERE status IN ('PENDING', 'FAILED_RETRYABLE')`
    ).run(new Date().toISOString());

    const outcome = await processWhatsAppOutboxBatch(20);
    writeAuditLog({
      actorUserId: req.user!.id,
      actorRole: 'ADMIN',
      action: 'WHATSAPP_OUTBOX_MANUAL_FLUSH',
      entityType: 'WHATSAPP_OUTBOX',
      ipAddress: getClientIp(req),
      metadata: outcome,
    });

    return res.json({ ok: true, data: outcome });
  });

  return router;
}
