'use strict';
/* =========================================================
   最小 SMTP 发信（零依赖）
   =========================================================
   为什么自己写：整个站点 package.json 的 dependencies 是空的，
   部署就是把这个目录原样打包，装不了 npm 包。node 自带的 tls/net
   足够跑完 SMTP 那一套会话，一百多行就能通。

   配置放 data/mail.config.json：
     { "host": "smtp.qq.com", "port": 465, "secure": true,
       "user": "1027615061@qq.com", "pass": "QQ邮箱的SMTP授权码",
       "to": "1027615061@qq.com" }
   · pass 不是 QQ 密码，是邮箱设置里生成的「授权码」，16 位
   · to 可以省略，默认发给自己（user）
   · 这个文件改完不用重启：每次发信前重新读，缓存 60 秒

   没有这个文件 / 字段不全，enabled() 就是 false —— 上层的做法是
   「建议照样存下来，只是不发信」，绝不能因为发不出邮件就把用户的
   反馈丢掉（也绝不能因此给用户报错）。
   ========================================================= */

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const net = require('net');

const TIMEOUT = 15000;
const CACHE_MS = 60 * 1000;

let cache = { at: 0, cfg: null };

function readConfig(file) {
  const now = Date.now();
  if (now - cache.at < CACHE_MS) return cache.cfg;
  let cfg = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const host = String(raw.host || '').trim();
    const user = String(raw.user || '').trim();
    const pass = String(raw.pass || '').trim();
    if (host && user && pass) {
      cfg = {
        host: host,
        port: Number(raw.port) || 465,
        secure: raw.secure !== false,
        user: user,
        pass: pass,
        to: String(raw.to || '').trim() || user,
        fromName: String(raw.fromName || '期末刷题站').trim()
      };
    }
  } catch (e) { cfg = null; }
  cache = { at: now, cfg: cfg };
  return cfg;
}

/* RFC 2047 编码：中文主题直接塞进 header 会被邮件客户端显示成乱码 */
function encHeader(s) {
  const t = String(s == null ? '' : s);
  // eslint-disable-next-line no-control-regex
  if (!/[\u0080-\uFFFF]/.test(t)) return t;
  return '=?UTF-8?B?' + Buffer.from(t, 'utf8').toString('base64') + '?=';
}

/* 按行读 SMTP 响应：250- 是续行，250   是最后一行 */
function makeReader(sock) {
  let buf = '';
  const waiters = [];
  function pump() {
    while (waiters.length) {
      let idx;
      let acc = '';
      let consumed = 0;
      let complete = false;
      while ((idx = buf.indexOf('\r\n', consumed)) >= 0) {
        const line = buf.slice(consumed, idx);
        consumed = idx + 2;
        acc += line + '\n';
        if (line.length < 4 || line[3] !== '-') { complete = true; break; }
      }
      if (!complete) return;
      buf = buf.slice(consumed);
      const w = waiters.shift();
      w.resolve(acc.trim());
    }
  }
  return {
    onData: function (d) { buf += d; pump(); },
    read: function () {
      return new Promise(function (resolve, reject) {
        waiters.push({ resolve: resolve, reject: reject });
        pump();
      });
    },
    push: function (err) {
      while (waiters.length) waiters.shift().reject(err);
    }
  };
}

/* 发一封信。永远 resolve，用 { ok, error } 表达结果 —— 调用方不该因为
   邮件发不出去而拿到一个 reject 的 Promise 然后忘记 catch。 */
