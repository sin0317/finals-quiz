'use strict';
/* 前端 E2E：用 happy-dom 加载真实 index.html + app.js，打真实后端
   覆盖：离线纯本地 / 在线游客 / 注册登录 / 题集上云 / 换设备合并 / 站长看板
   运行： NODE_PATH=<workspace>/node_modules node test/browser.test.js        */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Window } = require('happy-dom');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5100 + Math.floor(Math.random() * 400);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqbrowser-'));
const nodeFetch = globalThis.fetch;
const RealURL = globalThis.URL;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* ---------- 每台"设备"一个独立的 localStorage + Cookie 罐 ---------- */
function makeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); },
    clear: function () { m.clear(); },
    key: function (i) { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
    _dump: function () { return Object.fromEntries(m); }
  };
}

function makeFetch(jar, opts) {
  opts = opts || {};
  return async function (url, init) {
    if (opts.dead) throw new TypeError('Failed to fetch');
    init = init || {};
    const abs = new RealURL(url, BASE).toString();
    const headers = Object.assign({}, init.headers || {});
    const ck = Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ');
    if (ck) headers.Cookie = ck;
    const res = await nodeFetch(abs, Object.assign({}, init, { headers: headers, redirect: 'manual' }));
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    sc.forEach(function (s) {
      const pair = s.split(';')[0];
      const i = pair.indexOf('=');
      if (i <= 0) return;
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v) jar[k] = v; else delete jar[k];
    });
    return res;
  };
}

/* ---------- 启动一个"浏览器标签页" ---------- */
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || '';
const BODY_CLEAN = BODY.replace(/<script[\s\S]*?<\/script>/gi, '');

function bootApp(opts) {
  const win = new Window({ url: opts.url || (BASE + '/') });
  win.document.body.innerHTML = BODY_CLEAN;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return opts.confirmAnswer !== false; };
  win.prompt = function (msg, def) { return opts.promptAnswer != null ? opts.promptAnswer : def; };
  win.alert = function () {};
  if (opts.wbMock) win.WorkBuddyCloud = opts.wbMock;

  class FileReaderShim {
    readAsText() { setTimeout(() => { this.result = ''; this.onload && this.onload(); }, 0); }
    readAsArrayBuffer() { setTimeout(() => { this.result = new ArrayBuffer(0); this.onload && this.onload(); }, 0); }
  }

  const URLShim = RealURL;
  if (!URLShim.createObjectURL) URLShim.createObjectURL = function () { return 'blob:mock'; };
  if (!URLShim.revokeObjectURL) URLShim.revokeObjectURL = function () {};

  const store = opts.storage || makeStorage();
  const fetchImpl = opts.fetch || makeFetch(opts.jar || {}, { dead: !!opts.offline });

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator',
    APP_SRC
  );
  fn(win, win.document, store, fetchImpl,
    win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval,
    win.Blob || globalThis.Blob, URLShim, FileReaderShim, win.crypto, win.navigator);

  const app = {
    win: win,
    doc: win.document,
    store: store,
    $: function (s) { return win.document.querySelector(s); },
    $$: function (s) { return Array.prototype.slice.call(win.document.querySelectorAll(s)); },
    text: function (s) { const e = win.document.querySelector(s); return e ? e.textContent.trim() : null; },
    visible: function (s) { const e = win.document.querySelector(s); return !!e && !e.hidden; },
    click: function (s) {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到元素：' + s);
      e.dispatchEvent(new win.Event('click', { bubbles: true }));
      return e;
    },
    setVal: function (s, v) {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到元素：' + s);
      e.value = v;
    }
  };
  return app;
}

