import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, originalHex] = parts;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const original = Buffer.from(originalHex, 'hex');
    if (derived.length !== original.length) return false;
    return crypto.timingSafeEqual(derived, original);
  } catch {
    return false;
  }
}

export function generateRandomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function computeHmacSha256(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmacSignature(
  payload: string,
  signatureHex: string,
  secret: string
): boolean {
  try {
    if (!signatureHex || !secret) return false;
    const expectedHex = computeHmacSha256(payload, secret);
    const a = Buffer.from(signatureHex.trim().toLowerCase(), 'hex');
    const b = Buffer.from(expectedHex.toLowerCase(), 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function normalizeWhatsappPhone(raw: string): { valid: boolean; normalized: string; error?: string } {
  const cleaned = String(raw || '').replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, normalized: '', error: 'Nomor WhatsApp hanya boleh berisi angka.' };
  }
  let normalized = cleaned;
  if (normalized.startsWith('08')) {
    normalized = '62' + normalized.slice(1);
  } else if (normalized.startsWith('8')) {
    normalized = '62' + normalized;
  }
  if (!normalized.startsWith('628') || normalized.length < 10 || normalized.length > 15) {
    return {
      valid: false,
      normalized,
      error: 'Format nomor WhatsApp harus aktif dan diawali 08xx atau 628xx (10–15 digit).',
    };
  }
  return { valid: true, normalized };
}

export function validateEmailFormat(email: string): boolean {
  const trimmed = String(email || '').trim().toLowerCase();
  if (trimmed.length < 5 || trimmed.length > 120) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function validateUsernameFormat(username: string): { valid: boolean; cleaned: string; error?: string } {
  const cleaned = String(username || '').trim().toLowerCase();
  if (cleaned.length < 3 || cleaned.length > 30) {
    return { valid: false, cleaned, error: 'Username harus terdiri dari 3 hingga 30 karakter.' };
  }
  if (!/^[a-z0-9_]+$/.test(cleaned)) {
    return {
      valid: false,
      cleaned,
      error: 'Username hanya boleh menggunakan huruf kecil, angka, dan garis bawah (_).',
    };
  }
  return { valid: true, cleaned };
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  const str = String(password || '');
  if (str.length < 8) {
    return { valid: false, error: 'Password minimal 8 karakter.' };
  }
  if (str.length > 128) {
    return { valid: false, error: 'Password maksimal 128 karakter.' };
  }
  if (!/[A-Za-z]/.test(str) || !/\d/.test(str)) {
    return { valid: false, error: 'Password harus mengandung kombinasi huruf dan angka.' };
  }
  return { valid: true };
}

export function sanitizeReturnUrl(returnTo: unknown, fallback = '/shop'): string {
  if (typeof returnTo !== 'string') return fallback;
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback;
  }
  if (trimmed.startsWith('/login') || trimmed.startsWith('/register')) {
    return fallback;
  }
  return trimmed;
}

export function maskDisplayName(username: string): string {
  const clean = String(username || 'user').trim();
  if (clean.length <= 2) return `${clean[0] || 'u'}***`;
  return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function serializeSessionCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  isProduction: boolean
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

export function createRateLimiter(options: {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
  message: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateLimitStore.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.maxRequests) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: options.message,
          retryAfterSeconds: retryAfterSec,
        },
      });
    }

    return next();
  };
}

export function clearRateLimitBucketsForTest() {
  rateLimitStore.clear();
}
