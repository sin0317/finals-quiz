'use strict';
/* 冲刺报告：付费墙与报告渲染
   运行： NODE_PATH=<workspace>/node_modules node test/sprint.test.js
   不联网：/api/pay/* 用桩数据，其余请求一律失败（走纯本地模式） */

const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '';
const BODY_CLEAN = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');

function boot(seed, payStub) {
  const win = new Window({ url: 'http://127.0.0.1/' });
  win.document.body.innerHTML = BODY_CLEAN;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.prompt = function (m, d) { return d; };
  win.alert = function () {};
  win.print = function () {};

  const store = {
    _d: Object.assign({}, seed || {}),
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem: function (k, v) { this._d[k] = String(v); },
    removeItem: function (k) { delete this._d[k]; }
  };

  const fetchImpl = function (url) {
    const p = String(url);
    if (payStub && p.indexOf('/api/pay/') === 0) {
      const body = p.indexOf('/api/pay/status') === 0 ? payStub.status : payStub.access;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: function () { return Promise.resolve(JSON.stringify(body)); }
      });
    }
    return Promise.reject(new Error('offline'));
  };

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator',
    APP_SRC
  );
  fn(win, win.document, store, fetchImpl,
    win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval,
    win.Blob || globalThis.Blob, globalThis.URL,
    class { readAsText() {} readAsArrayBuffer() {} }, win.crypto, win.navigator);

  return win;
}

const bank = {
  id: 'b1',
  course: '临床药物治疗学',
  questions: [
    { id: 'q1', stem: '青霉素的抗菌机制是什么', chapter: '第三章 抗菌药', type: 'single', opts: ['A', 'B'], answer: 'A' },
    { id: 'q2', stem: '氨基糖苷类的主要不良反应', chapter: '第三章 抗菌药', type: 'single', opts: ['A', 'B'], answer: 'A' },
    { id: 'q3', stem: '已经掌握的那道题', chapter: '第三章 抗菌药', type: 'single', opts: ['A', 'B'], answer: 'A' },
    { id: 'q4', stem: '药动学的基本概念', chapter: '第一章 总论', type: 'single', opts: ['A', 'B'], answer: 'A' },
    { id: 'q5', stem: '还没答过的题', chapter: '第一章 总论', type: 'single', opts: ['A', 'B'], answer: 'A' },
    { id: 'q6', stem: '完全没碰过的章节题', chapter: '第五章 特殊人群', type: 'single', opts: ['A', 'B'], answer: 'A' }
  ]
};

const seed = {
  fq_banks_v1: JSON.stringify([bank]),
  fq_stats_v1: JSON.stringify({
    q1: { ok: 2, bad: 3, mastery: 0.4 },
    q2: { ok: 0, bad: 2, mastery: 0.2 },
    q3: { ok: 5, bad: 1, mastery: 0.95 },
    q4: { ok: 1, bad: 1, mastery: 0.5 }
  }),
  fq_current_v1: 'b1'
};

function tick(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 3); i++) p = p.then(function () { return new Promise(function (r) { setTimeout(r, 0); }); });
  return p;
}

function clickTab(win, view) {
  const t = win.document.querySelector('.tab[data-view="' + view + '"]');
  if (!t) throw new Error('找不到 tab：' + view);
  t.dispatchEvent(new win.Event('click', { bubbles: true }));
}

