'use strict';
/* 题库解析回归：把老师排好的成型题库还原成单选、多选
   运行： NODE_PATH=<workspace>/node_modules node test/bank.test.js

   样本全部内联在下面（不依赖任何外部笔记文件）：
   别人拿到这个项目也能直接跑测试，不需要谁的个人资料。
   格式照抄真实笔记里那几种最难对付的写法：
   答案紧贴空括号 / 答案后跟年份 / 题目黏在一起 / 名词解释 / 简答提纲      */

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

/* ---------------- 样本：第五章式成型题库（答案紧贴空括号） ---------------- */
const BANK_CH5 = [
  '第五章 临床药物治疗学',
  '',
  '单选题（每题 2 分）',
  '',
  '疗效评价的首要内容是（ ）B',
  'A. 安全性 B. 有效性 C. 经济性 D. 适当性',
  '',
  '药物不良反应监测的意义在于（ ）A',
  'A. 及时发现新的不良反应 B. 降低药品价格 C. 缩短疗程 D. 提高依从性',
  '',
  '急诊处方一般不得超过（ ）日用量 A',
  'A.3 B. 7 C. 4 周 D.12 周',
  '',
  '下列哪个药物需要开展治疗药物监测（ ）C',
  'A. 阿莫西林 B. 对乙酰氨基酚 C. 他克莫司 D. 维生素 C',
  '',
  '药品不良反应是指（ ）D',
  'A. 假药引起的有害反应 B. 劣药引起的有害反应',
  'C. 超剂量引起的有害反应 D. 合格药品正常用法用量下出现的有害反应',
  '',
  '影响药物作用的机体因素包括（ ）A',
  'A. 年龄与性别 B. 药品包装 C. 药品价格 D. 给药途径的颜色',
  '',
  '药物相互作用最常发生的环节是（ ）B',
  'A. 吸收环节 B. 代谢环节 C. 包装环节 D. 运输环节',
  '',
  '多选题（每题 2 分）',
  '',
  '合理用药的基本原则包括（ ）ABCD',
  'A. 安全 B. 有效 C. 经济 D. 适当',
  '',
  '药物治疗方案制定的步骤包括（ ）ABC 2025',
  'A. 明确诊断 B. 确定治疗目标 C. 选择药物 D. 停止随访',
  '',
  '药物警戒的意义包括（ ）ABCDE 2025',
  'A. 防止严重药害事件的发生、蔓延和重演；',
  'B. 促进新药的研发；',
  'C. 弥补药品上市前研究的不足，为上市后再评价提供服务；',
  'D. 为遴选、整顿和淘汰药品提供依据；',
  'E. 促进临床合理用药，为药物滥用、误用和不合理使用提供警戒。',
  '',
  '影响药物用药安全的因素包括（ ）BCD',
  'A. 患者依从性 B. 假劣药品 C. 药品不良反应/事件 D. 药物治疗错误',
  '',
  '需要进行血药浓度监测的药物有（ ）ABC',
  'A、苯妥英钠 B、地高辛',
  'C、氨茶碱 D、青霉素',
  '',
  '药物不良反应的分类包括（ ）ABCD',
  'A. A 型不良反应 B. B 型不良反应',
  'C. C 型不良反应 D. D 型不良反应',
  '',
  '药物代谢动力学参数包括（ ）ABC',
  'A. 清除率 B. 表观分布容积',
  'C. 半衰期 D. 药品有效期',
  ''
].join('\n');

/* ---------------- 样本：题目黏在一起（手抄笔记常见） ---------------- */
const BANK_GLUE = [
  '第十二章 围手术期用药',
  '',
  '单选题（每题 2 分）',
  '',
  '预防性应用抗菌药物的时机是（ ）A',
  'A. 术前 0.5-1 小时 B. 术前 1 天 C. 术后 3 天 D. 术中任意时刻2. 肌肉注射给药的时间是（ ）B',
  'A. 进手术室前 10 分 B. 进手术室前 30-60 分 C. 术后立即 D. 术前 1 周',
  '',
  '手术部位感染最常见的病原菌是（ ）C',
  'A. 病毒 B. 真菌 C. 金黄色葡萄球菌 D. 支原体',
  ''
].join('\n');

/* ---------------- 样本：名词解释（散文，没有选项） ---------------- */
const NOTE_TERMS = [
  '名词解释（每题 4 分）',
  '',
  '清除半衰期：指血浆药物浓度下降一半所需要的时间。',
  '',
  '生物利用度：指药物被吸收进入体循环的速度和程度。',
  '',
  '治疗药物监测：指在药代动力学原理指导下，测定血液中药物浓度。',
  '',
  '简答题（每题 10 分）',
  '',
  '1. 简述药物治疗方案的制定步骤（10 分）',
  '①明确诊断（2 分）',
  '②确定治疗目标（2 分）',
  '③选择药物（2 分）',
  ''
].join('\n');

const DOCS = [
  { name: '成型题库（单选+多选）', text: BANK_CH5 },
  { name: '黏连题', text: BANK_GLUE },
  { name: '名词解释与简答', text: NOTE_TERMS }
];

