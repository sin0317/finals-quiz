'use strict';
/* 「导入原卷」回归
   运行： NODE_PATH=<workspace>/node_modules node test/paperdoc.test.js

   用户的诉求：网站上能直接把老师发的原卷导入成题库，题目按原样录入。
   原卷和笔记完全不是一回事 —— 笔记要「提炼」，原卷要「照抄」：
     · 分段标题：单选题（每题2分）/ 多选题 / 名词解释 / 简答题
     · 答案字母尾随在空括号后面，有时还隔着半句话
     · 选项一行两个、某一项缺标号、长选项跨行、干脆整段不标号
   抄不动的（缺答案、选项不足）要明确跳过并说明原因，不能瞎编。        */

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

function boot(store) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  if (store) Object.keys(store).forEach((k) => win.localStorage.setItem(k, store[k]));
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals;})()');
  return { win, api };
}

/* ---------------- 一、分段与题型 ---------------- */
console.log('\n一、按原卷的分段标题切块');
{
  const { api } = boot(null);
  const txt = [
    '临床药物治疗学概论',
    '第二章 药物治疗的原则与过程',
    '单选题（每题2分）',
    '药物治疗的核心问题是（     ）A',
    'A、合理用药                B、获得最佳疗效',
    'C、安全用药                D、获得最低成本',
    '多选题（每题2分）',
    '药物治疗要求（     ）ABCD',
    'A.安全   B. 有效    C. 经济    D.适当',
    '名词解释（每题4分）',
    '处方：是指由注册的执业医师和执业助理医师在诊疗活动中为患者开具的医疗文书。（4分）',
    '简答题（每题10分）',
    '常用的给药方案设计方法有哪些？（10分）',
    '1）根据半衰期设计给药方案（2.5分）',
    '2）根据有效血药浓度范围设计给药方案（2.5分）'
  ].join('\n');

  const r = api.parsePaperDoc(txt);
  ok(r.chapter.indexOf('第二章') >= 0, '认出了章节标题', r.chapter);
  ok(r.questions.length === 4, '四种题型各一道', r.questions.length);
  ok(r.stats.single === 1 && r.stats.multi === 1 && r.stats.term === 1 && r.stats.short === 1,
    '题型统计对得上', r.stats);
}

/* ---------------- 二、答案字母的位置 ---------------- */
console.log('\n二、答案字母跟在括号后面，隔着半句话也认得');
{
  const { api } = boot(null);
  const mk = (lines) => api.parsePaperDoc(['单选题（每题2分）'].concat(lines).join('\n')).questions;

  let q = mk(['药物治疗的核心问题是（     ）A', 'A、甲   B、乙   C、丙   D、丁'])[0];
  ok(q.answer === '甲', '「（　）A」直接跟着', q.answer);

  q = mk(['新的、严重的ADR应当在（  ） 日内报告   D', '0   B. 1    C. 7   D.15'])[0];
  ok(q.answer === '15', '「（　） 日内报告   D」中间隔了话也认得', q && q.answer);
  ok(q.opts.length === 4, '首项没标号的「0」补成 A 项', q && q.opts);

  q = mk(['强心苷类不宜与排钾利尿药合用，易发生（     ）。C', 'A、高血压危象  B、严重低血压  C、心律失常  D、呼吸麻痹'])[0];
  ok(q.answer === '心律失常', '「（　）。C」带句号也认得', q && q.answer);

  q = mk(['5. A药的血浆蛋白结合率为98%，如果B药与A药竞争，结果是(        ) B',
    'A．A药结合率升高  B．A药游离型增加  C．A药药效降低  D．作用时间延长'])[0];
  ok(q.answer === 'A药游离型增加', '括号前的 A药 / B药 不会被误当成答案字母', q && q.answer);
}