async function send(opts) {
  const cfg = opts && opts.cfg;
  if (!cfg) return { ok: false, error: 'no-config' };

  const to = String(opts.to || cfg.to || '').trim();
  const subject = String(opts.subject || '');
  const text = String(opts.text || '');
  if (!to) return { ok: false, error: 'no-recipient' };

  const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  const head = [
    'From: ' + encHeader(cfg.fromName) + ' <' + cfg.user + '>',
    'To: <' + to + '>',
    'Subject: ' + encHeader(subject),
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Message-ID: <' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 8) + '@' + cfg.host + '>',
    '',
    body
  ].join('\r\n');

  return new Promise(function (resolve) {
    let settled = false;
    // cur 会在 STARTTLS 时整体换掉：socket 换了，读取器也得跟着换，
    // 否则升级之后还在读那条已经被 TLS 接管的旧连接
    let cur = null;

    function finish(res) {
      if (settled) return;
      settled = true;
      try { if (cur && cur.sock) cur.sock.destroy(); } catch (e) { /* 已经断了 */ }
      resolve(res);
    }

    const timer = setTimeout(function () { finish({ ok: false, error: 'timeout' }); }, TIMEOUT);
    if (timer.unref) timer.unref();

    function bind(s, r) {
      s.setEncoding('utf8');
      s.on('data', function (d) { r.onData(d); });
      s.on('error', function (e) { finish({ ok: false, error: 'socket: ' + (e.code || e.message) }); });
      s.on('timeout', function () { finish({ ok: false, error: 'socket-timeout' }); });
      s.on('close', function () { if (!settled) finish({ ok: false, error: 'closed-early' }); });
    }

    function onSock(s, isSecure) {
      cur = { sock: s, r: makeReader(s) };
      bind(s, cur.r);

      let queue = Promise.resolve();
      function step(name, expect, payload) {
        queue = queue.then(function () {
          if (payload != null) cur.sock.write(payload);
          return cur.r.read().then(function (res) {
            const code = String(res).slice(0, 3);
            if (expect && code !== expect) {
              throw new Error(name + ' 失败：' + String(res).slice(0, 120));
            }
            return res;
          });
        });
        return queue;
      }

      step('greeting', '220')
        .then(function () { return step('ehlo', '250', 'EHLO finals-quiz\r\n'); })
        .then(function () {
          if (isSecure) return null;
          // 587 这类明文端口：先升 TLS 再谈登录，否则 QQ 会直接拒
          return step('starttls', '220', 'STARTTLS\r\n').then(function () {
            return new Promise(function (res, rej) {
              const old = cur.sock;
              old.removeAllListeners('data');
              old.removeAllListeners('close');
              const up = tls.connect({ socket: old, servername: cfg.host }, function () { res(up); });
              up.on('error', function (e) { rej(new Error('starttls: ' + (e.code || e.message))); });
            });
          }).then(function (up) {
            cur = { sock: up, r: makeReader(up) };
            bind(up, cur.r);
            return step('ehlo2', '250', 'EHLO finals-quiz\r\n');
          });
        })
        .then(function () { return step('auth', '334', 'AUTH LOGIN\r\n'); })
        .then(function () { return step('auth-user', '334', Buffer.from(cfg.user, 'utf8').toString('base64') + '\r\n'); })
        .then(function () { return step('auth-pass', '235', Buffer.from(cfg.pass, 'utf8').toString('base64') + '\r\n'); })
        .then(function () { return step('mail-from', '250', 'MAIL FROM:<' + cfg.user + '>\r\n'); })
        .then(function () { return step('rcpt-to', '250', 'RCPT TO:<' + to + '>\r\n'); })
        .then(function () { return step('data', '354', 'DATA\r\n'); })
        .then(function () { return step('body', '250', head + '\r\n.\r\n'); })
        .then(function () {
          // 不等 QUIT 的回包：服务器回完 250 就可能关连接，
          // 等下去会被 close 事件误判成失败
          try { cur.sock.write('QUIT\r\n'); } catch (e) { /* 无所谓 */ }
          finish({ ok: true });
        })
        .catch(function (e) { finish({ ok: false, error: (e && e.message) || 'unknown' }); });
    }

    try {
      if (cfg.secure) {
        const s = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, function () { onSock(s, true); });
        s.setTimeout(TIMEOUT);
        s.on('error', function (e) { finish({ ok: false, error: 'connect: ' + (e.code || e.message) }); });
      } else {
        const s = net.connect({ host: cfg.host, port: cfg.port }, function () { onSock(s, false); });
        s.setTimeout(TIMEOUT);
        s.on('error', function (e) { finish({ ok: false, error: 'connect: ' + (e.code || e.message) }); });
      }
    } catch (e) {
      finish({ ok: false, error: (e && e.message) || 'throw' });
    }
  });
}

function createMailer(dataDir) {
  const file = path.join(dataDir, 'mail.config.json');
  return {
    file: file,
    config: function () { return readConfig(file); },
    enabled: function () { return !!readConfig(file); },
    /* 配置坏了或者网络不通都只是返回 { ok:false }，日志里留一句便于排查 */
    send: async function (opts) {
      const cfg = readConfig(file);
      if (!cfg) return { ok: false, error: 'no-config' };
      const res = await send(Object.assign({}, opts, { cfg: cfg }));
      if (!res.ok) console.error('[期末刷题] 邮件没发出去：' + res.error);
      return res;
    },
    resetCache: function () { cache = { at: 0, cfg: null }; }
  };
}

module.exports = { createMailer: createMailer, _encHeader: encHeader, _readConfig: readConfig };
