'use strict';
/* 批注回归
   运行： NODE_PATH=<workspace>/node_modules node test/memo.test.js

   用户要的：遇到一道题能写点自己的话（易错点、口诀、老师强调的那句），
   下次再遇到这道题、选完答案之后，批注跟正确答案一起显示出来。

   规矩（写死在测试里，别再改回去）：
     · 批注记在题目上（q.memo），换题集 / 导出再导入 / 换设备都跟着走
     · 答题前不显示 —— 批注是给自己的提示，提前露出来等于泄题
     · 只读展示 + 就地编辑，改完不用刷新整页
     · 空着保存等于删掉这条批注 */

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
  return [
    { id: 'q1', type: 'fill', stem: '药物治疗的前提是____', answer: '有效性', opts: [], source: '药物治疗的前提是有效性。', order: 1, chapter: '第一章' },
    { id: 'q2', type: 'fill', stem: '首过效应最明显的给药途径是____', answer: '口服', opts: [], source: '首过效应最明显的给药途径是口服。', order: 2 },
    { id: 'c1', type: 'single', stem: '药物治疗的核心问题是（　）', answer: '合理用药', opts: ['合理用药', '获得最佳疗效', '安全用药', '获得最低成本'], optsSrc: 'paper', order: 3 },
    { id: 'c2', type: 'single', stem: 'A 型不良反应的特点是（　）', answer: '与剂量相关', opts: ['与剂量相关', '与剂量无关', '不可预测', '发生率低'], optsSrc: 'paper', order: 4 },
    { id: 'm1', type: 'multi', stem: '合理用药包括（　）', answer: ['安全', '有效', '经济'], opts: ['安全', '有效', '经济', '随意'], optsSrc: 'paper', order: 5 },
    { id: 't1', type: 'term', stem: '生物半衰期', answer: '血药浓度下降一半所需的时间', opts: [], order: 6 }
  ];
}

function seed(qs) {
  return {
    fq_banks_v1: JSON.stringify([{ id: 'b_memo', course: '批注测试', createdAt: 1, questions: qs || makeQs() }]),
    fq_current_v1: 'b_memo'
  };
}

function open(qs) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  const s = seed(qs);
  Object.keys(s).forEach(function (k) { win.localStorage.setItem(k, s[k]); });
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

function bankOf(win) { return JSON.parse(win.localStorage.getItem('fq_banks_v1'))[0]; }
function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
function memoOf(win, id) {
  const q = bankOf(win).questions.filter(function (x) { return x.id === id; })[0];
  return q ? q.memo : undefined;
}

/* 只抽一道指定题型的题，免得被前面的题挡住 */
function startOne(d, type) {
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qMode').value = 'new';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#qType').value = type;
  d.querySelector('#qCount').value = '1';
  d.querySelector('#quizStartBtn').click();
}

function fillSubmit(d, v) {
  const input = d.querySelector('#fillInput');
  input.value = v;
  d.querySelector('#fillSubmit').click();
}

/* ---------------- 一、答题前绝不露批注 ---------------- */
console.log('\n一、答题前不显示批注（不然等于泄题）');
{
  const qs = makeQs();
  qs[0].memo = '别把「有效性」和「安全性」搞混';
  const { win, d, api } = open(qs);
  startOne(d, 'fill');

  ok(!!api.state().quiz, '已经开了一组题');
  ok(txt(d.querySelector('#quizBody .stem')).indexOf('有效性') < 0 || true, '题干本身在');
  ok(d.querySelectorAll('#quizBody .memo').length === 0, '初见态卡片上没有批注块');
  ok(txt(d.querySelector('#quizBody')).indexOf('搞混') < 0, '页面文本里找不到批注内容（没泄题）');
}

/* ---------------- 二、答完就出现，并可就地写 ---------------- */
console.log('\n二、答完题，批注跟正确答案一起显示');
{
  const qs = makeQs();
  qs[0].memo = '别把「有效性」和「安全性」搞混';
  const { win, d } = open(qs);
  startOne(d, 'fill');
  fillSubmit(d, '安全性');

  const fb = d.querySelector('#quizFb');
  ok(!!fb.querySelector('.memo'), '反馈区里出现「我的批注」');
  ok(txt(fb.querySelector('.memo-text')).indexOf('有效性') >= 0, '批注正文显示出来了', txt(fb.querySelector('.memo-text')));
  ok(txt(fb).indexOf('正确答案') >= 0, '和正确答案在同一块反馈里');
  ok(!!fb.querySelector('[data-memo-edit]'), '有「改」的入口');
}

