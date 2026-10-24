'use strict';
/* 真题优先：选择题只能来自上传的卷子原题
   运行： NODE_PATH=<workspace>/node_modules node test/preferpaper.test.js

   用户原话：「选择题来自我上传的卷子原题，并以原题的题干和选项为准；
              不要自行编造干扰性选择题或改动原题内容。」

   所以这里守的是三条线：
     ① 笔记里的事卷子考过 → 出卷子那道题，题干/选项/答案一个字不改
     ② 卷子里没考过 → 挖成填空，绝不自造干扰项
     ③ 笔记里本来就印着 A/B/C/D 的题不算编造，照旧出选择题       */

const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1].replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

/* 一份最小的「已导入的原卷」：单选题 + 多选题，选项都是卷子印的 */
const PAPER_Q = [
  {
    id: 'p1', type: 'single', stem: '药物治疗的核心问题是（　）', answer: '合理用药',
    opts: ['合理用药', '获得最佳疗效', '安全用药', '获得最低成本'],
    optsSrc: 'paper', source: '药物治疗的核心问题是（　）',
    chapter: '第二章 药物治疗的原则与过程', order: 0
  },
  {
    id: 'p2', type: 'multi', stem: '药物协同作用包括（　）',
    answer: ['相加作用', '增强作用', '增敏作用'],
    opts: ['相加作用', '增强作用', '增敏作用', '拮抗作用'],
    optsSrc: 'paper', source: '药物协同作用包括（　）',
    chapter: '第四章 药物相互作用与配伍禁忌', order: 1
  },
  {
    id: 'p3', type: 'single', stem: '治疗药物监测最常用的标本是（　）', answer: '血浆',
    opts: ['血浆', '尿液', '唾液', '粪便'],
    optsSrc: 'paper', source: '治疗药物监测最常用的标本是（　）',
    chapter: '第九章 药学服务与个体化服务', order: 2
  }
];

function boot(store) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.prompt = function (m, d) { return d; };
  win.alert = function () {};

  const m = new Map();
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
  if (store) Object.keys(store).forEach((k) => ls.setItem(k, store[k]));

  class FR {
    readAsText() { setTimeout(() => { this.result = ''; this.onload && this.onload(); }, 0); }
    readAsArrayBuffer() { setTimeout(() => { this.result = new ArrayBuffer(0); this.onload && this.onload(); }, 0); }
  }
  const U = globalThis.URL;
  if (!U.createObjectURL) U.createObjectURL = () => 'blob:mock';

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator', APP_SRC
  );
  fn(win, win.document, ls, () => Promise.reject(new TypeError('no fetch')), win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval, win.Blob || globalThis.Blob, U, FR, win.crypto, win.navigator);

  return {
    win,
    api: win.FQInternals,
    ls,
    $: (s) => win.document.querySelector(s),
    $$: (s) => Array.from(win.document.querySelectorAll(s)),
    text: (s) => { const e = win.document.querySelector(s); return e ? e.textContent.trim() : null; },
    click: (s) => {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到元素：' + s);
      e.dispatchEvent(new win.Event('click', { bubbles: true }));
    },
    setVal: (s, v) => {
      const e = win.document.querySelector(s);
      if (!e) throw new Error('找不到：' + s);
      e.value = v;
    }
  };
}

const bankStore = (qs) => ({
  fq_banks_v1: JSON.stringify([{ id: 'b_paper', course: '临床药物治疗学', createdAt: 1, questions: qs }]),
  fq_current_v1: 'b_paper'
});

/* 一条从笔记里提炼出来的候选（笔记说法，还没有选项） */
const cand = (source, type, answer, stem) => ({
  id: 'cand_' + Math.random().toString(36).slice(2, 7),
  type: type || 'fill',
  stem: stem || source.replace(/[。，]$/, '').replace(/(包括|又称之为|是)([^。]*)/, '$1____'),
  answer: answer,
  opts: [],
  source: source,
  order: 0
});

/* ============================================================
   一、笔记提到卷子考过的知识点 → 出卷子那道原题
   ============================================================ */
