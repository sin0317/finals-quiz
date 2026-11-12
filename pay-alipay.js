'use strict';

/* =========================================================================
   支付宝 AI 网页应用收款 · 服务端接入层
   -------------------------------------------------------------------------
   · 替换原 Watcher Pay，保持 pay.access() / pay.consume() 对外契约不变
   · 新增 createOrder / handleNotify / handleReturn 三个支付宝专用方法
   · 权益存本地（Redis 或内存缓存），不再调 Watcher Pay 云端
   · 配置优先级：环境变量 > data/pay.config.json（该目录已 gitignore）
   ========================================================================= */

const fs = require('fs');
const path = require('path');

/* 延迟 require：项目不一定有 alipay-sdk（测试环境可能没装），缺失时走 enabled=false */
let AlipaySdkCtor = null;
try {
  AlipaySdkCtor = require('alipay-sdk').AlipaySdk;
} catch (e) {
  AlipaySdkCtor = null;
}

const PRODUCT_CODE = 'FAST_INSTANT_TRADE_PAY';  // AI 网页应用收款固定值
const TIMEOUT_MS = 15000;

/* 统一时间戳格式：yyyy-MM-dd HH:mm:ss，Skill 要求不能用 ISO */
function nowStr() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function readConfigFile(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'pay.config.json'), 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}

function loadConfig(dataDir) {
  const f = readConfigFile(dataDir);
  const pick = function (envKey, fileVal, fallback) {
    const e = process.env[envKey];
    if (e && String(e).trim()) return String(e).trim();
    if (fileVal && String(fileVal).trim()) return String(fileVal).trim();
    return fallback;
  };

  const isSandbox = String(pick('ALIPAY_ENVIRONMENT', f.environment, 'sandbox')).toLowerCase() === 'sandbox';
  const gateway = pick('ALIPAY_GATEWAY', f.gateway,
    isSandbox
      ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'
      : 'https://openapi.alipay.com/gateway.do').replace(/\/+$/, '');

  const cfg = {
    appId: pick('ALIPAY_APP_ID', f.appId, ''),
    privateKey: pick('ALIPAY_PRIVATE_KEY', f.privateKey, ''),   // PKCS#1 格式，不含 PEM 头尾
    alipayPublicKey: pick('ALIPAY_PUBLIC_KEY', f.alipayPublicKey, ''),
    gateway: gateway,
    environment: isSandbox ? 'sandbox' : 'production',
    notifyUrl: pick('ALIPAY_NOTIFY_URL', f.notifyUrl, ''),
    returnUrl: pick('ALIPAY_RETURN_URL', f.returnUrl, ''),
    reportCost: Number(f.reportCost) > 0 ? Math.floor(Number(f.reportCost)) : 1,
    price: pick('ALIPAY_PRICE', f.price, ''),
    priceLabel: pick('ALIPAY_PRICE_LABEL', f.priceLabel, ''),
    subject: pick('ALIPAY_SUBJECT', f.subject, '期末刷题站 · 冲刺报告永久解锁'),
    body: pick('ALIPAY_BODY', f.body, '期末刷题站 v1.30.1 · 冲刺报告一次购买永久解锁')
  };

  cfg.enabled = !!(cfg.appId && cfg.privateKey && cfg.alipayPublicKey);
  if (cfg.enabled && !AlipaySdkCtor) {
    console.error('[期末刷题] pay-alipay 配置了但 alipay-sdk 未安装，回退 disabled');
    cfg.enabled = false;
  }
  return cfg;
}

/* ========== 本地权益持久化 ==========
   权益存 Redis 的 fq:purchases key，或 data/purchases.json（没有 Redis 时）。
   数据结构：{ uid: { source: 'alipay', out_trade_no, paid_at, expires_at?, perpetual: true } } */