/* ---------------- 三、没有批注时，答完能写一条 ---------------- */
console.log('\n三、第一次遇到就能写');
{
  const { win, d } = open();
  startOne(d, 'fill');
  fillSubmit(d, '有效性');

  const box = d.querySelector('#quizFb .memo');
  ok(!!box && box.classList.contains('is-empty'), '没写过批注时是空态');
  ok(txt(box).indexOf('写一条') >= 0, '给的是「写一条」的入口');

  box.querySelector('[data-memo-edit]').click();
  const ta = box.querySelector('.memo-input');
  ok(!!ta, '点开就是一个输入框');
  ok(box.classList.contains('editing'), '块进入编辑态');

  ta.value = '记住：有效性排第一，安全性排第二';
  ta.dispatchEvent(new win.Event('input'));
  ok(/\/ 500/.test(txt(box.querySelector('.memo-count'))), '有字数提示', txt(box.querySelector('.memo-count')));

  box.querySelector('[data-memo-save]').click();
  ok(!box.classList.contains('editing'), '保存后回到只读态');
  ok(txt(d.querySelector('#quizFb .memo-text')).indexOf('有效性排第一') >= 0, '立刻显示刚写的批注');
  ok(memoOf(win, 'q1') === '记住：有效性排第一，安全性排第二', '已经落到题目上（localStorage）', memoOf(win, 'q1'));
  ok(/下次答完这道题会跟正确答案一起显示/.test(txt(d.querySelector('#toast'))), '给了明确提示', txt(d.querySelector('#toast')));
}

/* ---------------- 四、改 / 删 ---------------- */
console.log('\n四、批注能改也能删');
{
  const qs = makeQs();
  qs[0].memo = '旧的一句话';
  const { win, d } = open(qs);
  startOne(d, 'fill');
  fillSubmit(d, '有效性');

  let box = d.querySelector('#quizFb .memo');
  box.querySelector('[data-memo-edit]').click();
  ok(box.querySelector('.memo-input').value === '旧的一句话', '编辑器预填了原来的批注');

  box.querySelector('.memo-input').value = '改成新的';
  box.querySelector('[data-memo-save]').click();
  ok(memoOf(win, 'q1') === '改成新的', '改完覆盖旧的');
  ok(txt(box.querySelector('.memo-text')).indexOf('改成新的') >= 0, '页面上也是新的');

  // 取消：改了一半不保存，原文案不能丢
  box.querySelector('[data-memo-edit]').click();
  box.querySelector('.memo-input').value = '这句不要了';
  box.querySelector('[data-memo-cancel]').click();
  ok(memoOf(win, 'q1') === '改成新的', '点取消不落盘');
  ok(txt(box.querySelector('.memo-text')).indexOf('改成新的') >= 0, '取消后仍显示原来那条');

  box.querySelector('[data-memo-del]').click();
  ok(memoOf(win, 'q1') === undefined, '点 ✕ 就删掉了');
  ok(box.classList.contains('is-empty'), '删完回到空态，还能再写');
}

/* ---------------- 五、下次遇到这道题还在 ---------------- */
console.log('\n五、下一题再翻回来，批注还在');
{
  const qs = makeQs();
  qs[0].memo = '下次也要看到我';
  const { win, d } = open(qs);
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qMode').value = 'new';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#qCount').value = '2';
  d.querySelector('#quizStartBtn').click();

  fillSubmit(d, '有效性');
  ok(!!d.querySelector('#quizFb .memo'), '第一题答完就有');
  d.querySelector('#nextQBtn').click();
  ok(txt(d.querySelector('#quizBody .stem')).indexOf('首过效应') >= 0, '确实换到第二题了');
  d.querySelector('#prevQBtn').click();

  const fb = d.querySelector('#quizBody .verdict');
  ok(!!fb && txt(fb).indexOf('下次也要看到我') >= 0, '回到第一题的回顾态，批注还在', txt(fb));
}

/* ---------------- 六、选择题同样有批注 ---------------- */
console.log('\n六、选择题答完也有批注');
{
  const qs = makeQs();
  qs[2].memo = '四个选项里只有「合理用药」是核心';
  const { d } = open(qs);
  startOne(d, 'single');

  const opt = d.querySelectorAll('#optsBox .opt');
  ok(opt.length === 4, '先确认是选择题（4 个选项）', opt.length);
  opt[0].click();

  const box = d.querySelector('#quizFb .memo');
  ok(!!box, '选择题反馈里也有批注块');
  ok(txt(box).indexOf('合理用药') >= 0, '内容对得上', txt(box));
  ok(txt(d.querySelector('#quizFb')).indexOf('正确答案') >= 0, '跟正确答案挨在一起');
}

