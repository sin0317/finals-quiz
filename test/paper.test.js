'use strict';
/* 原卷型笔记（分区标题 + 题干/选项分行的卷子）解析回归
   运行： NODE_PATH=<workspace>/node_modules node test/paper.test.js

   规则是用户拍的板：
     · 题型由分区决定：一、单选题 / 二、多选题 / 填空题 / 名词解释 / 简答题
     · 多选题没写正确项字母 = 全选
     · 名词解释：题干只留冒号前的名词，答案是整段解释，自己默写
     · 简答题：题干是标题，答案是下面那串要点，自己打字答要点
   样本全部内联，不依赖任何个人笔记文件。                                */

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
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  return win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
}
const api = boot();

/* ---------------- 样本：一份完整的原卷 ---------------- */
const PAPER = [
  '一、单选题（2 题）',
  '药物治疗的前提是安全性',
  '0.9% 氯化钠注射液可以和头孢曲松配伍',
  '二、多选题（3 题）',
  '下列属于妊娠期用药基本原则的是',
  'A 有明确的用药指征',
  'B 应用疗效肯定、不良反应小且已清楚的药物，避免使用尚未确定不良反应的新药',
  'C 小剂量有效避免大剂量，单药有效避免联合用药',
  'D 用药前明确妊娠周数，妊娠头 3 个月尽量避免用药',
  'E 应用可能对胎儿有影响的药物时，应权衡利弊后再决定',
  '下列属于摄取转运体的包括A OCT1　B NTCP　C OAT2　D MRP3',
  '下列属于外排转运体的包括',
  'A. P-gp',
  'B. BCRP',
  'C. MRP2',
  '三、填空题',
  '临床研究方法：原始研究和二次研究',
  '名词解释',
  '★药物警戒：药物警戒就是研究、收集、监测、发现和评价来自企业、医务人员和患者，关于草药、传统药品和辅助用药、生物制品、血液制品、疫苗以及医疗器械所致的各种不良事件信息的一门学科。',
  '★清除半衰期（t1/2）：指血液中药物浓度下降一半所需的时间。',
  '简答题',
  '★药物治疗方案制定的一般原则（10分）',
  '确定治疗目的选择合适药物；（2分）',
  '选择合适的用药时机（1分）',
  '选择合适的剂型和给药方案（2分）',
  '★哪些患者需要建立药历（10分）',
  '患有一种或多种慢性疾病的患者（2.5分）',
  '需要长期药物治疗的患者（2.5分）',
  '因特殊的病理生理状况需要调整给药剂量、给药途径的患者（2.5分）'
].join('\n');

const qs = api.buildFromNote(PAPER);
const byType = (t) => qs.filter((q) => q.type === t);

console.log('\n分区定题型：');
(function () {
  ok(byType('multi').length === 3, '多选题区出了 3 道多选', byType('multi').map((q) => q.stem));
  ok(byType('short').length === 2, '简答题区出了 2 道简答', byType('short').map((q) => q.stem));
  const term = byType('term');
  ok(term.length === 2, '名词解释区出了 2 条名词解释', term.map((q) => q.stem));
})();

console.log('\n多选题没写正确项 = 全选：');
(function () {
  const q = byType('multi').filter((x) => /妊娠期用药基本原则/.test(x.stem))[0];
  ok(!!q, '题干识别正确', q && q.stem);
  ok(q && q.answer.length === 5, '五个选项全部算正确（全选）', q && q.answer);
  ok(q && q.answer[0] === '有明确的用药指征', '答案取的是选项原文，不是字母', q && q.answer[0]);
  ok(q && q.answer.every((a) => !/^[A-E]$/.test(a)), '答案里没有残留字母', q && q.answer);

  // 选项挤在同一行也要切得开
  const inline = byType('multi').filter((x) => /摄取转运体/.test(x.stem))[0];
  ok(inline && inline.answer.length === 4, '题干后面挤在一行的选项也切开了', inline && inline.answer);
  ok(inline && inline.answer.join('、') === 'OCT1、NTCP、OAT2、MRP3',
    '选项文本干净（没把「包括」吃进选项）', inline && inline.answer);
})();