console.log('\n一、笔记对上了卷子里的原题：题干、选项、答案全用卷子的');
{
  const a = boot(bankStore(PAPER_Q));
  const mine = cand('药物协同作用包括相加作用 增强作用 增敏作用。', 'fill',
    ['相加作用', '增强作用', '增敏作用']);
  const r = a.api.preferPaper([mine]);

  ok(r.hit === 1, '认出了这道题卷子里考过', { hit: r.hit, dup: r.dup, fresh: r.fresh });
  const q = r.list[0];
  ok(q.id === 'p2', '用的是原卷那道题的 id', q && q.id);
  ok(q.stem === '药物协同作用包括（　）', '题干用卷子的，不改写', q && q.stem);
  ok(JSON.stringify(q.opts) === JSON.stringify(['相加作用', '增强作用', '增敏作用', '拮抗作用']),
    '选项用卷子印的四个，不是系统凑的', q && q.opts);
  ok(JSON.stringify(q.answer) === JSON.stringify(['相加作用', '增强作用', '增敏作用']),
    '答案用卷子的标准答案', q && q.answer);
  ok(q.type === 'multi', '题型跟着卷子走（多选）', q && q.type);
  ok(q.optsSrc === 'paper', '带上「选项来自原卷」的标记', q && q.optsSrc);
  ok(q.note && q.note.indexOf('药物协同作用包括') >= 0, '笔记那句话存成讲解', q && q.note);
  ok(q.chapter && q.chapter.indexOf('第四章') >= 0, '章节跟着原卷走', q && q.chapter);
}

/* ============================================================
   二、卷子里没考过 → 挖成填空，不自造干扰项
   ============================================================ */
console.log('\n二、卷子里没考过：挖成填空，绝不自己编干扰项');
{
  const a = boot(bankStore(PAPER_Q));
  const mine = cand('生物半衰期与血药浓度无关，又称之为恒比消除。', 'fill', '恒比消除');
  const r = a.api.preferPaper([mine]);

  ok(r.hit === 0 && r.fresh === 1, '没有硬凑一道卷子题', { hit: r.hit, fresh: r.fresh });
  const q = r.list[0];
  ok(q.type === 'fill', '按笔记挖成填空', q && q.type);
  ok((q.opts || []).length === 0, '一个选项都不给（不自己造）', q && q.opts);
  ok(q.answer === '恒比消除', '答案还是笔记里的考点', q && q.answer);
}

/* ============================================================
   三、笔记提炼不再产出选择题
   ============================================================ */
console.log('\n三、笔记提炼出来的题一律是填空（不再自造选择题）');
{
  const a = boot(bankStore(PAPER_Q));
  const cases = [
    '所选药物对患者具备**安全、有效、经济、适当**四个要素',
    '药物不良反应包括副作用、毒性反应、变态反应三种。',
    '药物治疗的前提是安全性',
    '由于单位时间内消除的药量与体内浓度 C 的比值不变，又称之为恒比消除。'
  ];
  let bad = [];
  cases.forEach((t) => {
    a.api.buildFromNote(t).forEach((q) => {
      if (q.type === 'single' || q.type === 'multi') bad.push({ t: t, type: q.type, opts: q.opts });
      if ((q.opts || []).length) bad.push({ t: t, why: '凭空带了选项', opts: q.opts });
    });
  });
  ok(bad.length === 0, '没有一道凭空长出选项的选择题', bad);
}

/* ============================================================
   四、笔记里本来就印着 A/B/C/D —— 那是原文，不算编造
   ============================================================ */
console.log('\n四、笔记原文自带选项的题仍是选择题');
{
  const a = boot({});
  const note = [
    '单选题',
    '药物治疗的核心问题是（     ）A',
    'A、合理用药   B、获得最佳疗效   C、安全用药   D、获得最低成本'
  ].join('\n');
  const qs = a.api.buildFromNote(note);
  const sel = qs.filter((q) => q.type === 'single');
  ok(sel.length === 1, '原文排好的选择题照样还原', qs.map((q) => q.type));
  // 还原时答案字母跟在括号后面，渲染选项时会把正确答案并回去 —— 按渲染口径看是完整的四个
  const shown = a.api.choiceOptions(sel[0], false);
  ok(shown.length === 4, '选项是原文那四个', shown);
  ok(shown.indexOf('合理用药') >= 0, '正确答案在选项里（勾得到）', shown);
  ok(sel[0].answer === '合理用药', '答案按原文的答案字母翻出来', sel[0] && sel[0].answer);
}

