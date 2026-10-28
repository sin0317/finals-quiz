'use strict';
/* 随机乱序 → 生的优先（加权随机）回归
   运行： NODE_PATH=<workspace>/node_modules node test/weighted.test.js

   用户报：「顺序选随机乱序，掌握度越低的越容易出现吧 —— 既然选了随机，
   肯定不希望遇见熟悉的题」。原来「随机乱序」是纯 Fisher–Yates，完全不看
   掌握度，会撞见刚做对的题。

   现在的规矩：
     · 随机仍是随机，但按权重抽：掌握度越低权重越高，越容易被排到前面
     · 不是死排序（那就成「只刷没掌握的」了），熟的也有机会，每回组合不一样
     · 全熟题也得能抽出题（常数项兜底）
     · 没练过（无统计）的题掌握度按 0 算，权重最高
     · 刷题和背知识点的「顺序」共用一个口径 */

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

function makeQs() {
  const qs = [];
  for (let i = 1; i <= 5; i++) qs.push({ id: 'f' + i, type: 'fill', stem: '生题' + i + '____', answer: 'x', opts: [], order: i });
  for (let i = 1; i <= 5; i++) qs.push({ id: 'c' + i, type: 'fill', stem: '熟题' + i + '____', answer: 'x', opts: [], order: 10 + i });
  return qs;
}

function open() {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }

  const qs = makeQs();
  win.localStorage.setItem('fq_banks_v1', JSON.stringify([{
    id: 'b_w', course: '加权随机', createdAt: 1, questions: qs
  }]));
  win.localStorage.setItem('fq_current_v1', 'b_w');

  // 熟题：掌握度 0.9；生题不写统计，掌握度按 0
  const stats = {};
  for (let i = 1; i <= 5; i++) stats['c' + i] = { ok: 9, bad: 1, streak: 9, mastery: 0.9, mastered: true, lastAt: 1 };
  win.localStorage.setItem('fq_stats_v1', JSON.stringify(stats));

  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, qs };
}

/* ============ 1 生的平均排名明显靠前 ============ */
console.log('\n[1] 掌握度低的题平均排位更靠前');
{
  const { api, qs } = open();
  const N = 2000;
  let sumF = 0, sumC = 0;
  for (let k = 0; k < N; k++) {
    const arr = api.weightedShuffle(qs);
    arr.forEach(function (q, idx) {
      if (q.id[0] === 'f') sumF += idx; else sumC += idx;
    });
  }
  const avgF = sumF / (N * 5), avgC = sumC / (N * 5);
  console.log('      avgF=' + avgF.toFixed(2) + '  avgC=' + avgC.toFixed(2) + '（纯随机两者都是 4.5）');
  ok(avgF < avgC, '生的平均位次早于熟的', { avgF: +avgF.toFixed(2), avgC: +avgC.toFixed(2) });
  ok(avgF < 3, '生的明显集中在前半（<3.0）', { avgF: +avgF.toFixed(2) });
  ok(avgC > 6, '熟的明显被挤到后半（>6.0）', { avgC: +avgC.toFixed(2) });
}

/* ============ 2 全熟题也能出题（兜底） ============ */
console.log('\n[2] 池子里全是熟题也不至于空手');
{
  const { api, qs } = open();
  const hot = qs.filter(function (q) { return q.id[0] === 'c'; });
  const r = api.weightedShuffle(hot);
  ok(r.length === hot.length, '长度不变');
  const ids = r.map(function (q) { return q.id; }).sort().join(',');
  ok(ids === 'c1,c2,c3,c4,c5', '五道都在，一道不少', ids);
}

/* ============ 3 抽题层：count 截断后生的优先进前 N ============ */
console.log('\n[3] 抽 3 道题，生的更容易进前 3');
{
  const { api } = open();
  let inTop = 0, trials = 2000;
  for (let k = 0; k < trials; k++) {
    const picked = api.pickQuestions({ range: 'all', type: 'all', count: 3, shuffle: true });
    picked.forEach(function (q) { if (q.id[0] === 'f') inTop++; });
  }
  const rate = inTop / trials;   // 每轮期望选中的「生题个数」均值
  console.log('      前 3 名里生题占比 = ' + (rate / 3 * 100).toFixed(1) + '%（纯随机约 50%）');
  ok(rate / 3 > 0.75, '生题明显主导前 3 名（>75%）', { 生题比例: +(rate / 3).toFixed(2) });
}

/* ============ 4 顺序=跟着笔记走 时绝不打乱 ============ */
console.log('\n[4] 「跟着笔记走」仍然按 order 原序');
{
  const { api } = open();
  const seq = api.pickQuestions({ range: 'all', type: 'all', count: 0, shuffle: false });
  const ids = seq.map(function (q) { return q.id; }).join(',');
  ok(ids === 'f1,f2,f3,f4,f5,c1,c2,c3,c4,c5', '原序不变', ids);
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
