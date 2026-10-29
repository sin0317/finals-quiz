'use strict';
/* 观猹（watcha.cn）OAuth2 登录接入测试
   运行： node test/watcha.test.js

   规矩：
     · 授权地址参数齐全：response_type / client_id / redirect_uri / scope / state / PKCE
     · PKCE 是真的在用：换 token 时带的 code_verifier 必须能对上授权时的 code_challenge
     · state 一次性：用过就废，挡住 CSRF 与重放
     · 同一个观猹 user_id 反复登录认回同一个账号，不重复建号
     · 观猹那边出错时不能崩，要给用户看得懂的话，且不发放会话
     · 没配 client_id 时入口要关掉，不能让人点了才报错

   做法：起一个桩服务器冒充观猹（/oauth/api/token、/oauth/api/userinfo），
        再起真的 server.js，把 WATCHA_OAUTH_BASE_URL 指到桩上。 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqwatcha-'));
const STUB_PORT = 5321 + Math.floor(Math.random() * 400);
const PORT = 4321 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;
const STUB = 'http://127.0.0.1:' + STUB_PORT;
const REDIRECT_URI = 'https://finals-quiz.test/';

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

function req(method, urlPath, body, cookie, base) {
  return new Promise(function (resolve, reject) {
    const u = new URL((base || BASE) + urlPath);
    const lib = require(u.protocol === 'https:' ? 'https' : 'http');
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const r = lib.request({
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

/* ---------------- 桩服务器：冒充观猹 ---------------- */

const stub = {
  challenge: '',      // 上一次授权请求里的 code_challenge
  verifier: '',       // 桩在换 token 时收到的 code_verifier
  tokenForm: null,
  user: { user_id: 88888, nickname: '观猹同学', avatar_url: 'https://example.test/a.png' },
  tokenStatus: 200,
  tokenBody: null,    // 非空则直接返回这个（模拟 invalid_grant）
  userinfoStatus: 200
};

function readForm(req2, cb) {
  let raw = '';
  req2.on('data', function (c) { raw += c; });
  req2.on('end', function () { cb(new URLSearchParams(raw)); });
}

const stubServer = http.createServer(function (req2, res) {
  const u = new URL(req2.url, 'http://local');
  if (u.pathname === '/oauth/api/token' && req2.method === 'POST') {
    return readForm(req2, function (form) {
      stub.tokenForm = {};
      form.forEach(function (v, k) { stub.tokenForm[k] = v; });
      stub.verifier = form.get('code_verifier') || '';
      if (stub.tokenBody) {
        res.writeHead(stub.tokenStatus, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(stub.tokenBody));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'at-' + Date.now(), token_type: 'Bearer',
        expires_in: 1800, refresh_token: 'rt-1', scope: 'read'
      }));
    });
  }
  if (u.pathname === '/oauth/api/userinfo') {
    if (stub.userinfoStatus !== 200) {
      res.writeHead(stub.userinfoStatus, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ statusCode: 400, code: 'ERROR', message: '无效的 access_token' }));
    }
    const auth = String(req2.headers.authorization || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 200, data: stub.user }));
    return;
  }
  res.writeHead(404); res.end('{}');
});

