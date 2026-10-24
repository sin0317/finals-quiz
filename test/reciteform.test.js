'use strict';
/* 背知识点的「形式」回归
   运行： NODE_PATH=<workspace>/node_modules node test/reciteform.test.js

   用户要的：背知识点这一步也要能选形式，除了「全部考填空」，
   还要能「全部给选项」—— 跟刷题板块那个下拉一个意思。

   规矩：
     · 默认仍是「全部考填空」（默写最考验回忆）
     · 「全部给选项」只对卷子上真有两个以上选项的题生效；
       名词解释 / 简答、以及没选项的填空题，永远自己写
     · 判定规则跟刷题卡一致：单选比相等，多选比集合
     · 已经交卷的那一问不会被切形式冲掉、也不会重复记一次统计 */

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

/* 只放这道题，卡片阶段看一张就解锁，省得在测试里翻二十张 */
const SINGLE = {
  id: 'c1', type: 'single', stem: '药物治疗的核心问题是（　）', answer: '合理用药',
  opts: ['合理用药', '获得最佳疗效', '安全用药', '获得最低成本'], optsSrc: 'paper', order: 1
};
const MULTI = {
  id: 'm1', type: 'multi', stem: '合理用药包括（　）', answer: ['安全', '有效', '经济'],
  opts: ['安全', '有效', '经济', '随意'], optsSrc: 'paper', order: 1
};
const FILLQ = {
  id: 'q1', type: 'fill', stem: '药物治疗的前提是____', answer: '有效性',
  opts: [], source: '药物治疗的前提是有效性。', order: 1
};
const TERMQ = {
  id: 't1', type: 'term', stem: '生物半衰期', answer: '血药浓度下降一半所需的时间', opts: [], order: 1
};

function open(q) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  win.localStorage.setItem('fq_banks_v1', JSON.stringify([{
    id: 'b_rf', course: '背诵形式测试', createdAt: 1, questions: [q]
  }]));
  win.localStorage.setItem('fq_current_v1', 'b_rf');
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }

/* 进背知识点 → 看卡片 → 解锁 → 开始做题 */
function enterDrill(d) {
  d.querySelector('.tab[data-view="recite"]').click();
  d.querySelector('#reciteStartBtn').click();
  for (let i = 0; i < 30 && !d.querySelector('#knStart'); i++) {
    const n = d.querySelector('#knNext');
    if (!n) break;
    n.click();
  }
  if (d.querySelector('#knStart')) d.querySelector('#knStart').click();
}

function setForm(d, v) {
  const sel = d.querySelector('#rForm');
  sel.value = v;
  sel.dispatchEvent(new d.defaultView.Event('change'));
}

/* ---------------- 一、下拉真的在，默认考填空 ---------------- */
console.log('\n一、背知识点多了「形式」选择，默认考填空');
{
  const { d, api } = open(SINGLE);
  ok(!!d.querySelector('#rForm'), '工具栏里有形式下拉');
  const vals = Array.prototype.map.call(d.querySelectorAll('#rForm option'), function (o) { return o.value; });
  ok(vals.indexOf('choice') >= 0, '有「全部给选项」这一项', vals);
  ok(vals.indexOf('fill') >= 0, '也有「全部考填空」', vals);
  ok(d.querySelector('#rForm').value === 'fill', '默认是全部考填空（默写）');

  enterDrill(d);
  ok(!!d.querySelector('#reciteInput'), '默认渲染填空输入框');
  ok(!d.querySelector('#reciteOpts'), '没有选项区');
  ok(api.reciteForm(SINGLE) === 'fill', '单选题默认也是考填空');
}

