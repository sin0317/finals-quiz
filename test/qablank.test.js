'use strict';
/* 手动加题里的「快捷挖空」
   运行： NODE_PATH=<workspace>/node_modules node test/qablank.test.js

   用户的原话：
     「这里做一个快捷挖空 选中的直接变成答案」

   守的几条线：
     · 题干里选中一段字 → 变成 ____，选中的字自动进答案框（不用手抄第二遍）
     · 答案框已经有内容时追加，不覆盖、不重复
     · 没选东西 / 选到空白 → 说清怎么选，题干一个字都不改
     · 选择题、名词解释、简答不挖空 —— 先把题型切成「填空」
     · 两个空 + 答案本身带顿号时，答案不能被劈成三段
     · 用户后来手动改了答案，就按他自己写的来
     · Alt+W 和点按钮等价                                              */

/* 公共骨架（index.html 正文 + app.js + happy-dom + ok 计数）收在 _harness 里，
   这里只写这一套要守的线。以前这 30 行在 42 套里各抄了一遍。 */
const T = require('./_harness');
const { ok, openWin, $, txt } = T;

function toastOf(d) { return txt($(d, '#toast')); }
function bankList(win) { return JSON.parse(win.localStorage.getItem('fq_banks_v1') || '[]'); }

/* 在题干里选中 word 第一次出现的那一段（从第几处开始找：第 nth 次出现） */
function selectWord(d, word, nth) {
  const ta = $(d, '#qaStem');
  const at = nth === undefined ? ta.value.indexOf(word) : (function () {
    let i = -1;
    for (let k = 0; k <= (nth || 0); k++) i = ta.value.indexOf(word, i + 1);
    return i;
  })();
  if (at < 0) throw new Error('题干里找不到「' + word + '」');
  ta.selectionStart = at;
  ta.selectionEnd = at + word.length;
  return ta;
}

