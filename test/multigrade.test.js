'use strict';
/* 「五个选项全勾上，还判错」（用户 2026-11-09 报的截图）
   运行： NODE_PATH=<workspace>/node_modules node test/multigrade.test.js

   题目：下列哪些是用药不适宜处方（　）
     A 遴选的药品不适宜的        B 药品剂型或给药途径不适宜的
     C 适应证不适宜的            D 用法、用量不适宜的
     E 无正当理由不首选国家基本药物的

   正确答案那串本身是「适应证不适宜的、遴选的药品不适宜的、…、用法、用量不适宜的、…」，
   按顿号一拆，「用法、用量不适宜的」变成「用法」+「用量不适宜的」两个碎片。
   选项文本跟哪个碎片都不一字不差 → 判分认为 D 没被选（红框），
   而正确答案拼出来又正好还是那五句话，看着就像「全选对了还判错」。

   现在的规矩：
     · 加载题集时按选项原文把碎片拼回去（mergeAnsByOpts / healChoiceAns）
     · 判分走 picksMatch（逐项配对 + optHit 容忍标点与解释尾巴），不再比字符串 */

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
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

const { api } = open();

/* 卷子原样：D 一条里自带顿号 */
const OPTS = [
  '遴选的药品不适宜的',
  '药品剂型或给药途径不适宜的',
  '适应证不适宜的',
  '用法、用量不适宜的',
  '无正当理由不首选国家基本药物的'
];
/* 老题库里存坏的样子：按顿号拆开 */
const SPLIT = [
  '适应证不适宜的', '遴选的药品不适宜的', '药品剂型或给药途径不适宜的',
  '用法', '用量不适宜的', '无正当理由不首选国家基本药物的'
];

console.log('\n[1] 拼回选项原文');
{
  const merged = api.mergeAnsByOpts(SPLIT, OPTS);
  ok(merged.length === 5, '6 个碎片拼回 5 项', merged);
  ok(merged.indexOf('用法、用量不适宜的') >= 0, '「用法」+「用量不适宜的」合成带顿号的那条', merged);
  ok(merged.indexOf('用法') < 0, '没有孤零零的「用法」', merged);
  ok(merged.every(function (t) { return OPTS.indexOf(t) >= 0; }), '每一项都对得上卷子原文', merged);
}

console.log('\n[2] 已经正常的答案不动它');
{
  const clean = OPTS.slice();
  ok(JSON.stringify(api.mergeAnsByOpts(clean, OPTS)) === JSON.stringify(clean), '五项本来就齐，原样返回');
  const one = ['适应证不适宜的'];
  ok(api.mergeAnsByOpts(one, OPTS).length === 1, '只有一项时不去凑');
  /* 单段自己能对上某个选项，就别拿它去跟下一段拼 */
  const mixed = ['用法、用量不适宜的', '无正当理由不首选国家基本药物的'];
  ok(JSON.stringify(api.mergeAnsByOpts(mixed, OPTS)) === JSON.stringify(mixed), '单段已命中就不合并');
}

console.log('\n[3] 三段拼一条（答案被拆得更碎）');
{
  const O2 = ['胃内PH值增高', '机体组织脂肪组织增加、肌肉组织和体内水分减少', '血浆白蛋白浓度增加'];
  const A2 = ['机体组织脂肪组织增加', '肌肉组织和体内水分减少'];
  const m = api.mergeAnsByOpts(A2, O2);
  ok(m.length === 1 && m[0] === O2[1], '两段拼回带顿号的那条', m);
}

console.log('\n[4] 判分：全选中就对');
{
  const pick = OPTS.slice();
  ok(api.picksMatch(pick, SPLIT, OPTS) === true, '五条全勾上 → 判对（以前判错）');
  ok(api.picksMatch(pick, api.mergeAnsByOpts(SPLIT, OPTS), OPTS) === true, '答案拼好之后也判对');
}

console.log('\n[5] 少选、多选都还是错');
{
  ok(api.picksMatch(OPTS.slice(0, 4), SPLIT, OPTS) === false, '漏了 E → 判错');
  ok(api.picksMatch(OPTS.concat(['随便编的一条']), SPLIT, OPTS) === false, '多勾一条 → 判错');
  ok(api.picksMatch([], SPLIT, OPTS) === false, '一条没勾 → 判错');
}

console.log('\n[6] 标点差异不算错');
{
  const O = ['适应症不适宜的；', '遴选的药品不适宜的；', '用法、用量不适宜的；'];
  const pick = ['适应症不适宜的', '遴选的药品不适宜的', '用法、用量不适宜的'];
  ok(api.picksMatch(pick, ['适应症不适宜的；', '遴选的药品不适宜的；', '用法、用量不适宜的；'], O) === true,
    '选项带分号、答案不带 → 还是判对');
}

