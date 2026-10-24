'use strict';
/* 改题之后要能看见修改效果
   运行： NODE_PATH=<workspace>/node_modules node test/refix.test.js

   用户反馈：改了题，界面上还是原来那次「答错了」的回顾，看不到改动，
   也没法按新版重答一遍。

   现在的规矩：
     · 改题保存 → 正停着的这道题回到「初见」：输入框/选项回来、反馈清空
     · 清掉的只是这一场的这一次作答，历史统计（掌握度）不动
     · 重答一次，结账页只算一次，不会变成两道题
     · 改的是别的题（或者从错题本里改），不许抹掉当前这道题的作答 */

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
    { id: 'q1', type: 'fill', stem: '药物治疗的前提是____', answer: '有效性', opts: [], source: '药物治疗的前提是有效性。', order: 1 },
    { id: 'q2', type: 'fill', stem: '首过效应最明显的给药途径是____', answer: '口服', opts: [], source: '首过效应最明显的给药途径是口服。', order: 2 },
    { id: 'c1', type: 'single', stem: '药物治疗的核心问题是（　）', answer: '合理用药', opts: ['合理用药', '获得最佳疗效', '安全用药', '获得最低成本'], optsSrc: 'paper', order: 3 }
  ];
}

function open(qs) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  win.localStorage.setItem('fq_banks_v1', JSON.stringify([{
    id: 'b_refix', course: '改题测试', createdAt: 1, questions: qs || makeQs()
  }]));
  win.localStorage.setItem('fq_current_v1', 'b_refix');
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

function bankOf(win) { return JSON.parse(win.localStorage.getItem('fq_banks_v1'))[0]; }
function txt(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }

function startGroup(d, count) {
  d.querySelector('.tab[data-view="quiz"]').click();
  d.querySelector('#qMode').value = 'new';
  d.querySelector('#qOrder').value = 'seq';
  d.querySelector('#qType').value = 'all';
  // qCount 只有 10/20/40/0 四档，抽「一道题」靠题库本身就小
  d.querySelector('#qCount').value = String(count || 10);
  d.querySelector('#quizStartBtn').click();
}

function fillSubmit(d, v) {
  const input = d.querySelector('#fillInput');
  input.value = v;
  d.querySelector('#fillSubmit').click();
}

/* 打开改题面板，直接把题干和答案改掉 */
function editCurrent(d, opts) {
  d.querySelector('#quizBody [data-fix]').click();
  if (opts.stem != null) d.querySelector('#fixStem').value = opts.stem;
  if (opts.answer != null) d.querySelector('#fixAns').value = opts.answer;
  if (opts.type != null) {
    const sel = d.querySelector('#fixType');
    sel.value = opts.type;
    sel.dispatchEvent(new d.defaultView.Event('change'));
  }
  d.querySelector('#fixSave').click();
}

/* ---------------- 一、答错之后改题，卡片回到初见 ---------------- */
console.log('\n一、答完再改题：卡片回到「还没答」的样子');
{
  const { win, d, api } = open();
  startGroup(d, 1);
  fillSubmit(d, '安全性');
  ok(!!d.querySelector('#quizFb .verdict'), '先确认已经答过、看得到「答错了」');

  editCurrent(d, { stem: '药物治疗的前提是____（改过）', answer: '安全性' });

  ok(!!d.querySelector('#fillInput'), '输入框回来了，可以重新答');
  ok(!d.querySelector('#quizFb .verdict'), '旧的「答错了」反馈已经清掉', txt(d.querySelector('#quizFb')));
  ok(txt(d.querySelector('#quizBody .stem')).indexOf('改过') >= 0, '题干是新改的版本');
  ok(api.state().quiz.results[0] == null, '这场里这道题的作答记录清空了', api.state().quiz.results[0]);
  ok(txt(d.querySelector('#toast')).indexOf('重新答一次') >= 0, '提示告诉用户可以重答', txt(d.querySelector('#toast')));
  ok(bankOf(win).questions[0].answer === '安全性', '改动本身已经存进题库');
}

/* ---------------- 二、重答一次能按新答案判 ---------------- */
console.log('\n二、重答一次，按改完的新答案判分');
{
  const { win, d, api } = open();
  startGroup(d, 1);
  fillSubmit(d, '安全性');                     // 旧答案：判错
  editCurrent(d, { stem: '药物治疗的前提是____（改过）', answer: '安全性' });

  fillSubmit(d, '安全性');                     // 新答案：应该判对
  const v = d.querySelector('#quizFb .verdict');
  ok(!!v && v.classList.contains('ok'), '这次判对了', txt(v));
  ok(txt(v).indexOf('正确答案') >= 0 && txt(v).indexOf('安全性') >= 0, '答案显示的是改完之后的那版', txt(v));
  ok(api.state().quiz.results[0] && api.state().quiz.results[0].ok === true, '结果里记的是重答这次');
  ok(api.state().quiz.results.length === 1, '没有变成两条记录', api.state().quiz.results.length);
}

