'use strict';
/* 分享裂变：取用别人的题集 → 送 7 天冲刺报告体验权
   运行： node test/bonus.test.js
   用沙箱配置，不会碰真实支付。 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 4523 + Math.floor(Math.random() * 300);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqbonus-'));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:' + PORT;

/* 只用沙箱配置：正式配置会生成真实可付款的链接，测试不该碰 */
const cfgSandbox = path.join(ROOT, 'data', 'pay.sandbox.config.json');
if (fs.existsSync(cfgSandbox)) fs.copyFileSync(cfgSandbox, path.join(DATA, 'pay.config.json'));

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

function req(method, urlPath, body, cookie) {
  return new Promise(function (resolve, reject) {
    const u = new URL(BASE + urlPath);
    const http = require('http');
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: method,
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

const QUESTIONS = [{
  type: 'single', stem: '药物的副作用是指', opts: ['A.治疗作用', 'B.非治疗作用'], answer: 'B', source: ''
}];

(async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), FQ_DATA_DIR: DATA }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  child.stdout.on('data', function (d) { bootLog += d.toString(); });
  child.stderr.on('data', function (d) { bootLog += d.toString(); });

  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await req('GET', '/api/ping'); if (r.status === 200) { up = true; break; } }
    catch (e) { /* 还没起来 */ }
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  if (!up) { console.log('服务没起来：\n' + bootLog); child.kill(); process.exit(1); }

  try {
    console.log('\n— 分享者 A —');
    const ra = await req('POST', '/api/register', { username: 'sharer_a', password: 'test123456' });
    ok(ra.status === 200, 'A 注册', ra.json);
    const ca = cookieFrom(ra);

    const sh = await req('POST', '/api/plaza/share', {
      course: '临床药物治疗学', major: '药学', subject: '临床药理学', note: '期末冲刺用',
      questions: QUESTIONS
    }, ca);
    ok(sh.status === 200 && sh.json && sh.json.id, 'A 分享题集到广场', sh.json);
    const plazaId = sh.json.id;

    console.log('\n— 取用者 B —');
    const rb = await req('POST', '/api/register', { username: 'taker_b', password: 'test123456' });
    const cb = cookieFrom(rb);
    ok(rb.status === 200, 'B 注册');

    const tk = await req('POST', '/api/plaza/take', { id: plazaId }, cb);
    ok(tk.status === 200, 'B 取用 A 的题集', tk.json);
    ok(tk.json.bonus && tk.json.bonus.active === true, 'B 拿到分享体验权', tk.json.bonus);
    ok(tk.json.bonus && tk.json.bonus.days === 7, '体验期 7 天', tk.json.bonus);
    ok(tk.json.bonus && !!tk.json.bonus.expiresAt, '体验权带过期时间');

    const bon = await req('GET', '/api/pay/bonus', null, cb);
    ok(bon.status === 200 && bon.json.active === true, 'B 的体验权状态可查', bon.json);

    const acc = await req('POST', '/api/pay/access', {}, cb);
    ok(acc.status === 200 && acc.json.access === 'granted', 'B 能进冲刺报告', acc.json);
    ok(acc.json.source === 'bonus', '来源标为分享体验权而不是买断', acc.json.source);

    console.log('\n— 自己去自己那份：不发放 —');
    const self = await req('POST', '/api/plaza/take', { id: plazaId }, ca);
    ok(self.status === 200, 'A 自己取用自己分享的', self.json);
    ok(!self.json.bonus || !self.json.bonus.active, '自己取自己不发体验权', self.json.bonus);

    console.log('\n— 不重复发放 —');
    const again = await req('POST', '/api/plaza/take', { id: plazaId }, cb);
    ok(again.json.bonus && again.json.bonus.expiresAt === tk.json.bonus.expiresAt,
      '重复取用不叠加、有效期不变', { first: tk.json.bonus.expiresAt, second: again.json.bonus.expiresAt });

    console.log('\n— 游客取用：提示登录，不发体验权 —');
    const guest = await req('POST', '/api/plaza/take', { id: plazaId });
    ok(guest.status === 200, '游客也能取用题集', guest.json);
    ok(!guest.json.bonus, '游客拿不到体验权（没有稳定账号）', guest.json.bonus);
    ok(guest.json.needLoginForBonus === true, '游客被提示登录后可领', guest.json);
  } catch (e) {
    fail++;
    console.log('  ✗ 测试中断：' + (e && e.message));
  } finally {
    child.kill();
  }

  console.log('\n通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