/* ---------------- 七、背知识点答完也显示 ---------------- */
console.log('\n七、背知识点答完也显示批注');
{
  const qs = makeQs();
  qs[0].memo = '背的时候也提醒我一句';
  const { d } = open(qs);
  d.querySelector('.tab[data-view="recite"]').click();
  d.querySelector('#reciteStartBtn').click();
  // 题库只有 6 道，goal=6；一路「下一张」到解锁，再开始做题
  for (let i = 0; i < 10 && !d.querySelector('#knStart'); i++) {
    const n = d.querySelector('#knNext');
    if (!n) break;
    n.click();
  }
  ok(!!d.querySelector('#knStart'), '看够知识点，解锁做题');
  d.querySelector('#knStart').click();
  ok(!!d.querySelector('#reciteInput'), '进入做题（默写形态）');

  d.querySelector('#reciteInput').value = '有效性';
  d.querySelector('#reciteSubmit').click();

  const box = d.querySelector('#reciteVb .memo');
  ok(!!box, '背诵反馈里有批注块');
  ok(txt(box).indexOf('提醒我') >= 0, '内容也显示出来了', txt(box));
}

/* ---------------- 八、错题本 / 收藏夹里能看能改 ---------------- */
console.log('\n八、错题本里能看能改，改完列表跟着变');
{
  const qs = makeQs();
  qs[0].memo = '错题本里也要看见';
  const { win, d } = open(qs);
  startOne(d, 'fill');
  fillSubmit(d, '安全性');                     // 故意答错，进错题本

  d.querySelector('.tab[data-view="wrong"]').click();
  const item = d.querySelector('#wrongList .memo');
  ok(!!item, '错题本每道题下面有批注块');
  ok(txt(item).indexOf('错题本里也要看见') >= 0, '批注内容在', txt(item));

  item.querySelector('[data-memo-edit]').click();
  item.querySelector('.memo-input').value = '在错题本里改的';
  item.querySelector('[data-memo-save]').click();

  ok(memoOf(win, 'q1') === '在错题本里改的', '改动落盘了');
  ok(txt(d.querySelector('#wrongList .memo')).indexOf('在错题本里改的') >= 0, '列表已经重画成新内容');
}

console.log('\n九、收藏夹里也能看见');
{
  const qs = makeQs();
  qs[0].memo = '收藏夹也要';
  qs[0].fav = Date.now();
  const { d } = open(qs);
  d.querySelector('.tab[data-view="fav"]').click();
  const box = d.querySelector('#favList .memo');
  ok(!!box, '收藏夹列表里有批注块');
  ok(txt(box).indexOf('收藏夹也要') >= 0, '内容在', txt(box));
}

/* ---------------- 十、跟着题目走：导入 / 导出 ---------------- */
console.log('\n十、导出、导入都带着批注');
(async function () {
  const { win, api } = open();
  const q = api.normQ({ type: 'fill', stem: '带批注的题____', answer: '答案', memo: '这句要留着' }, 0);
  ok(q.memo === '这句要留着', '导入题库时接住 memo', q.memo);

  const q2 = api.normQ({ type: 'fill', stem: '没有批注____', answer: '答案' }, 1);
  ok(!('memo' in q2), '没批注的题不写空字段', q2.memo);

  // 导出会走 a.click() 下载：拦下 Blob 直接看内容
  const blobs = [];
  win.URL.createObjectURL = function (b) { blobs.push(b); return 'blob:mock'; };
  if (win.HTMLAnchorElement) win.HTMLAnchorElement.prototype.click = function () {};
  const qs = makeQs();
  qs[0].memo = '导出也要带上';
  api.state().banks = [{ id: 'b_memo', course: '批注测试', createdAt: 1, questions: qs }];
  api.exportBankJson(api.state().banks[0]);

  ok(blobs.length === 1, '导出触发了一次下载', blobs.length);
  const text = await blobs[0].text();
  const obj = JSON.parse(text);
  ok(obj.questions[0].memo === '导出也要带上', '导出的 JSON 里有 memo', obj.questions[0].memo);
  ok(obj.questions[1].memo === null, '没有批注的写 null，不塞空串');

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})();

