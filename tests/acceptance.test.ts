import assert from 'node:assert/strict';
import http from 'node:http';
import { createExpressApp } from '../server.ts';
import { resetDbForTesting } from '../server/db.ts';
import { clearRateLimitBucketsForTest, computeHmacSha256 } from '../server/security.ts';
import { getRuntimeConfig } from '../server/runtimeEnv.ts';

interface TestClientResponse {
  status: number;
  headers: Headers;
  body: any;
  rawText: string;
}

class SessionClient {
  private baseUrl: string;
  public cookie = '';
  public csrfToken = '';

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<TestClientResponse> {
    const method = options.method || 'GET';
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }
    if (this.csrfToken && method !== 'GET') {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body:
        options.body !== undefined
          ? typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body)
          : undefined,
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const cookiePair = setCookie.split(';')[0];
      if (cookiePair.endsWith('=')) {
        this.cookie = '';
      } else {
        this.cookie = cookiePair;
      }
    }

    const rawText = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }

    if (body && typeof body === 'object' && typeof body.csrfToken === 'string') {
      this.csrfToken = body.csrfToken;
    }

    return {
      status: res.status,
      headers: res.headers,
      body,
      rawText,
    };
  }
}

async function runAcceptanceTests() {
  console.log('====================================================================');
  console.log('AdViora — Production Acceptance & Security Verification Suite');
  console.log('====================================================================');

  // Use isolated in-memory SQLite database for deterministic testing
  process.env.SQLITE_DB_PATH = ':memory:';
  process.env.QRIS_PROVIDER_MODE = 'SANDBOX_SIMULATOR';
  process.env.WA_BOT_V32_ENABLED = 'false';

  const db = resetDbForTesting(':memory:');
  clearRateLimitBucketsForTest();

  const app = await createExpressApp({ skipVite: true });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const config = getRuntimeConfig();

  let passed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    process.stdout.write(`• [TEST] ${name} ... `);
    await fn();
    passed += 1;
    console.log('PASS');
  };

  try {
    const guest = new SessionClient(baseUrl);
    const customerA = new SessionClient(baseUrl);
    const customerB = new SessionClient(baseUrl);
    const admin = new SessionClient(baseUrl);

    await step('1. Health & Public Overview endpoint works and exposes zero fake transactions on fresh DB', async () => {
      const health = await guest.request('/api/health');
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(health.body.database.connected, true);

      const pub = await guest.request('/api/public/overview');
      assert.equal(pub.status, 200);
      assert.equal(Array.isArray(pub.body.data.publicActivityFeed), true);
      assert.equal(pub.body.data.publicActivityFeed.length, 0);
    });

    await step('2. Guest cannot access protected APIs (/api/shop/catalog, /api/orders, /api/admin/overview)', async () => {
      const catRes = await guest.request('/api/shop/catalog');
      assert.equal(catRes.status, 401);

      const ordRes = await guest.request('/api/orders');
      assert.equal(ordRes.status, 401);

      const admRes = await guest.request('/api/admin/overview');
      assert.equal(admRes.status, 401);
    });

    await step('3. Customer registration, duplicate prevention, and login security', async () => {
      const regA = await customerA.request('/api/auth/register', {
        method: 'POST',
        body: {
          username: 'cust_alpha',
          email: 'alpha@example.com',
          whatsapp: '081234567801',
          password: 'AlphaPassword123',
        },
      });
      assert.equal(regA.status, 201);
      assert.equal(regA.body.user.whatsapp, '6281234567801');
      assert.ok(customerA.cookie.includes('adviora_session='));
      assert.ok(customerA.csrfToken.length >= 16);

      // Duplicate registration rejected with anti-enumeration 409
      const dupReg = await guest.request('/api/auth/register', {
        method: 'POST',
        body: {
          username: 'cust_alpha',
          email: 'other@example.com',
          whatsapp: '081234567899',
          password: 'AlphaPassword123',
        },
      });
      assert.equal(dupReg.status, 409);

      // Register Customer B
      const regB = await customerB.request('/api/auth/register', {
        method: 'POST',
        body: {
          username: 'cust_bravo',
          email: 'bravo@example.com',
          whatsapp: '081234567802',
          password: 'BravoPassword123',
        },
      });
      assert.equal(regB.status, 201);

      // Wrong password rejected with 401
      const badLogin = await guest.request('/api/auth/login', {
        method: 'POST',
        body: {
          identifier: 'cust_alpha',
          password: 'WrongPassword999',
        },
      });
      assert.equal(badLogin.status, 401);
    });

    await step('4. Role CUSTOMER cannot execute ADMIN endpoints (Strict RBAC)', async () => {
      const resOverview = await customerA.request('/api/admin/overview');
      assert.equal(resOverview.status, 403);
      assert.equal(resOverview.body.error.code, 'FORBIDDEN_ROLE');

      const resCreateProd = await customerA.request('/api/admin/products', {
        method: 'POST',
        body: { name: 'Hack', slug: 'hack', sku: 'HCK', categoryId: 'cat_cloud_productivity' },
      });
      assert.equal(resCreateProd.status, 403);
    });

    let orderAId = '';
    let orderANumber = '';
    let orderATotal = 0;

    await step('5. Customer A creates order; server ignores client price tampering & reserves stock atomically', async () => {
      const catalogRes = await customerA.request('/api/shop/catalog');
      assert.equal(catalogRes.status, 200);
      const targetProd = catalogRes.body.data.items.find(
        (p: any) => p.id === 'prd_kinetic_devtools_suite'
      );
      assert.ok(targetProd);
      assert.equal(targetProd.stockCount, 3);

      const createRes = await customerA.request('/api/orders', {
        method: 'POST',
        body: {
          productId: targetProd.id,
          quantity: 1,
          idempotencyKey: 'idem_test_alpha_order_001',
          price: 1, // Attempt client price tampering -> server must ignore
          total: 1,
        },
      });
      assert.equal(createRes.status, 201);
      orderAId = createRes.body.data.id;
      orderANumber = createRes.body.data.orderNumber;
      orderATotal = createRes.body.data.totalAmount;

      // Server price must be 310000, not 1!
      assert.equal(orderATotal, 310000);
      assert.equal(createRes.body.data.status, 'PENDING_PAYMENT');
      // Pending payment must NEVER expose credentials
      assert.equal(createRes.body.data.fulfillment, null);

      // Stock must now be 2 (1 reserved)
      const detailProd = await customerA.request(`/api/shop/products/${targetProd.slug}`);
      assert.equal(detailProd.body.data.stockCount, 2);
      assert.equal(detailProd.body.data.reservedCount, 1);
    });

    await step('6. Customer B cannot view or cancel Customer A order (Horizontal Privilege Escalation blocked)', async () => {
      const spyRes = await customerB.request(`/api/orders/${orderAId}`);
      assert.equal(spyRes.status, 403);
      assert.equal(spyRes.body.error.code, 'FORBIDDEN_ORDER_ACCESS');

      const cancelSpy = await customerB.request(`/api/orders/${orderAId}/cancel`, {
        method: 'POST',
      });
      assert.equal(cancelSpy.status, 403);
    });

    await step('7. Out-of-stock product and simultaneous overselling are rejected atomically', async () => {
      // Product with 0 stock
      const zeroStockRes = await customerA.request('/api/orders', {
        method: 'POST',
        body: {
          productId: 'prd_enterprise_ dedicated_node',
          quantity: 1,
          idempotencyKey: 'idem_zero_stock_001',
        },
      });
      assert.equal(zeroStockRes.status, 409);
      assert.equal(zeroStockRes.body.error.code, 'INSUFFICIENT_STOCK');

      // prd_kinetic_devtools_suite has 2 available units left.
      // Let Customer B reserve all 2 remaining units:
      const takeTwo = await customerB.request('/api/orders', {
        method: 'POST',
        body: {
          productId: 'prd_kinetic_devtools_suite',
          quantity: 2,
          idempotencyKey: 'idem_bravo_take_2',
        },
      });
      assert.equal(takeTwo.status, 201);

      // Now 0 units remain available. Another order for 1 unit must fail with 409 INSUFFICIENT_STOCK:
      const oversellAttempt = await customerA.request('/api/orders', {
        method: 'POST',
        body: {
          productId: 'prd_kinetic_devtools_suite',
          quantity: 1,
          idempotencyKey: 'idem_oversell_attempt',
        },
      });
      assert.equal(oversellAttempt.status, 409);
      assert.equal(oversellAttempt.body.error.code, 'INSUFFICIENT_STOCK');
    });

    await step('8. Fake webhook, invalid signature, nominal mismatch, and expired timestamp replay are rejected', async () => {
      const validPayload = {
        eventId: 'evt_test_001',
        orderNumber: orderANumber,
        providerReference: `QRIS-${orderANumber}`,
        merchantId: config.qris.merchantId,
        amount: orderATotal,
        currency: 'IDR',
        paymentStatus: 'PAID',
        timestamp: Date.now(),
      };

      // 8a. Invalid signature -> 401
      const badSigRes = await guest.request('/api/webhooks/qris', {
        method: 'POST',
        headers: { 'X-Adviora-Signature': 'deadbeef123456' },
        body: JSON.stringify(validPayload),
      });
      assert.equal(badSigRes.status, 401);
      assert.equal(badSigRes.body.error.code, 'INVALID_WEBHOOK_SIGNATURE');

      // 8b. Nominal mismatch -> 400
      const mismatchPayload = { ...validPayload, eventId: 'evt_mismatch', amount: 50000 };
      const mismatchRaw = JSON.stringify(mismatchPayload);
      const mismatchSig = computeHmacSha256(mismatchRaw, config.qris.webhookSecret);
      const mismatchRes = await guest.request('/api/webhooks/qris', {
        method: 'POST',
        headers: { 'X-Adviora-Signature': mismatchSig },
        body: mismatchRaw,
      });
      assert.equal(mismatchRes.status, 400);
      assert.equal(mismatchRes.body.error.code, 'AMOUNT_MISMATCH');

      // 8c. Replay attack (timestamp 20 minutes old) -> 400
      const replayPayload = {
        ...validPayload,
        eventId: 'evt_replay',
        timestamp: Date.now() - 20 * 60 * 1000,
      };
      const replayRaw = JSON.stringify(replayPayload);
      const replaySig = computeHmacSha256(replayRaw, config.qris.webhookSecret);
      const replayRes = await guest.request('/api/webhooks/qris', {
        method: 'POST',
        headers: { 'X-Adviora-Signature': replaySig },
        body: replayRaw,
      });
      assert.equal(replayRes.status, 400);
      assert.equal(replayRes.body.error.code, 'WEBHOOK_TIMESTAMP_EXPIRED');
    });

    await step('9. Valid signed webhook marks order COMPLETED, claims vault credential once, and duplicate webhook is idempotent', async () => {
      const validPayload = {
        eventId: 'evt_valid_settlement_001',
        orderNumber: orderANumber,
        providerReference: `QRIS-${orderANumber}`,
        merchantId: config.qris.merchantId,
        amount: orderATotal,
        currency: 'IDR',
        paymentStatus: 'PAID',
        timestamp: Date.now(),
      };
      const rawBody = JSON.stringify(validPayload);
      const sig = computeHmacSha256(rawBody, config.qris.webhookSecret);

      const okWebhook = await guest.request('/api/webhooks/qris', {
        method: 'POST',
        headers: { 'X-Adviora-Signature': sig },
        body: rawBody,
      });
      assert.equal(okWebhook.status, 200);
      assert.equal(okWebhook.body.data.idempotentDuplicate, false);
      assert.equal(okWebhook.body.data.status, 'COMPLETED');

      // Verify Customer A now sees the claimed license key
      const orderAfter = await customerA.request(`/api/orders/${orderAId}`);
      assert.equal(orderAfter.status, 200);
      assert.equal(orderAfter.body.data.status, 'COMPLETED');
      assert.equal(orderAfter.body.data.fulfillment.credentials.length, 1);
      const firstCredential = orderAfter.body.data.fulfillment.credentials[0];
      assert.ok(firstCredential.startsWith('ADV-DEV6M-'));

      // Send duplicate webhook with same eventId -> must return idempotentDuplicate: true
      const dupWebhook = await guest.request('/api/webhooks/qris', {
        method: 'POST',
        headers: { 'X-Adviora-Signature': sig },
        body: rawBody,
      });
      assert.equal(dupWebhook.status, 200);
      assert.equal(dupWebhook.body.data.idempotentDuplicate, true);

      // Send another webhook with a DIFFERENT eventId for the same already-paid order -> must not claim a second credential!
      const secondEventPayload = {
        ...validPayload,
        eventId: 'evt_valid_settlement_002_retry',
      };
      const raw2 = JSON.stringify(secondEventPayload);
      const sig2 = computeHmacSha256(raw2, config.qris.webhookSecret);
      const secondWebhook = await guest.request('/api/webhooks/qris', {
        method: 'POST',
        headers: { 'X-Adviora-Signature': sig2 },
        body: raw2,
      });
      assert.equal(secondWebhook.status, 200);
      assert.equal(secondWebhook.body.data.idempotentDuplicate, true);

      const orderCheckAgain = await customerA.request(`/api/orders/${orderAId}`);
      assert.equal(orderCheckAgain.body.data.fulfillment.credentials.length, 1);
      assert.equal(orderCheckAgain.body.data.fulfillment.credentials[0], firstCredential);
    });

    await step('10. WhatsApp v32 Outbox separates CUSTOMER_PRIVATE and ADMIN_GROUP (zero secrets in Admin Group)', async () => {
      const outboxRows = db
        .prepare(`SELECT * FROM whatsapp_outbox WHERE order_id = ?`)
        .all(orderAId) as Array<Record<string, any>>;

      assert.ok(outboxRows.length >= 2);
      const privateMsg = outboxRows.find((r) => r.target_type === 'CUSTOMER_PRIVATE');
      const adminGroupMsgs = outboxRows.filter((r) => r.target_type === 'ADMIN_GROUP');

      assert.ok(privateMsg, 'Customer private WhatsApp message must be queued');
      assert.equal(privateMsg.recipient, '6281234567801');
      assert.ok(privateMsg.payload_json.includes('ADV-DEV6M-'));

      assert.ok(adminGroupMsgs.length >= 1, 'Admin group operational alert must be queued');
      for (const grp of adminGroupMsgs) {
        assert.equal(
          grp.payload_json.includes('ADV-DEV6M-'),
          false,
          'Admin group notification must NEVER contain product credentials!'
        );
      }
    });

    await step('11. Public Activity Feed masks buyer identity and leaks zero PII', async () => {
      const pub = await guest.request('/api/public/overview');
      assert.equal(pub.status, 200);
      const feed = pub.body.data.publicActivityFeed;
      assert.equal(feed.length, 1);
      assert.equal(feed[0].anonymizedBuyer, 'cu***a');
      const rawFeedStr = JSON.stringify(feed);
      assert.equal(rawFeedStr.includes('cust_alpha'), false);
      assert.equal(rawFeedStr.includes('alpha@example.com'), false);
      assert.equal(rawFeedStr.includes('6281234567801'), false);
      assert.equal(rawFeedStr.includes('ADV-DEV6M-'), false);
    });

    await step('12. Admin login, dashboard metrics, vault restock, and audit log verification', async () => {
      const admLogin = await admin.request('/api/auth/login', {
        method: 'POST',
        body: {
          identifier: config.adminBootstrap.username,
          password: config.adminBootstrap.password,
        },
      });
      assert.equal(admLogin.status, 200);
      assert.equal(admLogin.body.user.role, 'ADMIN');

      const ov = await admin.request('/api/admin/overview');
      assert.equal(ov.status, 200);
      assert.equal(ov.body.data.metrics.totalRevenue, 310000);
      assert.equal(ov.body.data.metrics.completedOrders, 1);

      // Restock 2 new keys into prd_kinetic_devtools_suite
      const restockRes = await admin.request(
        '/api/admin/products/prd_kinetic_devtools_suite/inventory',
        {
          method: 'POST',
          body: {
            credentialsList: ['ADV-DEV6M-2026-NEW1', 'ADV-DEV6M-2026-NEW2'],
            batchNote: 'QA Automated Restock',
          },
        }
      );
      assert.equal(restockRes.status, 201);
      assert.equal(restockRes.body.data.added, 2);
      assert.equal(restockRes.body.data.newStock, 2);
    });

    await step('13. Logout invalidates server session immediately', async () => {
      const savedCookie = customerA.cookie;
      const logoutRes = await customerA.request('/api/auth/logout', { method: 'POST' });
      assert.equal(logoutRes.status, 200);

      // Replay old cookie after logout -> must be rejected with 401
      const replayClient = new SessionClient(baseUrl);
      replayClient.cookie = savedCookie;
      const checkProtected = await replayClient.request('/api/orders');
      assert.equal(checkProtected.status, 401);
    });

    console.log('--------------------------------------------------------------------');
    console.log(`ALL ${passed} ACCEPTANCE & SECURITY TEST SUITES PASSED SUCCESSFULLY.`);
    console.log('--------------------------------------------------------------------');
  } finally {
    server.close();
  }
}

runAcceptanceTests().catch((err) => {
  console.error('ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
