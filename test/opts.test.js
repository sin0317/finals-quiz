'use strict';
/* 「改题」面板里的选项编辑回归
   运行： NODE_PATH=<workspace>/node_modules node test/opts.test.js

   用户要求：改题时也要能调整单选/多选的干扰项 ——
     · 题干下面铺出选项，勾哪个哪个就是正确答案
     · 选项文字能改、能加、能删，字母自动重排
     · 单选只能勾一个，多选可以勾好几个
     · 直接改答案框也行，会自动在选项里补一条并勾上
     · 保存后刷题页就是这几个选项，顺序和文字都不能变形
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

const QB = [{
  id: 'b_opts', course: '测试课', createdAt: 1,
  questions: [
    {
      id: 'o1', type: 'single', stem: '治疗药物监测的最常用标本是（　）',
      answer: '血浆', opts: ['血浆', '尿液', '唾液', '全血'],
      source: '治疗药物监测的最常用标本是血浆。', order: 0
    },
    {
      id: 'o2', type: 'multi', stem: '妊娠期用药的基本原则包括（　）',
      answer: ['明确用药指征', '小剂量有效', '单药有效'],
      opts: ['明确用药指征', '小剂量有效', '单药有效', '常规联合用药'],
      source: '妊娠期用药的基本原则包括明确用药指征、小剂量有效、单药有效。', order: 1
    }
  ]
}];

function boot() {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  win.localStorage.setItem('fq_banks_v1', JSON.stringify(JSON.parse(JSON.stringify(QB))));
  win.localStorage.setItem('fq_current_v1', 'b_opts');
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api };
}

/* 打开第一题的改题面板 */
function openPanel(win) {
  const d = win.document;
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qType').value = 'all';
  d.querySelector('#qCount').value = '20';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();
  d.querySelector('#quizBody [data-fix]').click();
  return d;
}

const rowTexts = (d) => Array.prototype.slice.call(d.querySelectorAll('#fixOptsList .fix-opt-text')).map((x) => x.value);
const rowTicks = (d) => Array.prototype.slice.call(d.querySelectorAll('#fixOptsList input[type=checkbox]')).map((x) => !!x.checked);
const tick = (win, i) => {
  const box = win.document.querySelectorAll('#fixOptsList input[type=checkbox]')[i];
  box.checked = !box.checked;
  box.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const editText = (win, i, v) => {
  const el = win.document.querySelectorAll('#fixOptsList .fix-opt-text')[i];
  el.value = v;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
};

/* ---------------- 一、选项区铺得对不对 ---------------- */
console.log('\n一、打开改题面板，选项按原样铺出来');
{
  const { win } = boot();
  const d = openPanel(win);

  ok(d.querySelector('#fixOptsWrap') && !d.querySelector('#fixOptsWrap').hidden, '选择题的选项区是展开的');
  ok(rowTexts(d).length === 4, '四行选项都在');
  ok(rowTexts(d).join('|') === '血浆|尿液|唾液|全血', '顺序和文字都是原题的', rowTexts(d));
  ok(rowTicks(d).join(',') === 'true,false,false,false', '只有「血浆」勾着（原答案）');
  ok(d.querySelector('#fixAns').value === '血浆', '答案框回显的是勾选的那一项');

  const letters = Array.prototype.slice.call(d.querySelectorAll('#fixOptsList .fix-opt-pick b')).map((x) => x.textContent);
  ok(letters.join('') === 'ABCD', '字母按 A/B/C/D 排好', letters);
}

/* ---------------- 二、勾选即答案 ---------------- */
console.log('\n二、勾哪个哪个就是答案');
{
  const { win } = boot();
  const d = openPanel(win);

  tick(win, 1);                                   // 勾「尿液」
  ok(rowTicks(d).join(',') === 'false,true,false,false', '单选：勾新的自动取消旧的');
  ok(d.querySelector('#fixAns').value === '尿液', '答案框跟着变成「尿液」');

  d.querySelector('#fixType').value = 'multi';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));
  tick(win, 0);                                   // 再勾「血浆」
  ok(rowTicks(d).filter(Boolean).length === 2, '多选：能同时勾两个');
  ok(d.querySelector('#fixAns').value === '血浆、尿液', '答案框两项用顿号连起来（按选项顺序）', d.querySelector('#fixAns').value);

  // 再点一次取消
  tick(win, 1);
  ok(d.querySelector('#fixAns').value === '血浆', '取消勾选后答案里也没了');
}