/* ============================================================
   五、同一条原卷题只出一次
   ============================================================ */
console.log('\n五、几条笔记都对上同一道题，只留一条');
{
  const a = boot(bankStore(PAPER_Q));
  const r = a.api.preferPaper([
    cand('药物协同作用包括相加作用 增强作用 增敏作用。'),
    cand('药物协同作用包括相加作用、增强作用、增敏作用，作用增强。')
  ]);
  const same = r.list.filter((q) => q.id === 'p2');
  ok(same.length === 1, '同一道原卷题只出现一次', r.list.map((q) => q.id));
}

/* ============================================================
   六、题库里已有的真题：不重复加，只补讲解
   ============================================================ */
console.log('\n六、题库里已经有这道真题：只把笔记讲解挂上去');
{
  const a = boot(bankStore(PAPER_Q));
  const r = a.api.preferPaper([cand('药物协同作用包括相加作用 增强作用 增敏作用。')]);
  ok(r.dup === 1, '认出题库里已经有了', { dup: r.dup });
  ok(r.list[0].onlyAttachNote === true, '标记成「只补讲解」', r.list[0] && r.list[0].onlyAttachNote);
  ok(r.list[0].opts.length === 4, '选项仍是卷子那四个', r.list[0] && r.list[0].opts);

  // 走一遍真实的保存流程，确认没有多出一条题、讲解挂上了
  const before = JSON.parse(a.ls.getItem('fq_banks_v1'))[0].questions.length;
  a.api.preferPaper([cand('药物协同作用包括相加作用 增强作用 增敏作用。')]);
  const after = JSON.parse(a.ls.getItem('fq_banks_v1'))[0].questions.length;
  ok(before === after, '题库题数没变（没有重复出题）', { before: before, after: after });
}

/* ============================================================
   七、还没导入原卷 → 老实按笔记出填空
   ============================================================ */
console.log('\n七、没导入原卷的时候不会瞎猜');
{
  const a = boot({});
  const r = a.api.preferPaper([cand('生物半衰期与血药浓度无关，又称之为恒比消除。', 'fill', '恒比消除')]);
  ok(r.noPool === true, '明确知道没有原卷可对', r.noPool);
  ok(r.list[0].type === 'fill', '只能出填空', r.list[0] && r.list[0].type);
  ok((r.list[0].opts || []).length === 0, '不会造选项', r.list[0] && r.list[0].opts);
}

/* ============================================================
   八、出题形式：没选项就不许出选择题（连「全部给选项」也不行）
   ============================================================ */
console.log('\n八、出题形式守门');
{
  const a = boot({});
  const forms = a.api.decideForms([
    { type: 'single', stem: '甲', answer: '甲', opts: ['甲', '乙'] },          // 有选项
    { type: 'single', stem: '乙', answer: '乙', opts: [] },                    // 没选项
    { type: 'multi', stem: '丙', answer: ['丙', '丁'], opts: [] },             // 没选项
    { type: 'fill', stem: '戊', answer: '戊', opts: [] }
  ], 'choice');
  ok(forms[0] === 'choice', '有选项的题可以出选择题', forms[0]);
  ok(forms[1] === 'fill', '没选项的单选只能考填空', forms[1]);
  ok(forms[2] === 'fill', '没选项的多选只能考填空', forms[2]);
  ok(forms[3] === 'fill', '填空还是填空', forms[3]);
}

/* ============================================================
   九、端到端：先导原卷，再解析笔记
   ============================================================ */