(async function main() {
  console.log('\n— 页面接线 —');
  const w0 = boot(seed, null);
  ok(!!w0.document.querySelector('.tab[data-view="sprint"]'), '导航里有冲刺报告入口');
  ok(!!w0.document.getElementById('view-sprint'), '页面上有 view-sprint 容器');
  ['sprintReport', 'sprintLock', 'sprintNeedLogin', 'sprintPrice', 'sprintBuyBtn', 'sprintQr']
    .forEach(function (id) { ok(!!w0.document.getElementById(id), '存在元素 #' + id); });

  console.log('\n— 未登录：引导登录，不暴露报告 —');
  const w1 = boot(seed, {
    status: { ok: true, enabled: true, price: '¥9.90', loggedIn: false },
    access: { ok: true, access: 'purchase_required' }
  });
  clickTab(w1, 'sprint');
  await tick();
  ok(w1.document.getElementById('sprintNeedLogin').hidden === false, '未登录时显示登录引导');
  ok(w1.document.getElementById('sprintLock').hidden === true, '未登录时不显示购买卡片');
  ok(w1.document.getElementById('sprintReport').innerHTML.trim() === '', '未登录时不渲染报告');

  console.log('\n— 已登录未购买：付费墙 —');
  const w2 = boot(seed, {
    status: { ok: true, enabled: true, price: '¥9.90', loggedIn: true, environment: 'sandbox' },
    access: {
      ok: true, access: 'purchase_required', entitlement: { type: 'permanent' },
      purchase: { url: 'https://pay.example/purchase?ticket=t', qr_code_url: 'https://pay.example/qr.png?x=1' }
    }
  });
  clickTab(w2, 'sprint');
  await tick();
  const lock2 = w2.document.getElementById('sprintLock');
  ok(lock2.hidden === false, '显示购买卡片');
  ok(w2.document.getElementById('sprintPrice').textContent.indexOf('9.90') >= 0, '价格取自服务端配置', w2.document.getElementById('sprintPrice').textContent);
  ok(w2.document.getElementById('sprintQr').hidden === false, '有二维码时显示二维码');
  ok(w2.document.getElementById('sprintQrImg').getAttribute('src').indexOf('qr.png') > 0, '二维码用的是平台返回的地址');
  ok(w2.document.getElementById('sprintReport').innerHTML.trim() === '', '未购买时不渲染报告');
  ok(w2.document.getElementById('sprintBuyBtn').disabled === false, '购买按钮可点');
  const env2 = w2.document.getElementById('sprintEnv');
  ok(env2.hidden === false, '沙箱环境会标出「不会真实扣款」');
  ok(env2.textContent.indexOf('不会真实扣款') >= 0, '环境提示写明不扣款', env2.textContent);

  console.log('\n— 已购买：报告内容 —');
  const w3 = boot(seed, {
    status: { ok: true, enabled: true, price: '¥9.90', loggedIn: true },
    access: { ok: true, access: 'granted', entitlement: { type: 'permanent' } }
  });
  clickTab(w3, 'sprint');
  await tick(5);
  const html = w3.document.getElementById('sprintReport').innerHTML;
  ok(w3.document.getElementById('sprintLock').hidden === true, '已购买时不显示付费墙');
  ok(html.indexOf('72 小时') > 0, '报告里有 72 小时计划');
  ok(html.indexOf('第三章 抗菌药') > 0, '列出薄弱章节');
  ok(html.indexOf('第五章 特殊人群') > 0, '单独提示一次没碰过的章节');
  ok(html.indexOf('青霉素的抗菌机制') > 0, '薄弱章节下列出具体题目');
  ok(html.indexOf('已经掌握的那道题') < 0, '已掌握的题不列进薄弱清单');
  ok(w3.document.getElementById('sprintGoQuiz') !== null, '报告底部有去刷题的入口');

  console.log('\n— 正式环境：环境提示不出现 —');
  const w5 = boot(seed, {
    status: { ok: true, enabled: true, price: '¥9.90', loggedIn: true, environment: 'live' },
    access: {
      ok: true, access: 'purchase_required', entitlement: { type: 'permanent' },
      purchase: {
        url: 'alipays://platformapi/startapp?appId=2021006180624128&page=pages/order/index?purchaseLinkId=X',
        qr_code_url: 'https://mobilecodec.alipay.com/show.htm?code=abc'
      }
    }
  });
  clickTab(w5, 'sprint');
  await tick();
  ok(w5.document.getElementById('sprintEnv').hidden === true, '正式环境不显示沙箱提示');
  ok(w5.document.getElementById('sprintScanTip').hidden === false, '支付宝深链时提示改用扫码');
  ok(w5.document.getElementById('sprintBuyBtn').textContent.indexOf('扫') >= 0, '按钮文案引导扫码而不是点链接',
    w5.document.getElementById('sprintBuyBtn').textContent);
  ok(w5.document.getElementById('sprintQrImg').getAttribute('src').indexOf('mobilecodec') > 0, '二维码用的是支付宝官方地址');

  console.log('\n— 未开通付费：降级不报错 —');
  const w4 = boot(seed, {
    status: { ok: true, enabled: false, loggedIn: true },
    access: { ok: true, access: 'granted' }
  });
  clickTab(w4, 'sprint');
  await tick();
  ok(w4.document.getElementById('sprintReport').innerHTML.indexOf('还没开放') > 0, '付费未配置时给出说明而不是空白');

  console.log('\n通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
