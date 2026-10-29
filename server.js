#!/usr/bin/env node
'use strict';

/* =========================================================================
   期末刷题站 · 极简后端（零第三方依赖，只用 Node 内置模块）
   -------------------------------------------------------------------------
   · 静态托管：把本目录的 index.html / styles.css / app.js 发出去
   · 游客统计：不登录也能用，服务端只记一个匿名 id 与访问时间
   · 账号体系：昵称 + 密码，scrypt 加盐哈希，httpOnly Cookie 会话
   · 题集同步：登录后把自己的题集、练习记录存到云端，换设备继续刷
   · 站长视角：第一个注册的账号自动成为站长，可看站点使用情况
   存储：./data/*.json，进程内缓存 + 防抖原子写盘
   ========================================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createPayService } = require('./pay');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = process.env.FQ_DATA_DIR
  ? path.resolve(process.env.FQ_DATA_DIR)
  : path.join(ROOT, 'data');

const SESSION_DAYS = 30;
const MAX_BODY = 8 * 1024 * 1024; // 题集可能不小，给到 8MB
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();

/* 版本号：从 package.json 读，页脚显示的是同一个数，测试会校验两处一致 */
const PKG_VERSION = (function () {
  try {
    return String(require(path.join(ROOT, 'package.json')).version || '0.0.0');
  } catch (e) {
    return '0.0.0';
  }
})();

/* ========================= 存储层 ========================= */

const store = {
  users: {},      // uid -> { id, username, name, salt, hash, role, createdAt, lastLoginAt, loginCount }
  sessions: {},   // token -> { uid, exp }
  cloud: {},      // uid -> { banks, stats, log, updatedAt }
  guests: {},     // gid -> { gid, firstSeen, lastSeen, visits, ua }
  daily: {},      // 'YYYY-MM-DD' -> { g: 游客访问次数, u: 登录用户访问次数 }
  plaza: {},      // pid -> { id, uid, author, course, major, subject, note, questions, createdAt, downloads }
  bonus: {}       // uid -> { from, fromName, at, expiresAt } 分享带来的冲刺报告体验权
};

/* 分享体验权有效期：拿到的是「限时免费」，不是买断 */
const BONUS_DAYS = 7;

/* 当前用户有效的分享体验权；没有或已过期就顺手清掉，返回 null */
function activeBonus(uid) {
  const b = uid && store.bonus[uid];
  if (!b || !b.expiresAt) return null;
  if (b.expiresAt < Date.now()) {
    delete store.bonus[uid];
    markDirty('users');
    return null;
  }
  return b;
}

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  cloud: path.join(DATA_DIR, 'cloud.json'),
  stats: path.join(DATA_DIR, 'stats.json'),
  plaza: path.join(DATA_DIR, 'plaza.json')
};

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* 只读环境就算了 */ }

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) { return fallback; }
}

function loadAll() {
  const u = readJson(FILES.users, {});
  store.users = (u.users && typeof u.users === 'object') ? u.users : {};
  store.sessions = (u.sessions && typeof u.sessions === 'object') ? u.sessions : {};
  store.bonus = (u.bonus && typeof u.bonus === 'object') ? u.bonus : {};
  store.cloud = readJson(FILES.cloud, {}) || {};
  const s = readJson(FILES.stats, {});
  store.guests = (s.guests && typeof s.guests === 'object') ? s.guests : {};
  store.daily = (s.daily && typeof s.daily === 'object') ? s.daily : {};
  store.plaza = readJson(FILES.plaza, {}) || {};

  const now = Date.now();
  Object.keys(store.sessions).forEach(function (t) {
    if (!store.sessions[t] || store.sessions[t].exp < now) delete store.sessions[t];
  });
}
loadAll();

/* 爱猹收：查权益与扣额度。配置缺失时 enabled=false，前端据此隐藏付费入口 */
const pay = createPayService(DATA_DIR);

// 防抖写盘：同一次 flush 内多个文件串行写，避免并发 rename 冲突
const dirty = { users: false, cloud: false, stats: false, plaza: false };
let flushTimer = null;
let flushing = false;

function markDirty(key) {
  dirty[key] = true;
  if (flushTimer) return;
  flushTimer = setTimeout(flushAll, 800);
  if (flushTimer.unref) flushTimer.unref();
}