console.log('\n名词解释：题干只留冒号前的名词：');
(function () {
  const q = byType('term').filter((x) => /药物警戒/.test(x.stem))[0];
  ok(!!q, '「药物警戒」被识别成名词解释', q && q.stem);
  ok(q && q.stem === '药物警戒', '题干就是那个名词，不带冒号和解释', q && q.stem);
  ok(q && /^是研究、收集、监测、发现和评价/.test(q.answer),
    '答案是被解释的内容（剥掉了重复的术语）', q && q.answer.slice(0, 20));
  ok(q && q.answer.length > 40, '整段解释都留着，没有截断', q && q.answer.length);

  const half = byType('term').filter((x) => /清除半衰期/.test(x.stem))[0];
  ok(half && half.stem === '清除半衰期', '题干里的括号别名去掉了', half && half.stem);
  ok(half && /^指血液中药物浓度下降一半所需的时间/.test(half.answer), '解释原样保留', half && half.answer);
})();

console.log('\n简答题：题干是标题，答案是要点：');
(function () {
  const q = byType('short').filter((x) => /一般原则/.test(x.stem))[0];
  ok(!!q, '简答题识别出来', q && q.stem);
  ok(q && q.stem === '药物治疗方案制定的一般原则', '题干只剩标题（分值、序号都清掉）', q && q.stem);
  ok(q && Array.isArray(q.answer) && q.answer.length === 3, '要点逐条收进答案', q && q.answer);
  ok(q && q.answer[0] === '确定治疗目的选择合适药物', '要点里的「（2分）」和分号都清掉了', q && q.answer[0]);

  const q2 = byType('short').filter((x) => /药历/.test(x.stem))[0];
  ok(q2 && q2.answer.length === 3, '第二道简答的要点也齐', q2 && q2.answer);
})();

console.log('\n简答要点不会被偷成名词解释：');
(function () {
  const NOTE = [
    '简答题',
    '★简述药源性疾病的防治措施（10分）',
    '（1）主观性资料（3分）：患者主诉；病史；药物过敏史',
    '（2）客观性资料（3分）：生命体征、临床各种生化检验值',
    '最终目的：通过对药品安全性监测，综合评价药物的风险与效益'
  ].join('\n');
  const r = api.buildFromNote(NOTE);
  const fake = r.filter((q) => q.type === 'term');
  ok(fake.length === 0, '「子标题：a；b；c」这种要点没被当成名词解释', fake.map((q) => q.stem));
  const s = r.filter((q) => q.type === 'short')[0];
  ok(s && s.answer.length >= 2, '它们还在简答的要点里', s && s.answer);
})();

console.log('\nB 卷漏写「名词解释」标题也能救回来：');
(function () {
  const NOTE = [
    '名词解释',
    'A卷',
    '★清除半衰期：指血液中药物浓度下降一半所需的时间。',
    '简答',
    '★药物治疗方案制定的一般原则（10分）',
    '确定治疗目的选择合适药物；（2分）',
    '选择合适的用药时机（1分）',
    'B卷',
    '1、处方：是指由注册的执业医师和执业助理医师在诊疗活动中为患者开具的、由药师审核调配的医疗文书。',
    '2、随机效应：是导致药物代谢动力学特征随机变异性的一类未知的、难以预知与评估的效应。',
    '简答',
    '1、常用的给药方案设计方法有哪些？（10分）',
    '根据半衰期设计给药方案（2.5分）',
    '根据有效血药浓度范围设计给药方案（2.5分）'
  ].join('\n');
  const r = api.buildFromNote(NOTE);
  const term = r.filter((q) => q.type === 'term').map((q) => q.stem);
  ok(term.indexOf('清除半衰期') >= 0, 'A 卷的名词解释在', term);
  ok(term.indexOf('处方') >= 0 && term.indexOf('随机效应') >= 0,
    'B 卷没写标题的名词解释也救回来了', term);
  const s = r.filter((q) => q.type === 'short');
  ok(s.length === 2, 'A 卷、B 卷的简答都出了', s.map((q) => q.stem));
})();

