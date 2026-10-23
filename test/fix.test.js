'use strict';
/* 「这题出得不对？」反馈机制回归
   运行： NODE_PATH=<workspace>/node_modules node test/fix.test.js

   用户在刷题时教系统「这题该怎么出」：题型 + 题干（____ 标空）+ 答案。
   要求：
     · 改完立刻生效（当前这张卡片就按新版出）
     · 存进题集，刷新 / 换设备（云端同步）后还是新版
     · 「恢复系统原样」能一步退回解析器原来的出法
     · 题型和答案形状要自洽（多选至少两项、简答是若干要点）
   样本全部内联，不依赖个人笔记。                                        */

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

function boot(banks) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  if (banks) win.localStorage.setItem('fq_banks_v1', JSON.stringify(banks));
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api };
}

/* ---------------- 一、答案拆分 ---------------- */
console.log('\n一、不同题型的答案怎么拆');
{
  const { api } = boot(null);
  const fill = api.fixAnswerOf('fill', '血药浓度、谷浓度');
  ok(Array.isArray(fill) && fill.length === 2 && fill[1] === '谷浓度', '填空：多个空按顿号拆开');

  const one = api.fixAnswerOf('fill', '血液');
  ok(one === '血液', '填空：只有一个空时仍是一个整串');

  ok(api.fixAnswerOf('single', '血浆') === '血浆', '单选：整体一个答案');

  const multi = api.fixAnswerOf('multi', '有明确指征、小剂量有效、单药有效');
  ok(Array.isArray(multi) && multi.length === 3, '多选：每个正确项一项');

  const short = api.fixAnswerOf('short', '要点一；要点二\n要点三');
  ok(Array.isArray(short) && short.length === 3, '简答：分号 / 换行拆要点');

  const term = api.fixAnswerOf('term', '研究、收集、监测、发现和评价药物不良反应的一门学科');
  ok(!Array.isArray(term) && term.indexOf('、') > 0,
    '名词解释：解释里的顿号不能拆（整段是一个答案）');
}

/* ---------------- 二、applyFix / clearFix ---------------- */
console.log('\n二、改法落到题上，也能原样退回');
{
  const { api } = boot(null);
  const q = { id: 'q1', type: 'fill', stem: '甲是____', answer: '乙', opts: [], source: '甲是乙' };
  q.fix = { type: 'term', stem: '甲', answer: '乙的完整解释', note: '', at: 1 };
  api.applyFix(q);
  ok(q.type === 'term', '题型改成名词解释');
  ok(q.stem === '甲' && q.answer === '乙的完整解释', '题干和答案换成用户写的');
  ok(q.orig && q.orig.stem === '甲是____' && q.orig.answer === '乙', '原始解析结果先备份下来');

  api.clearFix(q);
  ok(q.type === 'fill' && q.stem === '甲是____' && q.answer === '乙', '恢复系统原样：字段逐项还原');
  ok(!q.orig && !q.fix, '恢复后不残留备份');
}

/* ---------------- 三、刷题页上的完整流程 ---------------- */
console.log('\n三、刷题页：点「改题」→ 改 → 保存 → 下次按新版出');
const BANK = [{
  id: 'b_test', course: '测试课', createdAt: 1,
  questions: [
    { id: 'q1', type: 'fill', stem: '治疗药物监测的最常用标本是____', answer: '血液', opts: [], source: '治疗药物监测的最常用标本是血液。', order: 0 },
    { id: 'q2', type: 'fill', stem: '药物警戒的英文是____', answer: 'Pharmacovigilance', opts: [], source: '药物警戒的英文是 Pharmacovigilance。', order: 1 },
    { id: 'q3', type: 'fill', stem: '妊娠期用药的第一条原则是____', answer: '明确用药指征', opts: [], source: '妊娠期用药的第一条原则是明确用药指征。', order: 2 }
  ]
}];

