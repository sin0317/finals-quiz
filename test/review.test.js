'use strict';
/* 填空题作答链路回归：判分、展示正确答案、输入法 Enter、自动下一题、回看上一题
   重点是「手打的题不能被自动跳转冲掉」和「能回头看答案」。
   运行： NODE_PATH=<workspace>/node_modules node test/review.test.js            */

const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function bootApp() {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.prompt = function (m, d) { return d; };
  win.alert = function () {};

  const m = new Map();
  const store = {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); },
    clear: function () { m.clear(); },
    key: function (i) { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; }
  };
  class FileReaderShim {
    readAsText() { setTimeout(() => { this.result = ''; this.onload && this.onload(); }, 0); }
    readAsArrayBuffer() { setTimeout(() => { this.result = new ArrayBuffer(0); this.onload && this.onload(); }, 0); }
  }
  const RealURL = globalThis.URL;
  if (!RealURL.createObjectURL) RealURL.createObjectURL = function () { return 'blob:mock'; };
  const deadFetch = function () { return Promise.reject(new TypeError('Failed to fetch')); };

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator',
    APP_SRC
  );
  fn(win, win.document, store, deadFetch, win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval,
    win.Blob || globalThis.Blob, RealURL, FileReaderShim, win.crypto, win.navigator);

  return {
    win: win,
    $: function (s) { return win.document.querySelector(s); },
    $$: function (s) { return Array.prototype.slice.call(win.document.querySelectorAll(s)); },
    text: function (s) { const e = win.document.querySelector(s); return e ? e.textContent.trim() : null; },
    click: function (s) {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到元素：' + s);
      e.dispatchEvent(new win.Event('click', { bubbles: true }));
    },
    clickEl: function (e) { e.dispatchEvent(new win.Event('click', { bubbles: true })); },
    setVal: function (s, v) { const e = win.document.querySelector(s); if (!e) throw new Error('找不到：' + s); e.value = v; },
    enter: function (s, composing) {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到：' + s);
      const ev = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      if (composing) Object.defineProperty(ev, 'isComposing', { value: true });
      e.dispatchEvent(ev);
    },
    store: store
  };
}

// 三句必定抽出 3 道题的笔记（含一条填空）
const NOTE = [
  '药物不良反应包括副作用、毒性反应、变态反应三种。',
  '由于单位时间内消除的药量与体内浓度 C 的比值不变，又称之为恒比消除。',
  '药物治疗学是研究药物治疗疾病规律的一门学科。'
].join('\n');

function answerCount(a) {
  const stats = JSON.parse(a.store.getItem('fq_stats_v1') || '{}');
  let n = 0;
  Object.keys(stats).forEach(function (k) { n += (stats[k].ok || 0) + (stats[k].bad || 0); });
  return n;
}

async function intoQuiz(a, form) {
  a.setVal('#noteText', NOTE);
  a.click('#extractBtn');
  await sleep(200);
  a.click('#saveBankBtn');
  await sleep(200);
  a.setVal('#qForm', form);
  a.setVal('#qCount', '0');
  a.click('#quizStartBtn');
  await sleep(150);
}

