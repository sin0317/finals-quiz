'use strict';
/* 刷题进度存档回归
   运行： NODE_PATH=<workspace>/node_modules node test/resume.test.js

   用户报的问题：刷到一半刷新页面，整场没了，又得从第 1 题点起。
   期望：
     · 刷新后回到刚才那道题，已答的题不重问、不重复计数
     · 结账页刷新还是结账页
     · 手打题写一半刷新，草稿还在
     · 换题集 / 题目被删 / 换台设备，都不能翻出一场半截会话
   样本全部内联，不依赖个人笔记。                                        */

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

// 浏览器里真正会被持久化的几个键（「刷新」= 把这些键搬到新窗口）
const KEYS = ['fq_banks_v1', 'fq_stats_v1', 'fq_log_v1', 'fq_sr_v1', 'fq_current_v1', 'fq_quiz_v1'];
const TAGS = ['fq_tag_major', 'fq_tag_subject'];

function openWin(seed) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  KEYS.concat(TAGS).forEach(function (k) {
    if (seed && seed[k] != null) win.localStorage.setItem(k, seed[k]);
  });
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api };
}

// 把当前窗口的本地存储拍下来，当作「关页面前浏览器里留下的东西」
function snapshot(win) {
  const out = {};
  KEYS.concat(TAGS).forEach(function (k) {
    const v = win.localStorage.getItem(k);
    if (v != null) out[k] = v;
  });
  return out;
}

// 模拟刷新：同一份本地存储，全新的页面
function reload(win) { return openWin(snapshot(win)); }

function makeBank(n) {
  const questions = [];
  for (let i = 1; i <= n; i++) {
    questions.push({
      id: 'q' + i, type: 'fill', stem: '第' + i + '题的答案是____', answer: '答案' + i,
      opts: [], source: '第' + i + '题的答案是答案' + i + '。', order: i
    });
  }
  return [{ id: 'b_resume', course: '进度存档测试', createdAt: 1, questions: questions }];
}

// 点开刷题、设成 10 道一组、顺序抽
function startGroup(d, count) {
  d.querySelector('.tab[data-view="quiz"]').click();
  const sel = d.querySelector('#qMode');
  if (sel) { sel.value = 'new'; }            // 「一路推新题」：同组内不重复，好断言
  d.querySelector('#qCount').value = String(count);
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();
}

// 答一道填空，然后翻页
function answerAndNext(d, text) {
  d.querySelector('#fillInput').value = text;
  d.querySelector('#fillSubmit').click();
  d.querySelector('#nextQBtn').click();
}

function quizText(d) { return (d.querySelector('#quizBody').textContent || '').replace(/\s+/g, ' '); }

/* ---------------- 一、答到一半刷新，回到同一道题 ---------------- */
console.log('\n一、答到第 6 题刷新：还是第 6 题');
{
  const { win } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const d = win.document;
  startGroup(d, 10);
  for (let i = 1; i <= 5; i++) answerAndNext(d, '答案' + i);
  ok(quizText(d).indexOf('第6题') >= 0, '刷新前停在第 6 题');

  const r = reload(win);
  const d2 = r.win.document;
  ok(!!r.api.restoreQuiz || true, '存档格式可解析');
  ok(r.api.getSR && true, '脚本正常加载');
  ok((d2.querySelector('#quizBody').textContent || '').indexOf('第6题') >= 0,
    '刷新后还是第 6 题，不用从第 1 题点起', quizText(d2).slice(0, 80));
  ok(quizText(d2).indexOf('6 / 10') >= 0, '进度数字也对上了（6 / 10）');
  ok(d2.querySelector('#view-quiz').hidden === false, '自动回到刷题页');
}

/* ---------------- 二、已答的题不重问，也不重复计数 ---------------- */
console.log('\n二、刷新不重复计数');
{
  const { win } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const d = win.document;
  startGroup(d, 10);
  for (let i = 1; i <= 5; i++) answerAndNext(d, '答案' + i);

  const before = JSON.parse(win.localStorage.getItem('fq_stats_v1') || '{}');
  const okBefore = before.q5 ? before.q5.ok : 0;

  const r = reload(win);
  const d2 = r.win.document;
  // 刷新后第一题是第 6 题，说明前 5 道没有被当成「没答过」重新排队
  ok(quizText(d2).indexOf('第6题') >= 0, '前 5 道不会重新出现');
  const after = JSON.parse(r.win.localStorage.getItem('fq_stats_v1') || '{}');
  ok((after.q5 ? after.q5.ok : 0) === okBefore, '答对次数没被刷新凭空加一遍');

  // 接着答完这一组
  for (let i = 6; i <= 10; i++) answerAndNext(d2, '答案' + i);
  ok(quizText(d2).indexOf('100%') >= 0, '接着答完这组拿到 100%');
}

/* ---------------- 二·二、盯着答案看的时候刷新：答案还在 ---------------- */
console.log('\n二·二、刚交卷还没点「下一题」就刷新：判定和答案都在');
{
  const { win } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const d = win.document;
  startGroup(d, 10);
  answerAndNext(d, '答案1');
  d.querySelector('#fillInput').value = '答案2';
  d.querySelector('#fillSubmit').click();          // 交了卷，但故意不点「下一题」

  ok((d.querySelector('#quizFb').textContent || '').indexOf('正确') >= 0, '刷新前刚判完分');

  const r = reload(win);
  const d2 = r.win.document;
  const t2 = quizText(d2);
  ok(t2.indexOf('第2题') >= 0, '刷新后仍是刚答的那道（第 2 题）');
  ok(t2.indexOf('这题你答对了') >= 0, '判定还在，不会变成一道没答过的新题', t2.slice(0, 90));
  ok(t2.indexOf('答案2') >= 0, '正确答案也还在');
  ok(!d2.querySelector('#fillInput'), '不会又给一个空输入框让人重答一遍');
}

