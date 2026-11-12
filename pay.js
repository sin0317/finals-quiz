'use strict';

/* =========================================================================
   爱猹收（watcha pay）服务端接入层
   -------------------------------------------------------------------------
   · 只做两件事：查权益（access）、扣额度（consume）
   · 零第三方依赖，用 Node 18+ 自带的 fetch
   · 配置优先级：进程环境变量 > data/pay.config.json（该目录已在 .gitignore）
   · 失败一律「关闭」：拿不到确定结果就当没授权，不猜、不放行
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const ACCESS_PATH = '/v1/entitlements/access';
const CONSUME_PATH = '/v1/entitlements/consume';
const TIMEOUT_MS = 10000;

function readConfigFile(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'pay.config.json'), 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

function loadConfig(dataDir) {
  const f = readConfigFile(dataDir);
  const pick = function (envKey, fileVal, fallback) {
    const e = process.env[envKey];
    if (e && String(e).trim()) return String(e).trim();
    if (fileVal && String(fileVal).trim()) return String(fileVal).trim();
    return fallback;
  };

  const cfg = {
    baseUrl: pick('WATCHA_PAY_BASE_URL', f.baseUrl, 'https://pay.watcha.cn').replace(/\/+$/, ''),
    apiKey: pick('WATCHA_PAY_API_KEY', f.apiKey, ''),
    entitlementId: pick('WATCHA_PAY_ENTITLEMENT_ID', f.entitlementId, ''),
    environment: pick('WATCHA_PAY_ENV', f.environment, 'sandbox'),
    reportCost: Number(f.reportCost) > 0 ? Math.floor(Number(f.reportCost)) : 1,
    /* 展示用价格，跟控制台档位保持一致；只用于前端文案，不参与计费判定 */
    price: pick('WATCHA_PAY_PRICE', f.price, ''),
    priceLabel: pick('WATCHA_PAY_PRICE_LABEL', f.priceLabel, '')
  };
  cfg.enabled = !!(cfg.apiKey && cfg.entitlementId);
  return cfg;
}

/* 单次请求：超时即中止，返回统一结构，永不抛到上层 */
async function request(cfg, pathname, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
  try {
    const res = await fetch(cfg.baseUrl + pathname, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { status: res.status, data: data };
  } catch (e) {
    return { status: 0, data: null, netError: (e && e.name === 'AbortError') ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

function createPayService(dataDir) {
  const cfg = loadConfig(dataDir);

  /* 查权益。返回 { ok, access, entitlement, purchase, reason, code }
     access 取值：granted / purchase_required / unavailable / unknown */
  async function access(userId) {
    if (!cfg.enabled) return { ok: false, code: 'pay_not_configured' };
    if (!userId) return { ok: false, code: 'no_user' };

    const r = await request(cfg, ACCESS_PATH, {
      entitlement_id: cfg.entitlementId,
      user_id: String(userId)
    });

    if (r.status === 200 && r.data && r.data.access) {
      return {
        ok: true,
        access: r.data.access,
        entitlement: r.data.entitlement || null,
        purchase: r.data.purchase || null,
        reason: r.data.reason || null
      };
    }

    /* 非 2xx 或结构不认识：失败关闭 */
    const code = (r.data && r.data.error && r.data.error.code) || r.netError || ('http_' + r.status);
    return { ok: false, code: 'access_failed', detail: code, status: r.status };
  }

  /* 扣额度。amount 正整数，idempotencyKey 由调用方保证「同一次操作重试复用同键」 */
  async function consume(userId, amount, idempotencyKey) {
    if (!cfg.enabled) return { ok: false, code: 'pay_not_configured' };
    if (!userId) return { ok: false, code: 'no_user' };
    const n = Math.floor(Number(amount));
    if (!(n > 0)) return { ok: false, code: 'bad_amount' };
    if (!idempotencyKey) return { ok: false, code: 'bad_idempotency_key' };

    const r = await request(cfg, CONSUME_PATH, {
      entitlement_id: cfg.entitlementId,
      user_id: String(userId),
      amount: n,
      idempotency_key: String(idempotencyKey)
    });

    if (r.status === 200 && r.data && typeof r.data.consumed === 'number') {
      return {
        ok: true,
        consumed: r.data.consumed,
        remaining: (r.data.entitlement && typeof r.data.entitlement.remaining === 'number')
          ? r.data.entitlement.remaining : null
      };
    }

    if (r.status === 409) {
      const code = (r.data && r.data.error && r.data.error.code) || 'conflict';
      return { ok: false, code: code, status: 409 };  // insufficient_quota / idempotency_conflict
    }

    const code = (r.data && r.data.error && r.data.error.code) || r.netError || ('http_' + r.status);
    return { ok: false, code: 'consume_failed', detail: code, status: r.status };
  }

  return {
    enabled: cfg.enabled,
    environment: cfg.environment,
    reportCost: cfg.reportCost,
    price: cfg.price,
    priceLabel: cfg.priceLabel,
    access: access,
    consume: consume
  };
}

module.exports = { createPayService: createPayService };