function sha256b64url(s) {
  return crypto.createHash('sha256').update(s).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------------- 起真正的服务 ---------------- */

function startServer(port, extraEnv) {
  const env = Object.assign({}, process.env, {
    PORT: String(port), FQ_DATA_DIR: DATA
  }, extraEnv || {});
  ['WATCHA_OAUTH_CLIENT_ID', 'WATCHA_OAUTH_CLIENT_SECRET', 'WATCHA_OAUTH_REDIRECT_URI',
    'WATCHA_OAUTH_SCOPE', 'WATCHA_OAUTH_BASE_URL'].forEach(function (k) {
      if (extraEnv && Object.prototype.hasOwnProperty.call(extraEnv, k)) return;
      delete env[k];
    });
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: env, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', function (c) { log += c.toString(); });
  child.stderr.on('data', function (c) { log += c.toString(); });
  return new Promise(function (resolve) {
    let tries = 0;
    (function wait() {
      tries++;
      req('GET', '/api/ping', null, null, 'http://127.0.0.1:' + port).then(function () {
        resolve({ child: child, log: function () { return log; } });
      }).catch(function () {
        if (tries > 60) return resolve({ child: child, log: function () { return log; } });
        setTimeout(wait, 100);
      });
    })();
  });
}

(async function main() {
  await new Promise(function (r) { stubServer.listen(STUB_PORT, '127.0.0.1', r); });

  const env = {
    WATCHA_OAUTH_CLIENT_ID: 'f1HwJMQn9cRClA4v',
    WATCHA_OAUTH_REDIRECT_URI: REDIRECT_URI,
    WATCHA_OAUTH_BASE_URL: STUB
  };
  const srv = await startServer(PORT, env);

  /* ============ 1 配置状态 ============ */
  console.log('\n[1] 配置状态');
  {
    const r = await req('GET', '/api/watcha/config');
    ok(r.status === 200 && r.json && r.json.ok === true, 'GET /api/watcha/config 返回正常');
    ok(r.json && r.json.enabled === true, '配好 client_id 后 enabled=true', r.json);
  }

  /* ============ 2 授权地址 ============ */
  console.log('\n[2] 授权地址参数');
  let state = '', authUrl = null;
  {
    const r = await req('GET', '/api/watcha/auth');
    ok(r.status === 200 && r.json && r.json.ok === true, 'GET /api/watcha/auth 返回正常', r.json);
    ok(!!r.json.url, '返回了授权地址');
    authUrl = new URL(r.json.url);
    state = r.json.state;
    ok(authUrl.origin + authUrl.pathname === STUB + '/oauth/authorize', '打的是观猹授权端', authUrl.href);
    ok(authUrl.searchParams.get('response_type') === 'code', 'response_type=code');
    ok(authUrl.searchParams.get('client_id') === 'f1HwJMQn9cRClA4v', 'client_id 是配置里那个', authUrl.searchParams.get('client_id'));
    ok(authUrl.searchParams.get('redirect_uri') === REDIRECT_URI, 'redirect_uri 与配置一致', authUrl.searchParams.get('redirect_uri'));
    ok(authUrl.searchParams.get('scope') === 'read', 'scope=read（不要邮箱手机号）', authUrl.searchParams.get('scope'));
    ok(!!authUrl.searchParams.get('state'), '带 state');
    ok(authUrl.searchParams.get('code_challenge_method') === 'S256', 'code_challenge_method=S256');
    ok(!!authUrl.searchParams.get('code_challenge'), '带 code_challenge');
    stub.challenge = authUrl.searchParams.get('code_challenge');
  }

  /* ============ 3 state 拦截 ============ */
  console.log('\n[3] state 拦截（CSRF / 重放）');
  {
    const r = await req('POST', '/api/watcha/exchange', { code: 'X', state: 'not-a-real-state' });
    ok(r.status === 400, '假的 state 被拒（400）', r.status);
    ok(r.json && r.json.ok === false && /过期/.test(r.json.error || ''), '提示是登录状态过期', r.json);
    const r2 = await req('POST', '/api/watcha/exchange', { code: 'X' });
    ok(r2.status === 400, '缺 state 也被拒（400）', r2.status);
  }

  /* ============ 4 完整链路 ============ */
  console.log('\n[4] 授权码换号');
  let userId = null, cookie = null;
  {
    const r = await req('POST', '/api/watcha/exchange', { code: 'AUTH_CODE_1', state: state });
    ok(r.status === 200 && r.json && r.json.ok === true, '换号成功', r.json);
    ok(!!r.json.user && r.json.user.provider === 'watcha', '用户 provider 是 watcha', r.json.user);
    ok(r.json.user && r.json.user.name === '观猹同学', '昵称带回来了', r.json.user);
    ok(r.json.user && r.json.user.avatar === 'https://example.test/a.png', '头像带回来了', r.json.user);
    ok(r.json.user && r.json.user.username === '观猹同学', '账号名取了昵称', r.json.user);
    userId = r.json.user && r.json.user.id;
    cookie = cookieFrom(r);
    ok(!!cookie, '发了会话 cookie');

    ok(stub.tokenForm && stub.tokenForm.grant_type === 'authorization_code', 'grant_type 对');
    ok(stub.tokenForm && stub.tokenForm.code === 'AUTH_CODE_1', 'code 原样送过去');
    ok(stub.tokenForm && stub.tokenForm.redirect_uri === REDIRECT_URI, 'redirect_uri 与授权时一致');
    ok(stub.tokenForm && stub.tokenForm.client_id === 'f1HwJMQn9cRClA4v', 'token 请求带 client_id');
    ok(!!stub.verifier, 'token 请求带了 code_verifier（PKCE）');
    ok(stub.verifier && sha256b64url(stub.verifier) === stub.challenge,
      'code_verifier 对得上授权时的 code_challenge', { v: stub.verifier, c: stub.challenge });
    ok(stub.tokenForm && !stub.tokenForm.client_secret, '公开客户端不送 client_secret');
  }

  /* ============ 5 会话与账号复用 ============ */
  console.log('\n[5] 会话与账号复用');
  {
    const me = await req('GET', '/api/me', null, cookie);
    ok(me.status === 200 && me.json && me.json.user && me.json.user.id === userId, '带着 cookie 能取回同一个账号', me.json);
    ok(me.json.user.provider === 'watcha', 'provider 还是 watcha');

    const a2 = await req('GET', '/api/watcha/auth');
    const r2 = await req('POST', '/api/watcha/exchange', { code: 'AUTH_CODE_2', state: a2.json.state });
    ok(r2.status === 200 && r2.json.user.id === userId, '同一个观猹账号再登录，认回同一个号（不重复建号）', r2.json.user);
    ok(r2.json.isNew === false, 'isNew=false', r2.json.isNew);
  }

  /* ============ 6 state 不能重放 ============ */
  console.log('\n[6] state 用过就废');
  {
    const a = await req('GET', '/api/watcha/auth');
    const st = a.json.state;
    const first = await req('POST', '/api/watcha/exchange', { code: 'C', state: st });
    ok(first.status === 200, '第一次能用');
    const again = await req('POST', '/api/watcha/exchange', { code: 'C', state: st });
    ok(again.status === 400, '同一个 state 不能用第二次', again.status);
  }

  /* ============ 7 观猹那边出错 ============ */
  console.log('\n[7] 观猹侧出错');
  {
    stub.tokenBody = { error: 'invalid_grant', error_description: 'Token 生成失败: invalid authorize code' };
    const a = await req('GET', '/api/watcha/auth');
    const r = await req('POST', '/api/watcha/exchange', { code: 'BAD', state: a.json.state });
    ok(r.status === 502, '换 token 失败返回 502', r.status);
    ok(r.json && /无效或已过期/.test(r.json.error || ''), '给的是人话，不是原始报文', r.json);
    ok(!cookieFrom(r), '失败不发会话 cookie');
    stub.tokenBody = null;

    stub.userinfoStatus = 400;
    const a2 = await req('GET', '/api/watcha/auth');
    const r2 = await req('POST', '/api/watcha/exchange', { code: 'C2', state: a2.json.state });
    ok(r2.status === 502, '取用户信息失败也返回 502', r2.status);
    stub.userinfoStatus = 200;
  }

  /* ============ 8 密码登录别把观猹账号搞崩 ============ */
  console.log('\n[8] 观猹账号走密码登录');
  {
    const me = await req('GET', '/api/me', null, cookie);
    const uname = me.json.user.username;
    const r = await req('POST', '/api/login', { username: uname, password: 'whatever' });
    ok(r.status === 400, '提示不是密码问题（400）', r.status);
    ok(r.json && /观猹/.test(r.json.error || ''), '提示里点明是观猹登录的账号', r.json);
  }

  /* ============ 9 没配置时入口要关 ============ */
  console.log('\n[9] 没配置 client_id');
  {
    const PORT2 = PORT + 50;
    const srv2 = await startServer(PORT2, {});
    const c = await req('GET', '/api/watcha/config', null, null, 'http://127.0.0.1:' + PORT2);
    ok(c.json && c.json.enabled === false, 'enabled=false', c.json);
    const a = await req('GET', '/api/watcha/auth', null, null, 'http://127.0.0.1:' + PORT2);
    ok(a.status === 503, '发起登录直接 503', a.status);
    const ex = await req('POST', '/api/watcha/exchange', { code: 'x', state: 'y' }, null, 'http://127.0.0.1:' + PORT2);
    ok(ex.status === 503, '换号也 503', ex.status);
    srv2.child.kill();
  }

  srv.child.kill();
  stubServer.close();
  console.log('\n结果： ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试崩了：', e);
  process.exit(1);
});
