'use strict';
/* 刷题时删题回归
   运行： NODE_PATH=<workspace>/node_modules node test/delq.test.js

   用户要的：解析器有时把一道题识别成两道（一条残句 + 一条真题干），
   得在刷题时就能把那道多余的删掉。

   守的几条线：
     · 删的是题集里的那一条，不是这场里的这一格 —— 同组抽中两次也要一起没
     · list / forms / results 三条平行数组必须一起摘，摘漏一条就整排错位
     · 掌握度与当天的逐题计数跟着清（不然战绩卡还替不存在的题数数）
     · 删空了这一组，不能落到「题库还没有题目」——题库还有，两回事
     · 取消就不动；刷新恢复的会话里不再有它                             */

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
const BODY = (HTML.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [])[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function makeBank(n) {
  const questions = [];
  for (let i = 1; i <= n; i++) {
    questions.push({
      id: 'q' + i, type: 'fill',
      stem: '第' + i + '题：这个考点的答案是____', answer: '答案' + i,
      opts: [], source: '第' + i + '题：这个考点的答案是答案' + i + '。', order: i
    });
  }
  return [{ id: 'b_del', course: '删题测试', createdAt: 1, questions: questions }];
}

function boot(n, opts) {
  const o = opts || {};
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  let answer = o.confirm === false ? false : true;
  win.confirm = function () { return answer; };
  win.__setConfirm = function (v) { answer = v; };
  win.alert = function () {};
  win.__logs = [];
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  const banks = makeBank(n);
  // o.more：额外塞一个题集（测「同一道题在两个题集里」那种情形）
  (o.more || []).forEach(function (b) { banks.push(b); });
  win.localStorage.setItem('fq_banks_v1', JSON.stringify(banks));
  win.localStorage.setItem('fq_current_v1', 'b_del');
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

function ls(win, k) {
  const raw = win.localStorage.getItem(k);
  return raw ? JSON.parse(raw) : null;
}
function bankQs(win) { return ls(win, 'fq_banks_v1')[0].questions; }
function body(d) { return d.querySelector('#quizBody').textContent || ''; }
function delBtn(d) { return d.querySelector('#quizBody .del-q'); }

/* 点「删题」→ 在站内确认框里点「删掉」。
   v1.21.19 起不再用 window.confirm（沙箱 iframe 里会被静默吞掉），
   所以测试也得跟着点两下。 */
function delNow(d) {
  const b = delBtn(d);
  if (!b) return false;
  b.click();
  const yes = d.querySelector('#cfmOk');
  if (!yes) return false;
  yes.click();
  return true;
}
function cfmOpen(d) { const m = d.querySelector('#cfmModal'); return !!m && !m.hidden; }
function cfmText(d) {
  const q = d.querySelector('#cfmQuote');
  return ((d.querySelector('#cfmText') || {}).textContent || '') + ' | ' + ((q && !q.hidden) ? q.textContent : '');
}

function startQuiz(d, count) {
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qCount').value = String(count == null ? 0 : count);
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();
}
function answerFill(d, text) {
  const inp = d.querySelector('#fillInput');
  const sub = d.querySelector('#fillSubmit');
  if (!inp || !sub) return false;
  inp.value = text;
  sub.click();
  return true;
}
/* 一路答到结算页：看见输入框就按题干里的题号填对，看见回顾就给下一题。
   用来跨过「删题之后剩下的那几道」，不依赖具体抽到哪几题。 */
function drain(d) {
  for (let guard = 0; guard < 30; guard++) {
    if (d.querySelector('.result-card')) return true;
    const inp = d.querySelector('#fillInput');
    if (inp && d.querySelector('#fillSubmit')) {
      const stem = (d.querySelector('#quizBody .stem') || {}).textContent || '';
      const n = (stem.match(/第(\d+)题/) || [])[1] || '';
      answerFill(d, '答案' + n);
      continue;
    }
    const nx = d.querySelector('#nextQBtn') || d.querySelector('#revNextBtn');
    if (nx) { nx.click(); continue; }
    return false;
  }
  return false;
}

/* ---------------- 一、入口就在题头 ---------------- */
console.log('\n一、刷题时题头有「删题」');
{
  const { d } = boot(5);
  startQuiz(d, 0);
  ok(!!delBtn(d), '题头有删题按钮');
  ok(delBtn(d).dataset.del === 'q1', '按钮认的是当前这道题', delBtn(d) && delBtn(d).dataset.del);
  ok((delBtn(d).title || '').indexOf('拆成两条') >= 0, '提示里点明了「一道题被拆成两条」这种情形',
    delBtn(d).title);
}

/* ---------------- 二、删掉当前这道 ---------------- */
console.log('\n二、删掉当前这道：题集少一条，人直接落到下一道');
{
  const { win, d } = boot(5);
  startQuiz(d, 0);
  ok(bankQs(win).length === 5, '删之前 5 道');
  delNow(d);
  ok(bankQs(win).length === 4, '题集里少了一条', bankQs(win).length);
  ok(bankQs(win).every(function (q) { return q.id !== 'q1'; }), '少的是被删的那条');
  ok(body(d).indexOf('1 / 4') >= 0, '进度跟着变成 1 / 4', body(d).slice(0, 40));
  ok(body(d).indexOf('第2题') >= 0, '当前换成原来排在它后面的那道');
  ok(!!d.querySelector('#fillInput'), '还是一道没答的题（不是回顾态）');
  const saved = ls(win, 'fq_quiz_v1');
  ok(saved && saved.ids.length === 4, '存档里也只剩 4 道', saved && saved.ids);
  ok(saved.ids.indexOf('q1') < 0, '存档里没有它 —— 刷新后不会又冒出来');
}

/* ---------------- 三、确认框：站内的，点取消就当没点 ---------------- */
console.log('\n三、站内确认框：点「取消」/点遮罩/Esc 都当没点');
{
  const { win, d } = boot(5);
  startQuiz(d, 0);
  delBtn(d).click();
  ok(cfmOpen(d), '点删题弹的是站内确认框（不是原生 confirm —— 那个在沙箱里会被吞）');
  ok(cfmText(d).indexOf('第1题') >= 0, '框里摆着这道题的题干原文，分得清删的是哪条', cfmText(d).slice(0, 60));
  ok(bankQs(win).length === 5, '光是弹框还没删');
  d.querySelector('#cfmCancel').click();
  ok(!cfmOpen(d), '点取消，框关掉');
  ok(bankQs(win).length === 5, '题集没动');
  ok(body(d).indexOf('第1题') >= 0, '还停在这道题上');
  ok(body(d).indexOf('1 / 5') >= 0, '进度也没动');

  // 点遮罩 / Esc 也要能关，且同样不删
  delBtn(d).click();
  d.querySelector('#cfmModal .modal-mask').click();
  ok(!cfmOpen(d) && bankQs(win).length === 5, '点遮罩关掉，题没删');
  delBtn(d).click();
  d.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!cfmOpen(d), 'Esc 也能关');
  ok(bankQs(win).length === 5, 'Esc 关掉也不删');
  // 框关着的时候再点「删掉」按钮，不能凭空触发删除
  d.querySelector('#cfmOk').click();
  ok(bankQs(win).length === 5, '框没开时点「删掉」按钮什么都不会发生');
}

/* ---------------- 四、删的是题集里的题，不是这一格 ---------------- */
console.log('\n四、同组抽中两次：一次删干净，三条平行数组一起摘');
{
  const { api } = boot(3);
  const q1 = { id: 'q1' }, q2 = { id: 'q2' };
  const st = {
    list: [q1, q2, q1], forms: ['fill', 'fill', 'fill'],
    results: [{ q: q1, ok: true }, null, { q: q1, ok: false }],
    idx: 1, draft: '写了一半', draftFor: 'q1'
  };
  const n = api.dropFromSession(st, 'q1');
  ok(n === 2, '两处都摘掉了', n);
  ok(st.list.length === 1 && st.list[0].id === 'q2', '只剩另一道', st.list.map(function (q) { return q.id; }));
  ok(st.forms.length === 1, '形式数组同步摘（摘漏就整排错位）', st.forms);
  ok(st.results.length === 1, '作答记录同步摘', st.results.length);
  ok(st.idx === 0, '当前题前面少了一道，游标跟着往前挪', st.idx);
  ok(st.draft === '' && st.draftFor === '', '给它写了一半的草稿也清掉');
}
console.log('\n四之二、删的是排在前面的一道：当前这道不能跳题');
{
  const { api } = boot(3);
  const q1 = { id: 'q1' }, q2 = { id: 'q2' }, q3 = { id: 'q3' };
  const st = { list: [q1, q2, q3], forms: ['fill', 'fill', 'fill'], results: [null, null, null], idx: 2 };
  api.dropFromSession(st, 'q1');
  ok(st.list.length === 2 && st.list[1].id === 'q3', '剩 q2 / q3');
  ok(st.idx === 1, '人还停在 q3 上（不是被顶到 q2 或直接出界）', st.idx);
}

/* ---------------- 五、已答过的题也能删，后面的不串位 ---------------- */
console.log('\n五、回顾态删掉已答的题：后面那道重新变成「没答」');
{
  const { win, d } = boot(5);
  startQuiz(d, 0);
  answerFill(d, '答案1');
  d.querySelector('#nextQBtn').click();               // 去第 2 题（不答）
  ok(body(d).indexOf('2 / 5') >= 0, '到第 2 题了');
  d.querySelector('#prevQBtn').click();               // 回第 1 题的回顾态
  ok(body(d).indexOf('回顾') >= 0, '停在回顾态');
  delNow(d);
  ok(bankQs(win).length === 4, '题集少一条');
  ok(body(d).indexOf('1 / 4') >= 0, '进度 1 / 4', body(d).slice(0, 40));
  ok(body(d).indexOf('第2题') >= 0, '当前是原来那道第 2 题');
  ok(body(d).indexOf('回顾') < 0, '它还是没答的（没把第 1 题的作答挂到它身上）');
  const r = (ls(win, 'fq_quiz_v1') || {}).results || [];
  ok(r.length === 4 && !r[0], '作答记录跟着挪了位置，第 1 格是空的', r);
}

/* ---------------- 六、结算不算它 ---------------- */
console.log('\n六、结算页不把删掉的题算进成绩');
{
  const { win, d } = boot(5);
  startQuiz(d, 0);
  answerFill(d, '答案1');                             // 对
  d.querySelector('#nextQBtn').click();
  answerFill(d, '错答案2');                           // 错 —— 这道待会儿删掉
  d.querySelector('#nextQBtn').click();
  d.querySelector('#prevQBtn').click();               // 回到第 2 题的回顾态
  delNow(d);
  ok(bankQs(win).length === 4, '题集 4 道');
  ok(drain(d), '一路答到结算页');
  const txt = body(d);
  ok(txt.indexOf('4 题') >= 0, '只算剩下的 4 道（删掉的那道不进总数）', txt.slice(0, 100));
  ok(txt.indexOf('完全正确 4') >= 0, '那道答错的跟着删掉了，成绩里没有它', txt.slice(0, 100));
}

/* ---------------- 七、统计与当天计数跟着清 ---------------- */
console.log('\n七、掌握度和当天的逐题计数一起划掉');
{
  const { win, d } = boot(5);
  startQuiz(d, 0);
  answerFill(d, '答案1');
  const stats1 = ls(win, 'fq_stats_v1') || {};
  ok(!!stats1.q1, '答完有 q1 的掌握度记录');
  const daily1 = ls(win, 'fq_daily_v1') || [];
  ok(daily1.length === 1 && daily1[0].q && daily1[0].q.q1, '当天明细里有 q1', daily1);
  d.querySelector('#nextQBtn').click();
  d.querySelector('#prevQBtn').click();
  delNow(d);
  const stats2 = ls(win, 'fq_stats_v1') || {};
  ok(!stats2.q1, '掌握度记录清掉了', Object.keys(stats2));
  const daily2 = ls(win, 'fq_daily_v1') || [];
  ok(!daily2.length, '当天只剩这一条记录、划空后整行收走（不留 0 题的空行）', daily2);
}

/* ---------------- 八、删空了这一组，但题库还有 ---------------- */
console.log('\n八、一组的题删完：提示「这一组都删掉了」，不说题库是空的');
{
  const { win, d } = boot(12);
  startQuiz(d, 10);
  let guard = 0;
  while (delNow(d) && guard++ < 30);
  ok(bankQs(win).length === 2, '题集还剩 2 道（这一组只抽了 10 道）', bankQs(win).length);
  ok(body(d).indexOf('这一组的题都删掉了') >= 0, '说的是这一组空了', body(d).slice(0, 60));
  ok(body(d).indexOf('题库还没有题目') < 0, '不能拿「题库还没有题目」糊弄（题库明明还有）');
  ok(ls(win, 'fq_quiz_v1') === null, '空会话不留存档 —— 刷新不会恢复成一张空卡');
}

/* ---------------- 九、题库真被删空 ---------------- */
console.log('\n九、题集真被删空：让人回去导入');
{
  const { win, d } = boot(2);
  startQuiz(d, 0);
  let guard = 0;
  while (delNow(d) && guard++ < 10);
  ok(bankQs(win).length === 0, '题集空了', bankQs(win).length);
  ok(body(d).indexOf('题集里的题都删完了') >= 0, '说的是题集空了', body(d).slice(0, 60));
  ok(body(d).indexOf('导入笔记') >= 0, '给了下一步（回去导入）');
}

/* ---------------- 十、题头那几个按钮都还在 ---------------- */
console.log('\n十、删题是加在题头上的，收藏和改题不能因此消失');
{
  const { d } = boot(5);
  startQuiz(d, 0);
  ok(!!d.querySelector('#quizBody .fav-toggle'), '收藏按钮在');
  ok(!!d.querySelector('#quizBody .fix-open'), '改题按钮在');
  ok(!!delBtn(d), '删题按钮也在（三个并排，窄屏会换行）');
}

/* ---------------- 十一、删掉的题不能被云同步拉回来 ---------------- */
console.log('\n十一、云同步是并集合并，删掉的题必须靠墓碑挡住');
{
  const { win, api } = boot(3);
  api.deleteQuestionById('q1');
  const raw = win.localStorage.getItem('fq_gone_v1');
  const tomb = JSON.parse(raw || '{}');
  ok(!!tomb['删题测试|q1'], '删的时候记了一笔墓碑，带题集键（不是只记题号）', raw);

  // 远端那份还带着 q1（模拟「删除没推上去」/ 另一台设备还没同步）
  const q = (id, order) => ({ id: id, type: 'fill', stem: '第' + order + '题：____', answer: '答案' + order, opts: [], order: order });
  const remote = [{ id: 'b_del', course: '删题测试', createdAt: 1, questions: [q('q1', 1), q('q2', 2), q('q3', 3), q('q9', 9)] }];
  const merged = api.mergeBanks(ls(win, 'fq_banks_v1'), remote);
  ok(!merged[0].questions.some(function (x) { return x.id === 'q1'; }), '拉一趟回来，删掉的那道没有复活');
  ok(merged[0].questions.some(function (x) { return x.id === 'q9'; }), '别人新加的题照样合进来（墓碑只挡被删的）');
  ok(merged[0].questions.length === 3, '本地剩的 2 道 + 远端新加的 1 道 = 3', merged[0].questions.length);

  // 墓碑按题集算：另一本题集里同题号的题，不该被这本的墓碑挡掉
  const other = [{ id: 'b_x', course: '另一本书', createdAt: 1, questions: [q('q1', 1)] }];
  const merged2 = api.mergeBanks([], other);
  ok(merged2[0].questions.length === 1, '别的题集里同题号的题照旧合进来（墓碑带题集，不外溢）',
    merged2[0].questions.length);

  // 老版本留下的纯题号墓碑（键里没有 |）继续算数，别让人升级后又看到删掉的题
  const live = api.tombstone();
  Object.keys(live).forEach(function (k) { delete live[k]; });
  live.q1 = Date.now();
  ok(api.isGone(live, { course: '随便哪本' }, 'q1'), '老的全局墓碑（纯题号）对哪本都算数');
  const merged3 = api.mergeBanks(ls(win, 'fq_banks_v1'), remote);
  ok(!merged3[0].questions.some(function (x) { return x.id === 'q1'; }), '老墓碑合并时照样挡得住');

  // 墓碑过期（30 天）后自己消失，不占地方
  api.tombstone()['删题测试|q1'] = Date.now() - 31 * 24 * 3600 * 1000;
  api.pruneGone();
  ok(!api.tombstone()['删题测试|q1'], '超过 30 天的墓碑会被清掉，localStorage 不会越堆越多', api.tombstone());
}

/* ---------------- 十二、删题只删当前这一本 ---------------- */
console.log('\n十二、同一道题躺在两个题集里（广场副本）：只删当前这一本');
{
  const dup = { id: 'q1', type: 'fill', stem: '第1题：这个考点的答案是____', answer: '答案1', opts: [], order: 1 };
  const { win, api } = boot(2, {
    more: [{ id: 'b_copy', course: '删题测试（广场）', createdAt: 2, questions: [dup, { id: 'qz', type: 'fill', stem: '另一个____', answer: 'x', opts: [], order: 1 }] }]
  });
  const r = api.deleteQuestionById('q1');
  ok(r && r.bank.id === 'b_del', '删的是当前选中的那本', r && r.bank.id);
  ok(r && r.otherBanks === 1, '知道别本里还有一份，并告诉你没动它', r && r.otherBanks);
  ok(!ls(win, 'fq_banks_v1')[0].questions.some(function (x) { return x.id === 'q1'; }), '当前这本里没有了');
  ok(ls(win, 'fq_banks_v1')[1].questions.some(function (x) { return x.id === 'q1'; }),
    '广场副本里那份还在 —— 那是另一份题集，不该跟着没');
  ok(ls(win, 'fq_banks_v1')[1].questions.length === 2, '副本的题数一点没变');

  // 统计是按题号共用一份的：别本里还有这道题，掌握度就不能跟着清
  api.statsOf().q1 = { ok: 3, bad: 1, streak: 2, mastery: 0.8 };
  api.deleteQuestionById('q1');
  ok(!!api.statsOf().q1, '别本里还有这份题，掌握度不动（清了等于把那一本的记录也抹了）');
}

/* ---------------- 十三、只此一份时，统计照旧清干净 ---------------- */
console.log('\n十三、这一本删掉、别处也没有了：掌握度和当天计数一起清');
{
  const { api } = boot(3);
  api.statsOf().q1 = { ok: 2, bad: 1, streak: 0, mastery: 0.4 };
  const r = api.deleteQuestionById('q1');
  ok(r && r.otherBanks === 0, '没有别的题集也带着它', r && r.otherBanks);
  ok(!api.statsOf().q1, '掌握度记录清掉了 —— 不然统计里还挂着不存在的题');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