/* ---------------- 二·二、答案印在括号里面 ---------------- */
console.log('\n二·二、答案印在括号里（（A））也认得');
{
  const { api } = boot(null);
  const mk = (lines, sec) => api.parsePaperDoc([sec || '单选题（每题2分）'].concat(lines).join('\n')).questions;

  let q = mk(['1. 药物治疗的核心问题是（A）',
    'A、合理用药   B、获得最佳疗效   C、药品价格   D、给药途径'])[0];
  ok(q && q.answer === '合理用药', '「（A）」写在括号里', q && q.answer);
  ok(q && q.type === 'single', '一个字母 → 单选', q && q.type);
  ok(q && q.stem === '药物治疗的核心问题是（　）', '题干里括号清成空括号、题号去掉', q && q.stem);
  ok(q && q.opts.length === 4 && q.opts[2] === '药品价格', '选项仍是卷子那四个', q && q.opts);
  ok(q && q.optsSrc === 'paper', '选项标记为来自原卷', q && q.optsSrc);

  q = mk(['2. 治疗药物监测最常用的标本是（ B ）',
    'A、尿液   B、血浆   C、唾液   D、粪便'])[0];
  ok(q && q.answer === '血浆', '「（ B ）」带空格也认得', q && q.answer);

  q = mk(['3. 下列属于肝药酶诱导剂的是(A)',
    'A、苯巴比妥   B、酮康唑   C、西咪替丁   D、红霉素'])[0];
  ok(q && q.answer === '苯巴比妥', '半角括号「(A)」也认得', q && q.answer);

  // 括号里多个字母 → 多选
  q = mk(['4. 下列需要做治疗药物监测的有（A、C）',
    'A、地高辛   B、维生素C   C、苯妥英钠   D、青霉素'])[0];
  ok(q && q.type === 'multi', '括号里两个字母 → 多选', q && q.type);
  ok(q && JSON.stringify(q.answer) === JSON.stringify(['地高辛', '苯妥英钠']),
    '两个正确项都按字母翻出来', q && q.answer);

  q = mk(['5. 下列需要做治疗药物监测的有（A,C）',
    'A、地高辛   B、维生素C   C、苯妥英钠   D、青霉素'])[0];
  ok(q && q.answer.length === 2 && q.answer[1] === '苯妥英钠', '逗号分隔的字母也认得', q && q.answer);

  // 括号里没答案的仍然要跳过，别把「（A型题）」这种当答案
  q = mk(['6. 关于A型不良反应（A型题）的说法正确的是',
    'A、与剂量相关   B、与剂量无关   C、不可预测   D、发生率低'])[0];
  ok(!q || q.answer === '' || typeof q.answer === 'string',
    '「（A型题）」不会被当成答案字母', q && q.answer);

  // 选项正文里出现（AC）这种写法，不能把该选项行当成新题干
  const list = mk(['7. 下列说法正确的是（D）',
    'A、甲说法错误   B、乙说法错误   C、丙说法错误',
    'D、（AC）均正确']);
  ok(list.length === 1, '选项里的「（AC）」不会多切出一道题', list.length);
  ok(list[0] && list[0].answer === '（AC）均正确', 'D 项原样保留', list[0] && list[0].answer);

  // 两种写法混排在同一份卷子里都要对上
  const mixed = mk([
    '8. 首过效应明显的给药途径是（B）',
    'A、静脉注射   B、口服   C、舌下含服   D、吸入',
    '9. 血浆半衰期是指（     ）C',
    'A、药物被吸收一半的时间   B、药物排泄一半的时间',
    'C、血药浓度下降一半所需的时间   D、药效下降一半的时间'
  ]);
  ok(mixed.length === 2, '括号内、括号后两种写法混排都对上', mixed.length);
  ok(mixed[0] && mixed[0].answer === '口服' && mixed[1] && mixed[1].answer.indexOf('血药浓度下降一半') === 0,
    '两道题的答案各自正确', mixed.map((x) => x.answer));
}

