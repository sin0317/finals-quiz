'use strict';
/* 用户反馈的判分事故：答案「监督学习」，输入「无监督学习」，系统显示 ✅ 正确
   运行： NODE_PATH=<workspace>/node_modules node test/negate.test.js

   小黑盒上一位南理工的同学报了这条（BAD）。两个概念含义正相反，
   系统却给了满分，还同时显示正确答案 —— 照着错的记，越刷越错。

   根子在 gradeAnswer 的「包含就算对」：答案被包含在输入里、
   长度比 ≥0.6 就判 right。中文里「无 / 不 / 非 / 未」一个字就能把意思翻过来，
   长度只差 1，比值 0.8，稳稳过关。

   现在的规矩：
     · 差的字里有否定字（且差得不多，≤3 字）→ 一律判错，半分都不给
     · 但要认出「有监督学习 = 监督学习」这类同义说法，别把对的判成错的
     · 多选/要点匹配也走同一条判定（match 里先过 negFlip） */

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

function open() {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

const { api } = open();
const grade = api.gradeAnswer;

/* ============ 1 用户报的那一条 ============ */
console.log('\n[1] 答案「监督学习」，输入「无监督学习」');
{
  const g = grade('无监督学习', '监督学习');
  ok(g.level === 'wrong', '判错（以前是 ✅ 正确）', g.level);
  ok(g.neg === '无', '能指出差的是「无」，方便提示用户', g.neg);
  ok(g.hits.length === 0, '不给命中，免得统计里算成对', g.hits);

  const r = grade('监督学习', '监督学习');
  ok(r.level === 'right', '原样答对仍然是 right', r.level);
}

/* ============ 2 反过来也拦 ============ */
console.log('\n[2] 答案带否定字、用户漏写');
{
  ok(grade('监督学习', '无监督学习').level === 'wrong', '答案「无监督学习」，输入「监督学习」判错');
  ok(grade('能空腹服用', '不能空腹服用').level === 'wrong', '「不」也算：答案不能空腹，输入能空腹 → 错');
  ok(grade('不能空腹服用', '能空腹服用').level === 'wrong', '反过来同样判错');
  ok(grade('线性', '非线性').level === 'wrong', '「非」也算');
  ok(grade('非线性', '线性').level === 'wrong', '「非」反向同样判错');
  ok(grade('稳态血药浓度', '稳态血药浓度').level === 'right', '同样的答案不受影响');
}

/* ============ 3 同义说法别误伤 ============ */
console.log('\n[3] 同义写法不能误判成错');
{
  ok(grade('有监督学习', '监督学习').level === 'right', '「有监督学习」就是「监督学习」，判对');
  ok(grade('监督学习', '监督学习（有监督）').level === 'right', '答案括号里带别名，判对');
  ok(grade('半衰期', '血浆半衰期').level === 'right', '多说两个字「血浆」，仍然判对');
  ok(grade('不良反应', '药品不良反应').level === 'right', '「药品」不是否定字，判对');
  ok(grade('无标签数据', '标签数据').level === 'wrong', '但「无标签数据」和「标签数据」是两个概念，判错');
}

/* ============ 4 长句里带否定词的情况 ============ */
console.log('\n[4] 前后带上下文时也要拦得住');
{
  const g = grade('无监督学习是从无标签数据中发现结构的方法', '监督学习');
  ok(g.level !== 'right', '整句作答里答反了，不能算对', g.level);

  const g2 = grade('监督学习使用带标签数据训练模型', '监督学习');
  ok(g2.level === 'right', '整句作答且答对，照旧算对', g2.level);
}

/* ============ 5 多选/要点匹配同样过这道关 ============ */
console.log('\n[5] 多选答案里被否定的一项不算命中');
{
  const g = grade('无监督学习、强化学习', ['监督学习', '强化学习']);
  ok(g.level !== 'right', '「无监督学习」顶不了「监督学习」，不能判全对', g.level);
  ok(g.hits.length < 2, '最多只认「强化学习」一项', g.hits.map(function (h) { return h.raw; }));

  const g2 = grade('监督学习、强化学习', ['监督学习', '强化学习']);
  ok(g2.level === 'right', '两项都答对，仍然 right', g2.level);
}

/* ============ 6 边界：差得多就不当否定处理 ============ */
console.log('\n[6] 完全不同的答案还是走原来的路');
{
  const g = grade('强化学习', '监督学习');
  ok(g.level !== 'right', '答成另一个概念，不能判对', g.level);

  const g2 = grade('药物治疗的前提是安全性', '安全性');
  ok(g2.level === 'right', '把整句抄上来，仍然判对', g2.level);
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——');
process.exit(fail ? 1 : 0);
