'use strict';
/* 错题范围的回归
   运行： NODE_PATH=<workspace>/node_modules node test/wrongfix.test.js

   用户报的：背知识点里选「范围：错题」，做过的题答对之后还赖着不走。
   查下去不是这条范围写错了，是它挂的门槛太狠：
   错题 = 做错过 && !mastered，而 mastered 要「连对 3 次且掌握度 ≥90%」，
   掌握度又是 ok/(ok+bad) —— 历史错误次数永久拖累。
   实测：错过 1 次要连对 5 次才出列，错过 3 次要连对 15 次。

   现在的规矩：
     · 错题 = 做错过、且最近一次没答对（streak === 0）
     · 答对一次就算订正，立刻从错题范围出去；再答错又回来
     · 简答「半对」（mid）不算订正 —— 要点没答全，还得再看一遍
     · 「已掌握」的严格口径不变（连对 3 次 + 掌握度 90%），统计页的数字还是那个意思
     · 刷题范围、背知识点范围、错题本「只看错题」三处必须是同一个口径 */

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

const SINGLE = {
  id: 's1', type: 'single', stem: '药物治疗的核心问题是（　）', answer: '合理用药',
  opts: ['合理用药', '获得最佳疗效', '安全用药', '获得最低成本'], optsSrc: 'paper', order: 1
};
const SHORT = {
  id: 'h1', type: 'short', stem: '合理用药的原则', answer: ['安全', '有效', '经济'],
  opts: [], order: 2
};
const CLEAN = {
  id: 'c1', type: 'fill', stem: '药物治疗的前提是____', answer: '有效性',
  opts: [], order: 3
};

function open(qs) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  win.localStorage.setItem('fq_banks_v1', JSON.stringify([{
    id: 'b_wf', course: '错题口径测试', createdAt: 1, questions: qs
  }]));
  win.localStorage.setItem('fq_current_v1', 'b_wf');
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

/* 从头答一遍：先错、再按给定序列作答 */
function drill(api, id, seq) {
  api.recordAnswer(id, 'wrong');
  seq.forEach(function (lv) { api.recordAnswer(id, lv); });
}

function inRange(api, range, id) {
  return api.filterPool([SINGLE, SHORT, CLEAN], range, 'all').some(function (q) { return q.id === id; });
}

/* ============ 1 答对一次就出列 ============ */
console.log('\n[1] 做对一次，立刻不在错题范围');
{
  const { api } = open([SINGLE, SHORT, CLEAN]);
  drill(api, 's1', []);
  ok(inRange(api, 'wrong', 's1'), '刚答错，在错题里');

  api.recordAnswer('s1', 'right');
  ok(!inRange(api, 'wrong', 's1'), '答对一次就不在错题里了（以前要连对 5 次）');

  const st = api.getStat('s1');
  ok(st.bad === 1 && st.ok === 1 && st.streak === 1, '统计照记：错 1 次、对 1 次、连对 1',
    { ok: st.ok, bad: st.bad, streak: st.streak });
  ok(st.mastered === false, '但还没到「已掌握」—— 严格口径没被放松', st.mastered);
}

/* ============ 2 再答错又回来 ============ */
console.log('\n[2] 再答错，重新回到错题里');
{
  const { api } = open([SINGLE, SHORT, CLEAN]);
  drill(api, 's1', ['right']);
  ok(!inRange(api, 'wrong', 's1'), '先答对，出列了');

  api.recordAnswer('s1', 'wrong');
  ok(inRange(api, 'wrong', 's1'), '又答错，回到错题里');
  ok(api.getStat('s1').streak === 0, '连对被打断，归零');
}

/* ============ 3 简答半对不算订正 ============ */
console.log('\n[3] 简答「部分正确」不算订正');
{
  const { api } = open([SINGLE, SHORT, CLEAN]);
  api.recordAnswer('h1', 'wrong');
  ok(inRange(api, 'wrong', 'h1'), '简答卷子错了一次');

  api.recordAnswer('h1', 'mid');
  ok(inRange(api, 'wrong', 'h1'), '要点没答全（mid）仍留在错题里，还得再看一遍');

  api.recordAnswer('h1', 'right');
  ok(!inRange(api, 'wrong', 'h1'), '全答对了才算订正');
}

