'use strict';
/* 收藏 / 收藏夹回归
   运行： NODE_PATH=<workspace>/node_modules node test/fav.test.js

   用户要的：刷题时能收藏单道题，「错题本」旁边多一个「收藏夹」，
   进去能看、能管（背它 / 取消收藏 / 清空 / 只刷收藏的题）。
   收藏记在题目自己身上（q.fav 时间戳），所以换题集、导出再导入都跟着走。 */

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
  return { win, api };
}

function makeBank(n, id) {
  const questions = [];
  for (let i = 1; i <= n; i++) {
    questions.push({
      id: 'q' + i, type: 'fill', stem: '第' + i + '题：这个考点的答案是____', answer: '答案' + i,
      opts: [], source: '第' + i + '题：这个考点的答案是答案' + i + '。', order: i
    });
  }
  return [{ id: id || 'b_fav', course: '收藏夹测试', createdAt: 1, questions: questions }];
}

function seed(extra) {
  return Object.assign({ fq_banks_v1: JSON.stringify(makeBank(5)), fq_current_v1: 'b_fav' }, extra || {});
}

function bankOf(win) {
  return JSON.parse(win.localStorage.getItem('fq_banks_v1'))[0];
}
function startGroup(d, count) {
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qMode').value = 'new';
  d.querySelector('#qCount').value = String(count || 5);
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();
}
function txt(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

/* ---------------- 一、刷题卡上收藏单道题 ---------------- */
console.log('\n一、刷题时点「☆ 收藏」');
{
  const { win, api } = openWin(seed());
  const d = win.document;
  startGroup(d, 5);

  const btn = d.querySelector('#quizBody .fav-toggle');
  ok(!!btn, '刷题卡右上角有收藏按钮');
  ok(/☆ 收藏/.test(txt(btn)), '默认是未收藏状态', txt(btn));
  ok(btn.classList.contains('on') === false, '未收藏时没有高亮样式');

  btn.click();
  ok(/★ 已收藏/.test(txt(d.querySelector('#quizBody .fav-toggle'))), '点一下变成已收藏', txt(d.querySelector('#quizBody .fav-toggle')));
  ok(d.querySelector('#quizBody .fav-toggle').classList.contains('on'), '已收藏有高亮样式');

  const q1 = bankOf(win).questions[0];
  ok(typeof q1.fav === 'number' && q1.fav > 0, '收藏时间戳落到了本地存档里', q1.fav);

  // 再点一次取消
  d.querySelector('#quizBody .fav-toggle').click();
  ok(!bankOf(win).questions[0].fav, '再点一下取消收藏，时间戳被删掉');
  ok(/☆ 收藏/.test(txt(d.querySelector('#quizBody .fav-toggle'))), '按钮回到未收藏样式');

  ok(api.state().quiz.idx === 0, '收藏不打断作答：还停在第 1 题', api.state().quiz.idx);
}

/* ---------------- 二、回顾态也能收藏 ---------------- */
console.log('\n二、答过的题回看时也能收藏');
{
  const { win } = openWin(seed());
  const d = win.document;
  startGroup(d, 5);
  d.querySelector('#fillInput').value = '答案1';
  d.querySelector('#fillSubmit').click();
  d.querySelector('#nextQBtn').click();          // 到第 2 题
  d.querySelector('#prevQBtn').click();          // 再回到第 1 题的回顾态
  const btn = d.querySelector('#quizBody .fav-toggle');
  ok(!!btn, '回顾态卡片上也有收藏按钮');
  btn.click();
  ok(/★ 已收藏/.test(txt(d.querySelector('#quizBody .fav-toggle'))), '回顾态点了也生效');
  ok(!!bankOf(win).questions[0].fav, '存档里记下了');
}

/* ---------------- 三、收藏夹入口与列表 ---------------- */
console.log('\n三、收藏夹页签');
{
  const { win, api } = openWin(seed());
  const d = win.document;

  ok(!!d.querySelector('.tab[data-view="fav"]'), '有一个「收藏夹」页签');
  ok(/收藏夹/.test(txt(d.querySelector('.tab[data-view="fav"]'))), '页签文案写着收藏夹');
  const tabs = Array.from(d.querySelectorAll('.tab')).map(function (t) { return t.dataset.view; });
  ok(tabs.indexOf('fav') === tabs.indexOf('wrong') + 1, '就排在错题本后面', tabs);
  ok(!!d.querySelector('#view-fav'), '收藏夹页面存在');

  // 空态
  d.querySelector('.tab[data-view="fav"]').click();
  ok(d.querySelector('#view-fav').hidden === false, '切过去能看到这一页');
  ok(/收藏夹是空的/.test(txt(d.querySelector('#favList'))), '没收藏时给空状态说明', txt(d.querySelector('#favList')).slice(0, 40));

  // 收藏两道再看
  api.toggleFav('q2');
  api.toggleFav('q4');
  d.querySelector('.tab[data-view="wrong"]').click();
  d.querySelector('.tab[data-view="fav"]').click();
  const items = d.querySelectorAll('#favList .item');
  ok(items.length === 2, '收藏了两道，列表就两条', items.length);
  const list = txt(d.querySelector('#favList'));
  ok(list.indexOf('第2题') >= 0 && list.indexOf('第4题') >= 0, '题目内容都在', list.slice(0, 60));
  ok(list.indexOf('第1题') < 0, '没收藏的题不会混进来');
  ok(/正确答案：答案2/.test(list), '列表里直接能看到正确答案');

  // 排序：新收藏的在前
  const first = txt(items[0]);
  ok(first.indexOf('第4题') >= 0, '按收藏时间新→旧排（后收藏的第 4 题在前）', first.slice(0, 30));

  // 列表里的星星可以点掉
  d.querySelector('#favList .fav-toggle').click();
  ok(d.querySelectorAll('#favList .item').length === 1, '在收藏夹里点★就取消收藏', d.querySelectorAll('#favList .item').length);
}

/* ---------------- 四、只刷收藏的题 ---------------- */
console.log('\n四、范围选「只刷收藏」');
{
  const { win, api } = openWin(seed());
  const d = win.document;
  api.toggleFav('q1');
  api.toggleFav('q3');
  api.toggleFav('q5');

  const opt = d.querySelector('#qRange option[value="fav"]');
  ok(!!opt, '刷题的范围下拉里有「只刷收藏」');

  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qRange').value = 'fav';
  d.querySelector('#qCount').value = '0';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#qMode').value = 'new';
  d.querySelector('#quizStartBtn').click();
  const st = api.state().quiz;
  ok(st.list.length === 3, '只抽到收藏的那 3 道', st.list.length);
  ok(st.list.every(function (q) { return q.fav; }), '抽出来的每道都是收藏过的');

  // 收藏夹里的「刷收藏的题」按钮走同一条路
  const { win: w2, api: a2 } = openWin(seed());
  const d2 = w2.document;
  a2.toggleFav('q2');
  d2.querySelector('.tab[data-view="fav"]').click();
  d2.querySelector('#favDrillBtn').click();
  ok(a2.state().quiz && a2.state().quiz.list.length === 1, '点「刷收藏的题」直接开一组', a2.state().quiz && a2.state().quiz.list.length);
  ok(d2.querySelector('#view-quiz').hidden === false, '并且跳到了刷题页');
}

/* ---------------- 五、清空收藏 ---------------- */
console.log('\n五、清空收藏');
{
  const { win, api } = openWin(seed());
  const d = win.document;
  api.toggleFav('q1'); api.toggleFav('q2');
  d.querySelector('.tab[data-view="fav"]').click();
  d.querySelector('#favClearBtn').click();
  ok(api.state().banks[0].questions.every(function (q) { return !q.fav; }), '全部取消收藏');
  ok(/收藏夹是空的/.test(txt(d.querySelector('#favList'))), '页面回到空状态');
  ok(api.state().banks[0].questions.length === 5, '题目本身不会被删', api.state().banks[0].questions.length);
}

/* ---------------- 六、收藏跟着题集走 ---------------- */
console.log('\n六、换题集 / 导出再导入，收藏都还在');
{
  const two = makeBank(3, 'b_fav').concat(makeBank(2, 'b_other').map(function (b) {
    b.course = '另一门课'; return b;
  }));
  const { win, api } = openWin({ fq_banks_v1: JSON.stringify(two), fq_current_v1: 'b_fav' });
  const d = win.document;

  api.toggleFav('q1');                       // 收藏在 b_fav 里
  d.querySelector('#bankSelect').value = 'b_other';
  d.querySelector('#bankSelect').dispatchEvent(new win.Event('change'));
  d.querySelector('.tab[data-view="fav"]').click();
  ok(/收藏夹是空的/.test(txt(d.querySelector('#favList'))), '切到别的题集，看到的是那个题集的收藏（空）');

  d.querySelector('#favScope').value = 'all';
  d.querySelector('#favScope').dispatchEvent(new win.Event('change'));
  ok(d.querySelectorAll('#favList .item').length === 1, '切「全部题集」能看到另一本题集里的收藏', d.querySelectorAll('#favList .item').length);
  ok(/另一门课|收藏夹测试/.test(txt(d.querySelector('#favList'))), '列表里标了它属于哪个题集');

  // 导出再导入：fav 字段要跟着 JSON 走（normQ 不能把它白名单掉）
  const nq = api.normQ({ stem: 'x', answer: 'y', fav: 1700000000000 });
  ok(nq.fav === 1700000000000, '导入 JSON 时收藏时间戳被保留', nq.fav);
  ok(!api.normQ({ stem: 'x', answer: 'y' }).fav, '没收藏的题不会凭空多出 fav 字段');
}

/* ---------------- 七、删除题目后收藏不残留 ---------------- */
console.log('\n七、收藏跟着题目走，不单独存一份');
{
  const { win, api } = openWin(seed());
  const d = win.document;
  api.toggleFav('q2');
  ok(api.favList('bank').length === 1, '先有一道收藏');
  // 直接把题目删掉（题集管理里「删除」走的就是删数组元素）
  api.state().banks[0].questions.splice(1, 1);
  ok(api.favList('bank').length === 0, '题目没了，收藏也跟着没了（不会留下指向空气的收藏）');
  d.querySelector('.tab[data-view="fav"]').click();
  ok(/收藏夹是空的/.test(txt(d.querySelector('#favList'))), '页面同步显示空');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
