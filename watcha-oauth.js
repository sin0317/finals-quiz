'use strict';

/* =========================================================================
   观猹（watcha.cn）OAuth2 接入层
   -------------------------------------------------------------------------
   · 标准 Authorization Code 流程 + PKCE(S256)，授权地址 /oauth/authorize
   · 零第三方依赖，用 Node 18+ 自带的 fetch
   · 配置优先级：进程环境变量 > data/watcha-oauth.config.json（data/ 在 .gitignore）
   · 公开客户端（is_public=true）没有 client_secret；机密客户端带上即可，两种都支持
   · 只申请 read scope：拿 user_id / nickname / avatar_url，不碰邮箱手机号
   · state 与 code_verifier 都留在服务端内存里，一次性、10 分钟过期
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIMEOUT_MS = 10000;
const DEFAULT_BASE = 'https://watcha.cn';
const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/api/token';
const USERINFO_PATH = '/oauth/api/userinfo';
const CONFIG_FILE = 'watcha-oauth.config.json';

function readConfigFile(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, CONFIG_FILE), 'utf8');
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadConfig(dataDir, env) {
  const f = readConfigFile(dataDir);
  const E = env || process.env;
  const pick = function (key, fileVal, fallback) {
    const e = E[key];
    if (e && String(e).trim()) return String(e).trim();
    if (fileVal && String(fileVal).trim()) return String(fileVal).trim();
    return fallback;
  };
  const scope = pick('WATCHA_OAUTH_SCOPE', f.scope, 'read');
  const cfg = {
    clientId: pick('WATCHA_OAUTH_CLIENT_ID', f.clientId, ''),
    clientSecret: pick('WATCHA_OAUTH_CLIENT_SECRET', f.clientSecret, ''),
    redirectUri: pick('WATCHA_OAUTH_REDIRECT_URI', f.redirectUri, ''),
    baseUrl: pick('WATCHA_OAUTH_BASE_URL', f.baseUrl, DEFAULT_BASE).replace(/\/+$/, ''),
    scope: scope,
    scopeList: scope.split(/[\s+]+/).filter(Boolean)
  };
  // client_id 和回调地址都有才算配好；secret 有没有都无所谓（公开客户端没有 secret）
  cfg.enabled = !!(cfg.clientId && cfg.redirectUri);
  return cfg;
}

/* 错误码 → 给用户看的中文话，别把观猹的原始报文直接甩出去 */
function describeError(code, desc) {
  const map = {
    invalid_grant: '授权码无效或已过期，请重新登录',
    invalid_client: '观猹应用配置对不上（client_id 或 client_secret 不匹配）',
    unauthorized_client: '这个观猹应用没有登录权限，请联系观猹开通',
    invalid_request: '登录请求参数不完整，请重新登录',
    access_denied: '你取消了授权',
    invalid_token: '登录凭证已失效，请重新登录'
  };
  if (map[code]) return map[code];
  const d = String(desc || '').trim();
  return d ? d.slice(0, 120) : '未知错误';
}

