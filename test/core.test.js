'use strict';
/* 核心引擎回归：出题 / 判分 / 刷题 / 背诵 / 错题本 / 顺序 / 题集管理
   确保这次加登录与同步之后，原有功能一处没坏。
   运行： NODE_PATH=<workspace>/node_modules node test/core.test.js            */

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

function bootApp(seedStorage) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  let confirmAnswer = true, promptAnswer = null;
  win.confirm = function () { return confirmAnswer; };
  win.prompt = function (m, d) { return promptAnswer != null ? promptAnswer : d; };
  win.alert = function () {};

  const m = new Map(Object.entries(seedStorage || {}));
  const store = {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); },
    clear: function () { m.clear(); },
    key: function (i) { const a = Array.from(m.keys()); return i < a.length ? a[i] : null; },
    get length() { return m.size; },
    _dump: function () { return Object.fromEntries(m); }
  };
  class FileReaderShim {
    readAsText() { setTimeout(() => { this.result = ''; this.onload && this.onload(); }, 0); }
    readAsArrayBuffer() { setTimeout(() => { this.result = new ArrayBuffer(0); this.onload && this.onload(); }, 0); }
  }
  const RealURL = globalThis.URL;
  if (!RealURL.createObjectURL) RealURL.createObjectURL = function () { return 'blob:mock'; };

  // 没有服务端 → Cloud 自动走离线分支，正好用来测「离线也不能影响原有功能」
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
    visible: function (s) { const e = win.document.querySelector(s); return !!e && !e.hidden; },
    click: function (s) {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到元素：' + s);
      e.dispatchEvent(new win.Event('click', { bubbles: true }));
    },
    clickEl: function (e) { e.dispatchEvent(new win.Event('click', { bubbles: true })); },
    setVal: function (s, v) { const e = win.document.querySelector(s); if (!e) throw new Error('找不到：' + s); e.value = v; },
    store: store,
    setConfirm: function (v) { confirmAnswer = v; },
    setPrompt: function (v) { promptAnswer = v; }
  };
}

const NOTE = [
  '林则徐是开眼看世界的第一人。',
  '太平天国运动爆发的标志是1851年金田起义。',
  '洋务运动的口号是自强、求富。',
  '戊戌变法又称百日维新。',
  '辛亥革命推翻了清王朝的统治。',
  '新文化运动兴起的标志是1915年《青年杂志》创刊。',
  '五四运动是中国新民主主义革命的开端。',
  '中国共产党成立于1921年。'
].join('\n');