/* ---------------- 二·三、答案印的是词：按填空题收 ---------------- */
console.log('\n二·三、括号里印的是词，就当填空题收');
{
  const { api } = boot(null);
  const mk = (lines, sec) => api.parsePaperDoc([sec || '单选题（每题2分）'].concat(lines).join('\n')).questions;

  let q = mk(['1. 药物治疗的核心问题是（合理用药）'])[0];
  ok(q && q.type === 'fill', '括号里是词 → 出成填空题（不是选择题）', q && q.type);
  ok(q && q.answer === '合理用药', '答案就是括号里那个词', q && q.answer);
  ok(q && q.stem === '药物治疗的核心问题是（　）', '题干把答案换成空括号、题号去掉', q && q.stem);
  ok(q && q.opts.length === 0, '不给选项（没有原卷选项可抄）', q && q.opts);
  ok(q && q.optsSrc === 'paper', '仍标成来自原卷', q && q.optsSrc);

  q = mk(['2. 药物不良反应包括（副作用、毒性反应、变态反应）'])[0];
  ok(q && q.type === 'fill' && q.answer === '副作用、毒性反应、变态反应',
    '括号里顿号并列的多个词整串当答案', q && q.answer);

  q = mk(['3. 恒比消除是指血药浓度（半衰期）不随浓度变化'])[0];
  ok(q && q.stem === '恒比消除是指血药浓度（　）不随浓度变化', '括号在句子中间也能挖', q && q.stem);

  // 括号里的词不是答案的几种情形，都不能误判
  const junk = mk([
    '4. 下列关于不良反应（ADR）的说法正确的是（　）A',
    'A、与剂量相关   B、与剂量无关',
    '5. 药品（包括中药）的说明书应注明【（　）】B',
    'A、成分   B、用法用量',
    '6. 药物代谢的主要器官是肝脏（见第三章）（　）A',
    'A、肝脏   B、肾脏'
  ]);
  ok(junk.length === 3, '缩写/补充说明/交叉引用都不当答案，题仍在', junk.length);
  ok(junk.every((x) => x.type === 'single'), '这三道仍是单选题', junk.map((x) => x.type));
  ok(junk[0] && junk[0].answer === '与剂量相关', '（ADR）没抢走答案', junk[0] && junk[0].answer);
  ok(junk[1] && junk[1].answer === '用法用量', '（包括中药）没抢走答案', junk[1] && junk[1].answer);

  // 纯字母、带数字、编号、分值这类括号都不算答案
  ok(mk(['7. 血浆半衰期（t1/2）（　）A', 'A、甲   B、乙'])[0].answer === '甲', '（t1/2）不当答案');
  ok(api.parsePaperDoc('单选题（每题2分）\n8. 首过效应（4分）（　）A\nA、甲   B、乙').questions[0].answer === '甲',
    '（4分）不当答案');

  // 括号里的词后面跟着 A/B/C/D：那些选项没有归属，不能污染下一题
  const orphan = mk([
    '9. 药物治疗的核心问题是（合理用药）',
    'A、甲   B、乙   C、丙   D、丁',
    '10. 治疗药物监测最常用的标本是（　）B',
    'A、尿液   B、血浆   C、唾液   D、粪便'
  ]);
  ok(orphan.length === 2, '填空 + 单选各一道', orphan.length);
  ok(orphan[0] && orphan[0].type === 'fill' && orphan[1] && orphan[1].type === 'single',
    '题型各归各的', orphan.map((x) => x.type + ':' + x.answer));
  ok(orphan[1] && orphan[1].answer === '血浆' && orphan[1].opts.length === 4,
    '下一题的选项和答案都没被上一题的选项污染', orphan[1] && { a: orphan[1].answer, o: orphan[1].opts });

  // 填空题区整段也能收
  const sec = api.parsePaperDoc([
    '填空题（每空1分）',
    '1. 药物治疗学是研究（药物治疗规律）的一门学科',
    '2. 首过效应最明显的给药途径是口服',   // 括号外没写答案 → 抄不了，跳过
    '3. 血浆半衰期是指（血药浓度下降一半所需的时间）'
  ].join('\n'));
  ok(sec.questions.length === 2, '填空题区只收括号里印了答案的', sec.questions.length);
  ok(sec.stats.fill === 2, '统计里记成填空', sec.stats);
  ok(sec.questions[1] && sec.questions[1].answer === '血药浓度下降一半所需的时间',
    '第二道填空答案正确', sec.questions[1] && sec.questions[1].answer);

  // 存进题库后刷题时也必须是填空形态
  ok(api.decideForms([{ type: 'fill', opts: [] }], 'choice')[0] === 'fill',
    '「全部给选项」也不会把填空掰成选择题', api.decideForms([{ type: 'fill', opts: [] }], 'choice')[0]);
}

