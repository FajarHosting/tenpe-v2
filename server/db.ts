import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getRuntimeConfig } from './runtimeEnv.ts';
import { hashPassword, sha256Hex } from './security.ts';

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDb(customPath?: string): DatabaseSync {
  const config = getRuntimeConfig();
  const targetPath = customPath || config.sqliteDbPath;

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  const schemaSql = fs.readFileSync(path.resolve(process.cwd(), 'db', 'schema.sql'), 'utf8');
  db.exec(schemaSql);

  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
  ).run('001_initial_adviora', new Date().toISOString());

  dbInstance = db;
  currentDbPath = targetPath;

  bootstrapDatabase(db);
  return db;
}

export function resetDbForTesting(testDbPath = ':memory:'): DatabaseSync {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close error
    }
    dbInstance = null;
    currentDbPath = null;
  }
  return getDb(testDbPath);
}

let inTransaction = false;

export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  if (inTransaction) {
    return fn(db);
  }
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  inTransaction = true;
  try {
    const result = fn(db);
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    inTransaction = false;
  }
}

export function syncProductStockCount(db: DatabaseSync, productId: string): {
  available: number;
  reserved: number;
} {
  const availRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM inventory_items WHERE product_id = ? AND status = 'AVAILABLE'`
    )
    .get(productId) as { cnt: number } | undefined;
  const resRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM inventory_items WHERE product_id = ? AND status = 'RESERVED'`
    )
    .get(productId) as { cnt: number } | undefined;

  const available = Number(availRow?.cnt ?? 0);
  const reserved = Number(resRow?.cnt ?? 0);

  db.prepare(
    `UPDATE products SET stock_count = ?, reserved_count = ?, updated_at = ? WHERE id = ?`
  ).run(available, reserved, new Date().toISOString(), productId);

  return { available, reserved };
}