console.log('\n标准题库格式（空括号 + 答案字母）照旧原样还原：');
(function () {
  const NOTE = [
    '多选题',
    '合理用药的基本原则包括（ ）ABCD',
    'A. 安全 B. 有效 C. 经济 D. 适当',
    '需要进行血药浓度监测的药物有（ ）ABC',
    'A、苯妥英钠 B、地高辛 C、氨茶碱'
  ].join('\n');
  const r = api.buildFromNote(NOTE);
  const m = r.filter((q) => q.type === 'multi');
  ok(m.length === 2, '两道多选都在', m.map((q) => q.stem));
  ok(m[0] && m[0].answer.length === 4 && m[0].answer[0] === '安全',
    '答案按字母取，不是全选', m[0] && m[0].answer);
  ok(m[0] && (m[0].opts || []).length === 0, '四个选项全对时没有干扰项', m[0] && m[0].opts);
})();

console.log('\n手打题判分（简答按要点、名词解释按关键词）：');
(function () {
  const g1 = api.gradeTyped({ type: 'short', answer: ['安全性', '有效性', '经济性'] }, '安全性、有效性');
  ok(g1.hits.length === 2 && g1.level === 'mid', '答中两条算部分正确', g1.hits.length);

  const g2 = api.gradeTyped({ type: 'short', answer: ['确定治疗目的选择合适药物', '选择合适的用药时机'] },
    '确定治疗目的，选择合适药物；选择合适的用药时机');
  ok(g2.level === 'right', '要点都答到了算对', g2.level);

  const g3 = api.gradeTyped({ type: 'term', answer: '是研究、收集、监测、发现和评价各种不良事件信息的一门学科' },
    '是研究、收集、监测、发现和评价各种不良事件信息的一门学科');
  ok(g3.level === 'right', '名词解释默写对了算对', g3.level);

  const g4 = api.gradeTyped({ type: 'term', answer: '是研究、收集、监测、发现和评价各种不良事件信息的一门学科' }, '不知道');
  ok(g4.level === 'wrong', '乱写算错', g4.level);

  const g5 = api.gradeTyped({ type: 'term', answer: '是研究、收集、监测、发现和评价各种不良事件信息的一门学科' }, '');
  ok(g5.level === 'empty', '空着不算作答', g5.level);
})();

console.log('\n简答/名词解释一律手打，卡片标题和答案一起背：');
(function () {
  // 简答和名词解释在「全部给选项」模式下也不能变成选择题
  const form = api.decideForms
    ? api.decideForms([{ type: 'short' }, { type: 'term' }, { type: 'multi' }], 'choice')
    : null;
  ok(form === null || (form[0] === 'fill' && form[1] === 'fill' && form[2] === 'choice'),
    '「全部给选项」也不会给手打题塞选项', form);
})();

console.log('\n重复的名词解释只留一条：');
(function () {
  const NOTE = [
    '名词解释',
    '★药物警戒：药物警戒就是研究、收集、监测、发现和评价各种不良事件信息的一门学科。',
    '填空题',
    '药物警戒：药物警戒就是研究、收集、监测、发现和评价各种不良事件信息的一门学科。'
  ].join('\n');
  const r = api.buildFromNote(NOTE);
  const same = r.filter((q) => /药物警戒/.test(q.stem));
  ok(same.length === 1, '同一条名词解释不重复出题', same.length);
})();

console.log('\n题干不补多余的下划线：');
(function () {
  // 以前对每道题都补一个空，简答/名词解释的题干后面被填上答案，看着像题干的一部分
  const ui = boot();
  const html = ui.stemHtml
    ? ui.stemHtml({ type: 'short', stem: '药物治疗方案制定的一般原则' })
    : null;
  ok(html === null || html === '药物治疗方案制定的一般原则',
    '简答题干后面没有多余的下划线', html);

  const m = ui.stemHtml ? ui.stemHtml({ type: 'multi', stem: '下列属于妊娠期用药基本原则的是' }) : null;
  ok(m === null || m === '下列属于妊娠期用药基本原则的是', '多选题干后面没有多余的下划线', m);

  const f = ui.stemHtml ? ui.stemHtml({ type: 'fill', stem: '药物代谢的主要部位是____' }) : null;
  ok(f === null || f.indexOf('blank-mark') > 0, '填空题还是要画出那个空', f);
})();

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
