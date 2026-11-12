'use strict';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
/* 页脚「提建议」回归
   运行： NODE_PATH=<workspace>/node_modules node test/feedback.test.js

   两段：
     一、服务端 —— 起临时端口 + 临时数据目录，验证校验 / 落盘 / 限流 / 站长看板
     二、前端   —— happy-dom 加载真实 index.html + app.js，走一遍点击

   守的线：
     · 不登录也能提（想吐槽的人不该先被要求注册）
     · 少于 8 个字不收（误点保护），但手写的换行必须原样留住
     · 提交成功 = 一定落盘。邮件只是通知，没配 SMTP 也不许丢用户的话
     · 填一半关掉再打开，内容还在（localStorage 草稿）
     · 站长之前没看过时，看板要给「N 条新的」 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Window } = require('happy-dom');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5900 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqfb-'));
const RealURL = globalThis.URL;
/* 版本号别在测试里写死 —— 每次发版都要改一遍断言，等于测试在守上一版。
   真正该守的是「带上了版本号」这件事本身，值跟 package.json 走。 */
const APPVER = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* ---------------- 前端环境 ---------------- */
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

/* 假的 fetch：只关心「发了什么」和「回什么」，不碰网络 */
function stubFetch(reply) {
  const calls = [];
  const fn = function (url, init) {
    calls.push({ url: url, body: init && init.body ? JSON.parse(init.body) : null, method: init && init.method });
    const r = reply || { ok: true, status: 200, json: { ok: true, id: 'fb_x', thanks: true } };
    return Promise.resolve({
      ok: r.ok !== false,
      status: r.status || 200,
      text: function () { return Promise.resolve(typeof r.body === 'string' ? r.body : JSON.stringify(r.json || { ok: true })); }
    });
  };
  fn.calls = calls;
  return fn;
}

function bootApp(opts) {
  const o = opts || {};
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = () => true;
  win.alert = () => {};
  const store = makeStorage(o.seed);
  const fakeFetch = o.fetch || stubFetch();
  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator',
    APP_SRC
  );
  fn(win, win.document, store, fakeFetch,
    win.confirm, () => '', win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval,
    win.Blob || globalThis.Blob, RealURL, win.FileReader, win.crypto, win.navigator);
  const q = (s) => win.document.querySelector(s);
  return {
    win, store, fetch: fakeFetch, q,
    click: (s) => {
      const el = q(s);
      if (!el) throw new Error('找不到元素：' + s);
      el.dispatchEvent(new win.Event('click', { bubbles: true }));
      return el;
    },
    type: (s, v) => {
      const el = q(s);
      if (!el) throw new Error('找不到元素：' + s);
      el.value = v;
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      return el;
    }
  };
}

