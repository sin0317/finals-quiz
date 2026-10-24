'use strict';
/* 「再来一组」分批推进回归
   运行： NODE_PATH=<workspace>/node_modules node test/batch.test.js

   用户报的问题：刷完 20 道点「再来一组」，又回到第 1 题，不是第 21 题。
   期望：
     · 默认「一路推新题」：这场答对的题不再出现，先推没出现过的，新题推完再回头刷答错的
     · 勾上「刷到 90% 才换新题」：只抽掌握度不到 90% 的，全达标了才放新题
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

function boot(banks, stats) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  if (banks) win.localStorage.setItem('fq_banks_v1', JSON.stringify(banks));
  if (stats) win.localStorage.setItem('fq_stats_v1', JSON.stringify(stats));
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api };
}

// 45 道填空，序号写在题干和答案里，方便断言「第几题」
function makeBank(n) {
  const questions = [];
  for (let i = 1; i <= n; i++) {
    questions.push({
      id: 'q' + i, type: 'fill', stem: '第' + i + '题的答案是____', answer: '答案' + i,
      opts: [], source: '第' + i + '题的答案是答案' + i + '。', order: i
    });
  }
  return [{ id: 'b_batch', course: '分批测试', createdAt: 1, questions: questions }];
}

/* ---------------- 一、第一组仍然是按顺序开头 ---------------- */
console.log('\n一、新开一场：还是从第 1 题开始');
{
  const { api } = boot(makeBank(45));
  const got = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'new', done: {}, served: {} });
  ok(got.list.length === 20, '一组 20 道');
  ok(got.list[0].id === 'q1' && got.list[19].id === 'q20', '第一组是第 1～20 题');
  ok(got.remain === 45, '还有 45 道没刷');
}

/* ---------------- 二、做对的跳过，接着往后推 ---------------- */
console.log('\n二、再来一组：接着第 21 题走，不回头');
{
  const { api } = boot(makeBank(45));
  const done = {}, served = {};
  for (let i = 1; i <= 20; i++) { done['q' + i] = 1; served['q' + i] = 1; }

  const got = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'new', done: done, served: served });
  ok(got.list[0].id === 'q21', '第二组从第 21 题开始（不是回到第 1 题）', got.list[0] && got.list[0].id);
  ok(got.list[19].id === 'q40', '第二组到第 40 题');
  ok(got.list.every(q => !done[q.id]), '这一场已经答对的题一个都不再出现');
  ok(got.remain === 25, '还剩 25 道（第 21～45 题）');
}

/* ---------------- 三、答错的题排在新题后面，回头再来 ---------------- */
console.log('\n三、答错的题不会丢：新题推完了再回头刷');
{
  const { api } = boot(makeBank(45));
  const done = {}, served = {};
  for (let i = 1; i <= 20; i++) served['q' + i] = 1;
  // 第 1～18 题答对，19、20 答错（没进 done）
  for (let i = 1; i <= 18; i++) done['q' + i] = 1;

  const second = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'new', done: done, served: served });
  ok(second.list[0].id === 'q21', '新题优先：第二组仍是第 21 题开头');
  ok(second.list.every(q => q.id !== 'q19' && q.id !== 'q20'), '新题还没推完时，答错的题先不插进来');

  // 把新题也刷完
  for (let i = 21; i <= 45; i++) { done['q' + i] = 1; served['q' + i] = 1; }
  const third = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'new', done: done, served: served });
  ok(third.list.length === 2, '新题推完后只剩那两道答错的');
  ok(third.list[0].id === 'q19' && third.list[1].id === 'q20', '答错的题按笔记顺序回头来');
}

/* ---------------- 四、全刷完且全答对：给个说明，不是死循环 ---------------- */
console.log('\n四、这个范围刷穿了怎么办');
{
  const { api } = boot(makeBank(5));
  const done = {}, served = {};
  for (let i = 1; i <= 5; i++) { done['q' + i] = 1; served['q' + i] = 1; }
  const got = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'new', done: done, served: served });
  ok(got.list.length === 0 && got.why === 'done', '返回空并标明「都刷完了」，不会悄悄重放第一批');
}

