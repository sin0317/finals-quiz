'use strict';
/* 「只刷没见过的」抽题方式回归
   运行： NODE_PATH=<workspace>/node_modules node test/fresh.test.js

   用户要的：抽题下拉里加一项，只抽一次都没练过的题。
   口径：认「有没有练习记录」，不认「掌握度是不是 0」——
   答过但全错的题掌握度也是 0，可它已经见过了，不该出现在这个模式里。   */

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

function boot(banks, stats) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  if (banks) win.localStorage.setItem('fq_banks_v1', JSON.stringify(banks));
  if (stats) win.localStorage.setItem('fq_stats_v1', JSON.stringify(stats));
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api };
}

function makeBank(n) {
  const questions = [];
  for (let i = 1; i <= n; i++) {
    questions.push({
      id: 'q' + i, type: 'fill', stem: '第' + i + '题的答案是____', answer: '答案' + i,
      opts: [], source: '第' + i + '题的答案是答案' + i + '。', order: i
    });
  }
  return [{ id: 'b_fresh', course: '抽题模式测试', createdAt: 1, questions: questions }];
}

function pick(api, extra) {
  return api.pickBatch(Object.assign({
    range: 'all', type: 'all', count: 20, shuffle: false,
    mode: 'fresh', done: {}, served: {}
  }, extra || {}));
}

/* ---------------- 一、下拉里真的有这一项 ---------------- */
console.log('\n一、下拉里有「只刷没见过的」这一项');
{
  const { win } = boot(makeBank(5));
  const opt = Array.from(win.document.querySelectorAll('#qMode option'))
    .filter(function (o) { return o.value === 'fresh'; })[0];
  ok(!!opt, '存在 value=fresh 的选项');
  ok(opt && opt.textContent === '只刷没见过的', '文案是「只刷没见过的」', opt && opt.textContent);
  const title = win.document.querySelector('#qMode').getAttribute('title') || '';
  ok(title.indexOf('只刷没见过的') > 0, 'title 说明里也提了', title);
}

/* ---------------- 二、只抽没练过的 ---------------- */
console.log('\n二、20 道里练过 12 道：只抽剩下 8 道');
{
  const stats = {};
  for (let i = 1; i <= 12; i++) {
    stats['q' + i] = { ok: i % 2, bad: 1, streak: 0, mastery: 0.2, mastered: false, lastAt: 1 };
  }
  const { api } = boot(makeBank(20), stats);
  const got = pick(api);
  ok(got.list.length === 8, '一组 8 道', got.list.length);
  ok(got.list.every(function (q) { return +q.id.slice(1) > 12; }), '全是 13~20 号没练过的');
  ok(got.remain === 8, 'remain 也是 8', got.remain);
}

/* ---------------- 三、答过但全错，算「见过」 ---------------- */
console.log('\n三、答过但全错（掌握度 0）不算没见过');
{
  const stats = {};
  for (let i = 1; i <= 5; i++) {
    stats['q' + i] = { ok: 0, bad: 1, streak: 0, mastery: 0, mastered: false, lastAt: 1 };
  }
  const { api } = boot(makeBank(10), stats);
  const got = pick(api);
  ok(got.list.length === 5, '剩 5 道没见过', got.list.length);
  ok(got.list.every(function (q) { return +q.id.slice(1) > 5; }), '全错的 1~5 号没被抽回来');
}

/* ---------------- 四、全见过了：给出 why=seen ---------------- */
console.log('\n四、全练过了：明确说「没有没见过的题了」');
{
  const stats = {};
  for (let i = 1; i <= 6; i++) stats['q' + i] = { ok: 1, bad: 0, streak: 1, mastery: 0.5, mastered: false, lastAt: 1 };
  const { win, api } = boot(makeBank(6), stats);
  const got = pick(api);
  ok(got.list.length === 0, '抽不出题');
  ok(got.why === 'seen', 'why=seen', got.why);
  win.document.querySelector('#qCount').value = '20';
  const tip = api.nextRoundTip({ mode: 'fresh' }, got);
  ok(tip.indexOf('没有没见过的题了') >= 0, '提示语说清原因', tip);
  ok(tip.indexOf('间隔复习') > 0, '给出下一出口', tip);
}