/* ---------------- 三、结账页只算一次 ---------------- */
console.log('\n三、重答之后结账，统计不会翻倍');
{
  const { d } = open([makeQs()[0]]);          // 只放一道题，答完就看成绩
  startGroup(d, 10);
  fillSubmit(d, '错的');
  editCurrent(d, { answer: '有效性' });
  fillSubmit(d, '有效性');
  d.querySelector('#nextQBtn').click();        // 只有 1 题，直接到成绩页

  const body = txt(d.querySelector('#quizBody'));
  ok(body.indexOf('1 题') >= 0, '结账页写的是 1 题', body);
  ok(body.indexOf('完全正确 1') >= 0, '算的是重答这次（答对 1 道）', body);
  ok(/这组|组 ·/.test(body) || body.indexOf('%') >= 0, '成绩页正常渲染');
}

/* ---------------- 四、改成选择题：形态跟着换 ---------------- */
console.log('\n四、把填空题改成单选题：重出时就是选项');
{
  const { d, api } = open();
  startGroup(d, 1);
  fillSubmit(d, '有效性');
  editCurrent(d, {
    type: 'single',
    stem: '药物治疗的前提是（　）',
    answer: '安全性'
  });

  ok(api.state().quiz.list[0].type === 'single', '题型已经变成单选');
  ok(!d.querySelector('#fillInput'), '不再是填空输入框');
  const opts = d.querySelectorAll('#optsBox .opt');
  ok(opts.length >= 2, '渲染出了选项', opts.length);
  const names = Array.prototype.map.call(opts, function (b) { return b.dataset.v; });
  ok(names.indexOf('安全性') >= 0, '新答案在选项里', names);
}

/* ---------------- 五、改的不是当前这道题，别乱清 ---------------- */
console.log('\n五、只清「正停着的这道」，别的题不背锅');
{
  const { d, api } = open();
  startGroup(d, 10);
  fillSubmit(d, '有效性');                     // 第 1 题答对
  ok(!!api.state().quiz.results[0], '第 1 题有作答记录');

  const other = api.state().quiz.list[1];
  ok(api.resetQuizItem(other) === false, '改的不是停着的那道 → 不动它');
  ok(!!api.state().quiz.results[0], '第 1 题的作答还在');

  const cur = api.state().quiz.list[0];
  ok(api.resetQuizItem(cur) === true, '改的正是停着的那道 → 清掉这次作答');
  ok(api.state().quiz.results[0] == null, '清干净了');

  ok(api.resetQuizItem({ id: 'not-in-session' }) === false, '不在这次会话里的题，不会乱改状态');
}

/* ---------------- 六、撤销改题也回到初见 ---------------- */
console.log('\n六、点「恢复系统原样」同样回到未作答');
{
  const { win, d } = open();
  startGroup(d, 1);
  fillSubmit(d, '有效性');
  editCurrent(d, { answer: '安全性' });
  fillSubmit(d, '安全性');

  d.querySelector('#quizBody [data-fix]').click();
  ok(!!d.querySelector('#fixUndo'), '改过的题才有「恢复系统原样」');
  d.querySelector('#fixUndo').click();

  ok(bankOf(win).questions[0].answer === '有效性', '答案退回系统原来那版');
  ok(!!d.querySelector('#fillInput'), '又回到初见态');
  ok(!d.querySelector('#quizFb .verdict'), '反馈也清干净了');
}

/* ---------------- 七、刷新之后不留残影 ---------------- */
console.log('\n七、改完题刷新页面，那道题还是「没答」');
{
  const { win, d } = open();
  startGroup(d, 1);
  fillSubmit(d, '错的');
  editCurrent(d, { answer: '有效性' });

  // 把落盘的会话再读回来（模拟刷新）
  const raw = JSON.parse(win.localStorage.getItem('fq_quiz_v1'));
  ok(raw.results[0] === null, '存盘时那次作答记成空洞', raw.results);

  const { d: d2 } = (function () {
    const win2 = new Window({ url: 'http://localhost/' });
    win2.document.body.innerHTML = BODY;
    win2.crypto = require('crypto').webcrypto;
    win2.Element.prototype.scrollIntoView = function () {};
    win2.confirm = function () { return true; };
    win2.alert = function () {};
    win2.localStorage.setItem('fq_banks_v1', win.localStorage.getItem('fq_banks_v1'));
    win2.localStorage.setItem('fq_current_v1', 'b_refix');
    win2.localStorage.setItem('fq_quiz_v1', JSON.stringify(raw));
    win2.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
    return { d: win2.document };
  })();

  ok(!!d2.querySelector('#fillInput'), '恢复出来直接是初见态（输入框在）');
  ok(!d2.querySelector('#quizFb .verdict'), '没有残留的「答错了」');
  const t2 = txt(d2.querySelector('#toast'));
  ok(/恢复|接着上次/.test(t2), '还是给了「接着上次进度」的提示', t2);
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——\n');
process.exit(fail ? 1 : 0);