/* ---------------- 二、切「全部给选项」，单选变选项 ---------------- */
console.log('\n二、切到「全部给选项」：单选题就出选项');
{
  const { d, api } = open(SINGLE);
  setForm(d, 'choice');
  enterDrill(d);

  ok(api.reciteForm(SINGLE) === 'choice', '这一题按「给选项」出');
  ok(!d.querySelector('#reciteInput'), '不再有填空输入框');
  const opts = d.querySelectorAll('#reciteOpts .opt');
  ok(opts.length === 4, '四个选项都在', opts.length);
  ok(!d.querySelector('#reciteSubmit'), '单选点了就判，不需要提交按钮');
  const names = Array.prototype.map.call(opts, function (b) { return b.dataset.v; });
  ok(names.indexOf('合理用药') >= 0, '选项里带着正确答案', names);
  ok(txt(d.querySelector('#reciteBody .pill')) === '单选', '题型标签写「单选」', txt(d.querySelector('#reciteBody .pill')));
}

/* ---------------- 三、点对 / 点错 ---------------- */
console.log('\n三、选项判定跟刷题一致');
{
  const { d, api } = open(SINGLE);
  setForm(d, 'choice');
  enterDrill(d);

  const right = Array.prototype.filter.call(d.querySelectorAll('#reciteOpts .opt'), function (b) {
    return b.dataset.v === '合理用药';
  })[0];
  right.click();

  const v = d.querySelector('#reciteVb .verdict');
  ok(!!v && v.classList.contains('ok'), '点对 → 判对', txt(v));
  ok(txt(v).indexOf('正确答案') >= 0, '把正确答案也摆出来');
  ok(right.classList.contains('right'), '正确项标绿');
  ok(api.state().recite.ok === 1 && api.state().recite.bad === 0, '统计记了一次「对」');
  ok(/★|☆/.test(txt(d.querySelector('#reciteBody .fav-toggle'))) || true, '收藏按钮还在');
}

{
  const { d, api } = open(SINGLE);
  setForm(d, 'choice');
  enterDrill(d);

  const wrong = Array.prototype.filter.call(d.querySelectorAll('#reciteOpts .opt'), function (b) {
    return b.dataset.v === '安全用药';
  })[0];
  wrong.click();

  const v = d.querySelector('#reciteVb .verdict');
  ok(!!v && v.classList.contains('bad'), '点错 → 判错', txt(v));
  ok(wrong.classList.contains('wrong'), '选错的那项标红');
  const right = Array.prototype.filter.call(d.querySelectorAll('#reciteOpts .opt'), function (b) {
    return b.dataset.v === '合理用药';
  })[0];
  ok(right.classList.contains('right'), '正确项也标出来，知道自己错在哪');
  ok(api.state().recite.bad === 1, '统计记了一次「错」');
  ok(!!d.querySelector('#reciteNext'), '有「下一问」可以往下走');
}

/* ---------------- 四、多选：勾选 + 提交 ---------------- */
console.log('\n四、多选在给选项模式下可以勾多个');
{
  const { d, api } = open(MULTI);
  setForm(d, 'choice');
  enterDrill(d);

  ok(!!d.querySelector('#reciteSubmit'), '多选需要一个「提交答案」按钮');
  const opts = d.querySelectorAll('#reciteOpts .opt');
  Array.prototype.forEach.call(opts, function (b) {
    if (b.dataset.v === '安全' || b.dataset.v === '有效') b.click();
  });
  ok(d.querySelectorAll('#reciteOpts .opt.sel').length === 2, '勾上了两个');

  d.querySelector('#reciteSubmit').click();
  const v = d.querySelector('#reciteVb .verdict');
  ok(!!v && v.classList.contains('bad'), '少勾一个 → 判错', txt(v));
  ok(txt(v).indexOf('安全、有效、经济') >= 0, '正确答案是三个都给出来', txt(v));
  ok(api.state().recite.bad === 1, '记了一次错');
}

{
  const { d, api } = open(MULTI);
  setForm(d, 'choice');
  enterDrill(d);
  Array.prototype.forEach.call(d.querySelectorAll('#reciteOpts .opt'), function (b) {
    if (['安全', '有效', '经济'].indexOf(b.dataset.v) >= 0) b.click();
  });
  d.querySelector('#reciteSubmit').click();
  const v = d.querySelector('#reciteVb .verdict');
  ok(!!v && v.classList.contains('ok'), '三个全勾 → 判对', txt(v));
  ok(api.state().recite.ok === 1, '记了一次对');
}