(async function main() {
  console.log('\n== 填空作答与回看上一题 ==\n');

  /* ---------- 1. 填空作答后必须给出正误与正确答案 ---------- */
  console.log('[1] 作答后的判定与答案展示');
  const a = bootApp();
  await sleep(150);
  await intoQuiz(a, 'fill');
  ok(!!a.$('#fillInput'), '填空题给了输入框');
  ok(a.$('#prevQBtn') === null, '第 1 题没有「上一题」按钮（前面没题）');

  a.setVal('#fillInput', '随便乱写一个');
  a.click('#fillSubmit');
  await sleep(150);
  const fb1 = a.text('#quizFb') || '';
  ok(/记错了|记住了大半|正确/.test(fb1), '提交后给出了判定结果', fb1.slice(0, 40));
  ok(/正确说法是|完整表述/.test(fb1), '判定里带有正确答案', fb1.slice(0, 60));
  const stem1 = a.text('#quizBody .stem') || '';
  ok(stem1.indexOf('____') < 0 && stem1.indexOf('________') < 0, '题干那个空已经被答案填上', stem1.slice(0, 40));
  ok(!!a.$('#quizBody .stem .blank-mark.filled'), '填入的答案有高亮标记');

  /* ---------- 2. 中文输入法：选词那一下 Enter 不能当提交 ---------- */
  console.log('\n[2] 输入法状态下的 Enter');
  const b = bootApp();
  await sleep(150);
  await intoQuiz(b, 'fill');
  b.setVal('#fillInput', 'fuzuoyong');
  b.enter('#fillInput', true);
  await sleep(80);
  ok((b.text('#quizFb') || '') === '', '选词时的 Enter 不会提交');
  ok(b.$('#fillInput') && !b.$('#fillInput').disabled, '输入框还能继续打字（候选词没被吞）');
  b.setVal('#fillInput', '副作用、毒性反应、变态反应三种');
  b.enter('#fillInput', false);
  await sleep(150);
  ok(/正确/.test(b.text('#quizFb') || ''), '正常 Enter 会提交并判定', (b.text('#quizFb') || '').slice(0, 30));

  /* ---------- 3. 手打中的题不能被自动跳转冲掉 ---------- */
  console.log('\n[3] 自动下一题不能打断正在作答的题');
  const c = bootApp();
  await sleep(150);
  await intoQuiz(c, 'fill');
  c.setVal('#fillInput', '副作用、毒性反应、变态反应三种');
  c.click('#fillSubmit');
  await sleep(100);
  c.click('#nextQBtn');          // 手动翻页，抢在定时器前面
  await sleep(100);
  ok(/第\s*2\s*\//.test(c.text('#quizBody .q-meta') || ''), '手动翻到第 2 题', c.text('#quizBody .q-meta'));
  c.setVal('#fillInput', '恒比');
  await sleep(2000);
  ok(/第\s*2\s*\//.test(c.text('#quizBody .q-meta') || ''), '第 1 题遗留的定时器没有把第 2 题切走');
  ok(c.$('#fillInput') && c.$('#fillInput').value === '恒比', '打了一半的内容还在，没被清掉');
  await sleep(1200);              // 累计 3.2s，早超过自动跳转时间
  ok(/第\s*2\s*\//.test(c.text('#quizBody .q-meta') || ''), '过了跳转时间仍停在第 2 题（正在打字就不动）');

  /* ---------- 4. 回看上一题 ---------- */
  console.log('\n[4] 回看上一题');
  c.setVal('#fillInput', '恒比消除');
  c.click('#fillSubmit');
  await sleep(150);
  c.click('#nextQBtn');
  await sleep(150);
  ok(/第\s*3\s*\//.test(c.text('#quizBody .q-meta') || ''), '翻到第 3 题', c.text('#quizBody .q-meta'));

  c.click('#prevQBtn');
  await sleep(150);
  const rv = c.text('#quizBody') || '';
  ok(/第\s*2\s*\/\s*3\s*题\s*·\s*回顾/.test(rv), '进入第 2 题的回顾态', rv.slice(0, 30));
  ok(/你写的是：恒比消除/.test(rv), '回顾里能看到当时自己写的答案', rv.slice(0, 80));
  ok(/正确答案：恒比消除/.test(rv), '回顾里能看到正确答案');
  ok(c.$('#fillInput') === null, '回顾态不再给输入框（不能重复作答）');
  ok((c.text('#quizBody .stem') || '').indexOf('____') < 0, '回顾态的题干也补上了答案');

  c.click('#revPrevBtn');
  await sleep(150);
  ok(/第\s*1\s*\/\s*3/.test(c.text('#quizBody .q-meta') || ''), '还能继续往前翻到第 1 题');
  ok(c.$('#revPrevBtn') === null, '第 1 题没有「更早一题」按钮');

  const before = answerCount(c);
  c.click('#revNextBtn');
  await sleep(150);
  ok(/第\s*2\s*\/\s*3/.test(c.text('#quizBody .q-meta') || ''), '「继续」回到第 2 题');
  c.click('#revNextBtn');
  await sleep(150);
  ok(c.$('#fillInput') !== null, '继续回到进度后恢复答题态', c.text('#quizBody .q-meta'));
  ok(answerCount(c) === before, '回看不会重复计入练习记录', { before: before, after: answerCount(c) });

  /* ---------- 5. 选择题也要能回看 ---------- */
  console.log('\n[5] 选择题的回看');
  const d = bootApp();
  await sleep(150);
  await intoQuiz(d, 'choice');
  const opts1 = d.$$('#optsBox .opt');
  ok(opts1.length > 0, '第 1 题给了选项', opts1.length);
  ok(d.$('#prevQBtn') === null, '选择题第 1 题也没有「上一题」');
  d.clickEl(opts1[0]);
  await sleep(80);
  // 多选题得先选中再点「提交答案」
  if (d.$('#multiSubmit')) { d.click('#multiSubmit'); await sleep(120); }
  ok(/你选：/.test(d.text('#quizFb') || ''), '选择题作答后给出判定', (d.text('#quizFb') || '').slice(0, 40));
  d.click('#nextQBtn');
  await sleep(150);
  ok(!!d.$('#prevQBtn'), '第 2 题出现「上一题」按钮');
  d.click('#prevQBtn');
  await sleep(150);
  const rv2 = d.text('#quizBody') || '';
  ok(/你选的是：/.test(rv2), '选择题回顾里显示当时选的答案', rv2.slice(0, 80));
  ok(/正确答案：/.test(rv2), '选择题回顾里显示正确答案');
  ok(d.$('#optsBox') === null, '选择题回顾态不再给选项按钮');

  /* ---------- 6. 最后一题回看后能走到成绩页 ---------- */
  console.log('\n[6] 最后一题的回顾');
  const e = bootApp();
  await sleep(150);
  await intoQuiz(e, 'fill');
  for (let i = 0; i < 2; i++) {
    e.setVal('#fillInput', '副作用、毒性反应、变态反应三种');
    if (e.$('#fillSubmit')) e.click('#fillSubmit');
    await sleep(120);
    if (e.$('#nextQBtn')) e.click('#nextQBtn');
    await sleep(120);
  }
  ok(/第\s*3\s*\//.test(e.text('#quizBody .q-meta') || ''), '走到第 3 题', e.text('#quizBody .q-meta'));
  e.click('#prevQBtn');
  await sleep(150);
  e.click('#revNextBtn');
  await sleep(150);
  ok(/第\s*3\s*\//.test(e.text('#quizBody .q-meta') || ''), '从第 2 题继续回到第 3 题');
  e.setVal('#fillInput', '药物治疗疾病规律的一门学科');
  e.click('#fillSubmit');
  await sleep(150);
  e.click('#nextQBtn');
  await sleep(200);
  ok(/这一组|正确率|成绩|%/.test(e.text('#quizBody') || ''), '第 3 题作完进入成绩页', (e.text('#quizBody') || '').slice(0, 40));

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})();