{
  const { win } = boot(BANK);
  const d = win.document;
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qType').value = 'all';
  d.querySelector('#qCount').value = '20';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();
  ok(d.querySelector('#quizBody').textContent.indexOf('治疗药物监测') >= 0, '先正常开始刷题');

  const openBtn = d.querySelector('#quizBody [data-fix]');
  ok(!!openBtn, '卡片上有「改题」按钮');
  openBtn.click();
  ok(!d.querySelector('#fixPanel').hidden, '点开后出现反馈面板');
  ok(d.querySelector('#fixStem').value.indexOf('治疗药物监测') >= 0, '题干预填的是当前题目');

  // 选中「血液」两个字 → 挖成空，答案自动进答案框
  const ta = d.querySelector('#fixStem');
  const at = ta.value.indexOf('血液');
  ta.selectionStart = at; ta.selectionEnd = at + 2;
  d.querySelector('#fixBlankBtn').click();
  ok(ta.value.indexOf('____') >= 0, '「把选中的字挖成空」把词换成了 ____');
  ok(d.querySelector('#fixAns').value.trim() === '血液', '挖出来的词自动填进答案框');

  // 改成单选，答案换成「血浆」，题干补一句
  d.querySelector('#fixType').value = 'single';
  ta.value = '治疗药物监测的最常用标本是____，结果直接决定给药方案';
  d.querySelector('#fixAns').value = '血浆';
  d.querySelector('#fixNote').value = '标本和监测指标别混在一起考';
  d.querySelector('#fixSave').click();

  ok(d.querySelector('#fixPanel').hidden, '保存后面板收起');
  ok(d.querySelector('#quizBody').textContent.indexOf('结果直接决定给药方案') >= 0, '当前这张卡片立刻换成新题干');
  ok(!!d.querySelector('#optsBox'), '改成单选后出现选项');
  ok((d.querySelector('#optsBox').textContent || '').indexOf('血浆') >= 0, '正确项在选项里');

  const saved = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  const sq = saved[0].questions.filter(function (q) { return q.id === 'q1'; })[0];
  ok(!!sq.fix && sq.fix.type === 'single', '改法写进题集（本地存储）');
  ok(sq.fix.note && sq.fix.note.indexOf('别混在一起') >= 0, '补充说明也一起存了');
  ok(sq.opts.length >= 2, '选择题的干扰项自动从题库里配齐');
  ok(sq.fix.stem.indexOf('____') < 0 && sq.fix.stem.indexOf('（　）') >= 0,
    '改成选择题后题干里的空换成括号占位，不再拖一条下划线');
  ok(sq.orig && sq.orig.answer === '血液', '原始答案备份还在');
}

/* ---------------- 四、刷新之后还认这个改法 ---------------- */
console.log('\n四、重新打开（刷新 / 换设备）后仍按用户的版本出题');
{
  const { win, api } = boot(BANK);
  const d = win.document;
  // 上一轮已经写进 localStorage 的版本由真实流程产生，这里手工补一条等价的
  const bank = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  bank[0].questions[0].fix = {
    type: 'single',
    stem: '治疗药物监测的最常用标本是____，结果直接决定给药方案',
    answer: '血浆',
    note: '',
    at: 1
  };
  win.localStorage.setItem('fq_banks_v1', JSON.stringify(bank));

  const again = boot(JSON.parse(win.localStorage.getItem('fq_banks_v1')));
  const d2 = again.win.document;
  d2.querySelector('.tab[data-view="quiz"]').click();
  d2.querySelector('#quizStartBtn').click();
  ok(d2.querySelector('#quizBody').textContent.indexOf('结果直接决定给药方案') >= 0,
    '加载题库时就套用了用户的改法');
  ok(!!d2.querySelector('#optsBox'), '仍然按单选（给选项）出');

  // 恢复原样
  d2.querySelector('#quizBody [data-fix]').click();
  const undo = d2.querySelector('#fixUndo');
  ok(!!undo, '改过的题有「恢复系统原样」');
  undo.click();
  const back = JSON.parse(again.win.localStorage.getItem('fq_banks_v1'));
  const bq = back[0].questions.filter(function (q) { return q.id === 'q1'; })[0];
  ok(!bq.fix, '恢复后不再有条目');
  ok(bq.stem === '治疗药物监测的最常用标本是____' && bq.answer === '血液', '题干答案退回解析器原样');
  ok(d2.querySelector('#quizBody').textContent.indexOf('结果直接决定给药方案') < 0, '页面上也立刻退回原题');
  void api; void d;
}

/* ---------------- 五、兜底：凑不出干扰项就别硬造选择题 ---------------- */
console.log('\n五、题库太小、凑不出干扰项时降级成填空');
{
  const { win } = boot([{
    id: 'b_one', course: '单题课', createdAt: 1,
    questions: [{ id: 'only', type: 'fill', stem: '唯一的题是____', answer: '甲', opts: [], source: '唯一的题是甲。', order: 0 }]
  }]);
  const d = win.document;
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#quizStartBtn').click();
  d.querySelector('#quizBody [data-fix]').click();
  d.querySelector('#fixType').value = 'single';
  d.querySelector('#fixStem').value = '唯一的题是____';
  d.querySelector('#fixAns').value = '乙';
  d.querySelector('#fixSave').click();

  const saved = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  const q = saved[0].questions[0];
  ok(q.fix && q.fix.type === 'fill', '凑不出干扰项时按填空存，不硬造只有一个选项的选择题');
  ok(q.stem.indexOf('____') >= 0, '题干保留了空');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