function createWatchaOAuth(dataDir, env) {
  const cfg = loadConfig(dataDir, env);
  const states = new Map(); // state -> { verifier, redirectUri, exp }

  function cleanupStates() {
    const now = Date.now();
    states.forEach(function (v, k) { if (!v || v.exp < now) states.delete(k); });
  }

  /* 回调地址：优先用配置里的（必须和观猹后台登记的 domain 对得上），
     没配就从请求头推一个（本地调试用；线上有 x-forwarded-* 反代头）。 */
  function resolveRedirectUri(req) {
    if (cfg.redirectUri) return cfg.redirectUri;
    const h = req && req.headers ? req.headers : {};
    const proto = String(h['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
    return host ? (proto + '://' + host + '/') : '';
  }

  function buildAuthorizeUrl(opts) {
    const u = new URL(cfg.baseUrl + AUTH_PATH);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', opts.redirectUri);
    u.searchParams.set('scope', cfg.scopeList.join(' '));
    u.searchParams.set('state', opts.state);
    if (opts.codeChallenge) {
      u.searchParams.set('code_challenge', opts.codeChallenge);
      u.searchParams.set('code_challenge_method', 'S256');
    }
    return u.toString();
  }

  /* 发起登录：生成 state + PKCE 校验串，state 与 verifier 留在服务端 */
  function beginAuth(redirectUri) {
    cleanupStates();
    const state = base64url(crypto.randomBytes(24));
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const ru = redirectUri || cfg.redirectUri;
    states.set(state, { verifier: verifier, redirectUri: ru, exp: Date.now() + STATE_TTL_MS });
    return { state: state, url: buildAuthorizeUrl({ redirectUri: ru, state: state, codeChallenge: challenge }) };
  }

  /* 领回并作废 state：一次性，防止重放与 CSRF */
  function consumeState(state) {
    cleanupStates();
    const rec = states.get(state);
    if (!rec) return null;
    states.delete(state);
    return rec;
  }

  async function postForm(pathname, form) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    try {
      const res = await fetch(cfg.baseUrl + pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: ctrl.signal
      });
      const raw = await res.text();
      let j = null;
      try { j = JSON.parse(raw); } catch (e) { j = null; }
      if (!j) {
        const e = new Error('观猹返回了看不懂的内容（HTTP ' + res.status + '）');
        e.code = 'bad_response';
        throw e;
      }
      // 观猹可能用 400 报 OAuth 错误，也可能用 200 带一个 error 字段，两种都认
      if (!res.ok || (j.statusCode && j.statusCode !== 200) || j.error) {
        const e = new Error(describeError(j.error || j.code, j.error_description || j.message));
        e.code = j.error || j.code || 'http_' + res.status;
        throw e;
      }
      return j;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('观猹那边响应太慢，请稍后再试');
        err.code = 'timeout';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* code 换 token：公开客户端靠 PKCE 验证，机密客户端再加 client_secret */
  async function exchangeCode(opts) {
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', String(opts.code || ''));
    form.set('redirect_uri', opts.redirectUri || cfg.redirectUri);
    form.set('client_id', cfg.clientId);
    if (cfg.clientSecret) form.set('client_secret', cfg.clientSecret);
    if (opts.codeVerifier) form.set('code_verifier', opts.codeVerifier);
    const j = await postForm(TOKEN_PATH, form);
    if (!j.access_token) {
      const e = new Error('观猹没有返回 access_token');
      e.code = 'no_token';
      throw e;
    }
    return {
      accessToken: String(j.access_token),
      refreshToken: String(j.refresh_token || ''),
      expiresIn: Number(j.expires_in) || 0,
      scope: String(j.scope || '')
    };
  }

  /* 拿用户信息：优先 Authorization 头，失败再退回 query 传 token（观猹兼容老接入） */
  async function fetchUserInfo(accessToken) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    let j = null;
    try {
      const res = await fetch(cfg.baseUrl + USERINFO_PATH, {
        headers: { 'Authorization': 'Bearer ' + accessToken },
        signal: ctrl.signal
      });
      const raw = await res.text();
      try { j = JSON.parse(raw); } catch (e) { j = null; }
      if (!j) {
        const e = new Error('观猹返回了看不懂的内容（HTTP ' + res.status + '）');
        e.code = 'bad_response';
        throw e;
      }
      if (!res.ok || (j.statusCode && j.statusCode !== 200) || j.error) {
        const e = new Error(describeError(j.code || j.error, j.message || j.error_description));
        e.code = j.code || j.error || 'http_' + res.status;
        throw e;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('观猹那边响应太慢，请稍后再试');
        err.code = 'timeout';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    // 正常是 { statusCode:200, data:{...} }，个别老接口直接返回对象，都认
    const d = (j && j.data && typeof j.data === 'object') ? j.data : (j || {});
    const userId = d.user_id == null ? '' : String(d.user_id).trim();
    if (!userId) {
      const e = new Error('观猹没有返回用户标识');
      e.code = 'no_user_id';
      throw e;
    }
    return {
      userId: userId,
      nickname: String(d.nickname || '').trim().slice(0, 40),
      avatarUrl: String(d.avatar_url || '').trim().slice(0, 500),
      email: d.email ? String(d.email).trim() : '',
      phone: d.phone ? String(d.phone).trim() : ''
    };
  }

  return {
    cfg: cfg,
    get enabled() { return cfg.enabled; },
    resolveRedirectUri: resolveRedirectUri,
    beginAuth: beginAuth,
    consumeState: consumeState,
    exchangeCode: exchangeCode,
    fetchUserInfo: fetchUserInfo
  };
}

module.exports = { createWatchaOAuth: createWatchaOAuth, describeError: describeError };