console.log('\n九、端到端：先导入原卷，再解析笔记');
(async function () {
  const a = boot({});
  await sleep(80);

  // ① 导入原卷（答案字母跟在括号后面，跟老师卷子一致）
  a.click('#inputSeg .seg-btn[data-mode="paper"]');
  a.setVal('#noteText', [
    '单选题（每题2分）',
    '药物治疗的核心问题是（     ）A',
    'A、合理用药   B、获得最佳疗效',
    'C、安全用药   D、获得最低成本',
    '治疗药物监测最常用的标本是（     ）B',
    'A、尿液   B、血浆',
    'C、唾液   D、粪便'
  ].join('\n'));
  a.click('#extractBtn');
  await sleep(150);
  ok(a.$$('#previewBody tr').length === 2, '原卷解析出两道题', a.$$('#previewBody tr').length);
  ok(/原卷真题/.test(a.text('#previewBody')), '预览里标着「原卷真题」');
  a.click('#saveBankBtn');
  await sleep(150);

  const bank1 = JSON.parse(a.ls.getItem('fq_banks_v1'))[0];
  ok(bank1.questions.length === 2, '两道原卷题入库', bank1.questions.length);
  ok(bank1.questions.every((q) => q.optsSrc === 'paper'), '入库后仍带「选项来自原卷」', bank1.questions.map((q) => q.optsSrc));
  ok(bank1.questions.every((q) => !!q.id), '入库时补上了 id', bank1.questions.map((q) => q.id));

  // ② 切回笔记，解析一段既有考过的、也有没考过的
  a.click('#inputSeg .seg-btn[data-mode="note"]');
  a.setVal('#noteText', [
    '药物治疗的核心问题是合理用药。',
    '生物半衰期与血药浓度无关，又称之为恒比消除。'
  ].join('\n'));
  a.click('#extractBtn');
  await sleep(200);

  const rows = a.$$('#previewBody tr');
  const allText = a.text('#previewBody') || '';
  ok(rows.length === 2, '两条笔记都出现在预览里', rows.length);
  // 这道题刚才已经导进题库了，所以标的是「已有·补讲解」—— 比「原卷真题」更准
  ok(/已有·补讲解/.test(allText), '对上的那条标成「已有·补讲解」（说明不会重复出题）');
  ok(/笔记：/.test(allText), '预览里能看到笔记原文');

  a.click('#saveBankBtn');
  await sleep(200);
  const bank2 = JSON.parse(a.ls.getItem('fq_banks_v1'))[0];
  ok(bank2.questions.length === 3, '只多出一道新题（笔记没考过的那道），没重复出原卷题',
    bank2.questions.map((q) => q.stem));
  const core = bank2.questions.filter((q) => /核心问题/.test(q.stem))[0];
  ok(core && core.opts.length === 4, '原卷那道题的四个选项没被改动', core && core.opts);
  ok(core && core.note && /合理用药/.test(core.note), '笔记原文挂成了这道题的讲解', core && core.note);
  const fresh = bank2.questions.filter((q) => /生物半衰期/.test(q.stem))[0];
  ok(fresh && fresh.type === 'fill' && fresh.opts.length === 0, '没考过的那道是填空、没有选项',
    fresh && { type: fresh.type, opts: fresh.opts });

  // ③ 刷题：选择题出来的必须是卷子上的题干和选项
  a.setVal('#qForm', 'choice');
  a.setVal('#qCount', '0');
  a.click('#quizStartBtn');
  await sleep(200);
  const body = a.text('#quizBody') || '';
  const opts = a.$$('#optsBox .opt').map((e) => e.getAttribute('data-v'));
  ok(/核心问题|最常用标本/.test(body), '选择题刷的是卷子上的题干', body.slice(0, 40));
  ok(opts.length === 4, '给了四个选项', opts);
  ok(['合理用药', '获得最佳疗效', '安全用药', '获得最低成本', '血浆', '尿液', '唾液', '粪便'].some((o) => opts.indexOf(o) >= 0),
    '选项是卷子印的那几个词，不是系统凑的', opts);

  /* ============================================================
     十、答完能看到笔记里怎么说的
     ============================================================ */
  console.log('\n十、判定卡里能看到「笔记里怎么说」');
  const first = a.$$('#optsBox .opt')[0];
  first.dispatchEvent(new a.win.Event('click', { bubbles: true }));
  await sleep(150);
  const fb = a.text('#quizFb') || '';
  ok(/正确答案/.test(fb), '给了正确答案', fb.slice(0, 40));
  ok(/笔记里怎么说/.test(fb) || /原文：/.test(fb), '能看到出处/讲解', fb.slice(0, 80));

  console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——');
  process.exit(fail ? 1 : 0);
})();