async function writeAtomic(file, obj) {
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(obj), 'utf8');
  await fs.promises.rename(tmp, file);
}

async function flushAll() {
  if (flushing) { flushTimer = setTimeout(flushAll, 300); return; }
  flushTimer = null;
  flushing = true;
  const jobs = [];
  try {
    if (dirty.users) { dirty.users = false; jobs.push(writeAtomic(FILES.users, { users: store.users, sessions: store.sessions, bonus: store.bonus })); }
    if (dirty.cloud) { dirty.cloud = false; jobs.push(writeAtomic(FILES.cloud, store.cloud)); }
    if (dirty.stats) { dirty.stats = false; jobs.push(writeAtomic(FILES.stats, { guests: store.guests, daily: store.daily })); }
    if (dirty.plaza) { dirty.plaza = false; jobs.push(writeAtomic(FILES.plaza, store.plaza)); }
    await Promise.all(jobs);
  } catch (e) {
    console.error('[期末刷题] 写盘失败：', e && e.message);
  } finally {
    flushing = false;
    if (dirty.users || dirty.cloud || dirty.stats || dirty.plaza) flushTimer = setTimeout(flushAll, 300);
  }
}

/* 一次性清理：开发期做接口冒烟测试时留下的假账号（无云端身份、固定用户名）。
   不清理的话它会永久占着「第一个注册者 = 站长」的位置，让真正的站点主人当不成站长。 */
(function purgeSmokeTestAccounts() {
  const bad = [];
  Object.keys(store.users).forEach(function (k) {
    const u = store.users[k];
    if (u && !u.cloudId && /^smoke[-_]?tester$/i.test(String(u.username || '').trim())) bad.push(k);
  });
  if (!bad.length) return;
  bad.forEach(function (k) { delete store.users[k]; delete store.cloud[k]; });
  Object.keys(store.sessions).forEach(function (t) {
    if (!store.sessions[t] || !store.users[store.sessions[t].uid]) delete store.sessions[t];
  });
  markDirty('users');
  markDirty('cloud');
  console.log('[期末刷题] 已清理 ' + bad.length + ' 个冒烟测试账号');
})();

/* ========================= 工具 ========================= */

function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store'
  });
  res.end(buf);
}
const ok = function (res, extra) { json(res, 200, Object.assign({ ok: true }, extra || {})); };
const fail = function (res, code, msg, extra) { json(res, code, Object.assign({ ok: false, error: msg }, extra || {})); };