/* ---------- 主流程 ---------- */
(async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), FQ_DATA_DIR: DATA }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', function (d) { log += d.toString(); });
  child.stderr.on('data', function (d) { log += d.toString(); });

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await nodeFetch(BASE + '/api/ping'); if (r.ok) { up = true; break; } } catch (e) {}
    await sleep(100);
  }
  console.log('\n== 前端 E2E（端口 ' + PORT + '）==\n');
  ok(up, '后端已就绪', log.slice(0, 200));
  if (!up) { child.kill(); process.exit(1); }

  /* ================= A. 离线：fetch 直接失败 ================= */
  console.log('\n[A] 离线纯本地模式');
  const a = bootApp({ offline: true, jar: {} });
  await sleep(250);
  ok(a.text('#acctName') === '游客', '离线时显示「游客」', a.text('#acctName'));
  ok(a.visible('#loginBtn') === false, '离线时隐藏登录按钮（点了也登不上）');
  ok(/离线/.test(a.text('#syncHint')), '离线时提示「离线模式」', a.text('#syncHint'));
  ok(a.$('#acctDot').className.indexOf('offline') >= 0, '离线时状态灯为 offline');

  // 离线也要能正常刷题
  a.click('#loadSampleBtn');
  await sleep(80);
  a.click('#extractBtn');
  await sleep(150);
  const pv = a.$$('#previewBody tr').length;
  ok(pv > 0, '离线时依然能提炼出知识点（' + pv + ' 条）', pv);
  a.setVal('#courseName', '中国近代史');
  a.click('#saveBankBtn');
  await sleep(150);
  ok(a.$$('#bankList .bank-item').length === 1, '离线时题集能保存到本地', a.$$('#bankList .bank-item').length);
  ok(a.store.getItem('fq_banks_v1') && JSON.parse(a.store.getItem('fq_banks_v1')).length === 1, '离线数据写进 localStorage');

  /* ================= B. 在线游客 ================= */
  console.log('\n[B] 在线游客（不登录也能用）');
  const jarB = {};
  const b = bootApp({ jar: jarB });
  await sleep(400);
  ok(b.text('#acctName') === '游客', '在线未登录时显示「游客」', b.text('#acctName'));
  ok(b.visible('#loginBtn'), '在线时显示「注册 / 登录」按钮');
  ok(/未登录/.test(b.text('#syncHint')), '提示未登录只存本机', b.text('#syncHint'));
  ok(b.store.getItem('fq_gid_v1') !== null, '生成本地游客匿名 id');

  // 游客访问应被服务端记下（写盘有 800ms 防抖）
  await sleep(1300);
  let statsFile = { guests: {} };
  try { statsFile = JSON.parse(fs.readFileSync(path.join(DATA, 'stats.json'), 'utf8')); } catch (e) {}
  ok(Object.keys(statsFile.guests || {}).length >= 1, '服务端记到了匿名游客访问', Object.keys(statsFile.guests || {}).length);

  /* ================= C. 注册 + 上云 ================= */
  console.log('\n[C] 注册并同步');
  b.click('#loadSampleBtn');
  await sleep(80);
  b.click('#extractBtn');
  await sleep(150);
  b.setVal('#courseName', '中国近代史');
  b.click('#saveBankBtn');
  await sleep(150);
  ok(b.$$('#bankList .bank-item').length === 1, 'B 设备本地有 1 个题集');

  b.click('#loginBtn');
  await sleep(60);
  ok(b.visible('#authModal'), '点击后弹出登录框');
  b.click('#authModal .mtab[data-mtab="reg"]');
  await sleep(40);
  ok(b.visible('#authNameFld'), '切到注册后显示「显示名」');
  b.setVal('#authUser', '小明同学');
  b.setVal('#authName', '小明');
  b.setVal('#authPass', 'ming123456');
  b.click('#authSubmit');
  await sleep(700);

  ok(b.visible('#authModal') === false, '注册成功后弹窗关闭');
  ok(b.text('#acctName') === '小明', '顶栏显示昵称', b.text('#acctName'));
  ok(/站长/.test(b.text('#acctName2')), '第一个注册的账号标记为站长', b.text('#acctName2'));
  ok(b.visible('#syncNowBtn') && b.visible('#logoutBtn'), '登录后出现「立即同步 / 退出登录」');
  ok(b.visible('#loginBtn') === false, '登录后隐藏「注册 / 登录」');

  // 等防抖推送
  await sleep(2600);
  const r1 = await (await nodeFetch(BASE + '/api/sync', { headers: { Cookie: 'fq_sid=' + jarB.fq_sid } })).json();
  ok(r1.banks && r1.banks.length === 1, '题集已推到云端', r1.banks && r1.banks.length);
  ok(r1.banks[0] && r1.banks[0].questions.length > 0, '云端题集里有题目', r1.banks[0] && r1.banks[0].questions.length);
  const cloudQ = r1.banks[0].questions.length;

  /* ================= D. 换一台设备：登录 + 拉取 ================= */
  console.log('\n[D] 换设备登录并合并');
  const jarD = {};
  const d = bootApp({ jar: jarD, storage: makeStorage() });
  await sleep(400);
  ok(d.text('#acctName') === '游客', '新设备初始是游客');
  ok(d.$$('#bankList .bank-item').length === 0, '新设备本地没有题集');

  d.click('#loginBtn');
  await sleep(60);
  d.setVal('#authUser', '小明同学');
  d.setVal('#authPass', 'ming123456');
  d.click('#authSubmit');
  await sleep(900);

  ok(d.text('#acctName') === '小明', '新设备登录成功');
  ok(d.$$('#bankList .bank-item').length === 1, '云端题集已拉到新设备', d.$$('#bankList .bank-item').length);
  ok(d.text('#bankList .item-sub').indexOf(cloudQ + ' 题') === 0, '新设备题数一致（' + cloudQ + ' 题）', d.text('#bankList .item-sub'));

  // 在新设备上新加一个题集，推上去
  d.click('#loadSampleBtn');
  await sleep(80);
  d.click('#extractBtn');
  await sleep(150);
  d.setVal('#courseName', '药理学');
  d.click('#saveBankBtn');
  await sleep(2600);

  const r2 = await (await nodeFetch(BASE + '/api/sync', { headers: { Cookie: 'fq_sid=' + jarD.fq_sid } })).json();
  ok(r2.banks.length === 2, '云端现在是 2 个题集（近代史 + 药理学）', r2.banks.map(function (x) { return x.course; }));

  // 老设备（沿用同一浏览器的 Cookie 罐 + localStorage）刷新后应合并出新题集，且不丢原有题目
  const b2 = bootApp({ jar: jarB, storage: makeStorage(b.store._dump()) });
  await sleep(400);
  ok(b2.text('#acctName') === '小明', '老设备重新打开仍保持登录');
  ok(b2.$$('#bankList .bank-item').length === 2, '老设备合并出 2 个题集', b2.$$('#bankList .bank-item').length);
  const total2 = b2.$$('#bankList .bank-item').reduce(function (n, el) {
    const m = el.querySelector('.item-sub').textContent.match(/^(\d+) 题/);
    return n + (m ? Number(m[1]) : 0);
  }, 0);
  ok(total2 > cloudQ, '合并后题目总数增加（' + total2 + ' > ' + cloudQ + '），原有题目没被覆盖');

  /* ================= E. 站长看板 ================= */
  console.log('\n[E] 站长使用情况');
  d.click('.tab[data-view="stats"]');
  await sleep(600);
  ok(d.visible('#adminCard'), '站长能看到「站点使用情况」卡片');
  const kpis = d.$$('#adminKpis .kpi').map(function (e) { return e.textContent; }).join(' | ');
  ok(/注册用户/.test(kpis), '看板有注册用户数', kpis);
  const rows = d.$$('#adminTable tbody tr');
  ok(rows.length === 1, '看板列出 1 位用户', rows.length);
  ok(rows[0] && /小明/.test(rows[0].textContent), '看板显示昵称', rows[0] && rows[0].textContent.slice(0, 40));
  ok(rows[0] && /站长/.test(rows[0].textContent), '看板标注站长');
  ok(d.$$('#adminDaily .cday').length === 7, '看板画出最近 7 天柱子', d.$$('#adminDaily .cday').length);
  const qCell = rows[0].querySelectorAll('td')[5].textContent;
  ok(Number(qCell) === total2, '看板统计的题目数与本机一致（' + qCell + '）', { qCell, total2 });

  /* ================= F. 普通用户看不到看板 ================= */
  console.log('\n[F] 权限隔离');
  const jarF = {};
  const f = bootApp({ jar: jarF, storage: makeStorage() });
  await sleep(300);
  f.click('#loginBtn');
  await sleep(60);
  f.click('#authModal .mtab[data-mtab="reg"]');
  await sleep(40);
  f.setVal('#authUser', '小红同学');
  f.setVal('#authPass', 'hong123456');
  f.click('#authSubmit');
  await sleep(800);
  ok(f.text('#acctName') === '小红同学', '第二个账号登录成功', f.text('#acctName'));
  ok(f.$$('#bankList .bank-item').length === 0, '小红看不到小明的题集');
  f.click('.tab[data-view="stats"]');
  await sleep(600);
  ok(f.visible('#adminCard') === false, '普通用户看不到站长看板');
  ok(!/站长/.test(f.text('#acctName2')), '普通用户没有站长标记', f.text('#acctName2'));

  /* ================= G. 退出登录保留本地数据 ================= */
  console.log('\n[G] 退出登录');
  f.click('.tab[data-view="stats"]');
  await sleep(200);
  f.click('#loadSampleBtn');
  f.click('.tab[data-view="import"]');
  await sleep(100);
  f.click('#extractBtn');
  await sleep(150);
  f.setVal('#courseName', '生理学');
  f.click('#saveBankBtn');
  await sleep(200);
  ok(f.$$('#bankList .bank-item').length === 1, '退出前有 1 个题集');
  f.click('.tab[data-view="stats"]');
  await sleep(300);
  f.click('#logoutBtn');
  await sleep(400);
  ok(f.text('#acctName') === '游客', '退出后回到游客身份');
  ok(f.visible('#loginBtn'), '退出后重新出现登录按钮');
  ok(f.$$('#bankList .bank-item').length === 1, '退出后本地题集仍然保留（不会白刷）', f.$$('#bankList .bank-item').length);

  // ============ F. WorkBuddy 账号登录 ============
  function makeWBMock(o) {
    const calls = { cfg: null, oauth: null, callback: 0, signOut: 0, getSession: 0 };
    const mock = {
      createWorkBuddyCloud: function (cfg) {
        calls.cfg = cfg;
        return {
          auth: {
            getSession: function () {
              calls.getSession++;
              return Promise.resolve({ data: o.session || null, error: null });
            },
            handleWorkBuddyCallback: function () {
              calls.callback++;
              if (o.cbError) return Promise.resolve({ data: null, error: { message: o.cbError } });
              return Promise.resolve({ data: o.cbSession || null, error: null });
            },
            signInWithOAuth: function (opt) {
              calls.oauth = opt;
              return Promise.resolve({ data: { url: 'https://relay.example/authorize?x=1' }, error: null });
            },
            signOut: function () { calls.signOut++; return Promise.resolve({ data: null }); }
          }
        };
      }
    };
    return { mock: mock, calls: calls };
  }

  // F1. 没有 SDK 时不能让登录入口变成死按钮
  const g1 = bootApp({});
  await sleep(200);
  ok(g1.text('#acctName') === '游客', 'F1 没加载 SDK 时仍是可用的游客态');
  g1.click('#loginBtn');
  await sleep(60);
  g1.click('#wbLoginBtn');
  await sleep(120);
  ok(/没加载|刷新/.test(g1.text('#authErr') || ''), 'F1 SDK 缺失时给出明确提示而不是静默失败', g1.text('#authErr'));

  // F2. 授权回调落地：换会话 + 清参数但保住 sharecode
  const wb2 = makeWBMock({ cbSession: { user: { id: 'wb_uid_e2e_9001', name: '小艾', avatarUrl: '' } } });
  const g2 = bootApp({ url: BASE + '/?code=abc&state=xyz&provider=workbuddy&sharecode=TESTCODE', wbMock: wb2.mock });
  await sleep(900);
  ok(wb2.calls.callback === 1, 'F2 回调落地页调用了 handleWorkBuddyCallback', wb2.calls.callback);
  ok(g2.text('#acctName') === '小艾', 'F2 云端身份换成本站会话后显示云端昵称', g2.text('#acctName'));
  ok(String(g2.win.location.search).indexOf('sharecode=TESTCODE') >= 0, 'F2 sharecode 被保留（分享进来的同学不会掉页）', g2.win.location.search);
  ok(!(/[?&]code=/.test(String(g2.win.location.search))), 'F2 回调参数 code 被清掉', g2.win.location.search);
  ok(!(/[?&]provider=/.test(String(g2.win.location.search))), 'F2 回调参数 provider 被清掉', g2.win.location.search);
  ok(!(/[?&]state=/.test(String(g2.win.location.search))), 'F2 回调参数 state 被清掉', g2.win.location.search);

  // F3. 普通访问：云端会话还在就自动认回
  const wb3 = makeWBMock({ session: { user: { id: 'wb_uid_e2e_9001', name: '小艾', avatarUrl: '' } } });
  const g3 = bootApp({ wbMock: wb3.mock });
  await sleep(900);
  ok(wb3.calls.callback === 0, 'F3 普通访问不走回调兑换', wb3.calls.callback);
  ok(g3.text('#acctName') === '小艾', 'F3 云端会话仍在时自动恢复登录', g3.text('#acctName'));

  // F4. 登录发起：provider 与 redirectTo 都要对
  const wb4 = makeWBMock({});
  const g4 = bootApp({ url: BASE + '/?sharecode=TESTCODE', wbMock: wb4.mock });
  await sleep(600);
  g4.click('#loginBtn');
  await sleep(60);
  g4.click('#wbLoginBtn');
  await sleep(300);
  ok(wb4.calls.oauth && wb4.calls.oauth.provider === 'workbuddy', 'F4 用 workbuddy 作为登录 provider', wb4.calls.oauth && wb4.calls.oauth.provider);
  ok(/sharecode=TESTCODE/.test((wb4.calls.oauth && wb4.calls.oauth.redirectTo) || ''), 'F4 redirectTo 保留 sharecode', wb4.calls.oauth && wb4.calls.oauth.redirectTo);
  ok(!!(wb4.calls.cfg && wb4.calls.cfg.endpoint && wb4.calls.cfg.publishableKey), 'F4 初始化带上 endpoint 与 publishableKey', wb4.calls.cfg && Object.keys(wb4.calls.cfg));
  ok(!!(wb4.calls.cfg && wb4.calls.cfg.oauthRelayBaseUrl), 'F4 初始化带上 oauthRelayBaseUrl', wb4.calls.cfg && wb4.calls.cfg.oauthRelayBaseUrl);

  // F5. 回调出错时要留在登录框，不能假装登录成功
  const wb5 = makeWBMock({ cbError: '授权已过期' });
  const g5 = bootApp({ url: BASE + '/?code=abc&state=xyz&provider=workbuddy', wbMock: wb5.mock });
  await sleep(900);
  ok(g5.text('#acctName') === '游客', 'F5 回调失败时不会伪装成已登录', g5.text('#acctName'));
  ok(/授权已过期/.test(g5.text('#authErr') || ''), 'F5 回调失败把原因说清楚', g5.text('#authErr'));

  child.kill('SIGTERM');
  await sleep(300);
  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('\n测试崩溃：', e);
  process.exit(1);
});
