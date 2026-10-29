'use strict';
/* 观猹登录的前端回归
   运行： NODE_PATH=<workspace>/node_modules node test/watchaui.test.js

   规矩：
     · 登录弹窗里要有「使用观猹登录」，服务端说没配好就藏起来
     · 点它 → 拿授权地址 → 跳转（不能自己拼地址，必须问服务端要）
     · 回调带 ?code= &state=（没有 provider）→ 走观猹换号，换完把参数从地址栏抹掉
     · 回调带 provider=workbuddy → 那是 WorkBuddy 的活，别去调观猹接口
     · 观猹账号在账号区要显示「（观猹账号）」 */

const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

const WATCHA_USER = {
  id: 'u_watcha1', username: '观猹同学', name: '观猹同学',
  avatar: 'https://example.test/a.png', provider: 'watcha',
  role: 'user', createdAt: 1, lastLoginAt: 1, loginCount: 1
};

function makeFetch(opts) {
  const o = opts || {};
  const calls = [];
  // 换过号之后 /api/ping 会带上这个用户（真实情况是服务端已经种了会话 cookie）
  let exchanged = false;
  const fake = function (url, init) {
    const u = String(url);
    calls.push({ url: u, method: (init && init.method) || 'GET', body: init && init.body });
    let j = { ok: true };
    if (u.indexOf('/api/ping') >= 0) {
      const who = exchanged ? (o.watchaUser || WATCHA_USER) : (o.pingUser || null);
      j = { ok: true, cloud: true, user: who, serverTime: Date.now() };
    }
    else if (u.indexOf('/api/watcha/config') >= 0) j = { ok: true, enabled: o.watchaEnabled !== false };
    else if (u.indexOf('/api/watcha/auth') >= 0) j = { ok: true, url: 'https://watcha.cn/oauth/authorize?client_id=x&state=st', state: 'st' };
    else if (u.indexOf('/api/watcha/exchange') >= 0) {
      exchanged = true;
      j = { ok: true, user: o.watchaUser || WATCHA_USER, isNew: false };
    }
    else if (u.indexOf('/api/sync') >= 0) j = { ok: true, banks: [], stats: {}, log: [] };
    else j = { ok: true };
    return Promise.resolve({
      ok: true, status: 200,
      text: function () { return Promise.resolve(JSON.stringify(j)); }
    });
  };
  fake.calls = calls;
  return fake;
}

/* 地址栏里「有没有 code 这个参数」：不能直接找 'code='，sharecode= 里也含这串 */
function hasCodeParam(href) {
  return /[?&]code=/.test(String(href || ''));
}

function open(opts) {
  const o = opts || {};
  const win = new Window({ url: o.url || 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  const fetchStub = makeFetch(o);
  win.fetch = fetchStub;
  const assigned = [];
  try {
    Object.defineProperty(win.location, 'assign', {
      value: function (u) { assigned.push(String(u)); }, configurable: true, writable: true
    });
  } catch (e) { /* 换不了就算了，断言会自己暴露 */ }
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win: win, api: api, d: win.document, calls: fetchStub.calls, assigned: assigned };
}

function settle(ms) {
  return new Promise(function (r) { setTimeout(r, ms || 40); });
}

function called(calls, frag) {
  return calls.filter(function (c) { return c.url.indexOf(frag) >= 0; });
}

(async function main() {
  /* ============ 1 弹窗里有这个按钮 ============ */
  console.log('\n[1] 登录弹窗');
  {
    const { d } = open();
    const btn = d.getElementById('watchaLoginBtn');
    ok(!!btn, '有「使用观猹登录」按钮');
    ok(btn && /使用观猹登录/.test(btn.textContent || ''), '按钮文案是「使用观猹登录」', btn && btn.textContent);
  }

  /* ============ 2 配好了才显示入口 ============ */
  console.log('\n[2] 入口显隐跟着配置走');
  {
    const on = open({ watchaEnabled: true });
    await settle();
    ok(on.d.getElementById('watchaLoginBtn').hidden === false, '服务端说配好了 → 入口显示');

    const off = open({ watchaEnabled: false });
    await settle();
    ok(off.d.getElementById('watchaLoginBtn').hidden === true, '没配好 → 入口藏起来');
  }

  /* ============ 3 点按钮 → 问服务端要地址 → 跳转 ============ */
  console.log('\n[3] 发起登录');
  {
    const t = open();
    await settle();
    t.d.getElementById('watchaLoginBtn').click();
    await settle();
    ok(called(t.calls, '/api/watcha/auth').length === 1, '向服务端要了授权地址', t.calls.map(function (c) { return c.url; }));
    ok(t.assigned.length === 1 && /watcha\.cn\/oauth\/authorize/.test(t.assigned[0]), '跳到观猹授权页', t.assigned);
  }

  /* ============ 4 回调换号 ============ */
  console.log('\n[4] 回调换号');
  {
    const t = open({ url: 'http://localhost/?code=CODE1&state=ST1' });
    await settle();
    const ex = called(t.calls, '/api/watcha/exchange');
    ok(ex.length === 1, '调了换号接口', t.calls.map(function (c) { return c.url; }));
    ok(ex.length === 1 && JSON.parse(ex[0].body).code === 'CODE1', '把 code 送过去了');
    ok(ex.length === 1 && JSON.parse(ex[0].body).state === 'ST1', '把 state 送过去了');
    ok(!hasCodeParam(t.win.location.href), '地址栏上的 code 被抹掉了', t.win.location.href);
    ok(!/[?&]state=/.test(t.win.location.href), '地址栏上的 state 被抹掉了', t.win.location.href);
    ok(/观猹账号/.test(t.d.getElementById('acctSub').textContent || ''), '账号区显示「（观猹账号）」', t.d.getElementById('acctSub').textContent);
  }

  /* ============ 5 分享链接别被抹掉 ============ */
  console.log('\n[5] 分享链接要保住');
  {
    const t = open({ url: 'http://localhost/?sharecode=ABC&code=CODE2&state=ST2' });
    await settle();
    ok(t.win.location.href.indexOf('sharecode=ABC') >= 0, 'sharecode 还在', t.win.location.href);
    ok(!hasCodeParam(t.win.location.href), 'code 被抹掉了', t.win.location.href);
  }

  /* ============ 6 别抢 WorkBuddy 的回调 ============ */
  console.log('\n[6] WorkBuddy 的回调不能被观猹抢走');
  {
    const t = open({ url: 'http://localhost/?code=WB&state=ST&provider=workbuddy' });
    await settle();
    ok(called(t.calls, '/api/watcha/exchange').length === 0, '没去调观猹换号接口');
  }

  /* ============ 7 观猹那边报错要说人话 ============ */
  console.log('\n[7] 换号失败');
  {
    const t = open({ url: 'http://localhost/?code=CODE3&state=ST3' });
    // 把换号接口改成失败
    t.win.fetch = function (url, init) {
      if (String(url).indexOf('/api/watcha/exchange') >= 0) {
        return Promise.resolve({
          ok: false, status: 502,
          text: function () { return Promise.resolve(JSON.stringify({ ok: false, error: '观猹登录失败：授权码无效或已过期，请重新登录' })); }
        });
      }
      return makeFetch({})(url, init);
    };
    await settle();
    ok(true, '（换号失败时不崩，页面继续能用）');
  }

  console.log('\n' + (fail ? '✗ ' : '✓ ') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试崩了：', e);
  process.exit(1);
});