function today(d) {
  const t = d ? new Date(d) : new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(9).toString('hex');
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(function (part) {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, remember) {
  const maxAge = (remember ? SESSION_DAYS : 7) * 86400;
  res.setHeader('Set-Cookie',
    'fq_sid=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'fq_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function parseJsonBody(buf) {
  if (!buf || !buf.length) return {};
  const v = JSON.parse(buf.toString('utf8'));
  return v && typeof v === 'object' ? v : {};
}

/* ---- 密码：scrypt + 每用户随机盐 ---- */
function hashPassword(pw, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}
function verifyPassword(pw, user) {
  const a = Buffer.from(hashPassword(pw, user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const NAME_RE = /^[A-Za-z0-9_\-.·一-龥]{2,20}$/;
function checkUsername(u) { return typeof u === 'string' && NAME_RE.test(u.trim()); }

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name || u.username,
    avatar: u.avatar || '',
    provider: u.provider || 'password',
    role: u.role || 'user',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || u.createdAt,
    loginCount: u.loginCount || 0
  };
}

function userFromReq(req) {
  const c = parseCookies(req);
  const sid = c.fq_sid;
  if (!sid) return null;
  const s = store.sessions[sid];
  if (!s) return null;
  if (s.exp < Date.now()) { delete store.sessions[sid]; markDirty('users'); return null; }
  return store.users[s.uid] || null;
}

/* ---- 登录爆破的简单节流 ---- */
const attempts = new Map();
function throttle(key, limit, windowMs) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.t > windowMs) { attempts.set(key, { t: now, n: 1 }); return true; }
  if (rec.n >= limit) return false;
  rec.n++;
  return true;
}
setInterval(function () {
  const now = Date.now();
  attempts.forEach(function (v, k) { if (now - v.t > 15 * 60 * 1000) attempts.delete(k); });
}, 5 * 60 * 1000).unref();

/* ---- 记录一次访问 ---- */
function noteVisit(kind) {
  const d = today();
  if (!store.daily[d]) store.daily[d] = { g: 0, u: 0 };
  store.daily[d][kind === 'u' ? 'u' : 'g']++;
  // 只保留最近 120 天
  const keys = Object.keys(store.daily).sort();
  while (keys.length > 120) delete store.daily[keys.shift()];
  markDirty('stats');
}

/* ========================= 静态文件 ========================= */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

// 已经下线的目录：线上沙箱是「解压覆盖」式更新，本地删掉的文件在服务器上会留下来，
// 所以这里显式挡住，避免旧内容被人翻出来访问
const RETIRED_DIRS = ['kb'];

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 安全：禁止越界，禁止访问后端与数据目录
  const abs = path.normalize(path.join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return fail(res, 403, '禁止访问');
  const relToRoot = path.relative(ROOT, abs);
  const topDir = relToRoot.split(path.sep)[0];
  if (topDir === 'data') return fail(res, 403, '禁止访问');
  if (RETIRED_DIRS.indexOf(topDir) >= 0) return fail(res, 404, '该功能已下线');
  if (['server.js', 'package.json', 'package-lock.json'].indexOf(relToRoot) >= 0) return fail(res, 403, '禁止访问');

  fs.stat(abs, function (err, st) {
    if (err || !st.isFile()) return fail(res, 404, '找不到 ' + rel);
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    // 页面、样式、脚本一律不许缓存：以前发版后用户刷新还是旧 JS，
    // 看到的还是修好之前的 bug，排查了半天才发现是浏览器缓存
    const noStore = ['.html', '.htm', '.js', '.css'].indexOf(ext) >= 0;
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': noStore ? 'no-store, must-revalidate' : 'no-cache',
      'Last-Modified': st.mtime.toUTCString()
    });
    fs.createReadStream(abs).pipe(res);
  });
}

/* ========================= 广场（题集分享） ========================= */

// 路由是按 "方法 + 路径" 精确匹配的，所以广场接口用 query 传 id，不改成 REST 风格路径
function queryOf(req) {
  try { return new URL(req.url || '/', 'http://local').searchParams; }
  catch (e) { return new URLSearchParams(); }
}

// 标签 / 标题这类短文本：压掉换行和连续空格，再按字数截断
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .slice(0, max);
}

const PLAZA_MAX_Q = 400;

/* 只收题目本身需要的字段：id 丢掉（前端会按 stem+answer 重新算，避免和别人的统计撞），
   作者那边的 source（原文句子）保留 —— 刷题时点「看原文」还用得上。 */
function cleanQuestions(list) {
  const out = [];
  for (let i = 0; i < list.length && out.length < PLAZA_MAX_Q; i++) {
    const q = list[i];
    if (!q || typeof q !== 'object') continue;
    const stem = cleanText(q.stem, 300);
    if (!stem) continue;
    let answer;
    if (Array.isArray(q.answer)) {
      answer = q.answer.map(function (a) { return cleanText(a, 200); })
        .filter(function (a) { return a; }).slice(0, 10);
      if (!answer.length) continue;
    } else {
      answer = cleanText(q.answer, 200);
      if (!answer) continue;
    }
    const opts = Array.isArray(q.opts)
      ? q.opts.map(function (o) { return cleanText(o, 120); }).filter(function (o) { return o; }).slice(0, 10)
      : [];
    out.push({
      type: q.type === 'multi' ? 'multi' : (q.type === 'fill' ? 'fill' : 'single'),
      stem: stem,
      answer: answer,
      opts: opts,
      source: cleanText(q.source, 300)
    });
  }
  return out;
}

// 列表里不带题目正文，只有一屏能显示的元信息，省流量
function briefPlaza(it, u) {
  return {
    id: it.id,
    course: it.course,
    major: it.major,
    subject: it.subject,
    note: it.note || '',
    author: it.author || '同学',
    qCount: (it.questions || []).length,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt || it.createdAt,
    downloads: it.downloads || 0,
    mine: !!(u && it.uid === u.id)
  };
}

function tagRank(map) {
  return Object.keys(map).sort(function (a, b) { return map[b] - map[a] || a.localeCompare(b, 'zh'); });
}

/* ========================= 接口 ========================= */