function makeStore(dataDir) {
  let redis = null;
  let prefix = 'fq:';
  try {
    const { getRedis } = require('./lib/redis');
    redis = getRedis(process.env);
    const env = process.env || {};
    prefix = String(env.FQ_REDIS_PREFIX || 'fq:');
  } catch (e) { /* 没 Redis 就用文件 */ }

  const FILE = path.join(dataDir, 'purchases.json');
  let cache = null;  // { uid: purchaseRecord }

  async function load() {
    if (cache) return cache;
    if (redis) {
      try {
        const raw = await redis.get(prefix + 'purchases');
        if (raw && typeof raw === 'object') cache = raw;
        else cache = {};
      } catch (e) { cache = {}; }
    } else {
      try {
        cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
      } catch (e) { cache = {}; }
    }
    if (!cache || typeof cache !== 'object') cache = {};
    return cache;
  }

  async function persist() {
    if (!cache) return;
    if (redis) {
      try { await redis.set(prefix + 'purchases', JSON.stringify(cache)); }
      catch (e) { console.error('[期末刷题] purchases 写 Redis 失败：', e && e.message); }
    } else {
      try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
        fs.renameSync(tmp, FILE);
      } catch (e) { console.error('[期末刷题] purchases 写文件失败：', e && e.message); }
    }
  }

  return {
    load: load,
    persist: persist,
    get: function (uid) { return cache && cache[uid]; },
    set: function (uid, rec) { cache[uid] = rec; },
    findByTradeNo: function (outTradeNo) {
      if (!cache) return null;
      const keys = Object.keys(cache);
      for (let i = 0; i < keys.length; i++) {
        if (cache[keys[i]] && cache[keys[i]].out_trade_no === outTradeNo) return { uid: keys[i], rec: cache[keys[i]] };
      }
      return null;
    }
  };
}

/* ========== 主服务 ========== */