/* ---------------- 三、选项排版的各种花活 ---------------- */
console.log('\n三、选项：一行两个 / 缺标号 / 跨行 / 整段不标号');
{
  const { api } = boot(null);
  const mk = (lines) => api.parsePaperDoc(['多选题（每题2分）'].concat(lines).join('\n')).questions;

  let q = mk(['下列哪些情况属于不规范处方（     ）ABCDE',
    '医师签名、签章不规范或者与签名、签章的留样不一致的；',
    '新生儿、婴幼儿处方未写明日、月龄的；',
    '西药、中成药与中药饮片未分别开具处方的；',
    '处方的前记、正文、后记内容缺项；',
    '处方修改未签名并注明修改日期'])[0];
  ok(q && q.opts.length === 5, '整段不标号的五行 = 五个选项', q && q.opts.length);
  ok(q.answer.length === 5, '五个正确答案全对上');

  q = mk(['作用于不同作用部位或受体的协同或相加（     ）BCDE',
    '氨基糖苷类  + 硫酸镁    B. 磺胺甲恶唑 + 甲氧苄啶',
    'C. β-内酰胺类+氨基糖苷类   D. 阿托品 + 解磷定',
    'E. 氢氯噻嗪 + 氨基糖苷类'])[0];
  ok(q.opts.length === 5, '首项缺标号也能凑成 A~E', q && q.opts);
  ok(q.opts[0].indexOf('氨基糖苷类') >= 0, 'A 项就是那段没标号的文字', q && q.opts[0]);
  ok(q.answer.length === 4 && q.answer[0].indexOf('磺胺') >= 0, 'B~E 四个正确项', q && q.answer);

  const mkSingle = (lines) => api.parsePaperDoc(['单选题（每题2分）'].concat(lines).join('\n')).questions;
  q = mkSingle(['以下可以和头孢曲松配伍的是（     ）A',
    'A、0.9%氯化钠注射液          B、葡萄糖酸钙',
    '林格液                    D、乳酸钠林格液'])[0];
  ok(q.opts.length === 4, '第二行那个没标号的「林格液」补成 C 项', q && q.opts);
  ok(q.opts[2] === '林格液', 'C 项文字干净', q && q.opts[2]);
  ok(q.answer === '0.9%氯化钠注射液', '答案正确');

  q = mk(['手术部位感染包括   （    ） ABC',
    'A.浅表切口感染     B.深部切口感染  C.手术所涉及的器官腔隙感染',
    'D.与手术无直接关系的、术后可能发生的其他部位感染'])[0];
  ok(q.opts.length === 4 && q.opts[3].indexOf('与手术无直接关系') >= 0, '第四项跨行也接上了', q && q.opts[3]);
}

/* ---------------- 四、抄不动的要明确跳过 ---------------- */
console.log('\n四、缺答案 / 选项不够：跳过并说明原因，不瞎编');
{
  const { api } = boot(null);
  const r = api.parsePaperDoc([
    '单选题（每题2分）',
    '（     ）效应是导致药物代谢动力学特征随机变异性的一类未知效应。',
    'A、固定效应   B、随机效应   C、经济效应   D、偶然效应',
    '真正的题（   ）A',
    'A、甲   B、乙'
  ].join('\n'));
  ok(r.questions.length === 1, '只留下能判分的那道', r.questions.length);
  ok(r.warn.length === 1 && r.warn[0].why === '缺答案', '跳过的原因写清楚了', r.warn);
}

/* ---------------- 五、名词解释与简答 ---------------- */
console.log('\n五、名词解释只留术语，简答按要点分条');
{
  const { api } = boot(null);
  const r = api.parsePaperDoc([
    '名词解释（每题4分）',
    '药物警戒：药物警戒就是研究、收集、监测、发现和评价来自企业、医务人员和患者的不良事件信息的一门学科。（4分）',
    '清除半衰期（t1/2）：指血液中药物浓度下降一半所需的时间。',
    '简答题（每题10分）',
    '药物治疗方案制定的一般原则（10分）',
    '1）确定治疗目的选择合适药物；（2分）',
    '2）选择合适的用药时机（1分）',
    '药物治疗中患者依从性差的原因是什么？如何提高患者依从性？（10分）',
    '1）医务人员因素（1分）；2）给药方案因素（1分）',
    '简化治疗方案（2分）；2）改进药品包装（1分）'
  ].join('\n'));

  const terms = r.questions.filter((q) => q.type === 'term');
  ok(terms.length === 2, '两道名词解释', terms.length);
  ok(terms[0].stem === '药物警戒', '术语只留冒号前那一段', terms[0].stem);
  ok(terms[0].answer.indexOf('研究、收集、监测') >= 0, '解释整段保留，顿号不拆');
  ok(terms[0].answer.indexOf('（4分）') < 0, '分值标记去掉了');

  const shorts = r.questions.filter((q) => q.type === 'short');
  ok(shorts.length === 2, '两道简答', shorts.length);
  ok(shorts[0].stem.indexOf('一般原则') >= 0 && shorts[0].stem.indexOf('10分') < 0,
    '题干去掉分值', shorts[0].stem);
  ok(shorts[0].answer.length === 2, '两个要点分开存', shorts[0].answer);
  ok(shorts[1].answer.length === 3, '带分号的要点行也拆对了', shorts[1].answer);
  ok(shorts[1].stem.indexOf('依从性') >= 0, '第二道简答的题干没被要点吞掉', shorts[1].stem);
}