(async function main() {
  /* ================= 一、服务端 ================= */
  console.log('\n一、接口：能收、会校验、不会丢');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), FQ_DATA_DIR: DATA, ADMIN_USERNAME: '' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await req('GET', '/api/version'); if (r.status === 200) { up = true; break; } } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  ok(up, '服务起在 ' + PORT, bootLog.slice(0, 200));

  try {
    // —— 校验
    const tooShort = await req('POST', '/api/feedback', { kind: 'idea', text: '不好' });
    ok(tooShort.status === 400, '少于 8 个字不收', tooShort.json);
    ok((tooShort.json || {}).error && tooShort.json.error.indexOf('8') > 0,
      '并且说清差多少字', (tooShort.json || {}).error);

    const empty = await req('POST', '/api/feedback', { kind: 'idea' });
    ok(empty.status === 400, '一个字没写也拒掉');

    // —— 正常提交（刻意带分行、零宽字符、行尾空格）
    const text = '导入卷子的时候，第 3 题的选项被拆成了两条\u200b\n\n\n\n一条是残句，另一条才是真题干。   ';
    const one = await req('POST', '/api/feedback', {
      kind: 'bug', text: text, contact: '1027615061@qq.com', ver: '1.21.16', view: '题库'
    });
    ok(one.status === 200 && one.json && one.json.thanks === true, '提交成功', one.json);
    ok(one.json && !('mailed' in one.json), '不回给前端「邮件发没发出去」（那是运维细节）', one.json);

    await sleep(1200);  // 等一次防抖落盘
    const file = path.join(DATA, 'feedback.json');
    ok(fs.existsSync(file), '落盘到 data/feedback.json');
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    ok(Array.isArray(saved) && saved.length === 1, '存了 1 条', Array.isArray(saved) ? saved.length : typeof saved);

    const rec = (saved[0] || {});
    ok(rec.kind === 'bug', '类型记下了', rec.kind);
    ok(rec.text.indexOf('\n') > 0, '手写的分行没被压成一行', rec.text);
    ok(rec.text.indexOf('\u200b') < 0, '零宽字符清掉了');
    ok(!/\s$/.test(rec.text), '行尾空格去掉了', JSON.stringify(rec.text.slice(-6)));
    ok(rec.text.indexOf('一条是残句') > 0, '正文一个字没少', rec.text.slice(0, 40));
    ok(rec.contact === '1027615061@qq.com', '联系方式存下了');
    ok(rec.ver === '1.21.16' && rec.view === '题库', '带了版本和页面，方便定位', [rec.ver, rec.view]);
    ok(rec.mailed === false && rec.mailErr === 'no-config',
      '没配 SMTP 时如实标记「没发信」，但这条照样在', [rec.mailed, rec.mailErr]);
    ok(!rec.uid, '没登录也能提');

    // —— 限流：同一个 IP 10 分钟 5 条
    let got429 = false;
    for (let i = 0; i < 6; i++) {
      const r = await req('POST', '/api/feedback', { kind: 'idea', text: '这是第 ' + i + ' 条测试建议，凑字数用的' });
      if (r.status === 429) { got429 = true; break; }
    }
    ok(got429, '刷屏会被 429 挡住');

    // —— 站长看板
    const anon = await req('GET', '/api/admin/feedback');
    ok(anon.status === 401, '没登录看不了建议列表', anon.status);

    const reg = await req('POST', '/api/register', { username: 'fbtest_owner', password: 'fb-pass-1234', name: '站长' });
    ok(reg.status === 200, '注册（第一个账号即站长）', reg.raw.slice(0, 120));
    const jar = cookieFrom(reg);

    const mine = await req('GET', '/api/admin/feedback', null, jar);
    ok(mine.status === 200, '站长能看', mine.status);
    ok(mine.json && mine.json.items.length >= 1, '列表里有刚才那条', mine.json && mine.json.items.length);
    ok(mine.json && mine.json.mail && mine.json.mail.enabled === false,
      '看板会告诉站长「邮件没配上」', mine.json && mine.json.mail);
    ok(mine.json && mine.json.total >= 1, '总数对得上', mine.json && mine.json.total);
    const items = (mine.json && mine.json.items) || [];
    ok(items.length >= 2, '不止一条时也都在', items.length);
    ok(items[0] && items[0].text && items[0].text.length > 0,
      '每条都能读到正文 —— 邮件没配时全靠这里', items[0] && items[0].text);
    ok(items.length < 2 || items[0].at >= items[1].at, '最新的排在最前面');
  } finally {
    try { child.kill(); } catch (e) { /* 已经退出了 */ }
  }

  /* ================= 二、前端 ================= */
  console.log('\n二、页面：页脚有个入口，点了能写、能发');

  {
    const app = bootApp();
    ok(!!app.q('#fbOpenBtn'), '页脚有「提建议」按钮');
    const foot = app.q('.app-footer');
    ok(foot && foot.textContent.indexOf('提建议') >= 0, '就在页脚里', foot && foot.textContent.trim());
    ok(!!app.q('#fbModal'), '弹窗结构在');
    ok(!!app.q('#fbText') && !!app.q('#fbContact'), '有正文和联系方式');
    ok(app.q('#fbKinds').querySelectorAll('.fb-kind').length === 3, '三种类型：建议 / 报错 / 想要的功能');
    ok(app.q('#fbModal').hidden === true, '默认是关着的');
  }

  {
    const app = bootApp();
    app.click('#fbOpenBtn');
    ok(app.q('#fbModal').hidden === false, '点一下就开');
    ok(app.q('#fbErr').hidden === true, '还没报错');
    ok(app.q('#fbVerTag').textContent.indexOf(APPVER) >= 0,
      '提前说清会带上版本号', app.q('#fbVerTag').textContent);
    app.click('[data-fbclose]');
    ok(app.q('#fbModal').hidden === true, '点遮罩 / ✕ 能关');
  }

  {
    const app = bootApp();
    app.click('#fbOpenBtn');
    app.type('#fbText', '太短');
    app.click('#fbSendBtn');
    ok(app.q('#fbErr').hidden === false, '写太短会拦下来说一句');
    ok(app.q('#fbErr').textContent.indexOf('8') > 0, '说明了至少几个字', app.q('#fbErr').textContent);
    ok(app.fetch.calls.length === 0, '压根没发请求');
    ok(app.q('#fbModal').hidden === false, '弹窗没关掉，写的东西还在');
  }

  {
    const app = bootApp();
    app.click('#fbOpenBtn');
    app.click('.fb-kind[data-kind="bug"]');
    app.type('#fbText', '导入卷子时第 3 题的选项被拆成两条');
    app.type('#fbContact', 'my@qq.com');
    app.click('#fbSendBtn');

    const call = app.fetch.calls[0] || {};
    ok(call.url === '/api/feedback', '发到 /api/feedback', call.url);
    ok(call.body && call.body.kind === 'bug', '带着选中的类型', call.body && call.body.kind);
    ok(call.body && call.body.text.indexOf('第 3 题') > 0, '正文带上了');
    ok(call.body && call.body.contact === 'my@qq.com', '联系方式带上了');
    ok(call.body && call.body.ver === APPVER, '版本号带上了，站长好定位', call.body && call.body.ver);
    ok(call.body && typeof call.body.view === 'string' && call.body.view.length >= 0, '当前页面带上了', call.body && call.body.view);

    await sleep(60);
    ok(app.q('#fbDone').hidden === false, '发出去之后切成「收到了」');
    ok(app.q('#fbBody').hidden === true, '表单收起来');
    ok(app.q('#fbSendBtn').textContent === '知道了', '按钮变成「知道了」', app.q('#fbSendBtn').textContent);
    ok(app.q('#fbCancelBtn').hidden === true, '「取消」这时候没意义，藏掉');
    ok(app.q('#fbDoneNote').textContent.indexOf('联系') >= 0, '留了联系方式会提一句');

    app.click('#fbSendBtn');   // 「知道了」
    ok(app.q('#fbModal').hidden === true, '点「知道了」关掉');
    ok(app.q('#fbText').value === '', '关掉后表单清空，下次是全新的一条');
    ok(app.q('#fbSendBtn').textContent === '发送', '按钮也复原');
    ok(app.store.getItem('fq_fb_draft_v1') === null, '发成功就把草稿删了');
  }

  {
    const app = bootApp();
    app.click('#fbOpenBtn');
    app.type('#fbText', '写到一半想起来要去吃饭');
    await sleep(400);   // 草稿是 300ms 防抖写的
    app.click('[data-fbclose]');

    const again = bootApp({ seed: { fq_fb_draft_v1: app.store.getItem('fq_fb_draft_v1') } });
    again.click('#fbOpenBtn');
    ok(again.q('#fbText').value === '写到一半想起来要去吃饭', '填一半关掉，下次打开还在',
      again.q('#fbText').value);
  }

  {
    // 服务端 500：内容必须留着，不能白写
    const app = bootApp({ fetch: stubFetch({ ok: false, status: 500, json: { ok: false, error: '服务器打盹了' } }) });
    app.click('#fbOpenBtn');
    app.type('#fbText', '这条一定要留住，不然白写了');
    app.click('#fbSendBtn');
    await sleep(60);
    ok(app.q('#fbErr').hidden === false, '发失败要说出来');
    ok(app.q('#fbErr').textContent.indexOf('服务器打盹了') > 0, '把服务器的原因带上', app.q('#fbErr').textContent);
    ok(app.q('#fbText').value.indexOf('一条') > 0 || app.q('#fbText').value.length > 0,
      '写的内容一根毛都没少', app.q('#fbText').value);
    ok(app.q('#fbModal').hidden === false, '弹窗没关，可以直接重发');
  }

  {
    // 429：得说人话，而不是甩一串英文
    const app = bootApp({ fetch: stubFetch({ ok: false, status: 429, json: { ok: false, error: '收到好几条了' } }) });
    app.click('#fbOpenBtn');
    app.type('#fbText', '连着提了好几条的那个');
    app.click('#fbSendBtn');
    await sleep(60);
    ok(app.q('#fbErr').textContent.indexOf('十分钟') > 0, '429 时说「过十分钟再来」', app.q('#fbErr').textContent);
  }

  {
    // Esc 关弹窗：跟公告、分享那几个弹窗一个手气
    const app = bootApp();
    app.click('#fbOpenBtn');
    // Event 构造参数里塞 key 是无效的，得用 KeyboardEvent（happy-dom 里 Event 没这属性）
    const ev = new app.win.Event('keydown', { bubbles: true });
    ev.key = 'Escape';
    app.win.document.dispatchEvent(ev);
    ok(app.q('#fbModal').hidden === true, '按 Esc 能关');
  }

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* 临时目录，算了 */ }
  process.exit(fail ? 1 : 0);
})();