/* ---------------- 一、选中 → 变成空 + 答案自动填好 ---------------- */
console.log('\n一、选中的字直接变成答案');
{
  const { api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  ok($(d, '#qaBlankBtn'), '加题框里有「✂」按钮');
  ok($(d, '#qaStemFld'), '题干字段还在（换成了带按钮的头）');

  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '首过效应最明显的给药途径是口服。';
  $(d, '#qaAns').value = '';
  selectWord(d, '口服');
  $(d, '#qaBlankBtn').click();

  ok($(d, '#qaStem').value.indexOf('____') >= 0, '题干里出现了空', $(d, '#qaStem').value);
  ok($(d, '#qaStem').value.indexOf('口服') < 0, '选中的字从题干里拿走了', $(d, '#qaStem').value);
  ok(/是 ____/.test($(d, '#qaStem').value), '空前面留了一个空格，不糊在一起', $(d, '#qaStem').value);
  ok($(d, '#qaAns').value === '口服', '答案框自动填上，不用手抄', $(d, '#qaAns').value);
  ok(/已挖空/.test(toastOf(d)), '告诉用户挖到了什么', toastOf(d));
}

/* ---------------- 二、答案已有内容：追加，不覆盖不重复 ---------------- */
console.log('\n二、挖第二个空时答案追加');
{
  const { api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '首过效应最明显的给药途径是口服，最危险的是静脉注射。';
  $(d, '#qaAns').value = '口服';
  selectWord(d, '静脉注射');
  $(d, '#qaBlankBtn').click();
  ok($(d, '#qaAns').value === '口服、静脉注射', '接着排在后面、用顿号隔开', $(d, '#qaAns').value);

  // 同一段字再挖一次（题干里还剩一处）：答案不该出现两遍
  $(d, '#qaStem').value = '口服药要按时吃，口服是首选。';
  $(d, '#qaAns').value = '口服';
  selectWord(d, '按时吃');
  $(d, '#qaBlankBtn').click();
  ok($(d, '#qaAns').value === '口服、按时吃', '已有的答案不重复添加', $(d, '#qaAns').value);
}

/* ---------------- 三、没选东西：说清楚，题干不动 ---------------- */
console.log('\n三、没选中就别动题干');
{
  const { api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  const before = '首过效应最明显的给药途径是口服。';
  $(d, '#qaStem').value = before;
  $(d, '#qaStem').selectionStart = $(d, '#qaStem').selectionEnd = 3;
  $(d, '#qaBlankBtn').click();
  ok($(d, '#qaStem').value === before, '题干一个字都没改', $(d, '#qaStem').value);
  ok(/先在题干里选中/.test(toastOf(d)), '提示怎么选', toastOf(d));

  // 只选了空格：也不能把空格挖成空
  const s = $(d, '#qaStem').value;
  $(d, '#qaStem').value = s + '   ';
  $(d, '#qaStem').selectionStart = s.length;
  $(d, '#qaStem').selectionEnd = s.length + 3;
  $(d, '#qaBlankBtn').click();
  ok($(d, '#qaStem').value.indexOf('____') < 0, '选到空白时不挖', $(d, '#qaStem').value);
}

/* ---------------- 四、按钮上实时报「选中了几个字」 ---------------- */
console.log('\n四、按钮跟着选区变');
{
  const { api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  $(d, '#qaStem').value = '首过效应最明显的给药途径是口服。';
  api.syncQaBlankBtn();
  ok(/选中的字挖成空/.test(txt($(d, '#qaBlankBtn'))), '没选中时是引导文案', txt($(d, '#qaBlankBtn')));

  selectWord(d, '口服');
  api.syncQaBlankBtn();
  ok(/挖空这 2/.test(txt($(d, '#qaBlankBtn'))), '选中 2 字就报 2 字', txt($(d, '#qaBlankBtn')));
  ok($(d, '#qaBlankBtn').className.indexOf('on') >= 0, '有选中时按钮点亮');
}

/* ---------------- 五、题型不对：不挖，并说清为什么 ---------------- */
console.log('\n五、选择 / 名词解释 / 简答不挖空');
{
  const { api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  const stem = '首过效应最明显的给药途径是（　）';
  ['single', 'multi'].forEach(function (t) {
    $(d, '#qaType').value = t;
    $(d, '#qaStem').value = stem;
    selectWord(d, '给药途径');
    $(d, '#qaBlankBtn').click();
    ok($(d, '#qaStem').value === stem, t + '：题干没被改', $(d, '#qaStem').value);
    ok(/选择题不挖空/.test(toastOf(d)), t + '：说清选择题材怎么写', toastOf(d));
  });
  ['term', 'short'].forEach(function (t) {
    $(d, '#qaType').value = t;
    $(d, '#qaStem').value = '首过效应';
    selectWord(d, '效应');
    $(d, '#qaBlankBtn').click();
    ok($(d, '#qaStem').value === '首过效应', t + '：题干没被改', $(d, '#qaStem').value);
    ok(/默写/.test(toastOf(d)), t + '：说清这两种是默写', toastOf(d));
  });
}

/* ---------------- 六、两个空 + 答案本身带顿号：不能劈成三段 ---------------- */
console.log('\n六、答案自己带顿号也不会错位');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  $(d, '#qaCourse').value = '药物治疗学';
  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '所选药物要安全、有效，老年人还要减量服用。';
  $(d, '#qaAns').value = '';

  selectWord(d, '安全、有效');
  $(d, '#qaBlankBtn').click();
  selectWord(d, '减量服用');
  $(d, '#qaBlankBtn').click();

  const stem = $(d, '#qaStem').value;
  ok((stem.match(/____/g) || []).length === 2, '题干里正好两个空', stem);
  ok($(d, '#qaAns').value === '安全、有效、减量服用', '答案框里串起来看是一句', $(d, '#qaAns').value);

  api.saveAddQuestion();
  const q = bankList(win)[0].questions[0];
  ok(Array.isArray(q.answer) && q.answer.length === 2, '存下来是两段答案，没被劈成三段',
    q.answer);
  ok(q.answer[0] === '安全、有效', '第一段整段保留顿号', q.answer[0]);
  ok(q.answer[1] === '减量服用', '第二段是第二个空', q.answer[1]);
}

/* ---------------- 七、用户手动改过答案：以他写的为准 ---------------- */
console.log('\n七、手改过答案就按人写的来');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  $(d, '#qaCourse').value = '药物治疗学';
  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '首过效应最明显的给药途径是口服。';
  $(d, '#qaAns').value = '';
  selectWord(d, '口服');
  $(d, '#qaBlankBtn').click();
  ok($(d, '#qaAns').value === '口服', '先自动填上', $(d, '#qaAns').value);

  // 用户改成自己的说法（同义、更短）
  const ans = $(d, '#qaAns');
  ans.value = '口服给药';
  ans.dispatchEvent(new win.Event('input', { bubbles: true }));
  api.saveAddQuestion();

  const q = bankList(win)[0].questions[0];
  ok(!Array.isArray(q.answer) && q.answer === '口服给药', '存的是人改过的那句', q.answer);
}

/* ---------------- 八、Alt+W 和点按钮等价 ---------------- */
console.log('\n八、Alt+W 也能挖');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '药物不良反应包括副作用、毒性反应。';
  $(d, '#qaAns').value = '';
  selectWord(d, '副作用');
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', {
    key: 'w', altKey: true, bubbles: true, cancelable: true
  }));
  ok($(d, '#qaStem').value.indexOf('____') >= 0, 'Alt+W 挖出了空', $(d, '#qaStem').value);
  ok($(d, '#qaAns').value === '副作用', '答案也填上了', $(d, '#qaAns').value);
}

/* ---------------- 九、两道题之间不串 ---------------- */
console.log('\n九、连加两道不串答案');
{
  const { win, api, d } = openWin();
  api.openAddQuestion({ newBank: true });
  $(d, '#qaCourse').value = '药物治疗学';
  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '首过效应最明显的给药途径是口服。';
  selectWord(d, '口服');
  $(d, '#qaBlankBtn').click();
  api.saveAddQuestion();
  ok(api.qaPicks().length === 0, '存完把上一道的挖空记录清干净', api.qaPicks());

  // 第二道：两个空，答案带顿号，不该受上一道影响
  api.openAddQuestion({});
  $(d, '#qaType').value = 'fill';
  $(d, '#qaStem').value = '药物要安全、有效，还要经济。';
  selectWord(d, '安全、有效');
  $(d, '#qaBlankBtn').click();
  selectWord(d, '经济');
  $(d, '#qaBlankBtn').click();
  api.saveAddQuestion();

  const qs = bankList(win)[0].questions;
  ok(qs.length === 2, '两道理都在同一本题集里', qs.length);
  const q2 = qs[1];
  ok(Array.isArray(q2.answer) && q2.answer.length === 2 && q2.answer[0] === '安全、有效',
    '第二道的答案还是两段', q2.answer);
}

T.done('快捷挖空');