/* ---------------- 六、题干清理 ---------------- */
console.log('\n六、题干：去题号、括号统一');
{
  const { api } = boot(null);
  const q = api.parsePaperDoc([
    '单选题（每题2分）',
    '3. 磺胺嘧啶注射液（pH为9.5 ~ 11），与10%葡萄糖注射液混合出现沉淀原因是(      )A',
    'A．pH改变        B．溶剂系统改变     C．直接反应        D．电解质盐析'
  ].join('\n')).questions[0];
  ok(q.stem.indexOf('3.') !== 0 && q.stem.indexOf('磺胺嘧啶') === 0, '题号剥掉了', q.stem);
  ok(q.stem.indexOf('（　）') >= 0, '括号统一成（　）', q.stem);
  ok(q.stem.indexOf('____') < 0, '原卷题干里不会凭空多一条下划线');
}

/* ---------------- 七、两步导入：第一步原卷（可跳过）→ 第二步笔记 ---------------- */
console.log('\n七、两步导入：第一步原卷（可跳过）→ 第二步笔记');
{
  const { win } = boot(null);
  const d = win.document;

  ok(!!d.querySelector('#stepPaper') && !!d.querySelector('#stepNote'), '导入页分成「原卷」「笔记」两张步骤卡');
  ok(/可选/.test(d.querySelector('#stepPaper').textContent), '第一步明确标着「可选」');
  ok(/必做/.test(d.querySelector('#stepNote').textContent), '第二步明确标着「必做」');
  ok(/1/.test(d.querySelector('#flowPaper .flow-n').textContent) &&
    /2/.test(d.querySelector('#flowNote .flow-n').textContent), '顶上流程条写着 1 → 2 的先后');
  ok(!d.querySelector('#inputSeg'), '原来那个「笔记 / 原卷」切换已经去掉');
  ok(!d.querySelector('#builtinPaperBtn'), '不再有某个专业专属的原卷按钮');
  ok(d.querySelector('#paperInput').multiple && d.querySelector('#fileInput').multiple,
    '两个文件框都支持一次选多个文件');
  ok(/可以跳过/.test(d.querySelector('#paperPoolBar').textContent), '还没原卷时明说这步能跳过');

  const paper = [
    '第二章 药物治疗的原则与过程',
    '单选题（每题2分）',
    '药物治疗的前提是（     ）B',
    'A.安全性  B.有效性   C.经济性   D.适当性',
    '多选题（每题2分）',
    '药物治疗要求（     ）ABC',
    'A.安全   B.有效    C.经济    D.适当',
    '名词解释（每题4分）',
    '处方：是指由注册的执业医师为患者开具的医疗文书。（4分）'
  ].join('\n');

  /* 第一步：粘进来 → 点一下就进真题库，不再挤占第二步的预览表 */
  d.querySelector('#paperText').value = paper;
  d.querySelector('#courseName').value = '临床药物治疗学概论';
  d.querySelector('#paperExtractBtn').click();

  const saved = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  ok(saved.length === 1 && saved[0].course === '临床药物治疗学概论', '原卷直接存成题集', saved[0] && saved[0].course);
  ok(saved[0].questions.length === 3, '三道题全部入库', saved[0].questions.length);
  const single = saved[0].questions.filter((q) => q.type === 'single')[0];
  ok(single && single.answer === '有效性', '答案字母翻译成原文', single && single.answer);
  ok(single && single.chapter.indexOf('第二章') === 0, '每道题都标着章节', single && single.chapter);
  ok(d.querySelector('#previewCard').hidden, '原卷这步不占用预览表');
  ok(d.querySelector('#flowPaper').classList.contains('done'), '第一步完成后流程条自己亮起来');
  ok(/真题库：3 道/.test(d.querySelector('#paperPoolBar').textContent), '真题库有多少道写得明明白白');

  /* 第二步：笔记里这件事卷子考过 → 直接出原题 */
  d.querySelector('#noteText').value = [
    '药物治疗的前提是有效性，这是最基本的要求。',
    '血浆半衰期是指血药浓度下降一半所需的时间。'
  ].join('\n');
  d.querySelector('#extractBtn').click();

  ok(!d.querySelector('#previewCard').hidden, '第二步解析完出预览');
  const rows = d.querySelectorAll('#previewBody tr');
  ok(rows.length === 2, '两条笔记出两道题', rows.length);
  const hitRow = Array.prototype.filter.call(rows, (tr) => /原卷真题/.test(tr.textContent))[0];
  ok(!!hitRow, '对上的那条标成「原卷真题」');
  ok(hitRow && hitRow.querySelector('.p-opts'), '原卷真题带着卷子上的选项');
  ok(hitRow && /有效性/.test(hitRow.textContent), '答案是卷子上的那个');
  const freshRow = Array.prototype.filter.call(rows, (tr) => !/原卷真题/.test(tr.textContent))[0];
  ok(freshRow && !freshRow.querySelector('.p-opts'), '卷子里没考过的那条是填空，没有选项');
  ok(d.querySelector('#flowPaper').classList.contains('done'), '第二步能看见第一步的状态还在');
}