/* ---------------- 五、题不够时别报做不到的数 ---------------- */
console.log('\n五、只剩 8 道没见过、题量 20：不说「抽 20 道」');
{
  const stats = {};
  for (let i = 1; i <= 12; i++) stats['q' + i] = { ok: 0, bad: 1, streak: 0, mastery: 0, mastered: false, lastAt: 1 };
  const { win, api } = boot(makeBank(20), stats);
  win.document.querySelector('#qCount').value = '20';
  const got = pick(api);
  const tip = api.nextRoundTip({ mode: 'fresh' }, got);
  ok(got.remain === 8, 'remain 8', got.remain);
  ok(tip.indexOf('抽 20 道') < 0, '不出现「抽 20 道」', tip);
  ok(tip.indexOf('8 道没见过') > 0, '说「8 道没见过」', tip);
  ok(tip.indexOf('另外 12 道都练过了') > 0, '把原因说清', tip);
}

/* ---------------- 六、随机不乱序、也不重复 ---------------- */
console.log('\n六、随机乱序：不重复、不越界');
{
  const { api } = boot(makeBank(30));
  const got = pick(api, { shuffle: true, count: 0 });
  const ids = got.list.map(function (q) { return q.id; });
  ok(new Set(ids).size === ids.length, '没有重复题');
  ok(ids.length === 30, '全部模式把 30 道都给了', ids.length);
}

/* ---------------- 七、结算页的「这本扫到哪儿了」 ---------------- */
console.log('\n七、结算页进度：12 / 20 道');

function seedQuiz(n, mode, seenCount) {
  const stats = {};
  for (let i = 1; i <= seenCount; i++) {
    stats['q' + i] = { ok: 1, bad: 0, streak: 1, mastery: 0.5, mastered: false, lastAt: 1 };
  }
  const ids = [];
  for (let i = 1; i <= 8; i++) ids.push('q' + i);
  const raw = {
    v: 1, bank: 'b_fresh', at: 1, round: 1, idx: 8, mode: mode, remain: 20,
    opt: { qRange: 'all', qType: 'all', qCount: '20', qOrder: 'seq', qForm: 'mix', qMode: mode },
    forms: new Array(8).fill('fill'), draft: '', draftFor: '', ids: ids,
    results: ids.map(function (id) { return { q: id, ok: true, partial: false, multi: false, input: 'x', picked: null }; }),
    drill: { done: {}, served: {} }
  };
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) {}
  win.localStorage.setItem('fq_banks_v1', JSON.stringify(makeBank(n)));
  win.localStorage.setItem('fq_current_v1', JSON.stringify('b_fresh'));
  win.localStorage.setItem('fq_stats_v1', JSON.stringify(stats));
  win.localStorage.setItem('fq_quiz_v1', JSON.stringify(raw));
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api };
}

{
  const { win, api } = seedQuiz(20, 'fresh', 12);
  const box = win.document.querySelector('.fresh-progress');
  ok(!!box, 'fresh 模式结算页有进度块');
  const txt = box ? box.textContent.replace(/\s+/g, '') : '';
  ok(txt.indexOf('这本已经扫完12/20道') === 0, '文案是「这本已经扫完 12 / 20 道」', txt);
  ok(txt.indexOf('还剩8道没碰过') > 0, '说清还剩几道', txt);
  const p = api.freshProgress();
  ok(p.seen === 12 && p.total === 20, 'freshProgress 数对', p);
}

console.log('\n八、别的模式不显示这条进度');
{
  const { win } = seedQuiz(20, 'srs', 12);
  ok(!win.document.querySelector('.fresh-progress'), '间隔复习的结算页没有这块');
}

console.log('\n九、整本扫完时说「整本都见过了」');
{
  const { win } = seedQuiz(20, 'fresh', 20);
  const txt = win.document.querySelector('.fresh-progress').textContent.replace(/\s+/g, '');
  ok(txt.indexOf('20/20道') > 0, '20 / 20', txt);
  ok(txt.indexOf('整本都见过了') > 0, '收尾一句', txt);
}

console.log('\n' + (fail ? '✗' : '✓') + ' fresh: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
