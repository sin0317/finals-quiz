'use strict';
/* =========================================================
   测试公共骨架
   ---------------------------------------------------------
   以前每套测试都把同一段 30 行的初始化抄一遍（42 套共 126 处重复）：
   读 index.html 抠 body、读 app.js、起 happy-dom、打桩 confirm、
   灌 localStorage、eval 出 FQInternals。这段东西只要有一处要改
   （换 happy-dom 版本、补一个 polyfill、app.js 换了暴露方式），
   就得改 42 个文件 —— 这是「改个小功能要很久」的一大来源。

   现在收成这一份。老测试仍然保持可独立运行，新测试请用它。

   用法：
     const T = require('./_harness');
     const { win, api, d } = T.openWin(T.bank(5, { course: '收藏夹测试' }));
     T.ok(api.state().banks.length === 1, '只载入一本');
     T.done();
   ========================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* happy-dom 装在【工作空间根】而不是 finals-quiz 里。
   以前每套测试都靠命令行 NODE_PATH 找它，忘了设就报「Cannot find module」。
   这里主动补一条查找路径，`node test/run.js` 或 `node test/xxx.test.js`
   都能直接跑，不用再记 NODE_PATH。 */
function ensureDeps() {
  try {
    require.resolve('happy-dom');
    return;
  } catch (e) { /* 继续往下找 */ }
  const ws = path.resolve(ROOT, '..');
  const candidates = [
    path.join(ws, 'node_modules'),
    path.join(ROOT, 'node_modules')
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'happy-dom'))) {
      module.paths.unshift(p);
      if (process.env.NODE_PATH) process.env.NODE_PATH += path.delimiter + p;
      else process.env.NODE_PATH = p;
      return;
    }
  }
}
ensureDeps();

const { Window } = require('happy-dom');

const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1]
  .replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

/* 记一笔。extra 只在失败时打出来，省得通过的用例刷屏。 */
function ok(cond, msg, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + msg);
  } else {
    fail++;
    const line = msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '');
    failures.push(line);
    console.log('  ✗ ' + line);
  }
}

function eq(actual, expected, msg) {
  ok(actual === expected, msg, { actual: actual, expected: expected });
}

/* 起一个页面：body 装进 index.html 的正文，app.js 在同一个 window 里跑一遍，
   返回 window / document / FQInternals 三件套。
   opts.confirm / opts.alert 可以覆盖原生弹窗的返回值。 */
function openWin(seed, opts) {
  const o = opts || {};
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return o.confirm === undefined ? true : o.confirm; };
  win.alert = function () {};
  win.prompt = function () { return o.prompt === undefined ? '' : o.prompt; };
  win.matchMedia = win.matchMedia || function () {
    return { matches: false, addListener: function () {}, removeListener: function () {} };
  };
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  if (seed) Object.keys(seed).forEach(function (k) { win.localStorage.setItem(k, seed[k]); });
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win: win, api: api, d: win.document };
}

const $ = function (d, s) { return d.querySelector(s); };
const $$ = function (d, s) { return Array.prototype.slice.call(d.querySelectorAll(s)); };

function txt(el) {
  return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
}

/* 造一本题集，直接能塞进 localStorage 的 fq_banks_v1。
   n 道填空题，题干 / 答案都带序号，方便断言「删的是第几道」。 */
function bank(n, opts) {
  const o = opts || {};
  const qs = [];
  for (let i = 1; i <= n; i++) {
    qs.push({
      id: (o.prefix || 'q') + i,
      type: o.type || 'fill',
      stem: '第' + i + '题：这个考点的答案是____',
      answer: '答案' + i,
      opts: [],
      source: '第' + i + '题：这个考点的答案是答案' + i + '。',
      order: i
    });
  }
  return { id: o.id || 'b1', course: o.course || '测试课', createdAt: 1, questions: qs };
}

/* 把一本或多本题集转成 openWin 要的 seed 对象 */
function seedFor(banks, extra) {
  const list = Array.isArray(banks) ? banks : [banks];
  const seed = {
    fq_banks_v1: JSON.stringify(list),
    fq_current_v1: list[0].id
  };
  return Object.assign(seed, extra || {});
}

/* 收尾：打印汇总，并且打一行机器可读的 #RESULT 给 run.js 解析。
   注意 pass/fail 是闭包里的计数，老测试自己维护的自己打印，互不影响。 */
function done(label) {
  console.log('\n—— ' + (label ? label + '：' : '') + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  console.log('#RESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
}

function counts() { return { pass: pass, fail: fail, failures: failures.slice() }; }

module.exports = {
  ROOT: ROOT,
  HTML: HTML,
  BODY: BODY,
  APP_SRC: APP_SRC,
  ok: ok,
  eq: eq,
  openWin: openWin,
  bank: bank,
  seedFor: seedFor,
  $: $,
  $$: $$,
  txt: txt,
  done: done,
  counts: counts
};
