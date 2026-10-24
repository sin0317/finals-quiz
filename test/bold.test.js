'use strict';
/* 加粗标记 + 「识别不出就转填空，别跳过」
   运行： NODE_PATH=<workspace>/node_modules node test/bold.test.js            */

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

function boot() {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.prompt = function (m, d) { return d; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  return win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
}
const api = boot();

const BAD = /[\u0001\u0002*＊]/;
function noMark(s) { return !BAD.test(String(s)); }
function qs(text) { return api.buildFromNote(text); }

console.log('[1] 加粗标记（**重点** / *重点*）：');
{
  const a = qs('所选药物对患者具备**安全、有效、经济、适当**四个要素');
  ok(a.length === 1, '双星号能出题', a.length);
  // 规矩变了：笔记提炼出来的题不再自己配干扰项凑选择题，并列内容按多个答案的填空考
  ok(a[0].type === 'fill', '并列内容出成填空（不自己造选择题）', a[0].type);
  ok(a[0].opts.length === 0, '不给自己造干扰项', a[0].opts);
  ok(JSON.stringify(a[0].answer) === JSON.stringify(['安全', '有效', '经济', '适当']),
    '加粗里的四项都是答案', a[0].answer);
  ok(a[0].stem === '所选药物对患者具备____四个要素', '题干不残留星号', a[0].stem);
  ok(noMark(a[0].stem) && (a[0].opts || []).every(noMark), '题干和选项都干净');

  const b = qs('所选药物对患者具备*安全、有效、经济、适当*四个要素');
  ok(b.length === 1 && b[0].stem === a[0].stem, '单星号和双星号结果一致', b.length && b[0].stem);

  const c = qs('治疗方案的制定应遵循**安全、有效**的原则。');
  ok(c.length === 1 && c[0].stem === '治疗方案的制定应遵循____的原则', '句尾加粗也能挖', c[0] && c[0].stem);

  const d = qs('药物不良反应包括**副作用、毒性反应、变态反应**三种。');
  ok(d.length === 1 && d[0].type === 'fill', '加粗 + 顿号 → 多答案填空', d[0] && d[0].type);
}

console.log('\n[2] 加粗顶在句首（以前会整个掉进兜底，答案还反了）：');
{
  const a = qs('**安全**是药物治疗的首要前提');
  ok(a.length === 1, '句首加粗照样出题', a.length);
  ok(a[0].stem === '____是药物治疗的首要前提', '空在句首而不是塞进题干', a[0] && a[0].stem);
  ok(String(a[0].answer) === '安全', '考的是加粗的词，不是后面的内容', a[0] && a[0].answer);

  const b = qs('**清除率**指单位时间内从体内清除的药物表观分布容积');
  ok(b.length === 1 && String(b[0].answer) === '清除率', '术语类句首加粗', b[0] && b[0].answer);
  ok(b.every(function (q) { return noMark(q.stem); }), '句首加粗不漏星号');
}

console.log('\n[3] 识别不出结构 → 转填空题，不许跳过：');
{
  // 动词表里没这个词，以前整句被丢
  const a = qs('由于单位时间内消除的药量(dC/dt)与体内浓度 C 的比值不变，又称之为恒比消除');
  ok(a.length === 1, '找不到谓语也能出题', a.length);
  ok(a[0].type === 'fill', '出的是填空题', a[0] && a[0].type);
  ok(String(a[0].answer) === '恒比消除', '引导词「又称之为」归到题干，答案干净', a[0] && a[0].answer);
  ok(a[0].stem.indexOf('又称之为') >= 0, '引导词留在题干里', a[0] && a[0].stem);

  // 引子太长（>30）以前整句被丢
  const b = qs('随机效应（random effects）：是导致药物代谢动力学特征随机变异性的一类未知的、难以预知与评估的效应，包括个体间和个体内变异');
  ok(b.length === 1, '引子再长也不丢句', b.length);
  ok(String(b[0].answer) === '个体间和个体内变异', '长句挖的是后半截', b[0] && b[0].answer);
  ok(b[0].stem.indexOf('包括____') >= 0, '题干保留到「包括」', b[0] && b[0].stem);

  const c = qs('清除率，是单位时间内机体清除药物的能力，受肝肾功能影响');
  ok(c.length >= 1, '逗号分句也能出题', c.length);
}

console.log('\n[4] 该跳过的照样跳过（不能为了不丢句就吐垃圾）：');
{
  ok(qs('A. 防止严重药害事件的发生、蔓延和重演').length === 0, '选项行不切碎片',
    qs('A. 防止严重药害事件的发生、蔓延和重演'));
  ok(qs('A、苯妥英钠 B、地高辛').length === 0, '两个选项挤一行也不切', qs('A、苯妥英钠 B、地高辛'));
  ok(qs('第十二章 临床给药方案的设计').length === 0, '章节标题不出题',
    qs('第十二章 临床给药方案的设计'));
  ok(qs('第十四章 常见症状与药物治疗').length === 0, '标题里的空格不算分隔',
    qs('第十四章 常见症状与药物治疗'));
  ok(qs('常用的给药方案设计方法有哪些').length === 0, '简答提纲不出题',
    qs('常用的给药方案设计方法有哪些'));
  ok(qs('单选题（每题 2 分）').length === 0, '卷面说明不出题');
}

console.log('\n[5] 答案后面跟年份的选择题（以前整题连同选项一起漏掉）：');
{
  const src = [
    '药物警戒的意义包括 （ ）ABCDE 2025',
    '',
    'A. 防止严重药害事件的发生、蔓延和重演；',
    'B. 促进新药的研发；',
    'C. 弥补药品上市前研究的不足，为上市后再评价提供服务；',
    'D. 为遴选、整顿和淘汰药品提供依据；',
    'E. 促进临床合理用药，为药物滥用、误用和不合理使用提供警戒。',
    ''
  ].join('\n');
  const r = api.parseBankQuestions(src);
  ok(r.questions.length === 1, '年份不再干扰识别', r.questions.length);
  if (r.questions.length) {
    const q = r.questions[0];
    ok(q.type === 'multi', '还原成多选题', q.type);
    ok(q.stem === '药物警戒的意义包括____', '题干收干净（空格一起吃掉）', q.stem);
    ok(q.answer.every(function (x) { return !/[；;]$/.test(x); }), '答案不带结尾分号', q.answer);
    ok(q.answer.length === 5, '五个选项都在', q.answer.length);
    ok(q.opts.length === 0, '没有把正确项当干扰项', q.opts);
  }
}

console.log('\n[6] 挖空只挖考点，后半句留在题干里（以前答案一路吃到句尾）：');
{
  const a = qs('适用于高血压患者，包括原发性高血压和继发性高血压，用药期间需监测血压。');
  ok(a.length === 1, '带后半句的句子照样出题', a.length);
  ok(/包括____，用药期间需监测血压$/.test(a[0].stem), '后半句留在题干里，题目是完整的', a[0] && a[0].stem);
  ok(String(a[0].answer) === '原发性高血压和继发性高血压', '答案只取考点本身', a[0] && a[0].answer);

  const b = qs('药物代谢的主要部位是肝脏，其次是胃肠道。');
  ok(/是肝脏，其次是____/.test(b[0].stem), '「是」后面的后半句也留在题干', b[0] && b[0].stem);
  ok(String(b[0].answer) === '胃肠道', '答案只挖最后一个考点', b[0] && b[0].answer);

  const c = qs('药物不良反应包括副作用、毒性反应、变态反应。');
  ok(c[0].type === 'fill' && c[0].answer.length === 3, '顿号并列 → 三个答案的填空', c[0] && c[0].answer);

  const d = qs('所选药物对患者具备**安全、有效、经济、适当**四个要素，需综合权衡。');
  ok(d[0].type === 'fill' && d[0].answer.length === 4, '加粗标好的范围不被截断', d[0] && d[0].answer);
  ok(/____四个要素，需综合权衡$/.test(d[0].stem), '加粗后面的尾巴也留在题干', d[0] && d[0].stem);
}

console.log('\n[7] 整本笔记回归（样本内联，不依赖外部文件）：');
{
  // 把难对付的写法攒在一本里：成型题库、选项行、章节标题、简答提纲、加粗
  const NOTEBOOK = [
    '第十二章 临床给药方案的设计',
    '',
    '单选题（每题 2 分）',
    '',
    '药物警戒的意义包括 （ ）ABCDE 2025',
    '',
    'A. 防止严重药害事件的发生、蔓延和重演；',
    'B. 促进新药的研发；',
    'C. 弥补药品上市前研究的不足，为上市后再评价提供服务；',
    'D. 为遴选、整顿和淘汰药品提供依据；',
    'E. 促进临床合理用药，为药物滥用、误用和不合理使用提供警戒。',
    '',
    '需要进行血药浓度监测的药物（ ）ABC',
    'A、苯妥英钠 B、地高辛',
    'C、氨茶碱 D、青霉素',
    '',
    '名词解释（每题 4 分）',
    '',
    '所选药物对患者具备**安全、有效、经济、适当**四个要素。',
    '',
    '由于单位时间内消除的药量(dC/dt)与体内浓度 C 的比值不变，又称之为恒比消除。',
    '',
    '简答题（每题 10 分）',
    '',
    '1. 简述药物治疗方案的制定步骤（10 分）',
    '①明确诊断（2 分）',
    ''
  ].join('\n');

  const list = qs(NOTEBOOK);
  let dirty = [], fragments = [];
  list.forEach(function (q) {
    if (!noMark(q.stem) || !noMark(String(q.answer)) || q.opts.some(function (o) { return !noMark(o); })) {
      dirty.push(q.stem);
    }
    if (/^[A-E]\s*[.、．]/.test(q.stem)) fragments.push(q.stem);
    if (/[（(]\s*[）)]/.test(String(q.answer))) fragments.push(q.stem);
  });
  ok(dirty.length === 0, '没有星号/控制字符漏进题目', dirty.slice(0, 3));
  ok(fragments.length === 0, '没有选项碎片和空括号残迹', fragments.slice(0, 3));
  ok(list.length >= 4, '该出的都出了', list.length);
  // 成型题库 + 名词解释两种路径都要覆盖到
  ok(list.some(function (q) { return q.type === 'multi'; }), '成型题库还原成多选题');
  ok(list.some(function (q) { return /药物警戒的意义包括/.test(q.stem); }), '带年份的题干没被漏掉');
  ok(list.some(function (q) { return /又称之为/.test(q.stem) && String(q.answer) === '恒比消除'; }),
    '散文长句走填空且答案干净');
  ok(list.some(function (q) { return /具备____四个要素/.test(q.stem); }), '加粗在整本笔记里也生效');
  ok(!list.some(function (q) { return /（10 分）|①明确诊断/.test(q.stem); }), '简答提纲没变成题');
  console.log('     （样本共 ' + list.length + ' 题）');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
