'use strict';
/* 导入账单 + 手动加题
   运行： NODE_PATH=<workspace>/node_modules node test/importreport.test.js

   用户的原话：
     「导入笔记之后，我不知道有多少条成功了、多少条没成功，
       所以我也没办法去针对性地改题、添加题；
       应当开放用户自己添加题目进入题集，不通过导入笔记也可以。」

   守的几条线：
     · 每份文件单独记账：多少句 → 出几道，跳过几句
     · 每一句没出成的原因要说得出来（太短 / 选项行 / 切不出空 …）
     · 没出成题的句子能在页面上看到原文，并且一键塞进加题框
     · 手动加题：不导入笔记也能建题集；填空 / 单选 / 多选 / 名词解释 / 简答都能加
     · 单选题答案是字母时按选项顺序换成原文；只有一个选项不许存
     · 题集里已有的题不加第二遍                                            */

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

function openWin(seed) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  if (seed) Object.keys(seed).forEach(function (k) { win.localStorage.setItem(k, seed[k]); });
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}
const $ = (d, s) => d.querySelector(s);
const $$ = (d, s) => Array.prototype.slice.call(d.querySelectorAll(s));
function txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }
function toastOf(d) { return txt($(d, '#toast')); }
function bankList(win) { return JSON.parse(win.localStorage.getItem('fq_banks_v1') || '[]'); }

const NOTE_GOOD = [
  '药物治疗的前提是有效性。',
  '首过效应最明显的给药途径是口服。',
  '药物不良反应包括副作用、毒性反应、变态反应。'
].join('\n');

/* 一句判断词都没有、也没有冒号的散文：一定会被跳过 */
/* 一句 100 多字、没有标点也没有判断词的长句：一定被判「太长」而跳过 */
const NOTE_BAD = '这是一段没有判断词也没有冒号的长句子'.repeat(6);

/* ---------------- 一、提炼过程会把「哪句没成 + 为什么」记下来 ---------------- */
console.log('\n一、每句没出成题的原文和原因都要记下来');
{
  const { api } = openWin();
  const sink = [];
  api.extractPoints('药物治疗的前提是有效性。短。\nA、合理用药　　B、获得最佳疗效', sink);
  ok(sink.length >= 2, '跳过两句以上就记两条以上', sink.length);
  ok(sink.some(function (x) { return /太短/.test(x.why); }), '「短。」被判太短', sink);
  ok(sink.some(function (x) { return /选项行/.test(x.why); }), '「A、…B、…」被判成选项行', sink);
  ok(sink.every(function (x) { return x.text && x.why; }), '每条都有原文和原因');

  const sink2 = [];
  const qs = api.buildFromNote(NOTE_GOOD, { drops: sink2, sameDup: 0 });
  ok(qs.length === 3, '能出题的三句照旧出三道', qs.length);
  ok(sink2.length === 0, '都出成了就不用记', sink2);
}

/* ---------------- 二、每份文件单独记账 ---------------- */
console.log('\n二、doExtractNote 一份文件一份账');
{
  const { win, api } = openWin();
  const st = api.state();
  st.noteFiles = [
    { name: '第三章.md', text: NOTE_GOOD, chars: NOTE_GOOD.length },
    { name: '第四章.md', text: NOTE_BAD, chars: NOTE_BAD.length }
  ];
  const r = api.doExtractNote(true);
  ok(r === true, '提炼跑通了');
  const rep = st.report;
  ok(rep && rep.files.length === 2, '两份文件各一条账', rep && rep.files.length);
  ok(rep.files[0].name === '第三章.md' && rep.files[1].name === '第四章.md', '账上有文件名');
  ok(rep.files[0].made === 3, '第三章出了 3 道', rep.files[0].made);
  ok(rep.files[0].drops.length === 0, '第三章没跳过');
  ok(rep.files[1].made === 0, '第四章一道没出', rep.files[1].made);
  ok(rep.files[1].drops.length === 1, '第四章那句被记进账单', rep.files[1].drops);
  ok(/切不出|太长|太短/.test(rep.files[1].drops[0].why), '原因说得出来', rep.files[1].drops[0].why);

  const tot = api.reportTotal(rep);
  ok(tot.files === 2 && tot.made === 3 && tot.drops === 1, '汇总：2 份 / 3 道 / 跳过 1 句', tot);
}

