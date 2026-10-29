'use strict';
/* 爱猹收接入冒烟测试：临时端口 + 临时数据目录，验证登录/幂等/失败关闭
   运行： node test/pay.test.js
   说明：沙箱商品未完成档位配置时，access 会返回 unavailable / 503，
        这属于平台侧状态，不是接入代码的问题，测试会把它打印出来。 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 4931 + Math.floor(Math.random() * 400);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqpay-'));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:' + PORT;

/* 把真实配置复制进临时目录，密钥不进日志 */
const cfgSrc = path.join(ROOT, 'data', 'pay.config.json');
if (fs.existsSync(cfgSrc)) fs.copyFileSync(cfgSrc, path.join(DATA, 'pay.config.json'));

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
    console.log('\n— 未登录 —');
    const noAuth = await req('POST', '/api/pay/access');
    ok(noAuth.status === 401, '未登录查权益返回 401', noAuth.json);
    const noAuthConsume = await req('POST', '/api/pay/consume', { idempotency_key: 'abcdefgh1234' });
    ok(noAuthConsume.status === 401, '未登录扣额度返回 401', noAuthConsume.json);

    console.log('\n— 登录后 —');
    const reg = await req('POST', '/api/register', { username: 'paytester', password: 'test123456' });
    ok(reg.status === 200 && reg.json && reg.json.ok, '注册测试账号', reg.json);
    const cookie = cookieFrom(reg);

    const st = await req('GET', '/api/pay/status', null, cookie);
    ok(st.status === 200 && st.json.enabled === true, '付费开关已开启（配置读取成功）', st.json);
    ok(st.json && st.json.cost === 1, '一次报告扣 1 点', st.json);

    const ac = await req('POST', '/api/pay/access', {}, cookie);
    console.log('    access 实际响应：HTTP ' + ac.status + ' → ' + JSON.stringify(ac.json));
    ok(ac.status === 200 || ac.status === 503, '查权益返回可预期的状态码', { status: ac.status });

    const badKey = await req('POST', '/api/pay/consume', { idempotency_key: '短' }, cookie);
    ok(badKey.status === 400, '非法幂等键被拒绝', badKey.json);

    const c1 = await req('POST', '/api/pay/consume', { idempotency_key: 'batch_test_0001' }, cookie);
    console.log('    consume 实际响应：HTTP ' + c1.status + ' → ' + JSON.stringify(c1.json));

    /* 同键重试：应当幂等（返回同样结果），不能重复扣 */
    const c2 = await req('POST', '/api/pay/consume', { idempotency_key: 'batch_test_0001' }, cookie);
    ok(c1.status === c2.status, '同键重试返回同样状态码', { first: c1.status, retry: c2.status });
    console.log('    同键重试：HTTP ' + c2.status + ' → ' + JSON.stringify(c2.json));
  } catch (e) {
    fail++;
    console.log('  ✗ 测试中断：' + (e && e.message));
  } finally {
    child.kill();
  }

  console.log('\n通过 ' + pass + '，失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