/* ---------------- 五、刷到 90% 才换新题 ---------------- */
console.log('\n五、勾上开关：只抽掌握度不到 90% 的');
{
  // q1 已掌握（streak 3、正确率 100% → mastery 100%）；q2、q3 生疏
  const stats = {
    q1: { ok: 3, bad: 0, streak: 3, mastery: 1, mastered: true },
    q2: { ok: 1, bad: 1, streak: 0, mastery: 0.3, mastered: false }
  };
  const { api } = boot(makeBank(5), stats);
  const got = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'master', done: {}, served: {} });
  ok(got.list.every(q => q.id !== 'q1'), '掌握度 100% 的题不再出现');
  // 没练过的 mastery 是 0%，比「练过一半」的 q2（30%）还要生，所以排最前
  ok(['q3', 'q4', 'q5'].indexOf(got.list[0].id) >= 0, '最生的排最前面（没练过的先来）', got.list[0].id);
  ok(got.list[got.list.length - 1].id === 'q2', '练过但仍没到 90% 的排后面');
  ok(got.list.length === 4, '剩下 4 道没到 90% 的全在池子里');
}

/* ---------------- 六、全达标后不再硬凑 ---------------- */
console.log('\n六、全部到 90% 了');
{
  const stats = {};
  for (let i = 1; i <= 5; i++) stats['q' + i] = { ok: 3, bad: 0, streak: 3, mastery: 1, mastered: true };
  const { api } = boot(makeBank(5), stats);
  const got = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'master', done: {}, served: {} });
  ok(got.list.length === 0 && got.why === 'mastered', '全达标就返回空并说明原因');
}

/* ---------------- 七、真实流程：刷 20 道按「再来一组」，落到第 21 题 ---------------- */
console.log('\n七、整条流程：刷完 20 道 → 再来一组 → 第 21 题');
{
  const { win } = boot(makeBank(45));
  const d = win.document;
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qRange').value = 'all';
  d.querySelector('#qType').value = 'all';
  d.querySelector('#qCount').value = '20';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();

  ok((d.querySelector('#quizBody').textContent || '').indexOf('第1题') >= 0, '第一组第一题是第 1 题');

  // 20 道全答对
  for (let i = 1; i <= 20; i++) {
    d.querySelector('#fillInput').value = '答案' + i;
    d.querySelector('#fillSubmit').click();
    d.querySelector('#nextQBtn').click();
  }
  ok(!!d.querySelector('#againBtn'), '20 道答完，出现结账页');
  ok((d.querySelector('#quizBody').textContent || '').indexOf('第 1 组') >= 0, '结账页写着这是第 1 组');
  ok(/下一组[^。]{0,24}25 道/.test((d.querySelector('#quizBody').textContent || '')), '结账页告诉下一组还有多少可刷');

  d.querySelector('#againBtn').click();
  const txt = d.querySelector('#quizBody').textContent || '';
  ok(txt.indexOf('第21题') >= 0, '点「再来一组」落到第 21 题（原来这里会回到第 1 题）');
  ok(txt.indexOf('第1题') < 0, '不再重放第 1 题');
  ok(txt.indexOf('第 2 组') >= 0 || (d.querySelector('#quizBody').textContent || '').indexOf('2 / 20') >= 0,
    '进度显示是第 2 组 / 新的一组');
}

/* ---------------- 八、开关切换会影响下一组的抽法 ---------------- */
console.log('\n八、开关在页面上能切');
{
  const { win } = boot(makeBank(5));
  const d = win.document;
  d.querySelector('.tab[data-view="quiz"]').click();
  const sel = d.querySelector('#qMode');
  ok(!!sel, '工具栏有「抽题方式」下拉');
  ok(sel.value === 'srs', '默认是间隔复习');
  ok(sel.options.length === 3, '三种抽法都在：间隔复习 / 一路推新题 / 只刷没掌握的');

  sel.value = 'master';
  d.querySelector('#qCount').value = '0';
  d.querySelector('#quizStartBtn').click();
  d.querySelector('#fillInput').value = '答案1';
  d.querySelector('#fillSubmit').click();
  d.querySelector('#nextQBtn').click();
  ok((d.querySelector('#quizBody').textContent || '').indexOf('第2题') >= 0, '换成「只刷没掌握的」后照常刷题');
}