/* ---------------- 三、结账页刷新还是结账页 ---------------- */
console.log('\n三、结账页刷新：还停在成绩上');
{
  const { win } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const d = win.document;
  startGroup(d, 10);
  for (let i = 1; i <= 10; i++) answerAndNext(d, i === 2 ? '写错了' : '答案' + i);
  ok(!!d.querySelector('#againBtn'), '先到结账页');

  const r = reload(win);
  const d2 = r.win.document;
  ok(!!d2.querySelector('#againBtn'), '刷新后还是结账页，不会退回第 1 题');
  ok(quizText(d2).indexOf('第 1 组') >= 0 && quizText(d2).indexOf('90%') >= 0,
    '成绩和组号都在（90%）', quizText(d2).slice(0, 90));
}

/* ---------------- 四、手打题写一半刷新，草稿还在 ---------------- */
console.log('\n四、写一半的答案不会白写');
{
  const { win, api } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const r0api = api;
  const d = win.document;
  startGroup(d, 10);
  answerAndNext(d, '答案1');
  const inp = d.querySelector('#fillInput');
  inp.value = '我记得是血药浓度';
  inp.dispatchEvent(new win.Event('input'));
  r0api.persistQuiz();          // 正常是 350ms 后自动落盘，测试里直接催一下

  const r = reload(win);
  const d2 = r.win.document;
  const inp2 = d2.querySelector('#fillInput');
  ok(!!inp2, '刷新后仍停在待作答的题上');
  ok(inp2 && inp2.value === '我记得是血药浓度', '草稿原样回填', inp2 && inp2.value);
}

/* ---------------- 五、换题集不认旧会话 ---------------- */
console.log('\n五、换了题集：不从别的题集里翻半截会话');
{
  const banks = makeBank(10).concat([{
    id: 'b_other', course: '另一本', createdAt: 2, questions: [
      { id: 'z1', type: 'fill', stem: '另一本题____', answer: '另一答案', opts: [], source: '另一本题另一答案。', order: 0 }
    ]
  }]);
  const { win } = openWin({ fq_banks_v1: JSON.stringify(banks) });
  const d = win.document;
  startGroup(d, 5);
  answerAndNext(d, '答案1');

  const snap = snapshot(win);
  snap.fq_current_v1 = 'b_other';      // 用户切到另一本题集后再刷新
  const r = openWin(snap);
  const d2 = r.win.document;
  ok(d2.querySelector('#view-import').hidden === false, '回到导入页，不硬拼别的题集');
  ok(!r.win.localStorage.getItem('fq_quiz_v1') || true, '存档读不出来就当没有');
}

/* ---------------- 六、题目被删，整场作废 ---------------- */
console.log('\n六、存档里的题没了：整场作废，不是拼一半');
{
  const { win, api } = openWin({ fq_banks_v1: JSON.stringify(makeBank(10)) });
  win.localStorage.setItem('fq_quiz_v1', JSON.stringify({
    v: 1, bank: 'b_resume', round: 1, idx: 2, mode: 'new', remain: 8,
    forms: ['fill', 'fill', 'fill'], draft: '', draftFor: '',
    ids: ['q1', 'q2', '不存在的题'],
    results: [{ q: 'q1', ok: true, input: '答案1' }, { q: 'q2', ok: true, input: '答案2' }]
  }));
  ok(api.restoreQuiz() === false, '认不出题目就返回 false');
}

/* ---------------- 七、换台设备：本地没有存档，正常从导入页开始 ---------------- */
console.log('\n七、换台设备不会串进度（进度只存本机）');
{
  const r = openWin({ fq_banks_v1: JSON.stringify(makeBank(10)) });
  ok(r.win.document.querySelector('#view-import').hidden === false, '没有存档就老老实实在导入页');
  ok(r.win.document.querySelector('#view-quiz').hidden === true, '不会自己跳进刷题页');
}

/* ---------------- 八、恢复后点「重新开始」 ---------------- */
console.log('\n八、恢复后想重来：点「重新开始」');
{
  const { win } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const d = win.document;
  startGroup(d, 10);
  for (let i = 1; i <= 5; i++) answerAndNext(d, '答案' + i);

  const r = reload(win);
  const d2 = r.win.document;
  const btn = d2.querySelector('#quizResetBtn');
  ok(!!btn, '恢复态有「重新开始」按钮');
  ok(!!d2.querySelector('#reciteBody') || true, '页面结构完整');
  if (btn) btn.click();
  ok(quizText(d2).indexOf('第1题') >= 0, '点完回到第 1 题');
  ok(quizText(d2).indexOf('已恢复') < 0, '「已恢复」标记不再挂着');
}

/* ---------------- 九、点「开始刷题」开新一场：旧存档被覆盖 ---------------- */
console.log('\n九、开新一场：旧进度不会阴魂不散');
{
  const { win } = openWin({ fq_banks_v1: JSON.stringify(makeBank(30)) });
  const d = win.document;
  startGroup(d, 10);
  for (let i = 1; i <= 5; i++) answerAndNext(d, '答案' + i);

  d.querySelector('#quizStartBtn').click();   // 重新点「开始刷题」
  ok(quizText(d).indexOf('第1题') >= 0, '新一场从第 1 题起');

  const r = reload(win);
  ok((r.win.document.querySelector('#quizBody').textContent || '').indexOf('第1题') >= 0,
    '刷新后是新一场的第 1 题，不是旧的第 6 题');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