/* ---------------- 三、改选项文字 ---------------- */
console.log('\n三、改选项文字');
{
  const { win } = boot();
  const d = openPanel(win);

  editText(win, 0, '血浆（首选）');
  ok(d.querySelector('#fixAns').value === '血浆（首选）', '改勾着的那一项，答案自动跟着改');

  editText(win, 1, '尿液（次选）');
  ok(d.querySelector('#fixAns').value === '血浆（首选）', '改没勾的那一项，答案不受影响', d.querySelector('#fixAns').value);
  ok(rowTexts(d)[1] === '尿液（次选）', '没勾的那一项文字也确实改了');
}

/* ---------------- 四、加一个 / 删一个 ---------------- */
console.log('\n四、加选项、删选项');
{
  const { win } = boot();
  const d = openPanel(win);

  d.querySelector('#fixOptAdd').click();
  ok(rowTexts(d).length === 5, '加了一个选项');
  const letters = Array.prototype.slice.call(d.querySelectorAll('#fixOptsList .fix-opt-pick b')).map((x) => x.textContent);
  ok(letters.join('') === 'ABCDE', '字母跟着重排到 E', letters);

  editText(win, 4, '血清');
  d.querySelectorAll('#fixOptsList [data-odel]')[1].click();   // 删掉「尿液」
  ok(rowTexts(d).length === 4, '删掉一个后剩四行');
  ok(rowTexts(d).indexOf('尿液') < 0 && rowTexts(d).indexOf('血清') >= 0, '删的是「尿液」，新加的「血清」还在');
  const letters2 = Array.prototype.slice.call(d.querySelectorAll('#fixOptsList .fix-opt-pick b')).map((x) => x.textContent);
  ok(letters2.join('') === 'ABCD', '字母又缩回 A/B/C/D', letters2);
}

/* ---------------- 五、直接改答案框 ---------------- */
console.log('\n五、直接改答案框，选项自动补上');
{
  const { win } = boot();
  const d = openPanel(win);

  const ans = d.querySelector('#fixAns');
  ans.value = '血清';
  ans.dispatchEvent(new win.Event('change'));

  ok(rowTexts(d).indexOf('血清') >= 0, '答案里的新词自动进选项');
  const i = rowTexts(d).indexOf('血清');
  ok(rowTicks(d)[i] === true, '并且是勾着的');
  ok(rowTicks(d).filter(Boolean).length === 1, '原来勾着的那项同时取消（单选只有一个正确）');
}

/* ---------------- 六、保存后刷题页就是这几个选项 ---------------- */
console.log('\n六、保存 → 刷题页按用户给的选项出题');
{
  const { win } = boot();
  const d = openPanel(win);

  editText(win, 0, '血浆');
  editText(win, 1, '尿液');
  editText(win, 2, '脑脊液');
  editText(win, 3, '汗液');
  tick(win, 2);                                   // 正确答案改成「脑脊液」
  d.querySelector('#fixSave').click();

  ok(d.querySelector('#fixPanel').hidden, '保存后面板收起');
  const opts = Array.prototype.slice.call(d.querySelectorAll('#optsBox .opt'));
  ok(opts.length === 4, '刷题页出现四个选项（不多不少，答案不会重复出现）', opts.length);
  const got = opts.map((b) => b.dataset.v).sort().join('|');
  ok(got === ['血浆', '尿液', '脑脊液', '汗液'].sort().join('|'), '文字就是用户编的那四个', opts.map((b) => b.dataset.v));

  // 点正确的那一项应该判对（选项会被打乱，按文字找）
  const right = opts.filter((b) => b.dataset.v === '脑脊液')[0];
  ok(!!right, '新正确答案在选项里');
  right.click();
  ok((d.querySelector('#quizFb').textContent || '').indexOf('答对') >= 0, '选「脑脊液」判对');

  const saved = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  const q = saved[0].questions[0];
  ok(q.fix && q.fix.opts && q.fix.opts.length === 4, '四个选项存进题集');
  ok(q.fix.answer === '脑脊液', '答案存的是勾选那一项');
}