/* ---------------- 九、间隔复习的排期 ---------------- */
console.log('\n九、间隔复习：答对隔几组再来，答错下组必来');
{
  const { api } = boot(makeBank(30));
  ok(api.srGap(1) === 2 && api.srGap(2) === 4 && api.srGap(3) === 8,
    '间隔随连对次数拉长：隔 1 组 / 3 组 / 7 组', [api.srGap(1), api.srGap(2), api.srGap(3)]);

  api.setSR({ round: 1, items: {} });
  api.srApply('q1', 'wrong');    // 答错：下一组必来
  api.srApply('q2', 'right');    // 答对一次：隔 1 组
  const sr = api.getSR();
  ok(sr.items.q1.due === 2, '答错的题排到第 2 组（下一组）');
  ok(sr.items.q2.due === 3, '答对一次的题排到第 3 组（中间空一组）');

  const g2 = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'srs', round: 2 });
  ok(g2.list[0].id === 'q1', '下一组里答错的题排最前面');
  ok(g2.list.every(q => q.id !== 'q2'), '刚答对的题下一组不出现');

  const g3 = api.pickBatch({ range: 'all', type: 'all', count: 20, shuffle: false, mode: 'srs', round: 3 });
  ok(g3.list.some(q => q.id === 'q2'), '隔一组之后它回来了');

  // 连对两次 → 隔 3 组
  api.setSR({ round: 4, items: {} });
  api.srApply('q3', 'right');
  api.srApply('q3', 'right');
  ok(api.getSR().items.q3.streak === 2 && api.getSR().items.q3.due === 8,
    '连对两次：排到第 8 组（中间空 3 组）', api.getSR().items.q3);

  // 连对三次 → 隔 7 组
  api.srApply('q3', 'right');
  ok(api.getSR().items.q3.due === 12, '连对三次：排到第 12 组（中间空 7 组）');

  // 答错会把连对清零
  api.srApply('q3', 'wrong');
  ok(api.getSR().items.q3.streak === 0 && api.getSR().items.q3.due === 5, '答错清零连对，下一组重来');
}

/* ---------------- 十、已掌握的题不再反复塞回来 ---------------- */
console.log('\n十、已掌握的题排得很远');
{
  const stats = { q1: { ok: 6, bad: 1, streak: 3, mastery: 0.91, mastered: true } };
  const { api } = boot(makeBank(5), stats);
  api.setSR({ round: 1, items: {} });
  api.srApply('q1', 'right');
  ok(api.getSR().items.q1.due >= 90, '已掌握的题排到很后面（这场不会再见到）');
}

/* ---------------- 十一、全在冷却里也不让人卡住 ---------------- */
console.log('\n十一、所有题都还没到期时，把最早到期的捞回来');
{
  const { api } = boot(makeBank(3));
  api.setSR({ round: 1, items: {} });
  ['q1', 'q2', 'q3'].forEach(id => api.srApply(id, 'wrong'));   // 都排到第 2 组
  const g = api.pickBatch({ range: 'all', type: 'all', count: 2, shuffle: false, mode: 'srs', round: 1 });
  ok(g.list.length === 2 && g.early === true, '还没有到期的题时给出「提前复习」并说明', g);
}

/* ---------------- 十二、真实流程：答错的题下一组第一道就是它 ---------------- */
console.log('\n十二、整条流程：这组错的那道，下一组先来');
{
  const { win } = boot(makeBank(30));
  const d = win.document;
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qCount').value = '10';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#quizStartBtn').click();
  ok((d.querySelector('#quizBody').textContent || '').indexOf('第1题') >= 0, '第一组从第 1 题开始');

  // 第 1 题答错，其余 9 道答对
  d.querySelector('#fillInput').value = '写错了';
  d.querySelector('#fillSubmit').click();
  d.querySelector('#nextQBtn').click();
  for (let i = 2; i <= 10; i++) {
    d.querySelector('#fillInput').value = '答案' + i;
    d.querySelector('#fillSubmit').click();
    d.querySelector('#nextQBtn').click();
  }
  d.querySelector('#againBtn').click();

  const txt = d.querySelector('#quizBody').textContent || '';
  ok(txt.indexOf('第1题') >= 0, '答错的那道排到下一组第一题');
  ok(txt.indexOf('第2题') < 0, '这组刚答对的题不跟着回来');

  // 把这道补上，下一题应该直接跳到新题（第 11 题），说明新题补进了这一组
  d.querySelector('#fillInput').value = '答案1';
  d.querySelector('#fillSubmit').click();
  d.querySelector('#nextQBtn').click();
  ok((d.querySelector('#quizBody').textContent || '').indexOf('第11题') >= 0,
    '不够 10 道就补新题（第二道直接到第 11 题）');
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