console.log('\n[7] 答案带解释尾巴 / 只是被包住的两个选项');
{
  const O = ['剂量相关型不良反应', '剂量非相关型不良反应'];
  ok(api.picksMatch(['剂量相关型不良反应'], ['剂量相关型不良反应，为药理作用增强所致'], O) === true,
    '选项是答案的前半截 → 认作同一项');

  const O2 = ['清洁-污染手术', '污染手术'];
  ok(api.picksMatch(['清洁-污染手术'], ['污染手术'], O2) === false,
    '「污染手术」自己也是一条选项时，选了「清洁-污染手术」不算选中它');
}

console.log('\n[8] healChoiceAns 只碰多选 / 多选项的题');
{
  const q = { type: 'multi', opts: OPTS.slice(), answer: SPLIT.slice() };
  ok(api.healChoiceAns(q) === true, '拆碎的多选被修好');
  ok(q.answer.length === 5 && q.answer.indexOf('用法、用量不适宜的') >= 0, '答案落在选项原文上', q.answer);
  ok(api.healChoiceAns(q) === false, '再跑一遍不重复动（幂等）');

  const single = { type: 'single', opts: OPTS.slice(), answer: '用法、用量不适宜的' };
  ok(api.healChoiceAns(single) === false, '单选题不碰');

  const noOpts = { type: 'multi', answer: SPLIT.slice() };
  ok(api.healChoiceAns(noOpts) === false, '没有选项可对，不做猜测');
  ok(noOpts.answer.length === 6, '猜不出来就保留原样', noOpts.answer);
}

console.log('\n[9] 加载题集时自动修（applyAllFixes 带上 heal）');
{
  const S = api.state();
  S.banks = [{
    id: 'b1', name: '测试', questions: [
      { id: 'q1', type: 'multi', stem: '下列哪些是用药不适宜处方（　）', opts: OPTS.slice(), answer: SPLIT.slice() }
    ]
  }];
  api.applyAllFixes();
  const q = S.banks[0].questions[0];
  ok(q.answer.length === 5, '打开题集就修成 5 项', q.answer);
  ok(api.choiceOptions(q, true).length === 5, '渲染仍是 5 个选项（不多出「用法」）', api.choiceOptions(q, true));
  ok(api.picksMatch(OPTS.slice(), q.answer, api.choiceOptions(q, true)) === true, '全选中判对');
}

console.log('\n[10] 真机流程：老题库直接开刷，五个都点，交卷');
{
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  win.localStorage.setItem('fq_banks_v1', JSON.stringify([{
    id: 'b1', course: '临床药物治疗学概论', createdAt: 1, questions: [
      {
        id: 'q1', type: 'multi', optsSrc: 'paper', chapter: '一',
        stem: '下列哪些是用药不适宜处方（　）', opts: OPTS.slice(), answer: SPLIT.slice(),
        source: '用药不适宜处方：适应症不适宜、遴选药品不适宜等', order: 0
      }
    ]
  }]));
  win.eval('(function(){' + APP_SRC + ';})()');
  const d = win.document;

  d.querySelector('.tab[data-view="quiz"]').click();
  if (d.querySelector('#qOrder')) d.querySelector('#qOrder').value = 'seq';
  /* 「一路推新题」v1.21.14 起从下拉撤掉了；这里要「同组内不重复」，把选项临时塞回去 */
  if (d.querySelector('#qMode')) {
    const om = d.createElement('option');
    om.value = 'new'; om.textContent = 'new';
    d.querySelector('#qMode').appendChild(om);
    d.querySelector('#qMode').value = 'new';
  }
  d.querySelector('#qCount').value = '1';
  d.querySelector('#quizStartBtn').click();

  const opts = Array.from(d.querySelectorAll('#optsBox .opt'));
  ok(opts.length === 5, '答题页 5 个选项（不是 6 个）', opts.length);
  opts.forEach(function (b) { b.click(); });
  d.querySelector('#multiSubmit').click();

  const right = d.querySelectorAll('#optsBox .opt.right').length;
  const wrong = d.querySelectorAll('#optsBox .opt.wrong').length;
  const fb = (d.querySelector('#quizFb').textContent || '').replace(/\s+/g, ' ');
  ok(right === 5, '五个选项全标绿', right);
  ok(wrong === 0, '没有一个被标红', wrong);
  ok(fb.indexOf('答对了') >= 0, '判定为答对（以前判错）', fb.slice(0, 60));
  ok(fb.indexOf('用法、用量不适宜的') >= 0, '正确答案里那条仍是一条', fb.slice(0, 120));
  const stat = win.FQInternals.getStat('q1');
  ok(stat.ok === 1 && stat.bad === 0, '统计记成答对一次', stat);
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
