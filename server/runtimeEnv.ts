import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

export type QrisProviderMode =
  | 'UNCONFIGURED'
  | 'DYNAMIC_API'
  | 'STATIC_VERIFIED_WEBHOOK'
  | 'SANDBOX_SIMULATOR';

export interface RuntimeConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  storeUrl: string;
  partnerUrl: string;
  sqliteDbPath: string;
  sessionSecret: string;
  sessionTtlHours: number;
  adminBootstrap: {
    username: string;
    email: string;
    password: string;
    whatsapp: string;
    forcePasswordRotation: boolean;
  };
  qris: {
    mode: QrisProviderMode;
    merchantId: string;
    merchantName: string;
    staticUrl: string;
    dynamicApiUrl: string;
    apiKey: string;
    webhookSecret: string;
    expiryMinutes: number;
  };
  fulfillment: {
    mode: 'LOCAL_VAULT' | 'HYBRID_SUPPLIER';
    supplierApiUrl: string;
    supplierApiKey: string;
    timeoutMs: number;
  };
  waBotV32: {
    enabled: boolean;
    url: string;
    sharedSecret: string;
    adminGroupJid: string;
    timeoutMs: number;
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const rawMode = (process.env.QRIS_PROVIDER_MODE || 'SANDBOX_SIMULATOR').toUpperCase();
  const allowedModes: QrisProviderMode[] = [
    'UNCONFIGURED',
    'DYNAMIC_API',
    'STATIC_VERIFIED_WEBHOOK',
    'SANDBOX_SIMULATOR',
  ];
  const qrisMode: QrisProviderMode = allowedModes.includes(rawMode as QrisProviderMode)
    ? (rawMode as QrisProviderMode)
    : 'UNCONFIGURED';

  return {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT || 3000),
    storeUrl: process.env.ADVIORA_STORE_URL || 'https://adviora.partnerhub.dpdns.org',
    partnerUrl: process.env.ADVIORA_PARTNER_URL || 'https://partnerhub.dpdns.org',
    sqliteDbPath:
      process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'adviora.sqlite'),
    sessionSecret:
      process.env.SESSION_SECRET ||
      'adviora-dev-hmac-secret-do-not-use-in-prod-98f7a6b5c4d3e2f1',
    sessionTtlHours: Math.max(1, Number(process.env.SESSION_TTL_HOURS || 24)),
    adminBootstrap: {
      username: process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin_adviora',
      email: process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@adviora.partnerhub.dpdns.org',
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD || 'AdViora#Admin2026!',
      whatsapp: process.env.ADMIN_BOOTSTRAP_WHATSAPP || '6281200000001',
      forcePasswordRotation: process.env.ADMIN_FORCE_PASSWORD_ROTATION === 'true',
    },
    qris: {
      mode: qrisMode,
      merchantId: process.env.QRIS_MERCHANT_ID || 'ID2026ADVIORAMERCHANT',
      merchantName: process.env.QRIS_MERCHANT_NAME || 'ADVIORA DIGITAL COMMERCE',
      staticUrl: process.env.QRIS_STATIC_URL || '',
      dynamicApiUrl: process.env.QRIS_DYNAMIC_API_URL || '',
      apiKey: process.env.QRIS_API_KEY || '',
      webhookSecret:
        process.env.QRIS_WEBHOOK_SECRET || 'adviora_qris_webhook_hmac_secret_2026',
      expiryMinutes: Math.max(5, Number(process.env.QRIS_EXPIRY_MINUTES || 15)),
    },
    fulfillment: {
      mode:
        process.env.FULFILLMENT_MODE === 'HYBRID_SUPPLIER'
          ? 'HYBRID_SUPPLIER'
          : 'LOCAL_VAULT',
      supplierApiUrl: process.env.SUPPLIER_API_URL || '',
      supplierApiKey: process.env.SUPPLIER_API_KEY || '',
      timeoutMs: Math.max(2000, Number(process.env.SUPPLIER_TIMEOUT_MS || 10000)),
    },
    waBotV32: {
      enabled: process.env.WA_BOT_V32_ENABLED === 'true',
      url: process.env.WA_BOT_V32_URL || 'http://127.0.0.1:4032',
      sharedSecret:
        process.env.WA_BOT_V32_SHARED_SECRET || 'adviora_wabot_v32_shared_secret_2026',
      adminGroupJid: process.env.WA_BOT_V32_ADMIN_GROUP_JID || '120363029384756@g.us',
      timeoutMs: Math.max(2000, Number(process.env.WA_BOT_V32_TIMEOUT_MS || 8000)),
    },
  };
}