/* ============ 4 没做错过的题不进错题范围 ============ */
console.log('\n[4] 一直答对的题从来不在错题里');
{
  const { api } = open([SINGLE, SHORT, CLEAN]);
  for (let i = 0; i < 4; i++) api.recordAnswer('c1', 'right');
  ok(!inRange(api, 'wrong', 'c1'), '没错过，不在错题范围');
  ok(api.getStat('c1').mastered === true, '连对 4 次且没错过 → 已掌握');
  ok(inRange(api, 'weak', 'c1') === false, '也不在「未掌握」里');
}

/* ============ 5 「已掌握」的严格口径没被改松 ============ */
console.log('\n[5] 「已掌握」仍然是连对 3 次 + 掌握度 90%');
{
  const { api } = open([SINGLE, SHORT, CLEAN]);
  api.recordAnswer('s1', 'wrong');
  for (let i = 0; i < 3; i++) api.recordAnswer('s1', 'right');
  const st = api.getStat('s1');
  ok(st.streak === 3, '连对 3 次');
  ok(st.mastered === false, '但掌握度被那次错误拖到 85%，还不算「已掌握」',
    { mastery: Math.round(st.mastery * 1000) / 1000, mastered: st.mastered });
  ok(!inRange(api, 'wrong', 's1'), '不过错题范围已经放它走了 —— 两件事分开算');
  ok(inRange(api, 'weak', 's1'), '它仍在「未掌握」里，因为掌握度确实还不够');
}

/* ============ 6 状态小标四种状态 ============ */
console.log('\n[6] 状态小标：错过 / 已订正 / 已掌握 / 待巩固');
{
  const { api } = open([SINGLE, SHORT, CLEAN]);

  api.recordAnswer('s1', 'wrong');
  ok(api.stPill(api.getStat('s1')).txt === '错过', '做错还没订正 → 错过');

  api.recordAnswer('s1', 'right');
  const p = api.stPill(api.getStat('s1'));
  ok(p.txt === '已订正', '订正了但还不够扎实 → 已订正', p);
  ok(p.cls !== 'err', '不再是红色错误态', p.cls);

  for (let i = 0; i < 10; i++) api.recordAnswer('s1', 'right');
  ok(api.stPill(api.getStat('s1')).txt === '已掌握', '连对够多、掌握度够高 → 已掌握');

  ok(api.stPill(api.getStat('c1')).txt === '待巩固', '没记录过 → 待巩固');
}

/* ============ 7 错题本的「只看错题」同一口径 ============ */
console.log('\n[7] 错题本页面跟着一起变');
{
  const { api, d } = open([SINGLE, SHORT, CLEAN]);
  api.recordAnswer('s1', 'wrong');
  api.recordAnswer('s1', 'right');   // 订正
  api.recordAnswer('h1', 'wrong');   // 还错着

  d.querySelector('[data-view="wrong"]').click();
  const list = d.querySelector('#wrongList');
  const txt = list ? list.textContent : '';
  ok(txt.indexOf('药物治疗的核心问题是') < 0, '订正过的那道题不在「只看错题」列表里', txt.slice(0, 80));
  ok(txt.indexOf('合理用药的原则') >= 0, '还错着的那道在列表里');
}

/* ============ 8 背知识点的范围也同一口径 ============ */
console.log('\n[8] 背知识点选「错题」拿到的题跟着变');
{
  const { api, d } = open([SINGLE, SHORT, CLEAN]);
  api.recordAnswer('s1', 'wrong');
  api.recordAnswer('s1', 'right');
  api.recordAnswer('h1', 'wrong');

  d.querySelector('#rRange').value = 'wrong';
  d.querySelector('#reciteStartBtn').click();
  const st = api.state ? api.state() : null;
  const ids = (st && st.recite && st.recite.list ? st.recite.list : []).map(function (q) { return q.id; });
  ok(ids.indexOf('s1') < 0, '订正过的 s1 没被抽进来', ids);
  ok(ids.indexOf('h1') >= 0, '还错着的 h1 抽进来了', ids);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
