'use strict';
/* 题集广场：接口 + 前端链路
   接口部分：起临时端口 + 临时数据目录，跑分享 / 列表 / 筛选 / 取用 / 撤下
   前端部分：happy-dom 加载真实 index.html + app.js，接真实后端走一遍点击
   运行： NODE_PATH=<workspace>/node_modules node test/plaza.test.js            */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Window } = require('happy-dom');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqplaza-'));
const nodeFetch = globalThis.fetch;
const RealURL = globalThis.URL;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 裸 HTTP（要带 query，所以不复用 api.test.js 那个） ---------------- */
function req(method, urlPath, body, cookie) {
  return new Promise(function (resolve, reject) {
    const u = new RealURL(BASE + urlPath);
    const http = require('http');
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': payload.length } : {},
        cookie ? { Cookie: cookie } : {}
      )
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json: json, raw: raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
function cookieFrom(res) {
  const sc = res.headers['set-cookie'];
  if (!sc || !sc.length) return null;
  return sc.map(function (s) { return s.split(';')[0]; }).join('; ');
}

/* ---------------- 浏览器环境 ---------------- */
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function makeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i) => { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; }
  };
}

function makeFetch(jar) {
  return async function (url, init) {
    init = init || {};
    const abs = new RealURL(url, BASE).toString();
    const headers = Object.assign({}, init.headers || {});
    const ck = Object.keys(jar).map((k) => k + '=' + jar[k]).join('; ');
    if (ck) headers.Cookie = ck;
    const res = await nodeFetch(abs, Object.assign({}, init, { headers: headers, redirect: 'manual' }));
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    sc.forEach((s) => {
      const pair = s.split(';')[0];
      const i = pair.indexOf('=');
      if (i <= 0) return;
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (v) jar[k] = v; else delete jar[k];
    });
    return res;
  };
}