(async function main() {
  console.log('\n== 核心引擎回归 ==\n');

  /* ---------- 1. 出题 ---------- */
  console.log('[1] 笔记 → 题目');
  const a = bootApp();
  await sleep(200);
  a.setVal('#noteText', NOTE);
  a.click('#extractBtn');
  await sleep(150);
  const rows = a.$$('#previewBody tr');
  ok(rows.length >= 7, '8 句笔记至少提炼出 7 个知识点（实际 ' + rows.length + '）', rows.length);

  // 题干/答案是可编辑的 input，得读 value（1=勾选框，2=题型，3=题干，4=答案）
  const stems = rows.map(function (r) { return r.querySelector('.p-stem').value; }).join('\n');
  const anss = rows.map(function (r) { return r.querySelector('.p-ans').value; }).join('\n');
  const types = rows.map(function (r) { return r.querySelector('.tag').textContent; }).join(',');
  ok(/林则徐/.test(stems), '「林则徐是……」被识别（「是」兜底没丢）');
  ok(/金田起义/.test(anss), '「……的标志是……」挖在「是」后面', anss.slice(0, 40));
  ok(/自强/.test(anss) && /求富/.test(anss), '「……的口号是……」挖在「是」后面');
  ok(/辛亥革命/.test(stems), '「辛亥革命推翻了……」没有触发词，被兜底转成填空');
  ok(/填空/.test(types), '题型列里出现了「填空」', types);

  // 题目顺序 = 笔记顺序
  a.setVal('#courseName', '中国近代史');
  a.click('#saveBankBtn');
  await sleep(150);
  const banks = JSON.parse(a.store.getItem('fq_banks_v1'));
  const qs = banks[0].questions;
  ok(qs.length === 8, '8 句笔记一道没丢，全部变成题（实际 ' + qs.length + '）', qs.length);
  const fills = qs.filter(function (q) { return q.type === 'fill'; });
  ok(fills.length >= 3, '其中 ' + fills.length + ' 道是没有触发词时兜底出的填空题');
  ok(qs.some(function (q) { return /辛亥革命/.test(q.stem); }), '兜底填空的题干保留了主语部分');
  let ordered = true;
  for (let i = 1; i < qs.length; i++) if ((qs[i].order || 0) < (qs[i - 1].order || 0)) ordered = false;
  ok(ordered, '题目 order 字段按笔记顺序递增');
  ok(qs.every(function (q) { return q.type === 'single' || q.type === 'multi' || q.type === 'fill'; }), '每道题都有合法题型');

  /* ---------- 2. 刷题 ---------- */
  console.log('\n[2] 刷选择题');
  a.click('.tab[data-view="quiz"]');
  await sleep(60);
  a.setVal('#qCount', '0');
  a.click('#quizStartBtn');
  await sleep(150);
  ok(/第\s*1\s*\//.test(a.text('#quizBody')), '进入第 1 题', a.text('#quizBody').slice(0, 60));

  // 交互 6 题：能对就对，不能对就故意错，验证判分与翻页
  let advanced = 0;
  for (let i = 0; i < 6; i++) {
    const opts = a.$$('#optsBox .opt');
    if (opts.length) {
      a.clickEl(opts[0]);
      await sleep(100);
      if (a.$('#multiSubmit')) { a.click('#multiSubmit'); await sleep(100); }
    } else {
      const inp = a.$('#fillInput');
      if (inp) { inp.value = '测试错误答案'; a.click('#fillSubmit'); await sleep(120); }
      else break;
    }
    const next = a.$('#nextQBtn');
    if (next) { a.click('#nextQBtn'); await sleep(120); advanced++; }
  }
  ok(advanced >= 4, '连续作答并翻页 ' + advanced + ' 次');

  const stats = JSON.parse(a.store.getItem('fq_stats_v1') || '{}');
  const statKeys = Object.keys(stats);
  ok(statKeys.length > 0, '作答后写入了练习记录（' + statKeys.length + ' 条）');
  const anyStat = stats[statKeys[0]] || {};
  ok((anyStat.ok + anyStat.bad) > 0, '记录里有对错统计', anyStat);
  ok(typeof anyStat.mastery === 'number' && anyStat.mastery >= 0 && anyStat.mastery <= 1, '掌握度在 0–1 之间', anyStat.mastery);

  /* ---------- 3. 背诵 ---------- */
  console.log('\n[3] 背知识点（苏格拉底式）');
  a.click('.tab[data-view="recite"]');
  await sleep(60);
  a.click('#reciteStartBtn');
  await sleep(150);
  ok(!!a.$('#reciteInput'), '进入背诵模式，出现输入框');

  // 先答错一次
  a.setVal('#reciteInput', '肯定是错的');
  a.click('#reciteSubmit');
  await sleep(150);
  const verdict1 = a.text('#reciteBody');
  ok(/不对|不完全|错了|❌|✗|还差/.test(verdict1) || /正确/.test(verdict1), '作答后立刻给出判定', verdict1.slice(-60));
  ok(/正确/.test(verdict1), '判定里直接给出正确答案', verdict1.slice(-80));

  const nextBtn = a.$('#reciteNext');
  ok(!!nextBtn, '出现「下一问」按钮，可以接着背');
  if (nextBtn) { a.click('#reciteNext'); await sleep(150); }

  // 再答对一次（用真实答案）
  const q0 = JSON.parse(a.store.getItem('fq_banks_v1'))[0].questions[0];
  const realAnswer = Array.isArray(q0.answer) ? q0.answer.join('、') : q0.answer;
  a.setVal('#reciteInput', realAnswer);
  a.click('#reciteSubmit');
  await sleep(150);
  ok(/对|✓|正确/.test(a.text('#reciteBody')), '回答正确时给出正面判定');

  /* ---------- 4. 错题本 ---------- */
  console.log('\n[4] 错题本');
  a.click('.tab[data-view="wrong"]');
  await sleep(150);
  ok(a.$$('#wrongList .item').length > 0 || /没有|暂无/.test(a.text('#wrongList')), '错题本正常渲染', a.text('#wrongList').slice(0, 40));

  /* ---------- 5. 统计 ---------- */
  console.log('\n[5] 数据统计');
  a.click('.tab[data-view="stats"]');
  await sleep(150);
  ok(a.$$('#kpis .kpi').length >= 3, '统计卡片渲染出 KPI', a.$$('#kpis .kpi').length);
  ok(a.$$('#weakList .item').length > 0, '薄弱知识点列表有内容', a.$$('#weakList .item').length);
  ok(a.visible('#acctCard'), '账号卡片存在');
  ok(a.visible('#adminCard') === false, '离线/游客时站长看板隐藏');

  /* ---------- 6. 题集管理 ---------- */
  console.log('\n[6] 题集管理');
  a.setVal('#noteText', '药理学笔记。阿司匹林的作用机制是抑制环氧酶。');
  a.click('#extractBtn');
  await sleep(120);
  a.setVal('#courseName', '药理学');
  a.click('#saveBankBtn');
  await sleep(150);
  ok(a.$$('#bankList .bank-item').length === 2, '第二个课程单独成为一个题集', a.$$('#bankList .bank-item').length);

  // 右键菜单
  const item = a.$('#bankList .bank-item');
  const ev = new a.win.MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 });
  item.dispatchEvent(ev);
  await sleep(60);
  ok(a.visible('#ctxMenu'), '右键题集弹出菜单');
  ok(a.$$('#ctxMenu button').length === 6, '菜单有 6 个操作（多了「分享到广场」）', a.$$('#ctxMenu button').length);
  ok(/分享到广场/.test(a.$('#ctxMenu').textContent), '菜单里确实有分享入口');

  // 删除
  a.clickEl(a.$('#ctxMenu button[data-act="del"]'));
  await sleep(150);
  ok(a.$$('#bankList .bank-item').length === 1, '删除后只剩 1 个题集', a.$$('#bankList .bank-item').length);
  ok(a.visible('#ctxMenu') === false, '删除后菜单关闭');

  /* ---------- 7. 顺序 / 乱序 ---------- */
  console.log('\n[7] 顺序与乱序');
  const b = bootApp();
  await sleep(150);
  b.setVal('#noteText', NOTE);
  b.click('#extractBtn');
  await sleep(120);
  b.setVal('#courseName', '顺序测试');
  b.click('#saveBankBtn');
  await sleep(120);
  b.click('.tab[data-view="quiz"]');
  await sleep(60);
  b.setVal('#qCount', '0');
  b.setVal('#qOrder', 'seq');
  b.click('#quizStartBtn');
  await sleep(150);
  ok(/顺序：跟着笔记走/.test(b.text('#qOrder')), '默认顺序是「跟着笔记走」');

  /* ---------- 8. 形式切换 ---------- */
  console.log('\n[8] 出题形式');
  ok(b.$$('#qForm option').length === 3, '形式下拉有 3 个选项（混合 / 全选择 / 全填空）');
  b.setVal('#qForm', 'fill');
  b.click('#quizStartBtn');
  await sleep(150);
  ok(!!b.$('#fillInput') || !!b.$('#reciteInput'), '「全部考填空」时直接给填空框');

  b.setVal('#qForm', 'choice');
  b.click('#quizStartBtn');
  await sleep(150);
  ok(b.$$('#optsBox .opt').length > 0, '「全部给选项」时给出选项', b.$$('#optsBox .opt').length);

  console.log('\n[9] 弹窗遮挡（登录页把人卡死那个 bug）');
  const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  ok(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(CSS),
    '.modal/.file-chip 的 display:flex 不会盖掉 hidden 属性');
  ok(/\.modal\s*\{[^}]*display:\s*flex/.test(CSS),
    '确认弹窗本身确实是 flex 布局（说明上面那条兜底是必要的，不是空跑）');
  ok(!!b.$('#authModal').hasAttribute('hidden'), '初始状态弹窗带 hidden');
  ok(String(b.win.getComputedStyle(b.$('#authModal')).display) !== 'flex',
    '初始状态弹窗不占据屏幕', String(b.win.getComputedStyle(b.$('#authModal')).display));

  console.log('\n[10] 切页面：五个视图都得能显示出来');
  // 只切 .active 类是不够的：HTML 里 ②~⑤ 自带 hidden，而 [hidden] 那条是 !important，
  // 属性不摘掉的话点导航永远停在导入页，其余四页看着就是一片空白。
  b.click('.tab[data-view="import"]');
  ok(b.visible('#view-import'), '切到导入页能显示');
  ['quiz', 'recite', 'wrong', 'stats'].forEach(function (name) {
    b.click('.tab[data-view="' + name + '"]');
    ok(b.visible('#view-' + name), '切到「' + name + '」这一页显示出来了', {
      hidden: b.$('#view-' + name).hidden,
      cls: b.$('#view-' + name).className
    });
    ok(!b.visible('#view-import'), '切走后导入页收起来（不会两页叠一起）');
  });
  b.click('.tab[data-view="import"]');
  ok(b.visible('#view-import'), '能切回导入页');
  ok(b.$$('.view:not([hidden])').length === 1, '任何时刻只有一个视图是显示的',
    b.$$('.view:not([hidden])').length);

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('\n测试崩溃：', e);
  process.exit(1);
});