const routes = {
  /* 当前版本：页脚显示同一个号，用来一眼确认线上是哪一版 */
  'GET /api/version': function (req, res) {
    ok(res, { name: 'finals-quiz', version: PKG_VERSION });
  },

  /* 探测后端是否可用 + 当前身份 */
  'GET /api/ping': function (req, res) {
    const u = userFromReq(req);
    ok(res, { cloud: true, user: publicUser(u), serverTime: Date.now() });
  },

  /* 记一次访问（游客匿名 / 登录用户） */
  'POST /api/visit': async function (req, res) {
    let body = {};
    try { body = parseJsonBody(await readBody(req)); } catch (e) { /* 忽略 */ }
    const u = userFromReq(req);
    const gid = String(body.gid || '').slice(0, 64);
    const ua = String(req.headers['user-agent'] || '').slice(0, 200);
    const now = Date.now();

    if (u) {
      u.lastSeenAt = now;
      noteVisit('u');
      markDirty('users');
    } else if (gid) {
      const g = store.guests[gid] || { gid: gid, firstSeen: now, visits: 0 };
      g.lastSeen = now;
      g.ua = ua;
      g.visits = (g.visits || 0) + 1;
      store.guests[gid] = g;
      noteVisit('g');
      markDirty('stats');
      pruneGuests();
    }
    ok(res, { user: publicUser(u) });
  },

  'POST /api/register': async function (req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString();
    if (!throttle('reg:' + ip, 20, 10 * 60 * 1000)) return fail(res, 429, '操作太频繁了，歇一会儿再试');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const name = String(body.name || '').trim().slice(0, 20) || username;

    if (!checkUsername(username)) return fail(res, 400, '昵称需要 2–20 位，可用中英文、数字、下划线、连字符');
    if (password.length < 6 || password.length > 64) return fail(res, 400, '密码需要 6–64 位');

    const key = username.toLowerCase();
    const dup = Object.keys(store.users).some(function (k) { return store.users[k].username.toLowerCase() === key; });
    if (dup) return fail(res, 409, '这个昵称已经被占用了');

    const isFirst = Object.keys(store.users).length === 0;
    const id = uid('u');
    const salt = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    const user = {
      id: id,
      username: username,
      name: name,
      salt: salt,
      hash: hashPassword(password, salt),
      role: (isFirst || (ADMIN_USERNAME && key === ADMIN_USERNAME)) ? 'admin' : 'user',
      createdAt: now,
      lastLoginAt: now,
      lastSeenAt: now,
      loginCount: 1
    };
    store.users[id] = user;

    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = { uid: id, exp: now + SESSION_DAYS * 86400 * 1000 };
    markDirty('users');
    setSessionCookie(res, token, true);
    ok(res, { user: publicUser(user) });
  },

  'POST /api/login': async function (req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString();
    if (!throttle('login:' + ip, 12, 5 * 60 * 1000)) return fail(res, 429, '试太多次了，5 分钟后再来');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const key = username.toLowerCase();
    let found = null;
    Object.keys(store.users).forEach(function (k) {
      if (store.users[k].username.toLowerCase() === key) found = store.users[k];
    });
    if (!found) return fail(res, 401, '昵称或密码不对');
    if (!found.hash || !found.salt) return fail(res, 400, '这个账号是用 WorkBuddy 登录的，请点「使用 WorkBuddy 登录」');
    if (!verifyPassword(password, found)) return fail(res, 401, '昵称或密码不对');

    const now = Date.now();
    found.lastLoginAt = now;
    found.lastSeenAt = now;
    found.loginCount = (found.loginCount || 0) + 1;

    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = { uid: found.id, exp: now + SESSION_DAYS * 86400 * 1000 };
    markDirty('users');
    setSessionCookie(res, token, true);
    ok(res, { user: publicUser(found) });
  },

  /* WorkBuddy 账号登录：前端用云服务 OAuth 拿到身份后，来这里换本站会话。
     以 WorkBuddy 的用户 id（cloudId）作为稳定主键，同一个人换设备登录能自动认回同一个账号。 */
  'POST /api/cloud-login': async function (req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString();
    if (!throttle('clogin:' + ip, 40, 10 * 60 * 1000)) return fail(res, 429, '操作太频繁了，歇一会儿再试');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const cloudId = String(body.cloudId || '').trim();
    const name = String(body.name || '').trim().slice(0, 20);
    const avatar = String(body.avatar || '').slice(0, 500);
    if (!/^[A-Za-z0-9_:.\-]{6,128}$/.test(cloudId)) return fail(res, 400, '登录信息不完整，请重新登录');

    const now = Date.now();
    let user = null;
    Object.keys(store.users).forEach(function (k) {
      if (store.users[k].cloudId === cloudId) user = store.users[k];
    });

    const isNew = !user;
    if (user) {
      user.lastLoginAt = now;
      user.lastSeenAt = now;
      user.loginCount = (user.loginCount || 0) + 1;
      if (name) user.name = name;
      if (avatar) user.avatar = avatar;
    } else {
      const id = uid('u');
      // 昵称撞车就加序号，免得站长看板上分不清谁是谁
      const base = name || ('同学' + id.slice(-4));
      let nick = base;
      let n = 1;
      while (n <= 99 && Object.keys(store.users).some(function (k) { return store.users[k].username === nick; })) {
        n += 1;
        nick = base + n;
      }
      if (n > 99) nick = base + '_' + id.slice(-4);
      const hasAdmin = Object.keys(store.users).some(function (k) { return store.users[k].role === 'admin'; });
      user = {
        id: id,
        username: nick,
        name: name || nick,
        avatar: avatar,
        cloudId: cloudId,
        provider: 'workbuddy',
        role: hasAdmin ? 'user' : 'admin',
        createdAt: now,
        lastLoginAt: now,
        lastSeenAt: now,
        loginCount: 1
      };
      store.users[id] = user;
    }

    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = { uid: user.id, exp: now + SESSION_DAYS * 86400 * 1000 };
    markDirty('users');
    setSessionCookie(res, token, true);
    ok(res, { user: publicUser(user), isNew: isNew });
  },

  'POST /api/logout': function (req, res) {
    const c = parseCookies(req);
    if (c.fq_sid && store.sessions[c.fq_sid]) { delete store.sessions[c.fq_sid]; markDirty('users'); }
    clearSessionCookie(res);
    ok(res);
  },

  'GET /api/me': function (req, res) {
    const u = userFromReq(req);
    ok(res, { user: publicUser(u) });
  },

  'POST /api/profile': async function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) return fail(res, 400, '昵称不能为空');
    u.name = name;
    markDirty('users');
    ok(res, { user: publicUser(u) });
  },

  /* 拉取云端题集 */
  'GET /api/sync': function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');
    const c = store.cloud[u.id] || { banks: [], stats: {}, log: [], updatedAt: 0 };
    ok(res, {
      banks: c.banks || [],
      stats: c.stats || {},
      log: c.log || [],
      updatedAt: c.updatedAt || 0
    });
  },

  /* 上传题集（整体覆盖，冲突合并在前端做） */
  'PUT /api/sync': async function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }
    if (!Array.isArray(body.banks)) return fail(res, 400, 'banks 必须是数组');

    const now = Date.now();
    store.cloud[u.id] = {
      banks: body.banks,
      stats: (body.stats && typeof body.stats === 'object') ? body.stats : {},
      log: Array.isArray(body.log) ? body.log : [],
      updatedAt: now
    };
    markDirty('cloud');
    ok(res, { updatedAt: now });
  },

  /* ---------------- 广场：浏览 / 取用 / 分享 / 取消分享 ---------------- */

  'GET /api/plaza/list': function (req, res) {
    const u = userFromReq(req);
    const sp = queryOf(req);
    const kw = String(sp.get('q') || '').toLowerCase().trim();
    const major = String(sp.get('major') || '').trim();
    const subject = String(sp.get('subject') || '').trim();
    const sort = sp.get('sort') === 'hot' ? 'hot' : 'new';
    const onlyMine = sp.get('mine') === '1';

    const all = Object.keys(store.plaza).map(function (k) { return store.plaza[k]; });
    // 标签候选按使用次数排，越常用越靠前（前端做成下拉 + 输入建议）
    const majors = {}, subjects = {};
    all.forEach(function (it) {
      if (it.major) majors[it.major] = (majors[it.major] || 0) + 1;
      if (it.subject) subjects[it.subject] = (subjects[it.subject] || 0) + 1;
    });

    let items = all;
    if (onlyMine) items = items.filter(function (it) { return u && it.uid === u.id; });
    if (major) items = items.filter(function (it) { return it.major === major; });
    if (subject) items = items.filter(function (it) { return it.subject === subject; });
    if (kw) {
      items = items.filter(function (it) {
        return (it.course + ' ' + it.major + ' ' + it.subject + ' ' + (it.note || '') + ' ' + (it.author || ''))
          .toLowerCase().indexOf(kw) >= 0;
      });
    }
    items.sort(function (a, b) {
      if (sort === 'hot') return (b.downloads || 0) - (a.downloads || 0) || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });

    ok(res, {
      items: items.map(function (it) { return briefPlaza(it, u); }),
      majors: tagRank(majors),
      subjects: tagRank(subjects),
      total: all.length,
      loggedIn: !!u
    });
  },

  'GET /api/plaza/get': function (req, res) {
    const u = userFromReq(req);
    const id = String(queryOf(req).get('id') || '');
    const it = store.plaza[id];
    if (!it) return fail(res, 404, '这个题集已经不在广场上了');
    const brief = briefPlaza(it, u);
    brief.questions = it.questions || [];
    ok(res, brief);
  },

  'POST /api/plaza/share': async function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '分享题集需要先登录');
    if (!throttle('share:' + u.id, 20, 10 * 60 * 1000)) return fail(res, 429, '分享得有点频繁，歇一会儿再试');

    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const course = cleanText(body.course, 40);
    const major = cleanText(body.major, 12);
    const subject = cleanText(body.subject, 24);
    const note = cleanText(body.note, 60);
    if (!course) return fail(res, 400, '题集还没有名字');
    if (!major) return fail(res, 400, '填一下专业，方便同学筛选');
    if (!subject) return fail(res, 400, '填一下科目，方便同学筛选');
    if (!Array.isArray(body.questions) || !body.questions.length) return fail(res, 400, '这个题集里还没有题');
    if (body.questions.length > PLAZA_MAX_Q) return fail(res, 400, '一次最多分享 ' + PLAZA_MAX_Q + ' 道题');

    const questions = cleanQuestions(body.questions);
    if (!questions.length) return fail(res, 400, '题目内容不完整，没法分享');

    const now = Date.now();
    const sid = cleanText(body.shareId, 40);
    let it = (sid && store.plaza[sid] && store.plaza[sid].uid === u.id) ? store.plaza[sid] : null;
    const isUpdate = !!it;

    if (!it) {
      it = { id: uid('p'), uid: u.id, createdAt: now, downloads: 0 };
      store.plaza[it.id] = it;
    }
    it.author = u.name || u.username;
    it.course = course;
    it.major = major;
    it.subject = subject;
    it.note = note;
    it.questions = questions;
    it.updatedAt = now;
    markDirty('plaza');

    ok(res, { id: it.id, updated: isUpdate, qCount: questions.length });
  },

  /* 取用：别人点「加入我的题集」时调，顺手把取用数 +1 */
  'POST /api/plaza/take': async function (req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString();
    if (!throttle('take:' + ip, 120, 10 * 60 * 1000)) return fail(res, 429, '取用太频繁了，歇一会儿再试');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const it = store.plaza[String(body.id || '')];
    if (!it) return fail(res, 404, '这个题集已经不在广场上了');
    it.downloads = (it.downloads || 0) + 1;
    markDirty('plaza');

    /* 分享裂变：取用别人分享的题集 → 送一份冲刺报告限时体验权。
       自己取自己的不算；同一个人只送一次；游客没有稳定账号，先不给。 */
    let bonus = null;
    const u = userFromReq(req);
    if (u && it.uid && it.uid !== u.id) {
      const have = activeBonus(u.id);
      if (!have) {
        const now = Date.now();
        store.bonus[u.id] = {
          from: it.uid,
          fromName: it.author || '同学',
          at: now,
          expiresAt: now + BONUS_DAYS * 86400 * 1000
        };
        markDirty('users');
        bonus = {
          active: true,
          days: BONUS_DAYS,
          expiresAt: store.bonus[u.id].expiresAt,
          fromName: store.bonus[u.id].fromName
        };
      } else {
        bonus = {
          active: true,
          days: BONUS_DAYS,
          expiresAt: have.expiresAt,
          fromName: have.fromName
        };
      }
    }

    ok(res, {
      course: it.course,
      major: it.major,
      subject: it.subject,
      author: it.author || '同学',
      plazaId: it.id,
      questions: it.questions || [],
      bonus: bonus,
      needLoginForBonus: !!(!u && it.uid)
    });
  },

  'POST /api/plaza/remove': async function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');
    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const it = store.plaza[String(body.id || '')];
    if (!it) return fail(res, 404, '这个题集已经不在广场上了');
    if (it.uid !== u.id && u.role !== 'admin') return fail(res, 403, '只能取消自己分享的题集');
    delete store.plaza[it.id];
    markDirty('plaza');
    ok(res, { removed: it.id });
  },

  /* ---------------- 冲刺报告：权益查询 / 额度扣减 ---------------- */

  /* 前端启动时问一句：付费开关开没开、一次扣几点、我登录了没 */
  'GET /api/pay/status': function (req, res) {
    const u = userFromReq(req);
    ok(res, {
      enabled: pay.enabled,
      environment: pay.environment,
      cost: pay.reportCost,
      price: pay.price ? ('¥' + pay.price) : '',
      priceLabel: pay.priceLabel || '',
      loggedIn: !!u
    });
  },

  /* 查权益。买断权益和「分享体验权」都算数，但来源要分清：
     source=paid 是真金白银买的（永久），source=bonus 是分享裂变送的（限时）。 */
  'POST /api/pay/access': async function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');
    const r = await pay.access(u.id);
    const b = activeBonus(u.id);

    if (r.ok && r.access === 'granted') {
      return ok(res, {
        access: 'granted',
        source: 'paid',
        entitlement: r.entitlement,
        purchase: r.purchase || null,
        reason: r.reason || null
      });
    }

    /* 平台那边还没买，但本地有分享体验权 → 照样能看报告 */
    if (b) {
      return ok(res, {
        access: 'granted',
        source: 'bonus',
        entitlement: { type: 'bonus' },
        purchase: r.ok ? (r.purchase || null) : null,
        reason: r.reason || null,
        bonus: {
          active: true,
          days: BONUS_DAYS,
          expiresAt: b.expiresAt,
          fromName: b.fromName || '同学'
        }
      });
    }

    if (!r.ok) {
      return fail(res, 503, '暂时查不到权益，稍后再试', { code: r.code, detail: r.detail || null });
    }
    ok(res, {
      access: r.access,
      source: 'none',
      entitlement: r.entitlement,
      purchase: r.purchase,
      reason: r.reason
    });
  },

  /* 只看分享体验权状态：前端用来在页面上写明「免费体验还剩几天」 */
  'GET /api/pay/bonus': function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');
    const b = activeBonus(u.id);
    if (!b) return ok(res, { active: false });
    ok(res, {
      active: true,
      days: BONUS_DAYS,
      expiresAt: b.expiresAt,
      fromName: b.fromName || '同学'
    });
  },

  /* 扣一次冲刺点。同一批报告重试必须复用同一个 idempotency_key */
  'POST /api/pay/consume': async function (req, res) {
    const u = userFromReq(req);
    if (!u) return fail(res, 401, '请先登录');

    let body;
    try { body = parseJsonBody(await readBody(req)); } catch (e) { return fail(res, 400, '请求格式不对'); }

    const clientKey = String(body.idempotency_key || '').trim();
    if (!/^[A-Za-z0-9_\-.]{8,80}$/.test(clientKey)) return fail(res, 400, '缺少有效的幂等键');

    /* 服务端强制加上用户前缀：不同用户的同名批次不会互相干扰 */
    const r = await pay.consume(u.id, pay.reportCost, u.id + ':' + clientKey);
    if (r.ok) return ok(res, { consumed: r.consumed, remaining: r.remaining });

    if (r.code === 'insufficient_quota') return fail(res, 409, '冲刺点不够了', { code: r.code });
    if (r.code === 'idempotency_conflict') return fail(res, 409, '这次扣减还在处理中，稍等一下再试', { code: r.code });
    return fail(res, 503, '扣减没成功，稍后再试', { code: r.code, detail: r.detail || null });
  },

  /* 站长看板 */
  'GET /api/admin/overview': function (req, res) {
    const me = userFromReq(req);
    if (!me) return fail(res, 401, '请先登录');
    if (me.role !== 'admin') return fail(res, 403, '只有站长能看这个');

    const users = Object.keys(store.users).map(function (k) {
      const u = store.users[k];
      const c = store.cloud[u.id] || {};
      const banks = Array.isArray(c.banks) ? c.banks : [];
      const stats = c.stats || {};
      let qCount = 0;
      banks.forEach(function (b) { qCount += (b && Array.isArray(b.questions) ? b.questions.length : 0); });
      let ok2 = 0, bad = 0, mastered = 0;
      Object.keys(stats).forEach(function (qid) {
        const s = stats[qid] || {};
        ok2 += s.ok || 0; bad += s.bad || 0;
        if (s.mastered) mastered++;
      });
      return {
        id: u.id,
        name: u.name || u.username,
        username: u.username,
        role: u.role || 'user',
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || u.createdAt,
        lastSeenAt: u.lastSeenAt || u.lastLoginAt || u.createdAt,
        loginCount: u.loginCount || 0,
        bankCount: banks.length,
        questionCount: qCount,
        answerCount: ok2 + bad,
        accuracy: (ok2 + bad) ? Math.round(ok2 / (ok2 + bad) * 100) : null,
        mastered: mastered,
        syncedAt: c.updatedAt || 0
      };
    }).sort(function (a, b) { return (b.lastSeenAt || 0) - (a.lastSeenAt || 0); });

    const guests = Object.keys(store.guests).map(function (k) { return store.guests[k]; });
    const now = Date.now();
    const day = 86400 * 1000;
    const activeGuest = guests.filter(function (g) { return now - (g.lastSeen || 0) < day; }).length;
    const activeUser = users.filter(function (u) { return now - (u.lastSeenAt || 0) < day; }).length;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = today(now - i * day);
      const v = store.daily[d] || { g: 0, u: 0 };
      days.push({ d: d, guests: v.g || 0, users: v.u || 0 });
    }

    ok(res, {
      total: {
        users: users.length,
        guests: guests.length,
        activeGuest: activeGuest,
        activeUser: activeUser,
        questions: users.reduce(function (s, u) { return s + u.questionCount; }, 0),
        answers: users.reduce(function (s, u) { return s + u.answerCount; }, 0),
        plazaShares: Object.keys(store.plaza).length,
        plazaTakes: Object.keys(store.plaza).reduce(function (s, k) { return s + (store.plaza[k].downloads || 0); }, 0)
      },
      users: users,
      daily: days
    });
  }
};

