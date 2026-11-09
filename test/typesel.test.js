'use strict';
/* 题型下拉只列题库里真有的题型
   运行： NODE_PATH=<workspace>/node_modules node test/typesel.test.js

   用户报的问题（原话）：「我传这个文件只有单选和多选，这里竟然还识别出这么多题型」。
   老版 #qType 的六项是写死在 index.html 里的，跟题库里有几种题型无关 ——
   导一份只有单选/多选的卷子，下拉里照样摆着填空、名词解释、简答。

   这里守的线：
     ① 题库里没有的题型，下拉里看不到（hidden + display:none，不是删掉）
     ② 有几种就显示几种，并带上道数
     ③ 换了题集、之前选的题型没题了 → 退回「全部」，别让人抽个空
     ④ 选项不删 DOM：别处还会按 value 赋值，删了会赋不上                              */

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

const q = (id, type) => ({
  id, type,
  stem: '题干' + id + '（　）',
  answer: '答案' + id,
  opts: type === 'single' || type === 'multi' ? ['答案' + id, '干扰一', '干扰二', '干扰三'] : [],
  optsSrc: type === 'single' || type === 'multi' ? 'paper' : null,
  fromPaper: type === 'single' || type === 'multi',
  chapter: '第一章', source: '题干' + id, order: 0
});

function boot(bankQs) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.prompt = function (m, d) { return d; };
  win.alert = function () {};

  const store = {};
  if (bankQs) {
    store.fq_banks_v1 = JSON.stringify([{ id: 'b_t', course: '测试课', createdAt: 1, questions: bankQs }]);
    store.fq_current_v1 = 'b_t';
  }
  const m = new Map(Object.keys(store).map((k) => [k, store[k]]));
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
  const U = globalThis.URL;
  if (!U.createObjectURL) U.createObjectURL = () => 'blob:mock';

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator', APP_SRC
  );
  fn(win, win.document, ls, () => Promise.reject(new TypeError('no fetch')), win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval, win.Blob || globalThis.Blob, U, class {}, win.crypto, win.navigator);

  return { win, d: win.document, api: win.FQInternals };
}

/* 下拉里「看得见」的选项：hidden 和 display:none 都算看不见 */
function shown(d) {
  const sel = d.querySelector('#qType');
  return Array.from(sel.options)
    .filter((o) => !o.hidden && o.style.display !== 'none')
    .map((o) => o.value);
}
function labelOf(d, val) {
  const sel = d.querySelector('#qType');
  const o = Array.from(sel.options).filter((x) => x.value === val)[0];
  return o ? o.textContent : null;
}

/* ---------------- 一、只有单选和多选（用户这份卷子） ---------------- */
console.log('\n一、题库里只有单选 + 多选：下拉就只该有这两项');
{
  const qs = [q('a1', 'single'), q('a2', 'single'), q('a3', 'multi')];
  const { d, api } = boot(qs);
  api.syncTypeOptions();
  ok(JSON.stringify(shown(d)) === JSON.stringify(['all', 'single', 'multi']),
    '看得见的只有 全部 / 单选 / 多选', shown(d));
  ok(labelOf(d, 'single') === '单选（2）', '单选后面带道数', labelOf(d, 'single'));
  ok(labelOf(d, 'multi') === '多选（1）', '多选后面带道数', labelOf(d, 'multi'));
  ok(d.querySelector('#qType').value === 'all', '默认还是「全部」');
}

/* ---------------- 二、真有填空，才让填空露面 ---------------- */
console.log('\n二、题库里有填空：填空才出现，名词解释/简答仍然不出现');
{
  const qs = [q('b1', 'single'), q('b2', 'fill'), q('b3', 'fill')];
  const { d, api } = boot(qs);
  api.syncTypeOptions();
  ok(shown(d).indexOf('fill') >= 0, '填空露面了', shown(d));
  ok(shown(d).indexOf('term') < 0, '名词解释没露面');
  ok(shown(d).indexOf('short') < 0, '简答没露面');
  ok(labelOf(d, 'fill') === '填空（2）', '填空带道数', labelOf(d, 'fill'));
}

/* ---------------- 三、旧题型别留着当筛子 ---------------- */
console.log('\n三、选中的题型在题库里没题（换过题集 / 题被删了）：自动退回全部');
{
  const qs = [q('c1', 'single'), q('c2', 'single')];
  const { d, api } = boot(qs);
  api.syncTypeOptions();
  const sel = d.querySelector('#qType');
  sel.value = 'fill';                       // 上一次留下的筛选（或恢复出来的）
  ok(sel.value === 'fill', '先停在「填空」上');
  api.syncTypeOptions();
  ok(sel.value === 'all', '这本题集一道填空都没有，退回「全部」', sel.value);
}

/* ---------------- 四、选项不删 DOM ---------------- */
console.log('\n四、看不见的题型还在 DOM 里，按 value 还能赋值');
{
  const qs = [q('d1', 'single')];
  const { d, api } = boot(qs);
  api.syncTypeOptions();
  const sel = d.querySelector('#qType');
  const term = Array.from(sel.options).filter((o) => o.value === 'term')[0];
  ok(!!term, '名词解释这个 option 还在');
  ok(term.hidden === true, '只是被藏起来了');
  ok(term.style.display === 'none', 'display 也设成 none（老浏览器只认这个）');
  sel.value = 'term';
  ok(sel.value === 'term', '仍能按 value 赋值（别处赋值不会失败）');
}

/* ---------------- 五、空题库：只剩「全部」，不留半截选项 ---------------- */
console.log('\n五、还没导入任何题：下拉只剩「全部」');
{
  const { d, api } = boot(null);
  api.syncTypeOptions();
  ok(JSON.stringify(shown(d)) === JSON.stringify(['all']), '只有全部', shown(d));
}

console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '（' + pass + ' 项）');
process.exit(fail ? 1 : 0);