console.log('题库还原（' + DOCS.length + ' 份样本）：');
let totalQ = 0, totalChoice = 0, bad = [];
DOCS.forEach((d) => {
  const qs = api.buildFromNote(d.text);
  const choice = qs.filter((q) => q.type === 'single' || q.type === 'multi');
  totalQ += qs.length;
  totalChoice += choice.length;
  console.log('  · ' + d.name + ' → ' + qs.length + ' 题（选择 ' + choice.length + '）');
  qs.forEach((q) => {
    if (!q.stem || q.stem.length < 4) bad.push(d.name + ' 题干过短: ' + q.stem);
    if (/单选题|多选题|名词解释|简答题/.test(q.stem)) bad.push(d.name + ' 题干混入小节标题: ' + q.stem);
    if (/单选题|多选题/.test((q.opts || []).join('|'))) bad.push(d.name + ' 选项混入小节标题: ' + q.stem);
    if (/（\s*\d+(\.\d+)?\s*分\s*）/.test(q.stem)) bad.push(d.name + ' 评分点被当成题干: ' + q.stem);
    if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(q.stem)) bad.push(d.name + ' 提纲条目被当成题干: ' + q.stem);
    if (q.type === 'multi' && !Array.isArray(q.answer)) bad.push(d.name + ' 多选答案不是数组: ' + q.stem);
    if (q.type === 'single' && Array.isArray(q.answer)) bad.push(d.name + ' 单选答案是数组: ' + q.stem);
  });
});
ok(bad.length === 0, '题库解析没有产生脏数据', bad.slice(0, 4));
ok(totalChoice >= 15, '样本里还原出 ' + totalChoice + ' 道选择题（原题库保真）', totalChoice);

console.log('\n逐项核对（答案紧贴空括号）：');
(function () {
  const qs = api.buildFromNote(BANK_CH5);
  const single = qs.filter((q) => q.type === 'single');
  const multi = qs.filter((q) => q.type === 'multi');
  ok(single.length === 7, '7 道单选全部还原', single.length);
  ok(multi.length === 7, '7 道多选全部还原', multi.length);

  const q = single.filter((x) => /疗效评价的首要内容/.test(x.stem))[0];
  ok(!!q, '题干保留了空括号位置', q && q.stem);
  ok(q && q.answer === '有效性', '单选答案取到正确选项原文', q && q.answer);
  ok(q && q.opts.indexOf('安全性') >= 0, '其余选项作为干扰项保留', q && q.opts);
  ok(q && q.stem.indexOf('____') >= 0, '空括号换成了 ____', q && q.stem);

  // 答案后跟年份也不能漏
  const y = multi.filter((x) => /药物警戒的意义包括/.test(x.stem))[0];
  ok(!!y, '答案后跟年份的多选题没被漏掉', y && y.stem);
  ok(y && y.answer.length === 5, '五个选项都在', y && y.answer);
  ok(y && y.answer.every((a) => !/[；;]$/.test(a)), '答案不带原文结尾的分号', y && y.answer);

  // 答案跨行、选项用顿号分隔
  const m2 = multi.filter((x) => /血药浓度监测的药物/.test(x.stem))[0];
  ok(m2 && m2.answer.length === 3, '选项跨行且用顿号分隔也能还原', m2 && m2.answer);
  ok(m2 && m2.answer[0] === '苯妥英钠', '顿号式选项的答案正确', m2 && m2.answer);
})();

console.log('\n逐项核对（题目黏在一起）：');
(function () {
  const qs = api.buildFromNote(BANK_GLUE);
  const single = qs.filter((q) => q.type === 'single');
  ok(single.length >= 3, '黏连段落里仍切出 ' + single.length + ' 道单选', single.length);
  ok(!qs.some((q) => /\d\.肌肉注射/.test((q.opts || []).join('|'))), '选项里没有吞进下一题题干');
  const q2 = single.filter((x) => /肌肉注射给药的时间/.test(x.stem))[0];
  ok(q2 && q2.answer === '进手术室前 30-60 分', '黏连题的答案没串行', q2 && q2.answer);
})();

console.log('\n逐项核对（名词解释与简答）：');
(function () {
  const qs = api.buildFromNote(NOTE_TERMS);
  ok(qs.length > 0, '纯名词解释文档提炼出 ' + qs.length + ' 道题');
  ok(qs.some((q) => /清除半衰期/.test(q.stem)), '「清除半衰期：…」被识别成题');
  ok(!qs.some((q) => /（\s*\d+\s*分\s*）/.test(q.stem)), '简答评分点没有被当成题干');
  ok(!qs.some((q) => /^[①②③]/.test(q.stem)), '简答提纲条目没有被当成题干');
})();

console.log('\n纯散文笔记：');
(function () {
  const plain = '林则徐是开眼看世界的第一人。\n辛亥革命推翻了清王朝的统治。';
  const qs = api.buildFromNote(plain);
  ok(qs.length === 2, '没有题库的散文笔记仍按原逻辑出题', qs.length);
  ok(qs.every((q) => q.type === 'fill'), '散文笔记按填空处理');
})();

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