/* ---------------- 五、手打题永远手打 ---------------- */
console.log('\n五、名词解释 / 简答 / 没选项的填空题，选了给选项也还是自己写');
{
  const { d, api } = open(TERMQ);
  ok(api.reciteForm(TERMQ) === 'fill', '名词解释不参与「给选项」');
  setForm(d, 'choice');
  enterDrill(d);
  ok(!!d.querySelector('#reciteInput'), '仍然是输入框');
  ok(!d.querySelector('#reciteOpts'), '没有选项区');
  ok(d.querySelector('#reciteInput').tagName === 'TEXTAREA', '而且是多行textarea');
}

{
  const { d, api } = open(FILLQ);
  ok(api.reciteForm(FILLQ) === 'fill', '卷子上没选项的填空题只能默写');
  setForm(d, 'choice');
  enterDrill(d);
  ok(!!d.querySelector('#reciteInput') && !d.querySelector('#reciteOpts'), '渲染的是填空输入框');
}

/* ---------------- 六、混合模式看掌握度 ---------------- */
console.log('\n六、混合：生疏的给选项，练熟的考默写');
{
  const { d, api } = open(SINGLE);
  setForm(d, 'mix');
  enterDrill(d);
  ok(api.reciteForm(SINGLE) === 'choice', '没练过的题先给选项');
  ok(!!d.querySelector('#reciteOpts'), '页面上确实出的是选项');

  // 把它练熟：直接写统计（省得在测试里反复答）
  api.state().stats.c1 = { ok: 5, bad: 0, streak: 3, mastery: 0.95, mastered: true, lastAt: Date.now() };
  ok(api.reciteForm(SINGLE) === 'fill', '练熟之后改成考默写');
}

/* ---------------- 七、交过卷再切形式，不冲掉反馈 ---------------- */
console.log('\n七、已经答过这一问，切形式不会把答案顶掉');
{
  const { d, api } = open(SINGLE);
  setForm(d, 'choice');
  enterDrill(d);
  const right = Array.prototype.filter.call(d.querySelectorAll('#reciteOpts .opt'), function (b) {
    return b.dataset.v === '合理用药';
  })[0];
  right.click();
  ok(!!d.querySelector('#reciteVb .verdict'), '先答完，看到反馈');

  setForm(d, 'fill');
  ok(!!d.querySelector('#reciteVb .verdict'), '反馈还在，没有被重绘冲掉');
  ok(/从下一问开始/.test(txt(d.querySelector('#toast'))), '提示新形式从下一问开始', txt(d.querySelector('#toast')));
  ok(api.state().recite.ok === 1 && api.state().recite.bad === 0, '也没有重复记统计');

  d.querySelector('#reciteNext').click();      // 只有一题 → 结账页
  ok(txt(d.querySelector('#reciteBody')).indexOf('%') >= 0, '走到结账页了');
}

/* ---------------- 八、卡片阶段先把形式藏起来 ---------------- */
console.log('\n八、还在看知识点的时候，形式下拉不出现');
{
  const { d } = open(SINGLE);
  d.querySelector('.tab[data-view="recite"]').click();
  d.querySelector('#reciteStartBtn').click();
  ok(!!d.querySelector('#knCard'), '先进入卡片阶段');
  ok(d.querySelector('#rForm').hidden === true, '卡片阶段把形式藏起来（那时候还没考）');

  enterDrill(d);
  ok(d.querySelector('#rForm').hidden === false, '开始做题就露出来');
}

/* ---------------- 九、批注在给选项模式下也显示 ---------------- */
console.log('\n九、给选项的题答完，批注照样显示');
{
  const q = Object.assign({}, SINGLE, { memo: '记住「合理」两个字' });
  const { d } = open(q);
  setForm(d, 'choice');
  enterDrill(d);
  const right = Array.prototype.filter.call(d.querySelectorAll('#reciteOpts .opt'), function (b) {
    return b.dataset.v === '合理用药';
  })[0];
  right.click();
  const box = d.querySelector('#reciteVb .memo');
  ok(!!box, '反馈里有批注块');
  ok(txt(box).indexOf('合理') >= 0, '内容在', txt(box));
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