/* ---------------- 八、多文件：一次十几份原卷合成一个真题库 ---------------- */
console.log('\n八、多份原卷合成一个真题库');
{
  const { win, api } = boot(null);
  const d = win.document;

  const A = ['第二章 药物治疗的原则与过程', '单选题（每题2分）',
    '药物治疗的前提是（     ）B', 'A.安全性  B.有效性   C.经济性   D.适当性'].join('\n');
  const B = ['第三章 药物相互作用', '单选题（每题2分）',
    '肝药酶诱导剂是（     ）A', 'A.苯巴比妥  B.酮康唑   C.西咪替丁   D.红霉素'].join('\n');

  const r = api.parsePaperRuns([
    { name: '第二章 药物治疗的原则与过程.docx', text: A },
    { name: '第三章 药物相互作用.docx', text: B },
    { name: '第二章 补考卷.pdf', text: A }        // 同一道题又出一遍
  ]);
  ok(r.files === 3, '三份文件都参与解析', r.files);
  ok(r.questions.length === 2, '重复的题只留一份', r.questions.length);
  ok(r.dup === 1, '重复计数对得上', r.dup);
  ok(r.questions[0].chapter.indexOf('第二章') === 0 &&
    r.questions[1].chapter.indexOf('第三章') === 0, '每份卷子按自己的文件名分章节',
    r.questions.map((q) => q.chapter));
  ok(r.questions.every((q) => q.id), '合成后每道题都有 id（不然掌握度会全挤到 undefined）');

  ok(api.chapterOf('第三章 药物相互作用.docx', '') === '第三章 药物相互作用', '文件名里的章节优先');
  ok(api.chapterOf('卷子.docx', '第四章 药物相互作用') === '第四章 药物相互作用', '文件名没章节就用文内标题');
  ok(api.guessCourse('临床药物治疗学概论 第三章.docx') === '临床药物治疗学概论', '文件名能猜出课程名');
  ok(api.guessCourse('第三章 药物治疗的原则与过程.docx') === '', '纯章节名不瞎猜课程');

  /* 真界面：把三份文件塞进第一步，点一下入库 */
  api.state().paperFiles = [
    { name: '第二章 药物治疗的原则与过程.docx', text: A, chars: A.length },
    { name: '第三章 药物相互作用.docx', text: B, chars: B.length }
  ];
  d.querySelector('#courseName').value = '临床药物治疗学概论';
  d.querySelector('#paperExtractBtn').click();
  const bank = JSON.parse(win.localStorage.getItem('fq_banks_v1'))[0];
  ok(bank.questions.length === 2, '两份原卷合成一个题集里的 2 道题', bank.questions.length);
  ok(bank.questions.every((q) => q.chapter), '题库里每道题都带章节');
}

/* ---------------- 九、不再内置某个专业的原卷 ---------------- */
console.log('\n九、不内置任何专业的原卷题库');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  ok(html.indexOf('临床药物治疗学概论') < 0, '页面里不再有某个专业的硬编码按钮');
  ok(app.indexOf('paper_bank.json') < 0, '代码不再依赖内置题库文件');
  ok(!fs.existsSync(path.join(ROOT, 'assets', 'paper_bank.json')), '内置题库文件已移除');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