function bootstrapDatabase(db: DatabaseSync) {
  const config = getRuntimeConfig();
  const now = new Date().toISOString();

  // 1. Bootstrap ADMIN account from environment configuration
  const existingAdmin = db
    .prepare(`SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`)
    .get() as { id: string } | undefined;

  if (!existingAdmin) {
    const adminId = 'usr_admin_bootstrap';
    db.prepare(
      `INSERT INTO users (
        id, username, email, whatsapp, password_hash, role, status,
        company_name, partner_tier, wallet_balance, force_password_rotation, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', 'AdViora Operations', 'ENTERPRISE', 0, ?, ?, ?)`
    ).run(
      adminId,
      config.adminBootstrap.username.toLowerCase(),
      config.adminBootstrap.email.toLowerCase(),
      config.adminBootstrap.whatsapp,
      hashPassword(config.adminBootstrap.password),
      config.adminBootstrap.forcePasswordRotation ? 1 : 0,
      now,
      now
    );

    db.prepare(
      `INSERT INTO audit_logs (id, actor_user_id, actor_role, action, entity_type, entity_id, ip_address, metadata_json, created_at)
       VALUES (?, ?, 'SYSTEM', 'BOOTSTRAP_ADMIN_CREATED', 'USER', ?, '127.0.0.1', ?, ?)`
    ).run(
      `aud_${crypto.randomUUID()}`,
      adminId,
      adminId,
      JSON.stringify({ username: config.adminBootstrap.username }),
      now
    );
  }

  // 2. Bootstrap Partner account for Partner Portal verification (non-production or initial setup)
  if (!config.isProduction) {
    const existingPartner = db
      .prepare(`SELECT id FROM users WHERE username = 'partner_fajar' LIMIT 1`)
      .get() as { id: string } | undefined;

    if (!existingPartner) {
      const rawApiKey = 'adv_live_partner_fajar_2026_key';
      db.prepare(
        `INSERT INTO users (
          id, username, email, whatsapp, password_hash, role, status,
          company_name, partner_tier, wallet_balance, api_key_hash, api_key_prefix,
          force_password_rotation, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'PARTNER', 'ACTIVE', 'Nusantara Cloud Digital', 'ENTERPRISE', 2500000, ?, ?, 0, ?, ?)`
      ).run(
        'usr_partner_fajar',
        'partner_fajar',
        'partner@partnerhub.dpdns.org',
        '6281299998888',
        hashPassword('Partner#2026!'),
        sha256Hex(rawApiKey),
        'adv_live_part',
        now,
        now
      );
    }

    const existingCustomer = db
      .prepare(`SELECT id FROM users WHERE username = 'pelanggan_demo' LIMIT 1`)
      .get() as { id: string } | undefined;

    if (!existingCustomer) {
      db.prepare(
        `INSERT INTO users (
          id, username, email, whatsapp, password_hash, role, status,
          company_name, partner_tier, wallet_balance, force_password_rotation, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'CUSTOMER', 'ACTIVE', NULL, NULL, 0, 0, ?, ?)`
      ).run(
        'usr_customer_initial',
        'pelanggan_demo',
        'customer@adviora.partnerhub.dpdns.org',
        '6281277776666',
        hashPassword('Pelanggan#2026!'),
        now,
        now
      );
    }
  }

  // 3. Bootstrap Categories
  const categoryCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM categories`).get() as { cnt: number }
  ).cnt;

  if (categoryCount === 0) {
    const categories = [
      {
        id: 'cat_cloud_productivity',
        slug: 'cloud-productivity',
        name: 'Cloud & Productivity',
        description: 'Lisensi ruang kerja awan, penyimpanan terenkripsi, dan kolaborasi tim.',
        sortOrder: 1,
      },
      {
        id: 'cat_creative_design',
        slug: 'creative-studio',
        name: 'Creative & Design Suite',
        description: 'Perangkat lunak desain grafis, penyuntingan video, dan aset kreatif.',
        sortOrder: 2,
      },
      {
        id: 'cat_security_privacy',
        slug: 'cyber-security',
        name: 'Security & Zero-Trust VPN',
        description: 'Proteksi jaringan privat, manajemen kredensial, dan lisensi keamanan.',
        sortOrder: 3,
      },
      {
        id: 'cat_developer_infra',
        slug: 'developer-tools',
        name: 'Developer & Cloud Infra',
        description: 'Langganan perkakas pengembangan perangkat lunak, CI/CD, dan IDE Pro.',
        sortOrder: 4,
      },
    ];

    const insertCat = db.prepare(
      `INSERT INTO categories (id, slug, name, description, sort_order, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );
    for (const c of categories) {
      insertCat.run(c.id, c.slug, c.name, c.description, c.sortOrder, now);
    }
  }

  // 4. Bootstrap Official Catalog Products & Real Vault Inventory (if catalog table is empty and not strictly disabled)
  const productCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM products`).get() as { cnt: number }
  ).cnt;

  if (productCount === 0 && process.env.DISABLE_CATALOG_BOOTSTRAP !== 'true') {
    const initialProducts = [
      {
        id: 'prd_cloud_workspace_pro',
        slug: 'adviora-cloud-workspace-pro-1y',
        sku: 'ADV-CLD-PRO-12M',
        name: 'Cloud Workspace Enterprise 2TB (1 Tahun)',
        categoryId: 'cat_cloud_productivity',
        shortDescription:
          'Penyimpanan awan terenkripsi 2TB dengan kolaborasi dokumen real-time dan aktivasi akun pribadi.',
        description:
          'Lisensi resmi Cloud Workspace Enterprise kapasitas 2TB selama 12 bulan penuh. Mendukung sinkronisasi lintas perangkat (Android, iOS, Windows, macOS), enkripsi end-to-end, serta ruang kerja kolaboratif tanpa batas. Kredensial aktivasi dikirimkan secara privat melalui WhatsApp dan halaman detail pesanan segera setelah pembayaran QRIS terverifikasi.',
        terms:
          '1. Berlaku untuk 1 akun utama selama 365 hari.\n2. Aktivasi dilakukan menggunakan kode lisensi resmi yang dikirimkan setelah pembayaran.\n3. Dilarang memperjualbelikan ulang kredensial di luar program Partner resmi AdViora.',
        durationLabel: '12 Bulan (365 Hari)',
        warrantyDays: 365,
        warrantyTerms:
          'Garansi penuh 365 hari penggantian lisensi baru apabila terjadi kendala validasi sistem.',
        imageUrl: '/src/assets/images/product_cloud_workspace_1791793694973.jpg',
        retailPrice: 249000,
        partnerPrice: 189000,
        deliveryType: 'LICENSE_KEY',
        initialVaultKeys: [
          'ADV-CLD2TB-2026-8841-X9A2',
          'ADV-CLD2TB-2026-8842-B7C4',
          'ADV-CLD2TB-2026-8843-M3P9',
          'ADV-CLD2TB-2026-8844-K5L1',
          'ADV-CLD2TB-2026-8845-R2W8',
        ],
      },
      {
        id: 'prd_creative_studio_master',
        slug: 'creative-studio-all-apps-3m',
        sku: 'ADV-CRT-ALL-3M',
        name: 'Creative Studio Pro All-Apps (3 Bulan)',
        categoryId: 'cat_creative_design',
        shortDescription:
          'Akses penuh suite desain vektor, tata letak publikasi, color grading, dan cloud font komersial.',
        description:
          'Paket lisensi Creative Studio Pro All-Apps untuk desainer produk, fotografer, dan editor video profesional. Termasuk 100GB penyimpanan aset kreatif, pustaka font komersial, dan pembaruan fitur langsung. Pengiriman otomatis dari brankas stok terverifikasi.',
        terms:
          '1. Lisensi dapat diaktifkan pada maksimal 2 perangkat secara bersamaan.\n2. Masa aktif 90 hari dihitung sejak tanggal pemenuhan order.\n3. Garansi penggantian penuh selama masa berlangganan aktif.',
        durationLabel: '3 Bulan (90 Hari)',
        warrantyDays: 90,
        warrantyTerms: 'Garansi penuh 90 hari sesuai masa aktif langganan.',
        imageUrl: '/src/assets/images/product_creative_suite_1791793706734.jpg',
        retailPrice: 175000,
        partnerPrice: 135000,
        deliveryType: 'LICENSE_KEY',
        initialVaultKeys: [
          'ADV-CRT3M-2026-1091-Q4E8',
          'ADV-CRT3M-2026-1092-Z9T3',
          'ADV-CRT3M-2026-1093-N6V2',
          'ADV-CRT3M-2026-1094-H8J5',
        ],
      },
      {
        id: 'prd_zerotrust_vpn_shield',
        slug: 'cryptoguard-zerotrust-vpn-1y',
        sku: 'ADV-SEC-VPN-12M',
        name: 'CryptoGuard Zero-Trust VPN & DNS Shield (1 Tahun)',
        categoryId: 'cat_security_privacy',
        shortDescription:
          'Koneksi WireGuard berkecepatan tinggi di 65+ negara dengan proteksi anti-phishing & DNS terenkripsi.',
        description:
          'Perlindungan privasi jaringan kelas enterprise dengan protokol WireGuard modern, kebijakan tanpa log (strict no-logs), serta pemblokir pelacak tingkat DNS. Mendukung hingga 5 perangkat sekaligus (Android, iOS, Linux, Windows, macOS).',
        terms:
          '1. Maksimal 5 perangkat aktif bersamaan per kode lisensi.\n2. Dilarang menggunakan layanan untuk aktivitas pelanggaran hukum atau spam jaringan.\n3. Pengiriman instan kode aktivasi setelah verifikasi pembayaran.',
        durationLabel: '12 Bulan (365 Hari)',
        warrantyDays: 365,
        warrantyTerms: 'Garansi resmi 365 hari penuh.',
        imageUrl: '/src/assets/images/product_security_vpn_1791793718221.jpg',
        retailPrice: 129000,
        partnerPrice: 95000,
        deliveryType: 'LICENSE_KEY',
        initialVaultKeys: [
          'ADV-CGVPN-2026-5501-X1Y2',
          'ADV-CGVPN-2026-5502-X3Y4',
          'ADV-CGVPN-2026-5503-X5Y6',
          'ADV-CGVPN-2026-5504-X7Y8',
          'ADV-CGVPN-2026-5505-X9Y0',
          'ADV-CGVPN-2026-5506-Z1W2',
        ],
      },
      {
        id: 'prd_kinetic_devtools_suite',
        slug: 'kinetic-devtools-cloud-ide-6m',
        sku: 'ADV-DEV-IDE-6M',
        name: 'Kinetic DevTools & Cloud IDE Pro (6 Bulan)',
        categoryId: 'cat_developer_infra',
        shortDescription:
          'Lingkungan pengembangan cloud, remote container runner, dan manajemen repositori privat untuk engineer.',
        description:
          'Lisensi profesional Kinetic DevTools selama 6 bulan. Mencakup 120 jam kompilasi container cloud per bulan, sinkronisasi konfigurasi terminal terenkripsi, dan integrasi debugging jarak jauh.',
        terms:
          '1. Kode aktivasi ditautkan ke 1 akun developer.\n2. Masa berlaku 180 hari penuh sejak tanggal penukaran kode.',
        durationLabel: '6 Bulan (180 Hari)',
        warrantyDays: 180,
        warrantyTerms: 'Garansi 180 hari penuh selama masa langganan.',
        imageUrl: '/src/assets/images/product_devtools_pro_1791793730699.jpg',
        retailPrice: 310000,
        partnerPrice: 245000,
        deliveryType: 'LICENSE_KEY',
        initialVaultKeys: [
          'ADV-DEV6M-2026-3311-D4F6',
          'ADV-DEV6M-2026-3312-G7H9',
          'ADV-DEV6M-2026-3313-J2K4',
        ],
      },
      {
        id: 'prd_enterprise_ dedicated_node',
        slug: 'enterprise-dedicated- archival-node-1y',
        sku: 'ADV-CLD-NODE-1Y',
        name: 'Enterprise Cold-Archival Vault 10TB (1 Tahun)',
        categoryId: 'cat_cloud_productivity',
        shortDescription:
          'Penyimpanan arsip objek S3-compatible 10TB dengan replikasi multi-region untuk backup infrastruktur.',
        description:
          'Layanan penyimpanan arsip S3-compatible berkapasitas 10TB untuk kebutuhan pencadangan server, database dump terenkripsi, dan kepatuhan retensi dokumen perusahaan.',
        terms:
          '1. Kredensial bucket S3 dikirimkan setelah verifikasi pembayaran.\n2. Saat ini stok sedang menunggu alokasi cluster baru.',
        durationLabel: '12 Bulan (365 Hari)',
        warrantyDays: 365,
        warrantyTerms: 'SLA 99.95% uptime dan garansi penuh 365 hari.',
        imageUrl: '/src/assets/images/product_cloud_workspace_1791793694973.jpg',
        retailPrice: 890000,
        partnerPrice: 720000,
        deliveryType: 'INSTANT_CREDENTIAL',
        initialVaultKeys: [], // Intentionally 0 stock to demonstrate real out-of-stock protection
      },
    ];

    const insertProduct = db.prepare(
      `INSERT INTO products (
        id, slug, sku, name, category_id, short_description, description,
        terms_and_conditions, duration_label, warranty_days, warranty_terms,
        image_url, retail_price, partner_price, stock_count, reserved_count,
        is_published, delivery_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
    );

    const insertVaultItem = db.prepare(
      `INSERT INTO inventory_items (
        id, product_id, credential_payload, batch_note, status, created_at
      ) VALUES (?, ?, ?, 'Initial Official Batch', 'AVAILABLE', ?)`
    );

    for (const p of initialProducts) {
      insertProduct.run(
        p.id,
        p.slug,
        p.sku,
        p.name,
        p.categoryId,
        p.shortDescription,
        p.description,
        p.terms,
        p.durationLabel,
        p.warrantyDays,
        p.warrantyTerms,
        p.imageUrl,
        p.retailPrice,
        p.partnerPrice,
        p.initialVaultKeys.length,
        p.deliveryType,
        now,
        now
      );

      for (const key of p.initialVaultKeys) {
        insertVaultItem.run(`inv_${crypto.randomUUID()}`, p.id, key, now);
      }
    }
  }

  // 5. Bootstrap Official System Announcement
  const announcementCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM announcements`).get() as { cnt: number }
  ).cnt;
  if (announcementCount === 0) {
    db.prepare(
      `INSERT INTO announcements (
        id, title, content, variant, target_audience, is_active, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'INFO', 'ALL', 1, 'SYSTEM', ?, ?)`
    ).run(
      'ann_welcome_2026',
      'Sistem Pembayaran QRIS & Pengiriman Otomatis Aktif',
      'Seluruh pesanan diverifikasi secara otomatis melalui callback terenkripsi dan lisensi dikirim langsung ke nomor WhatsApp terdaftar Anda.',
      now,
      now
    );
  }
}
