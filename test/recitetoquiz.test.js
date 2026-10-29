'use strict';
/* 背诵结算页的「继续刷题」回归
   运行： NODE_PATH=<workspace>/node_modules node test/recitetoquiz.test.js

   用户要：背知识点背完一轮（结算页）时，能直接接着去刷题。
   刷题结算页本来有「马上背这些错题」，背诵结算页缺一条反向的路。

   规矩：
     · 结算页四个按钮：再背一轮 / 继续刷题 / 去背错题 / 看看统计
     · 点「继续刷题」→ 切到刷题页并立刻开一组（不是只跳过去让人自己点开始）
     · 刷题的「范围」跟着刚才背诵的范围走（背的是错题，刷的就也是错题）
     · 范围里一道题都没有时（错题刚被订正光），退回「全部」并提示，
       不能把人丢到一个空白的刷题页
     · 题型、题量、抽题方式仍用刷题页自己那一套，不动 */

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

const QS = [
  { id: 'q1', type: 'fill', stem: '药物治疗的前提是____', answer: '有效性', opts: [], order: 1 },
  { id: 'q2', type: 'fill', stem: '合理用药的核心是____', answer: '安全', opts: [], order: 2 },
  { id: 'q3', type: 'fill', stem: '半衰期指____', answer: '浓度降一半', opts: [], order: 3 }
];

// 一道还没订正的错题
const WRONG_STATS = { q1: { ok: 0, bad: 1, streak: 0, mastery: 0, mastered: false, lastAt: 1 } };

function open(stats) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  win.localStorage.setItem('fq_banks_v1', JSON.stringify([{
    id: 'b_rq', course: '接着刷', createdAt: 1, questions: QS
  }]));
  win.localStorage.setItem('fq_current_v1', 'b_rq');
  if (stats) win.localStorage.setItem('fq_stats_v1', JSON.stringify(stats));
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

function endRecite(api) {
  api.state().recite = { list: QS, ok: 3, mid: 0, bad: 0 };
  api.renderReciteEnd();
}

/* ============ 1 结算页有四个按钮 ============ */
console.log('\n[1] 背诵结算页的按钮');
{
  const { api, d } = open();
  endRecite(api);
  ok(!!d.getElementById('reciteAgain'), '有「再背一轮」');
  ok(!!d.getElementById('reciteToQuiz'), '有「继续刷题」');
  ok(!!d.getElementById('reciteToWrong'), '有「去背错题」');
  ok(!!d.getElementById('reciteToStats'), '有「看看统计」');
  ok(d.querySelectorAll('#reciteBody button').length === 4, '一共四个按钮');
}

/* ============ 2 点了切到刷题页并直接开一组 ============ */
console.log('\n[2] 点「继续刷题」→ 落到刷题页并且已经在刷');
{
  const { api, d } = open();
  endRecite(api);
  d.getElementById('reciteToQuiz').click();
  const st = api.state();
  ok(st.view === 'quiz', '当前视图是刷题页', st.view);
  ok(d.getElementById('view-quiz').hidden === false, '刷题页是显示着的');
  ok(!!st.quiz && st.quiz.list && st.quiz.list.length > 0, '已经开了一组，不是空着等你自己点开始',
    st.quiz ? (st.quiz.list || []).length : null);
  ok(d.querySelector('#quizBody .quiz-card') !== null, '题目卡已经渲染出来了');
}

/* ============ 3 范围跟着背诵的范围走 ============ */
console.log('\n[3] 刷题的「范围」跟背诵的一致');
{
  const { api, d } = open(WRONG_STATS);
  endRecite(api);
  d.getElementById('rRange').value = 'wrong';
  d.getElementById('reciteToQuiz').click();
  ok(d.getElementById('qRange').value === 'wrong', '背的是错题 → 刷的也是错题', d.getElementById('qRange').value);
  const st = api.state();
  ok(!!st.quiz && st.quiz.list.length === 1, '只刷那一道错题', st.quiz ? st.quiz.list.map(q => q.id) : null);
}

/* ============ 3b 范围空了要退回「全部」 ============ */
console.log('\n[3b] 范围里一道题都没有时，退回全部');
{
  const { api, d } = open();          // 没有任何统计 → 错题范围是空的
  endRecite(api);
  d.getElementById('rRange').value = 'wrong';
  d.getElementById('reciteToQuiz').click();
  ok(d.getElementById('qRange').value === 'all', '错题空了 → 改刷全部', d.getElementById('qRange').value);
  const st = api.state();
  ok(!!st.quiz && st.quiz.list.length > 0, '照样开了一组，不是空页面', st.quiz ? st.quiz.list.length : null);
}

/* ============ 3c 范围是「全部」时不用动 ============ */
console.log('\n[3c] 背的是全部 → 刷的也是全部');
{
  const { api, d } = open();
  endRecite(api);
  d.getElementById('rRange').value = 'all';
  d.getElementById('reciteToQuiz').click();
  ok(d.getElementById('qRange').value === 'all', '范围保持全部', d.getElementById('qRange').value);
}

/* ============ 4 不动刷题页自己的设置 ============ */
console.log('\n[4] 题型和抽题方式不该被改');
{
  const { api, d } = open(WRONG_STATS);
  d.getElementById('qType').value = 'single';
  d.getElementById('qMode').value = 'master';
  d.getElementById('qCount').value = '10';
  endRecite(api);
  d.getElementById('reciteToQuiz').click();
  ok(d.getElementById('qType').value === 'single', '题型没被动过', d.getElementById('qType').value);
  ok(d.getElementById('qMode').value === 'master', '抽题方式没被动过', d.getElementById('qMode').value);
  ok(d.getElementById('qCount').value === '10', '题量没被动过', d.getElementById('qCount').value);
}

/* ============ 5 范围空时刷题页要说清原因，不是「题库还没有题目」 ============ */
console.log('\n[5] 刷题页抽不到题时，说清是范围空、不是题库空');
{
  const { api, d } = open();
  d.getElementById('qRange').value = 'wrong';   // 错题范围为空
  d.getElementById('quizStartBtn').click();
  const txt = d.querySelector('#quizBody').textContent;
  ok(txt.indexOf('题库还没有题目') < 0, '不再显示「题库还没有题目」', txt.slice(0, 60));
  ok(txt.indexOf('这个范围里没有可刷的题') >= 0, '说明白是「这个范围里没有可刷的题」', txt.slice(0, 60));
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