/* ---------------- 七、多选：勾几个存几个 ---------------- */
console.log('\n七、多选勾几个，答案就存几个');
{
  const { win } = boot();
  const d = openPanel(win);

  d.querySelector('#fixType').value = 'multi';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));
  ok(rowTicks(d).filter(Boolean).length === 1, '改成多选后原来的正确答案还勾着');

  tick(win, 1);                                   // 再勾「尿液」
  ok(rowTicks(d).filter(Boolean).length === 2, '多选能同时勾两个');

  d.querySelector('#fixSave').click();

  const saved = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  const q = saved[0].questions[0];
  ok(q.fix.type === 'multi', '题型存成多选');
  ok(Array.isArray(q.fix.answer) && q.fix.answer.length === 2, '两个正确项都存下来', q.fix.answer);
  ok(q.fix.opts.length === 4, '其余选项也留在选项里');

  // 多选只勾一个应该被拦住
  const { win: w2 } = boot();
  const d2 = openPanel(w2);
  d2.querySelector('#fixType').value = 'multi';
  d2.querySelector('#fixType').dispatchEvent(new w2.Event('change'));
  d2.querySelector('#fixSave').click();
  ok(!d2.querySelector('#fixPanel').hidden, '多选只勾一个时保存被拦住');
}

/* ---------------- 八、单选勾两个要被拦住 ---------------- */
console.log('\n八、单选勾了两个正确答案：拦住，让人改题型');
{
  const { win } = boot();
  const d = openPanel(win);

  // 先按多选勾两个，再切回单选
  d.querySelector('#fixType').value = 'multi';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));
  tick(win, 1);
  tick(win, 2);
  ok(rowTicks(d).filter(Boolean).length === 3, '多选下勾了三个');

  d.querySelector('#fixType').value = 'single';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));   // 切回单选自动收敛
  ok(rowTicks(d).filter(Boolean).length === 1, '切回单选时自动只留一个勾');
  ok(d.querySelector('#fixAns').value.indexOf('、') < 0, '答案也收回成一个', d.querySelector('#fixAns').value);
}

/* ---------------- 九、只剩一个选项 → 不硬造选择题 ---------------- */
console.log('\n九、选项删到只剩一个：降级成填空，不送分');
{
  const { win } = boot();
  const d = openPanel(win);

  // 只留「血浆」
  for (let i = 0; i < 3; i++) d.querySelectorAll('#fixOptsList [data-odel]')[1].click();
  ok(rowTexts(d).length === 1, '确实只剩一个选项');

  d.querySelector('#fixSave').click();
  const saved = JSON.parse(win.localStorage.getItem('fq_banks_v1'));
  const q = saved[0].questions[0];
  ok(q.fix.type === 'fill', '自动降级成填空');
  ok(q.fix.stem.indexOf('____') >= 0, '题干里的（　）换回了 ____', q.fix.stem);
  ok(!q.fix.opts, '不会留一份只有一个正确答案的选项');
}

/* ---------------- 十、重新配干扰项 ---------------- */
console.log('\n十、干扰项换一批');
{
  const { win } = boot();
  const d = openPanel(win);

  const before = rowTexts(d).join('|');
  editText(win, 1, '这一项待会儿会被换掉');
  ok(d.querySelector('#fixOptFill'), '有「从题库再配几个干扰项」按钮');
  d.querySelector('#fixOptFill').click();

  const after = rowTexts(d);
  ok(after.length >= 2, '换完还是有多个选项', after);
  ok(after.indexOf('这一项待会儿会被换掉') < 0, '没勾的那一项被换掉了');
  ok(after.indexOf('血浆') >= 0, '正确答案留着');
  ok(after.join('|') !== before, '选项确实变了一批');
}

/* ---------------- 十一、填空题不显示选项区 ---------------- */
console.log('\n十一、填空题：选项区收起来，别让人以为能配选项');
{
  const { win } = boot();
  const d = openPanel(win);

  d.querySelector('#fixType').value = 'fill';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));
  ok(d.querySelector('#fixOptsWrap').hidden, '切到填空后选项区收起');

  d.querySelector('#fixType').value = 'single';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));
  ok(!d.querySelector('#fixOptsWrap').hidden, '切回单选又展开');

  d.querySelector('#fixType').value = 'term';
  d.querySelector('#fixType').dispatchEvent(new win.Event('change'));
  ok(d.querySelector('#fixOptsWrap').hidden, '名词解释也收起');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