function pruneGuests() {
  const keys = Object.keys(store.guests);
  if (keys.length <= 3000) return;
  keys.sort(function (a, b) { return (store.guests[a].lastSeen || 0) - (store.guests[b].lastSeen || 0); });
  const drop = keys.length - 3000;
  for (let i = 0; i < drop; i++) delete store.guests[keys[i]];
}

/* ========================= 服务器 ========================= */

const server = http.createServer(async function (req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Allow': 'GET,POST,PUT' });
    return res.end();
  }

  let urlPath = req.url || '/';
  if (!urlPath.startsWith('/api/')) return serveStatic(req, res, urlPath);

  const key = req.method + ' ' + urlPath.split('?')[0];
  const fn = routes[key];
  if (!fn) return fail(res, 404, '接口不存在：' + key);

  try {
    await fn(req, res);
  } catch (e) {
    if (e && e.message === '请求体过大') return fail(res, 413, '内容太大了（上限 8MB）');
    console.error('[期末刷题] ' + key + ' 出错：', e);
    if (!res.headersSent) fail(res, 500, '服务器内部错误');
  }
});

server.on('error', function (e) {
  console.error('[期末刷题] 服务启动失败：', e && e.message);
  process.exit(1);
});

server.listen(PORT, HOST, function () {
  console.log('[期末刷题] 已启动： http://localhost:' + PORT);
  console.log('[期末刷题] 数据目录： ' + DATA_DIR);
  console.log('[期末刷题] 当前账号数：' + Object.keys(store.users).length + '，游客数：' + Object.keys(store.guests).length);
});

function shutdown() {
  console.log('\n[期末刷题] 正在保存数据…');
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  dirty.users = dirty.cloud = dirty.stats = dirty.plaza = true;
  Promise.resolve(flushAll()).then(function () {
    server.close(function () { process.exit(0); });
    setTimeout(function () { process.exit(0); }, 2000).unref();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
