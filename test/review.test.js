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
  ok(a.$('#qAutoNext') === null && a.$('#rAutoNext') === null,
    '两个「自动下一题」开关都已经去掉，不会再自己翻页');
  ok(a.$('#prevQBtn') === null, '第 1 题没有「上一题」按钮（前面没题）');

  a.setVal('#fillInput', '随便乱写一个');
  a.click('#fillSubmit');
  await sleep(150);
  const fb1 = a.text('#quizFb') || '';
  ok(/记错了|记住了大半|正确/.test(fb1), '提交后给出了判定结果', fb1.slice(0, 40));
  ok(/正确答案/.test(fb1), '判定里明确写了「正确答案」', fb1.slice(0, 80));
  ok(/完整表述/.test(fb1), '还给了整句的完整表述', fb1.slice(0, 80));
  const stem1 = a.text('#quizBody .stem') || '';
  ok(stem1.indexOf('____') < 0 && stem1.indexOf('________') < 0, '题干那个空已经被答案填上', stem1.slice(0, 40));
  ok(!!a.$('#quizBody .stem .blank-mark.filled'), '填入的答案有高亮标记');
  ok(/手打题不会自动跳/.test(fb1), '明确告诉用户手打题不会自己跳走', fb1.slice(-60));
  ok(!/秒后自动下一题/.test(fb1), '填空不再出现「几秒后自动跳」，省得以为答案会消失');
  await sleep(6500);                       // 以前答对 6 秒就跳，现在多久都不跳
  ok(/第\s*1\s*\//.test(a.text('#quizBody .q-meta') || ''),
    '等 6.5 秒仍停在第 1 题，答案没被顶掉', a.text('#quizBody .q-meta'));
  ok(!!a.$('#quizFb .verdict'), '答案卡片还在，没有被下一题顶掉');

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
  console.log('\n[3] 只有点了「下一题」才翻页');
  const c = bootApp();
  await sleep(150);
  await intoQuiz(c, 'fill');
  c.setVal('#fillInput', '副作用、毒性反应、变态反应三种');
  c.click('#fillSubmit');
  await sleep(100);
  ok(/第\s*1\s*\//.test(c.text('#quizBody .q-meta') || ''), '提交后仍停在第 1 题', c.text('#quizBody .q-meta'));
  c.click('#nextQBtn');          // 只有这一下才该翻页
  await sleep(100);
  ok(/第\s*2\s*\//.test(c.text('#quizBody .q-meta') || ''), '手动点「下一题」才翻到第 2 题', c.text('#quizBody .q-meta'));
  c.setVal('#fillInput', '恒比');
  await sleep(6000);
  ok(/第\s*2\s*\//.test(c.text('#quizBody .q-meta') || ''), '第 1 题没有遗留定时器把第 2 题切走');
  ok(c.$('#fillInput') && c.$('#fillInput').value === '恒比', '打了一半的内容还在，没被清掉');

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

  /* ---------- 7. 反馈落在屏幕外时必须滚进来 ---------- */
  // 这是「电脑端看不到答案、要点上一题才看得到」的根子：
  // block:'nearest' 只要元素露一丁点边就不滚，桌面视口又高，反馈整块待在屏幕下方。
  console.log('\n[7] 反馈卡片出屏时会被滚进视口');
  const f = bootApp();
  await sleep(150);
  try {
    Object.defineProperty(f.win.document.documentElement, 'clientHeight', { value: 800, configurable: true });
  } catch (err) { /* 老实现不可改，下面 getBoundingClientRect 照样能测 */ }
  const scrolls = [];
  f.win.Element.prototype.scrollIntoView = function (opt) { scrolls.push(opt || {}); };
  await intoQuiz(f, 'fill');

  // 假装反馈卡片整块落在视口下方（top 820 > 视口高 800）
  const fbBox = f.$('#quizFb');
  fbBox.getBoundingClientRect = function () {
    return { top: 820, bottom: 980, left: 0, right: 600, width: 600, height: 160 };
  };
  f.setVal('#fillInput', '随便写点什么');
  f.click('#fillSubmit');
  await sleep(150);
  ok(scrolls.length > 0, '反馈在屏幕外时主动滚过去');
  ok(scrolls.some(function (o) { return o.block === 'center'; }),
    '滚到视口中间，不会被吸顶的顶栏压住', scrolls);

  // 反过来：已经在视口里就别瞎滚，免得打断阅读
  scrolls.length = 0;
  if (f.$('#nextQBtn')) { f.click('#nextQBtn'); await sleep(120); }
  const fbBox2 = f.$('#quizFb');
  if (fbBox2) {
    fbBox2.getBoundingClientRect = function () {
      return { top: 120, bottom: 280, left: 0, right: 600, width: 600, height: 160 };
    };
    if (f.$('#fillInput')) {
      f.setVal('#fillInput', '再来一个');
      f.click('#fillSubmit');
      await sleep(150);
      ok(scrolls.length === 0, '反馈本来就在视口里时不乱滚', scrolls);
    }
  }

  /* ---------- 8. 答对也要给出正确答案；中途取消自动跳要生效 ---------- */
  console.log('\n[8] 答对时的答案展示，以及不会自己跳走');
  const g = bootApp();
  await sleep(150);
  await intoQuiz(g, 'fill');
  ok(g.$('#qAutoNext') === null, '新的一轮里也没有「自动下一题」这个开关了');

  const banks = JSON.parse(g.store.getItem('fq_banks_v1') || '[]');
  const curId = g.store.getItem('fq_current_v1');
  const bank = banks.filter(function (b) { return b.id === curId; })[0] || banks[banks.length - 1];
  const q0 = bank.questions[0];
  const ans0 = Array.isArray(q0.answer) ? q0.answer[0] : q0.answer;
  ok(g.text('#quizBody .stem').indexOf(q0.stem.replace('____', '').slice(0, 6)) >= 0,
    '第一道题就是题库第一题（顺序跟着笔记走）', g.text('#quizBody .stem').slice(0, 30));

  g.setVal('#fillInput', ans0);
  g.click('#fillSubmit');
  await sleep(150);
  const fbOk = g.text('#quizFb') || '';
  ok(/正确/.test(fbOk), '答对了有判定', fbOk.slice(0, 40));
  ok(/正确答案/.test(fbOk), '答对时也明确写出「正确答案」', fbOk.slice(0, 80));
  ok(fbOk.indexOf(ans0) >= 0, '写出来的就是那个标准答案', ans0);
  ok(fbOk.indexOf('手打题不会自动跳') >= 0, '答对时也说明这题不会自己跳走');

  // 等够 9 秒以上，仍然停在第 1 题
  await sleep(9500);
  ok(/第\s*1\s*\//.test(g.text('#quizBody .q-meta') || ''),
    '过了 9 秒仍停在答对这一题，答案没被顶掉', g.text('#quizBody .q-meta'));
  ok(!!g.$('#quizFb .verdict'), '反馈卡片没有被下一题顶掉');

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})();