function createPayService(dataDir) {
  const cfg = loadConfig(dataDir);
  const store = makeStore(dataDir);
  let sdk = null;
  if (cfg.enabled && AlipaySdkCtor) {
    try {
      sdk = new AlipaySdkCtor({
        appId: cfg.appId,
        privateKey: cfg.privateKey,
        alipayPublicKey: cfg.alipayPublicKey,
        gateway: cfg.gateway,
        signType: 'RSA2',
        keyType: 'PKCS1',
        version: '1.0',
        timeout: TIMEOUT_MS
      });
    } catch (e) {
      console.error('[期末刷题] pay-alipay SDK 初始化失败：', e && e.message);
      cfg.enabled = false;
      sdk = null;
    }
  }

  /* 查权益。返回结构与原 Watcher Pay 兼容
     access 取值：granted / purchase_required / unavailable */
  async function access(userId) {
    if (!cfg.enabled) return { ok: false, code: 'pay_not_configured' };
    if (!userId) return { ok: false, code: 'no_user' };

    await store.load();
    const rec = store.get(userId);
    if (rec && (rec.perpetual || (rec.expires_at && rec.expires_at > Date.now()))) {
      return {
        ok: true,
        access: 'granted',
        entitlement: { type: 'paid', perpetual: !!rec.perpetual, out_trade_no: rec.out_trade_no },
        purchase: { out_trade_no: rec.out_trade_no, paid_at: rec.paid_at },
        reason: null
      };
    }
    return {
      ok: true,
      access: 'purchase_required',
      entitlement: null,
      purchase: null,
      reason: '未购买冲刺报告'
    };
  }

  /* 扣额度。支付宝 WebPay 模式买一次永久解锁，consume 退化成空操作。
     保持返回结构跟原 Watcher Pay 兼容。 */
  async function consume(userId, amount, idempotencyKey) {
    if (!cfg.enabled) return { ok: false, code: 'pay_not_configured' };
    if (!userId) return { ok: false, code: 'no_user' };
    const n = Math.floor(Number(amount));
    if (!(n > 0)) return { ok: false, code: 'bad_amount' };
    if (!idempotencyKey) return { ok: false, code: 'bad_idempotency_key' };

    await store.load();
    const rec = store.get(userId);
    if (!rec) return { ok: false, code: 'insufficient_quota' };

    return { ok: true, consumed: n, remaining: null };
  }

  /* 下单。返回 { ok, html, out_trade_no }
     前端把 html 直接挂 DOM 里让表单自动提交，浏览器会跳到支付宝收银台 */
  async function createOrder(userId, totalAmount) {
    if (!cfg.enabled) return { ok: false, code: 'pay_not_configured' };
    if (!userId) return { ok: false, code: 'no_user' };

    const amountStr = Math.max(0.01, Math.round(Number(totalAmount) * 100) / 100).toFixed(2);
    const outTradeNo = 'fq' + Date.now() + userId.slice(-6);

    try {
      const bizContent = {
        out_trade_no: outTradeNo,
        total_amount: amountStr,
        subject: cfg.subject,
        body: cfg.body,
        product_code: PRODUCT_CODE,
        timestamp: nowStr()
      };
      const html = sdk.pageExec('alipay.trade.page.pay', 'POST', {
        bizContent: bizContent,
        notify_url: cfg.notifyUrl,
        return_url: cfg.returnUrl
      });
      return { ok: true, html: html, out_trade_no: outTradeNo };
    } catch (e) {
      return { ok: false, code: 'create_order_failed', detail: (e && e.message) || 'unknown' };
    }
  }

  /* 异步通知处理（POST 表单）。返回 true 时调用方应回 success 给支付宝 */
  async function handleNotify(postData) {
    if (!cfg.enabled || !sdk) return false;
    if (!postData || typeof postData !== 'object') return false;

    /* V2 验签：不对 value 做 decode，直接用 postData 验 */
    let signOk = false;
    try { signOk = sdk.checkNotifySignV2(postData); } catch (e) { signOk = false; }
    if (!signOk) {
      console.warn('[期末刷题] alipay-notify 验签失败，sign=' + (postData.sign || ''));
      return false;
    }

    const outTradeNo = String(postData.out_trade_no || '').trim();
    const tradeNo = String(postData.trade_no || '').trim();
    const tradeStatus = String(postData.trade_status || '').trim();
    if (!outTradeNo || !tradeNo) return false;

    await store.load();
    const existing = store.findByTradeNo(outTradeNo);
    if (existing) {
      /* 幂等：同 trade_no 重复通知，不重复写 */
      console.log('[期末刷题] alipay-notify 幂等命中 out_trade_no=' + outTradeNo);
      return true;
    }

    /* TRADE_SUCCESS / TRADE_FINISHED 都算支付完成 */
    if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
      /* 从 outTradeNo 反查 userId（下单时前缀 fq + 时间戳 + uid 后 6 位不够精确，
         所以下单时也要把 outTradeNo 存回用户记录。这里 findByTradeNo 没命中说明
         通知先到了但我们本地还没记录——直接查 trade.query 二次确认再落盘 */
      await confirmAndPersist(tradeNo, outTradeNo);
      return true;
    }

    console.log('[期末刷题] alipay-notify trade_status=' + tradeStatus + ' 跳过');
    return true;
  }

  /* 同步回跳处理。返回 { ok, paid, out_trade_no } */
  async function handleReturn(query) {
    if (!cfg.enabled || !sdk) return { ok: false, code: 'pay_not_configured' };
    if (!query || typeof query !== 'object') return { ok: false, code: 'bad_query' };

    /* 回跳参数里没有 business_type，V2 验签可能不认。手动对 sign_content 验 */
    let signOk = false;
    try {
      /* 按支付宝规则拼 sign_content：参数按字典序排，sign 和 sign_type 排除 */
      const params = {};
      Object.keys(query).forEach(function (k) {
        if (k !== 'sign' && k !== 'sign_type') params[k] = query[k];
      });
      const sortedKeys = Object.keys(params).sort();
      const signContent = sortedKeys.map(function (k) { return k + '=' + params[k]; }).join('&');
      signOk = sdk.rsaCheck(signContent, String(query.sign || ''), 'RSA2');
    } catch (e) { signOk = false; }
    if (!signOk) {
      console.warn('[期末刷题] alipay-return 验签失败');
      return { ok: false, code: 'verify_failed' };
    }

    const outTradeNo = String(query.out_trade_no || '').trim();
    const tradeNo = String(query.trade_no || '').trim();
    if (!outTradeNo && !tradeNo) return { ok: false, code: 'missing_trade_no' };

    await store.load();
    const existing = store.findByTradeNo(outTradeNo);
    if (existing) return { ok: true, paid: true, out_trade_no: outTradeNo };

    /* 本地没记录，trade.query 兜底确认 */
    const tradeNoToQuery = tradeNo || null;
    const r = await queryTrade(tradeNoToQuery, outTradeNo);
    return { ok: r.ok, paid: r.paid, out_trade_no: outTradeNo };
  }

  /* 主动查单（兜底 / 回跳二次确认） */
  async function queryTrade(tradeNo, outTradeNo) {
    if (!cfg.enabled || !sdk) return { ok: false, code: 'pay_not_configured' };
    const bc = {};
    if (tradeNo) bc.trade_no = tradeNo;
    if (outTradeNo) bc.out_trade_no = outTradeNo;
    if (!bc.trade_no && !bc.out_trade_no) return { ok: false, code: 'missing_trade_no' };

    try {
      const r = await sdk.exec('alipay.trade.query', { bizContent: bc });
      if (r && r.code === '10000') {
        const st = r.trade_info && r.trade_info.trade_status;
        const paid = st === 'TRADE_SUCCESS' || st === 'TRADE_FINISHED';
        if (paid && outTradeNo) await confirmAndPersist(null, outTradeNo);
        return { ok: true, paid: paid, trade_status: st };
      }
      return { ok: false, code: 'alipay_error', detail: r && r.sub_msg };
    } catch (e) {
      return { ok: false, code: 'query_failed', detail: (e && e.message) || 'unknown' };
    }
  }

  /* 根据 out_trade_no 反查 userId → 落盘权益。
     out_trade_no 格式 fq + 时间戳 + uid 后 6 位，但 uid 长度不固定反推不准，
     所以 createOrder 时要把 out_trade_no 存一份。这里直接查不到就跳过，
     通知侧（handleNotify）和回跳侧（handleReturn）createOrder 时都已经能拿到 userId */
  async function confirmAndPersist(tradeNo, outTradeNo) {
    /* store.findByTradeNo 只返回本地已有记录；如果 out_trade_no 本身存了 userId 就精确落盘 */
    await store.load();
    const found = store.findByTradeNo(outTradeNo);
    if (found) {
      store.set(found.uid, {
        source: 'alipay',
        out_trade_no: outTradeNo,
        trade_no: tradeNo,
        paid_at: Date.now(),
        perpetual: true
      });
      await store.persist();
      console.log('[期末刷题] 权益已持久化 uid=' + found.uid + ' out_trade_no=' + outTradeNo);
      return true;
    }
    console.warn('[期末刷题] confirmAndPersist 找不到 out_trade_no=' + outTradeNo + ' 对应的本地记录，跳过落盘');
    return false;
  }

  /* 给下单时用：预先存一个 pending 占位，让后续 notify/return 能反查到 userId */
  async function bindOrderToUser(userId, outTradeNo) {
    await store.load();
    const existing = store.findByTradeNo(outTradeNo);
    if (existing && existing.rec.paid_at) return;  // 已支付完成了
    store.set(userId, {
      source: 'alipay_pending',
      out_trade_no: outTradeNo,
      paid_at: 0,
      perpetual: false
    });
    await store.persist();
  }

  return {
    enabled: cfg.enabled,
    environment: cfg.environment,
    reportCost: cfg.reportCost,
    price: cfg.price,
    priceLabel: cfg.priceLabel,
    access: access,
    consume: consume,
    createOrder: createOrder,
    handleNotify: handleNotify,
    handleReturn: handleReturn,
    queryTrade: queryTrade,
    bindOrderToUser: bindOrderToUser
  };
}

module.exports = { createPayService: createPayService };