function bootApp(opts) {
  const o = opts || {};
  const win = new Window({ url: BASE + '/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = () => true;
  win.prompt = (m, d) => d;
  win.alert = () => {};
  const store = makeStorage(o.seed);
  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator',
    APP_SRC
  );
  fn(win, win.document, store, makeFetch(o.jar || {}),
    win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval,
    win.Blob || globalThis.Blob, RealURL, win.FileReader, win.crypto, win.navigator);

  return {
    win,
    $: (s) => win.document.querySelector(s),
    $$: (s) => Array.from(win.document.querySelectorAll(s)),
    click: (s) => {
      const el = win.document.querySelector(s);
      if (!el) throw new Error('找不到元素：' + s);
      el.dispatchEvent(new win.Event('click', { bubbles: true }));
      return el;
    },
    setVal: (s, v) => {
      const el = win.document.querySelector(s);
      if (!el) throw new Error('找不到元素：' + s);
      el.value = v;
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      return el;
    },
    store
  };
}

/* ---------------- 造数据 ---------------- */
const QS = [
  { type: 'single', stem: '阿司匹林的主要作用机制是____', answer: '抑制环氧化酶', opts: ['抑制环氧化酶', '阻断钙通道'] },
  { type: 'multi', stem: '以下属于解热镇痛药的有____', answer: ['阿司匹林', '对乙酰氨基酚'], opts: ['青霉素'] },
  { type: 'fill', stem: '地高辛的治疗窗很____', answer: '窄' }
];

(async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), FQ_DATA_DIR: DATA }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await nodeFetch(BASE + '/api/ping'); if (r.ok) { up = true; break; } } catch (e) { /* 等 */ }
    await sleep(100);
  }
  console.log('\n== 题集广场（端口 ' + PORT + '）==\n');
  ok(up, '后端已就绪', log.slice(0, 200));
  if (!up) { child.kill(); process.exit(1); }

  /* ================= A. 接口 ================= */
  console.log('[A] 接口');

  const empty = await req('GET', '/api/plaza/list');
  ok(empty.status === 200 && empty.json.items.length === 0, '空广场返回空列表', empty.json);
  ok(empty.json.loggedIn === false, '未登录时 loggedIn=false');

  const anon = await req('POST', '/api/plaza/share', { course: 'x', major: 'a', subject: 'b', questions: QS });
  ok(anon.status === 401, '未登录不能分享（401）', anon.status);

  const ra = await req('POST', '/api/register', { username: '分享者甲', password: 'abc123456', name: '甲同学' });
  const ckA = cookieFrom(ra);
  ok(ra.status === 200 && !!ckA, '注册账号甲并拿到会话', ra.status);

  const noMajor = await req('POST', '/api/plaza/share', { course: '药理', subject: '药理', questions: QS }, ckA);
  ok(noMajor.status === 400 && /专业/.test(noMajor.json.error), '不填专业被拦下', noMajor.json);

  const noQ = await req('POST', '/api/plaza/share', { course: '药理', major: '药学', subject: '药理学', questions: [] }, ckA);
  ok(noQ.status === 400 && /还没有题/.test(noQ.json.error), '空题集不能分享', noQ.json);

  const sh1 = await req('POST', '/api/plaza/share', {
    course: '临床药物治疗学', major: '药学', subject: '临床药物治疗学',
    note: '老师划的重点', questions: QS
  }, ckA);
  ok(sh1.status === 200 && sh1.json.qCount === 3 && !sh1.json.updated, '分享成功，3 道题', sh1.json);
  const pid = sh1.json.id;

  const list1 = await req('GET', '/api/plaza/list');
  ok(list1.json.items.length === 1, '列表里出现 1 份', list1.json.items && list1.json.items.length);
  const brief = list1.json.items[0];
  ok(brief.questions === undefined, '列表不带题目正文（省流量、防顺手抄库）', Object.keys(brief));
  ok(brief.major === '药学' && brief.subject === '临床药物治疗学', '专业 / 科目标签在', [brief.major, brief.subject]);
  ok(brief.author === '甲同学', '带上作者显示名', brief.author);
  ok(brief.mine === false, '未登录看别人的不算 mine');
  ok(list1.json.majors[0] === '药学', '专业候选里有「药学」', list1.json.majors);

  const mineList = await req('GET', '/api/plaza/list?mine=1', null, ckA);
  ok(mineList.json.items.length === 1 && mineList.json.items[0].mine === true, '作者自己看带 mine 标记');
  const mineAnon = await req('GET', '/api/plaza/list?mine=1');
  ok(mineAnon.json.items.length === 0, '未登录时 mine 过滤不出东西');

  // 脏题：空 stem / 非对象 要过滤掉，不能让广场里出现空题
  const dirty = await req('POST', '/api/plaza/share', {
    course: '带脏数据', major: '药学', subject: '药剂学',
    questions: [{ stem: '' }, null, 'x', { stem: '正常题____', answer: '答案' }]
  }, ckA);
  ok(dirty.status === 200 && dirty.json.qCount === 1, '空题干 / 非对象被过滤，只留 1 道', dirty.json);

  const tooMany = await req('POST', '/api/plaza/share', {
    course: '超大', major: '药学', subject: '药剂学',
    questions: Array.from({ length: 401 }, (_, i) => ({ stem: '题' + i + '____', answer: '答' }))
  }, ckA);
  ok(tooMany.status === 400 && /400/.test(tooMany.json.error), '超过 400 题被拦下', tooMany.json);

  const byMajor = await req('GET', '/api/plaza/list?major=' + encodeURIComponent('药学'));
  ok(byMajor.json.items.length === 2, '按专业筛选（2 份都是药学）', byMajor.json.items.length);
  const byOther = await req('GET', '/api/plaza/list?major=' + encodeURIComponent('临床医学'));
  ok(byOther.json.items.length === 0, '筛没有的专业返回空');
  const byKw = await req('GET', '/api/plaza/list?q=' + encodeURIComponent('临床药物'));
  ok(byKw.json.items.length === 1 && byKw.json.items[0].id === pid, '关键词能搜到科目名');
  const bySubject = await req('GET', '/api/plaza/list?subject=' + encodeURIComponent('药剂学'));
  ok(bySubject.json.items.length === 1, '按科目筛选');

  const hot = await req('GET', '/api/plaza/list?sort=hot');
  ok(hot.status === 200 && hot.json.items.length === 2, 'sort=hot 正常');

  // 取用：不带登录也能取，题目里不能带别人的 id
  const take = await req('POST', '/api/plaza/take', { id: pid });
  ok(take.status === 200 && take.json.questions.length === 3, '未登录也能取用', take.status);
  ok(take.json.questions.every((q) => q.id === undefined), '服务端剥掉了题目 id（前端重算，避免统计撞车）');
  ok(take.json.course === '临床药物治疗学' && take.json.author === '甲同学', '取用返回课程名和作者');
  const list2 = await req('GET', '/api/plaza/list');
  const brief2 = list2.json.items.filter((x) => x.id === pid)[0];
  ok(brief2.downloads === 1, '取用数 +1', brief2.downloads);

  const rb = await req('POST', '/api/register', { username: '路人乙', password: 'abc123456', name: '乙同学' });
  const ckB = cookieFrom(rb);
  const delB = await req('POST', '/api/plaza/remove', { id: pid }, ckB);
  ok(delB.status === 403, '别人不能删我分享的（403）', delB.status);
  const delAnon = await req('POST', '/api/plaza/remove', { id: pid });
  ok(delAnon.status === 401, '未登录不能删（401）', delAnon.status);

  // 重复分享同一份 = 更新，不新增条目
  const upd = await req('POST', '/api/plaza/share', {
    shareId: pid, course: '临床药物治疗学（修订）', major: '药学', subject: '临床药物治疗学',
    note: '补了两题', questions: QS
  }, ckA);
  ok(upd.status === 200 && upd.json.updated === true && upd.json.id === pid, '带 shareId 是更新，不是新分享', upd.json);
  const list3 = await req('GET', '/api/plaza/list');
  ok(list3.json.items.filter((x) => x.id === pid).length === 1, '更新后仍然只有一条');
  ok(list3.json.items.filter((x) => x.id === pid)[0].course === '临床药物治疗学（修订）', '课程名跟着改了');
  ok(list3.json.items.filter((x) => x.id === pid)[0].downloads === 1, '更新不会把取用数清零');

  // 别人的 shareId 不能拿来改我的东西
  const steal = await req('POST', '/api/plaza/share', {
    shareId: pid, course: '劫持', major: 'x', subject: 'y', questions: QS
  }, ckB);
  ok(steal.status === 200 && steal.json.id !== pid, '别人的 shareId 不会覆盖原条目（变成自己的新分享）', steal.json);

  const admin = await req('GET', '/api/admin/overview', null, ckA);
  ok(admin.json.total && admin.json.total.plazaShares === 3, '站长看板能数到广场分享数', admin.json.total && admin.json.total.plazaShares);

  /* ================= B. 前端 ================= */
  console.log('\n[B] 前端');

  // B1 空广场 + 未登录点分享
  const jar0 = {};
  const b1 = bootApp({ jar: jar0 });
  await sleep(300);
  b1.click('.tab[data-view="plaza"]');
  await sleep(400);
  ok(b1.$('#view-plaza').hidden === false, '切到广场这一页能显示');
  ok(b1.$$('#plazaList .plaza-item').length === 3, '列出 3 份分享', b1.$$('#plazaList .plaza-item').length);
  ok(/药学/.test(b1.$('#plazaList').textContent), '卡片上带专业标签');
  ok(/甲同学/.test(b1.$('#plazaList').textContent), '卡片上带作者');
  ok(/人取用/.test(b1.$('#plazaList').textContent), '卡片上带取用数');

  // 先把广场清空，才能看到"广场还空着"
  const all = await req('GET', '/api/plaza/list');
  for (const it of all.json.items) {
    await req('POST', '/api/plaza/remove', { id: it.id }, ckA);
  }
  const emptyAgain = await req('GET', '/api/plaza/list');
  ok(emptyAgain.json.items.length === 0, '先把广场清空，方便验空状态', emptyAgain.json.items.length);

  const b2 = bootApp({ jar: {} });
  await sleep(250);
  b2.click('.tab[data-view="plaza"]');
  await sleep(300);
  ok(/广场还空着/.test(b2.$('#plazaList').textContent), '空广场给的是引导文案，不是一片白', b2.$('#plazaList').textContent.trim().slice(0, 40));

  // 未登录分享 → 弹登录框，分享框不出现
  b2.setVal('#noteText', '阿司匹林是解热镇痛药。');
  b2.click('#extractBtn');
  await sleep(200);
  b2.click('#saveBankBtn');
  await sleep(200);
  b2.click('.tab[data-view="plaza"]');
  await sleep(200);
  b2.click('#plazaShareBtn');
  await sleep(200);
  ok(b2.$('#shareModal').hidden === true, '未登录时分享框不会打开');
  ok(b2.$('#authModal').hidden === false, '而是把登录框弹出来');
  ok(/先登录/.test(b2.$('#authErr').textContent), '说清楚了为什么要登录', b2.$('#authErr').textContent);

  // B3 登录后分享
  const jar1 = {};
  const login = await req('POST', '/api/login', { username: '分享者甲', password: 'abc123456' });
  const ckLogin = cookieFrom(login);
  ckLogin.split('; ').forEach((pair) => { const i = pair.indexOf('='); jar1[pair.slice(0, i)] = pair.slice(i + 1); });
  const seedBanks = JSON.stringify([{
    id: 'b_seed', course: '临床药物治疗学', createdAt: Date.now(), questions: QS
  }]);
  const b3 = bootApp({ jar: jar1, seed: { fq_banks_v1: seedBanks, fq_current_v1: 'b_seed' } });
  await sleep(400);
  ok(b3.$('#bankList').textContent.indexOf('临床药物治疗学') >= 0, '本地有题集（测试用的种子数据）');

  b3.click('.tab[data-view="plaza"]');
  await sleep(300);
  b3.click('#plazaShareBtn');
  await sleep(300);
  ok(b3.$('#shareModal').hidden === false, '登录后分享框打开了');
  ok(b3.$('#shareSubject').value === '临床药物治疗学', '科目默认填题库名', b3.$('#shareSubject').value);
  ok(/3 题/.test(b3.$('#shareMeta').textContent), '底部显示题数', b3.$('#shareMeta').textContent);

  b3.click('#shareDoBtn');
  await sleep(150);
  ok(b3.$('#shareErr').hidden === false && /专业/.test(b3.$('#shareErr').textContent), '专业没填就点分享会拦住', b3.$('#shareErr').textContent);

  b3.setVal('#shareMajor', '药学');
  b3.setVal('#shareNote', '老师划的重点');
  b3.click('#shareDoBtn');
  await sleep(500);
  ok(b3.$('#shareModal').hidden === true, '分享成功后弹窗自己关掉');
  const after = await req('GET', '/api/plaza/list');
  ok(after.json.items.length === 1 && after.json.items[0].major === '药学', '服务端收到这条分享', after.json.items[0] && after.json.items[0].major);
  ok(b3.$$('#plazaList .plaza-item').length === 1, '列表立刻刷新出来');
  ok(/我分享的/.test(b3.$('#plazaList').textContent), '自己的那条带「我分享的」标记');

  // B4 取用（用一个新"设备"，模拟别人）
  const b4 = bootApp({ jar: {} });
  await sleep(250);
  b4.click('.tab[data-view="plaza"]');
  await sleep(400);
  ok(b4.$$('#plazaList .plaza-item').length === 1, '另一台设备也能看到');
  ok(/老师划的重点/.test(b4.$('#plazaList').textContent), '推荐语显示出来了');
  const before = JSON.parse(b4.store.getItem('fq_banks_v1') || '[]').length;
  b4.click('[data-take]');
  await sleep(500);
  const banks = JSON.parse(b4.store.getItem('fq_banks_v1') || '[]');
  ok(banks.length === before + 1, '取用后本地多了一份题集', [before, banks.length]);
  const got = banks[banks.length - 1];
  ok(/（广场）$/.test(got.course), '标题标出来源是广场', got.course);
  ok(got.questions.length === 3 && got.questions.every((q) => !!q.id), '题目带上了 id（前端重算的）', got.questions.length);
  ok(got.from && got.from.author === '甲同学', '记住了作者，方便以后查来源', got.from);
  ok(/已加入/.test(b4.$('#toast').textContent), '给了成功提示', b4.$('#toast').textContent);

  b4.click('[data-take]');
  await sleep(400);
  ok(JSON.parse(b4.store.getItem('fq_banks_v1') || '[]').length === before + 1, '同一份重复点不会叠副本');

  // B5 撤销分享
  b3.click('#plazaRefreshBtn');
  await sleep(400);
  b3.click('[data-unshare]');
  await sleep(500);
  const afterDel = await req('GET', '/api/plaza/list');
  ok(afterDel.json.items.length === 0, '撤下后广场空了');
  ok(/广场还空着|没有题集/.test(b3.$('#plazaList').textContent), '列表跟着回到空状态');

  child.kill('SIGTERM');
  await sleep(300);
  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试崩溃：', e);
  process.exit(1);
});