/* ---------------- 三、账单摆到页面上，能一键塞进加题框 ---------------- */
console.log('\n三、页面上能看见哪句没成，并一键拿去加题');
{
  const { win, api, d } = openWin();
  const st = api.state();
  st.noteFiles = [
    { name: '第三章.md', text: NOTE_GOOD, chars: NOTE_GOOD.length },
    { name: '第四章.md', text: NOTE_BAD, chars: NOTE_BAD.length }
  ];
  api.doExtractNote(true);

  ok($(d, '#reportCard') && !$(d, '#reportCard').hidden, '账单卡片露出来了');
  const sum = txt($(d, '#reportBody .rp-sum'));
  ok(sum.indexOf('2 份笔记') >= 0, '汇总里有份数', sum);
  ok(sum.indexOf('3') >= 0 && /出题/.test(sum), '汇总里有出题数', sum);
  ok(/跳过/.test(sum), '汇总里说了跳过几句', sum);

  const files = $$(d, '#reportBody .rp-file');
  ok(files.length === 2, '两份文件两个折叠块', files.length);
  ok(txt(files[1]).indexOf('第四章.md') >= 0, '第二块是第四章', txt(files[1]));
  ok(/跳过 1 句/.test(txt(files[1])), '第二块标了跳过 1 句', txt(files[1]));
  ok(/每句都出成题了/.test(txt(files[0])), '第三章标的是每句都成', txt(files[0]));

  const adds = $$(d, '#reportBody .rp-add');
  ok(adds.length === 1, '没出成的那句后面有一个「用它加题」', adds.length);
  ok(txt(files[1]).indexOf(NOTE_BAD.slice(0, 10)) >= 0, '账单里摆着原文');

  adds[0].click();
  ok(!$(d, '#qaModal').hidden, '点它就打开了加题框');
  ok(($(d, '#qaStem').value || '').indexOf(NOTE_BAD) >= 0, '题干已经填好那句原文', $(d, '#qaStem').value);
  ok($(d, '#qaType').value === 'fill', '默认当填空');
}

/* ---------------- 四、手动加题：不导入也能建题集 ---------------- */
console.log('\n四、手动加题能建出一个新题集');
{
  const { win, api, d } = openWin();
  ok(!$(d, '#addQBtn') || !!$(d, '#addQBtn'), '「＋ 手动加题」按钮在');
  $(d, '#addQBtn').click();
  ok(!$(d, '#qaModal').hidden, '点按钮打开加题框');
  ok($(d, '#qaBank').value === '__new', '还没有题集时默认「新建一个题集」', $(d, '#qaBank').value);
  ok(!$(d, '#qaCourseWrap').hidden, '新题集的名字输入框露出来了');

  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '首过效应最明显的给药途径是 ____ 。';
  $(d, '#qaAns').value = '口服';
  $(d, '#qaCourse').value = '药物治疗学';
  api.saveAddQuestion();

  const banks = bankList(win);
  ok(banks.length === 1, '建出了一个题集', banks.length);
  ok(banks[0].course === '药物治疗学', '名字对', banks[0].course);
  ok(banks[0].questions.length === 1, '里面有一道题', banks[0].questions.length);
  const q = banks[0].questions[0];
  ok(q.type === 'fill' && q.answer === '口服', '题型和答案对', q);
  ok(!!q.id && q.manual === true, '有 id，并标了「手加」', q.id);
  ok($(d, '#qaModal').hidden, '存完自动关掉');
  ok(/已加进/.test(toastOf(d)), '给了句人话', toastOf(d));
}

/* ---------------- 五、单选：答案是字母就按选项顺序认 ---------------- */
console.log('\n五、选择题的字母答案');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({});
  $(d, '#qaType').value = 'single';
  $(d, '#qaStem').value = '首过效应最明显的给药途径是（　）';
  $(d, '#qaOpts').value = '静脉注射\n口服\n肌内注射';
  $(d, '#qaAns').value = 'B';
  $(d, '#qaCourse').value = '药物治疗学';
  api.saveAddQuestion();

  const q = bankList(win)[0].questions[0];
  ok(q.type === 'single', '题型是单选', q.type);
  ok(q.answer === '口服', '答案 B 换成了选项原文「口服」', q.answer);
  ok(q.opts.length === 3, '三个选项都留着', q.opts);
  ok(q.optsSrc === 'manual', '标了选项来源是手写（不是原卷）', q.optsSrc);
  ok(api.lettersToOpts('AC', ['甲', '乙', '丙']).join('/') === '甲/丙', 'AC 认成甲、丙');
  ok(api.lettersToOpts('口服', ['甲', '乙']) === null, '不是字母就不硬认');
}

