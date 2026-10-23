'use strict';
/* 后端接口冒烟测试：起一个临时端口 + 临时数据目录，跑完整链路
   运行： node test/api.test.js                                        */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 4321 + Math.floor(Math.random() * 500);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fqdata-'));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}

function req(method, urlPath, body, cookie) {
  return new Promise(function (resolve, reject) {
    const u = new URL(BASE + urlPath);
    const http = require(u.protocol === 'https:' ? 'https' : 'http');
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

  // 等服务起来
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await req('GET', '/api/ping'); if (r.status === 200) { up = true; break; } }
    catch (e) { /* 还没起来 */ }
    await new Promise(function (r) { setTimeout(r, 100); });
  }

  console.log('\n== 后端接口测试（端口 ' + PORT + '）==\n');
  ok(up, '服务启动并响应 /api/ping', bootLog.slice(0, 300));
  if (!up) { child.kill(); process.exit(1); }

  // 1. 静态资源
  const home = await req('GET', '/');
  ok(home.status === 200 && home.raw.indexOf('期末刷题') >= 0, 'GET / 返回首页 HTML');

  // 版本号：页脚、接口、package.json 三处必须是同一个数
  const pkgVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const verApi = await req('GET', '/api/version');
  ok(verApi.status === 200, 'GET /api/version 正常', verApi.status);
  ok(verApi.json && verApi.json.version === pkgVer, '/api/version 与 package.json 一致', verApi.json && verApi.json.version);
  ok(home.raw.indexOf('v' + pkgVer) >= 0, '首页页脚显示的版本号与 package.json 一致', pkgVer);
  ok(/<footer class="app-footer"/.test(home.raw), '首页带有页脚元素');

  const css = await req('GET', '/styles.css');
  ok(css.status === 200 && css.headers['content-type'].indexOf('text/css') >= 0, 'GET /styles.css 正常');
  const secret = await req('GET', '/data/users.json');
  ok(secret.status === 403, 'GET /data/users.json 被拒绝（403）', secret.status);
  const srv = await req('GET', '/server.js');
  ok(srv.status === 403, 'GET /server.js 被拒绝（403）', srv.status);
  // 已下线的知识库导入：线上沙箱是解压覆盖更新，素材会在服务器上残留，所以必须服务端挡住。
  // 本地没有 kb/ 目录，这里临时造一个探针文件，才能真正区分「被拦截」和「本来就不存在」
  const probeDir = path.join(ROOT, 'kb');
  const probeFile = path.join(probeDir, '_probe.json');
  try {
    fs.mkdirSync(probeDir, { recursive: true });
    fs.writeFileSync(probeFile, '{"probe":1}');
    const kbj = await req('GET', '/kb/_probe.json');
    ok(kbj.status === 404, 'GET /kb/* 已下线（404）', kbj.status);
  } finally {
    try { fs.unlinkSync(probeFile); } catch (e) { /* 忽略 */ }
    try { fs.rmdirSync(probeDir); } catch (e) { /* 目录非空或已删，忽略 */ }
  }
  const kbn = await req('GET', '/kb/notes/x.json');
  ok(kbn.status === 404, 'GET /kb/notes/* 已下线（404）', kbn.status);

  // 2. 游客访问
  const v1 = await req('POST', '/api/visit', { gid: 'guest-aaa' });
  ok(v1.status === 200 && v1.json.ok && v1.json.user === null, '游客 visit 记录成功且身份为 null');
  await req('POST', '/api/visit', { gid: 'guest-aaa' });
  await req('POST', '/api/visit', { gid: 'guest-bbb' });

  // 3. 未登录不能同步
  const s0 = await req('GET', '/api/sync');
  ok(s0.status === 401, '未登录 GET /api/sync 返回 401', s0.status);

  // 4. 注册（第一个账号 = 站长）
  const r1 = await req('POST', '/api/register', { username: '站长小明', password: 'abc123456', name: '小明' });
  ok(r1.status === 200 && r1.json.user && r1.json.user.role === 'admin', '第一个注册的账号成为站长', r1.json);
  const ck1 = cookieFrom(r1);
  ok(!!ck1 && ck1.indexOf('fq_sid=') === 0, '登录后下发 fq_sid Cookie', ck1);
  ok((r1.headers['set-cookie'] || []).join('').indexOf('HttpOnly') >= 0, 'Session Cookie 带 HttpOnly');

  // 5. 重复昵称
  const r2 = await req('POST', '/api/register', { username: '站长小明', password: 'abc123456' });
  ok(r2.status === 409, '重复昵称注册返回 409', r2.status);

  // 6. 弱密码 / 非法昵称
  const r3 = await req('POST', '/api/register', { username: 'x', password: 'abc123456' });
  ok(r3.status === 400, '昵称过短返回 400', r3.status);
  const r4 = await req('POST', '/api/register', { username: '小红红', password: '123' });
  ok(r4.status === 400, '密码过短返回 400', r4.status);

  // 7. 第二个普通账号
  const r5 = await req('POST', '/api/register', { username: '同学小红', password: 'hong123456' });
  ok(r5.status === 200 && r5.json.user.role === 'user', '第二个账号是普通用户', r5.json.user);
  const ck2 = cookieFrom(r5);

  // 8. 登录：错误密码 / 正确密码
  const l1 = await req('POST', '/api/login', { username: '站长小明', password: 'wrong-pass' });
  ok(l1.status === 401, '密码错误返回 401', l1.status);
  const l2 = await req('POST', '/api/login', { username: '站长小明', password: 'abc123456' });
  ok(l2.status === 200 && l2.json.user.loginCount >= 2, '正确密码登录成功且登录次数累加', l2.json.user);
  const ck1b = cookieFrom(l2);

  // 9. me
  const me = await req('GET', '/api/me', null, ck1b);
  ok(me.status === 200 && me.json.user.name === '小明', 'GET /api/me 返回昵称', me.json);

  // 10. 同步读写
  const banks = [{
    id: 'b_1', course: '中国近代史', createdAt: Date.now(),
    questions: [
      { id: 'q_1', type: 'single', stem: '林则徐是____', answer: '开眼看世界的第一人', opts: ['A', 'B'], order: 0 },
      { id: 'q_2', type: 'fill', stem: '太平天国运动爆发的标志是____', answer: '1851年金田起义', order: 1 }
    ]
  }];
  const up1 = await req('PUT', '/api/sync', { banks: banks, stats: { q_1: { ok: 3, bad: 1, streak: 2, mastery: 0.7, mastered: false, lastAt: Date.now() } }, log: [{ d: '2026-10-22', n: 4 }] }, ck1b);
  ok(up1.status === 200 && up1.json.updatedAt > 0, 'PUT /api/sync 上传成功', up1.json);

  const dn1 = await req('GET', '/api/sync', null, ck1b);
  ok(dn1.status === 200 && dn1.json.banks.length === 1 && dn1.json.banks[0].questions.length === 2, 'GET /api/sync 取回 1 个题集 2 道题', dn1.json.banks.length);
  ok(dn1.json.stats.q_1.ok === 3, '练习记录一并取回', dn1.json.stats);

  // 11. 数据隔离：小红看不到小明的题集
  const dn2 = await req('GET', '/api/sync', null, ck2);
  ok(dn2.status === 200 && dn2.json.banks.length === 0, '不同账号的题集互相隔离', dn2.json.banks.length);

  // 12. 非法 payload
  const bad1 = await req('PUT', '/api/sync', { banks: 'not-an-array' }, ck1b);
  ok(bad1.status === 400, 'banks 非数组返回 400', bad1.status);

  // 13. 管理员看板
  const ad1 = await req('GET', '/api/admin/overview', null, ck1b);
  ok(ad1.status === 200 && ad1.json.total.users === 2, '站长看板返回 2 个注册用户', ad1.json.total);
  ok(ad1.json.total.guests === 2, '站长看板返回 2 位游客', ad1.json.total);
  ok(ad1.json.users.length === 2 && ad1.json.users.some(function (u) { return u.questionCount === 2; }), '看板能统计到题目数', ad1.json.users.map(function (u) { return u.questionCount; }));
  ok(Array.isArray(ad1.json.daily) && ad1.json.daily.length === 7, '看板返回最近 7 天活跃');

  const ad2 = await req('GET', '/api/admin/overview', null, ck2);
  ok(ad2.status === 403, '普通用户访问看板返回 403', ad2.status);
  const ad3 = await req('GET', '/api/admin/overview');
  ok(ad3.status === 401, '未登录访问看板返回 401', ad3.status);

  // 14. 密码不落明文（写盘有 800ms 防抖，等一下）
  await new Promise(function (r) { setTimeout(r, 1400); });
  const uf = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'), 'utf8'));
  const dumped = JSON.stringify(uf);
  ok(dumped.indexOf('abc123456') < 0, '磁盘上不存在明文密码');
  ok(dumped.indexOf('hong123456') < 0, '磁盘上不存在第二个用户的明文密码');

  // 15. 登出
  const lo = await req('POST', '/api/logout', {}, ck1b);
  ok(lo.status === 200, '登出成功');
  const after = await req('GET', '/api/me', null, ck1b);
  ok(after.json.user === null, '登出后会话失效', after.json);

  // 16. 伪造 session
  const forged = await req('GET', '/api/sync', null, 'fq_sid=deadbeef');
  ok(forged.status === 401, '伪造的 session 无效', forged.status);

  // 17. WorkBuddy 账号登录：云端 uid 换本站会话
  const c1 = await req('POST', '/api/cloud-login', { cloudId: 'wb_uid_alice_0001', name: '阿黎' });
  ok(c1.status === 200 && !!c1.json.user, '云端身份能换到本站会话', c1.json);
  ok(c1.json.user.provider === 'workbuddy', '账号标记为 workbuddy 来源', c1.json.user);
  ok(c1.json.user.role === 'user', '已有站长时，云端登录的新人不是站长', c1.json.user);
  ok(c1.json.isNew === true, '首次登录被标记为新账号', c1.json.isNew);
  const ckCloud = cookieFrom(c1);
  const uidA = c1.json.user.id;

  const c2 = await req('POST', '/api/cloud-login', { cloudId: 'wb_uid_alice_0001', name: '阿黎改名' });
  ok(c2.json.user.id === uidA, '同一个云端 uid 认回同一个账号（不重复建号）', { before: uidA, after: c2.json.user.id });
  ok(c2.json.isNew === false, '第二次登录不再是新账号', c2.json.isNew);
  ok(c2.json.user.loginCount >= 2, '登录次数累加', c2.json.user.loginCount);
  ok(c2.json.user.name === '阿黎改名', '昵称跟着云端身份更新', c2.json.user.name);

  const c3 = await req('POST', '/api/cloud-login', { cloudId: 'wb_uid_bob_0002', name: '阿黎' });
  ok(c3.json.user.id !== uidA, '不同云端 uid 是不同账号');
  ok(c3.json.user.username !== c2.json.user.username, '昵称撞车自动加序号', c3.json.user.username);

  const c4 = await req('POST', '/api/cloud-login', { cloudId: 'x' });
  ok(c4.status === 400, '云端 uid 太短被拒绝', c4.status);
  const c5 = await req('POST', '/api/cloud-login', { cloudId: 'bad uid with space' });
  ok(c5.status === 400, '云端 uid 含空格被拒绝', c5.status);

  // 云端账号没有密码，不能被密码登录绕过
  const c6 = await req('POST', '/api/login', { username: c2.json.user.username, password: 'whatever123' });
  ok(c6.status === 400, 'WorkBuddy 账号不能走密码登录', c6.status);
  ok(/WorkBuddy/.test(c6.json.error || ''), '并提示改用 WorkBuddy 登录', c6.json.error);

  // 云端账号的会话与题集同步
  const cs = await req('GET', '/api/me', null, ckCloud);
  ok(cs.json.user && cs.json.user.id === uidA, '云端登录能恢复会话', cs.json.user);
  const cpush = await req('PUT', '/api/sync', {
    banks: [{ id: 'b_c', course: '云端课', questions: [{ id: 'q_c1', type: 'fill', stem: '题干', answer: '答案' }] }],
    stats: {}, log: []
  }, ckCloud);
  ok(cpush.status === 200, '云端账号能上传题集', cpush.status);
  const cpull = await req('GET', '/api/sync', null, ckCloud);
  ok(cpull.json.banks && cpull.json.banks.length === 1, '云端账号能拉回自己的题集', cpull.json.banks && cpull.json.banks.length);

  child.kill('SIGTERM');
  await new Promise(function (r) { setTimeout(r, 300); });

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试崩溃：', e);
  process.exit(1);
});