/* ---------------- 六、该拦的要拦住 ---------------- */
console.log('\n六、题干空着、选项不够，都不许存');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({ type: 'single' });
  $(d, '#qaCourse').value = '药物治疗学';
  $(d, '#qaStem').value = '';
  $(d, '#qaAns').value = '甲';
  ok(api.saveAddQuestion() === false, '题干空着，存不进去');
  ok(bankList(win).length === 0, '不会凭空建出题集');

  $(d, '#qaStem').value = '下面哪个对（　）';
  $(d, '#qaOpts').value = '只有一个';
  $(d, '#qaAns').value = '只有一个';
  ok(api.saveAddQuestion() === false, '选择题只有一个选项，存不进去');
  ok(/两个选项/.test(toastOf(d)), '说清楚差什么', toastOf(d));

  $(d, '#qaAns').value = '';
  $(d, '#qaOpts').value = '甲\n乙';
  ok(api.saveAddQuestion() === false, '答案空着也存不进去');
}

/* ---------------- 七、重复加同一道不会变两道 ---------------- */
console.log('\n七、题集里已经有的题，不加第二遍');
{
  const { win, api, d } = openWin();
  function addFill() {
    api.openAddQuestion({ type: 'fill' });
    $(d, '#qaStem').value = '药物治疗的前提是 ____ 。';
    $(d, '#qaAns').value = '有效性';
    $(d, '#qaCourse').value = '药物治疗学';
    return api.saveAddQuestion();
  }
  ok(addFill() === true, '第一遍加进去了');
  ok(addFill() === false, '第二遍被拦下');
  ok(bankList(win)[0].questions.length === 1, '题集里还是一道', bankList(win)[0].questions.length);
  ok(/已经有了/.test(toastOf(d)), '告诉你已经有了', toastOf(d));
}

/* ---------------- 八、多空填空 / 简答 / 名词解释 ---------------- */
console.log('\n八、别的题型也能加');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({ type: 'fill' });
  $(d, '#qaStem').value = '药物的 ____ 和 ____ 决定了给药间隔。';
  $(d, '#qaAns').value = '半衰期、清除率';
  $(d, '#qaCourse').value = '药物治疗学';
  api.saveAddQuestion();
  let q = bankList(win)[0].questions[0];
  ok(Array.isArray(q.answer) && q.answer.length === 2, '两个空拆成两条答案', q.answer);

  api.openAddQuestion({ type: 'short' });
  $(d, '#qaStem').value = '简述合理用药的原则。';
  $(d, '#qaAns').value = '安全；有效；经济；适当';
  $(d, '#qaBank').value = bankList(win)[0].id;
  api.saveAddQuestion();
  const qs2 = bankList(win)[0].questions;
  q = qs2[qs2.length - 1];
  ok(q.type === 'short' && q.answer.length === 4, '简答按分号拆成 4 条要点', q.answer);

  api.openAddQuestion({ type: 'term' });
  $(d, '#qaStem').value = '首过效应';
  $(d, '#qaAns').value = '药物经胃肠道吸收后先经过肝脏，使进入体循环的药量减少。';
  api.saveAddQuestion();
  const qs3 = bankList(win)[0].questions;
  q = qs3[qs3.length - 1];
  ok(q.type === 'term' && typeof q.answer === 'string', '名词解释的答案是一整段', q.answer);
  ok(qs3.length === 3, '三道都在同一个题集里', qs3.length);
}

/* ---------------- 九、Esc 关掉、题类型切换 ---------------- */
console.log('\n九、键盘与类型的交互');
{
  const { win, api, d } = openWin();
  $(d, '#addQBtn').click();
  ok(!$(d, '#qaModal').hidden, '打开着');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok($(d, '#qaModal').hidden, 'Esc 能关掉');

  api.openAddQuestion({ type: 'single' });
  ok(!$(d, '#qaOptsWrap').hidden, '单选时选项框露出来');
  $(d, '#qaType').value = 'short';
  api.syncQaOpts();
  ok($(d, '#qaOptsWrap').hidden, '换成简答后选项框收起来');
  ok(/要点|整段/.test(txt($(d, '#qaHint'))), '提示跟着换', txt($(d, '#qaHint')));
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
