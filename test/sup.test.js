'use strict';
/* 补导入（题集生成后再喂卷子/笔记）+ 老版 .doc 转 docx 回归
   运行： NODE_PATH=<workspace>/node_modules node test/sup.test.js

   用户的诉求：
     · 题集建好以后又拿到新卷子 / 新笔记，能补进去，不用整个重做
     · 卷子和笔记混着选也行，像试卷的照抄、像笔记的挖空
     · 跟题集里重复的题不能加两遍
     · 老版 .doc 也能直接导入（网页里内置转 .docx）
   样本全部内联；.doc 那节用本机真实文件，找不到就跳过。                          */

const fs = require('fs');
const path = require('path');
const { Window } = require('happy-dom');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0, skip = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function skipped(msg) { skip++; console.log('  – ' + msg); }

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
function txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }

const OLD_QS = [
  { type: 'fill', stem: '药物治疗的前提是____', answer: '有效性', source: '药物治疗的前提是有效性。' },
  { type: 'fill', stem: '首过效应最明显的给药途径是____', answer: '口服', source: '首过效应最明显的给药途径是口服。' }
];

// 先开一个空页面，再用真实走一遍 normQ（拿到和线上一样的 id），最后落盘
function banked() {
  const r = openWin({});
  const qs = OLD_QS.map(function (q, i) { return r.api.normQ(q, i); });
  r.api.state().banks.push({ id: 'b_sup', course: '药物治疗学', createdAt: 1, questions: qs });
  r.api.state().cur = 'b_sup';
  r.api.save();
  return r;
}
function bankOf(win) { return JSON.parse(win.localStorage.getItem('fq_banks_v1'))[0]; }

const PAPER = [
  '单选题（每题2分）',
  '1.药物治疗的核心问题是（     ）A',
  'A、合理用药        B、获得最佳疗效',
  'C、安全用药        D、获得最低成本',
  '2.以下属于肝药酶诱导剂的是（B）',
  'A、酮康唑        B、苯巴比妥        C、西咪替丁        D、红霉素'
].join('\n');

const NOTE = [
  '药物治疗的前提是有效性。',
  '首过效应最明显的给药途径是口服。',
  '生物半衰期与血药浓度无关，又称之为恒比消除。'
].join('\n');

(async function () {

/* ---------------- 一、入口 ---------------- */
console.log('\n一、补导入的入口');
{
  const { win, api } = banked();
  const d = win.document;
  ok(!!d.querySelector('#stepSup'), '导入页有一张「补充导入」卡片');
  ok(!!d.querySelector('#supPickBtn'), '有「选择文件（可多选）」按钮');
  ok(d.querySelector('#supInput').multiple, '文件框支持多选');
  const accept = d.querySelector('#supInput').getAttribute('accept') || '';
  ok(/\.docx/.test(accept) && /\.doc(?![x])/.test(accept) && /\.pdf/.test(accept) && /\.txt/.test(accept),
    '.docx / .doc / .pdf / .txt 都能选', accept);
  ok(!!d.querySelector('#supParseBtn'), '有「解析并预览」按钮');
  ok(!!d.querySelector('#supText'), '也能直接粘贴');
  ok(api.state().previewMode === 'main', '默认真的是「新建题集」模式，不是补导入');
}

/* ---------------- 二、补一份卷子：照抄原题 ---------------- */
console.log('\n二、补一份卷子：按原卷照抄');
{
  const { win, api } = banked();
  const d = win.document;
  d.querySelector('#supText').value = PAPER;
  d.querySelector('#supParseBtn').click();

  ok(api.state().previewMode === 'sup', '进入补导入模式');
  ok(d.querySelector('#previewCard').hidden === false, '预览表弹出来了');
  ok(/补导入预览/.test(txt(d.querySelector('#previewTitle'))), '标题写着「补导入预览」', txt(d.querySelector('#previewTitle')));
  ok(/追加到当前题集/.test(txt(d.querySelector('#saveBankBtn'))), '保存按钮改成「追加到当前题集」', txt(d.querySelector('#saveBankBtn')));

  const pv = api.state().preview;
  ok(pv.length === 2, '解析出 2 道选择题', pv.length);
  ok(pv[0].type === 'single' && pv[0].opts.length === 4, '选择题带着原卷的 4 个选项', pv[0] && pv[0].opts);
  ok(pv[0].optsSrc === 'paper' || pv[0].fromPaper, '标记成原卷题（能出选择题）');
  ok(/原卷真题/.test(txt(d.querySelector('#previewBody'))), '预览里标了「原卷真题」');
  ok(/合理用药/.test(txt(d.querySelector('#previewBody'))), '选项内容原样搬过来');

  d.querySelector('#saveBankBtn').click();
  const b = bankOf(win);
  ok(b.questions.length === 4, '原题 2 道 + 补进来 2 道 = 4 道', b.questions.length);
  ok(b.questions.slice(2).every(function (q) { return q.order >= 2; }), '新题接在旧题后面（order 递增）',
    b.questions.map(function (q) { return q.order; }));
  ok(api.state().supFiles.length === 0 && d.querySelector('#supText').value === '',
    '追加完把补导入的输入清掉，避免下次重复解析');
}

/* ---------------- 三、补一份笔记：挖空出填空 ---------------- */
console.log('\n三、补一份笔记：按笔记挖空');
{
  const { win, api } = banked();
  const d = win.document;
  d.querySelector('#supText').value = NOTE;
  d.querySelector('#supParseBtn').click();
  const pv = api.state().preview;
  ok(pv.length >= 2, '笔记提炼出了题', pv.length);
  ok(pv.every(function (q) { return q.type === 'fill' || q.type === 'single' || q.type === 'multi'; }),
    '题型都是认得的类型', pv.map(function (q) { return q.type; }));
  ok(pv.filter(function (q) { return q.type === 'fill'; }).length >= 1, '至少有挖空出来的填空');
  ok(!pv.some(function (q) { return q.type === 'single' || q.type === 'multi'; }),
    '笔记里的句子不会凭空变成选择题（没有原卷就不给选项）');
}

/* ---------------- 四、跟题集重复的题不重复加 ---------------- */
console.log('\n四、题集里已有的题：标「已有」、默认不勾、点了也不重复加');
{
  const { win, api } = banked();
  const d = win.document;
  d.querySelector('#supText').value = NOTE;
  d.querySelector('#supParseBtn').click();

  const rows = Array.from(d.querySelectorAll('#previewBody tr'));
  const already = rows.filter(function (tr) { return /已有/.test(txt(tr)); });
  ok(already.length >= 1, '跟题集重复的题被标成「已有」', already.length);
  ok(already.every(function (tr) { return !tr.querySelector('.p-chk').checked; }), '「已有」的默认不勾');
  ok(rows.some(function (tr) { return !/已有/.test(txt(tr)) && tr.querySelector('.p-chk').checked; }),
    '新题默认勾上');

  // 全都勾上再存：已有的题也不该被加两遍
  d.querySelector('#chkAll').checked = true;
  d.querySelector('#chkAll').dispatchEvent(new win.Event('change'));
  d.querySelector('#saveBankBtn').click();
  const b = bankOf(win);
  const stems = b.questions.map(function (q) { return q.stem; });
  ok(new Set(stems).size === stems.length, '题集里没有重复的题干', stems);
  ok(b.questions.filter(function (q) { return /药物治疗的前提是/.test(q.stem); }).length === 1,
    '「药物治疗的前提」还是只有一道');
}

/* ---------------- 五、多份文件混着来：自动分辨 ---------------- */
console.log('\n五、卷子和笔记混着选，自动分辨');
{
  const { win, api } = banked();
  const F = (name, text) => new win.File([text], name, { type: 'text/plain' });
  await api.importFiles([
    F('第五章 新卷子.txt', PAPER),
    F('第五章 新笔记.txt', NOTE)
  ], 'sup');
  ok(api.state().supFiles.length === 2, '两份文件都读进来了', api.state().supFiles.length);
  ok(/2 个文件/.test(txt(win.document.querySelector('#supStat'))), '按钮旁边报了文件数与字数',
    txt(win.document.querySelector('#supStat')));

  win.document.querySelector('#supParseBtn').click();
  const pv = api.state().preview;
  ok(pv.some(function (q) { return (q.opts || []).length >= 2; }), '卷子那份按选择题照抄');
  ok(pv.some(function (q) { return q.type === 'fill'; }), '笔记那份按填空出');
  ok(pv.every(function (q) { return q.chapter === '第五章 新卷子' || q.chapter === '第五章 新笔记'; }),
    '各按自己的文件名记章节', pv.map(function (q) { return q.chapter; }).slice(0, 4));
}

/* ---------------- 六、解析不出来时说清楚 ---------------- */
console.log('\n六、失败与格式不匹配');
{
  const { win, api } = banked();
  const d = win.document;
  d.querySelector('#supText').value = '1234567890';
  d.querySelector('#supParseBtn').click();
  ok(/没解析出题目/.test(txt(d.querySelector('#toast'))), '解析不出题时给明确提示',
    txt(d.querySelector('#toast')));
  ok(d.querySelector('#previewCard').hidden === true, '不会弹一张空预览表');

  // 没有任何输入
  const w2 = banked();
  w2.win.document.querySelector('#supParseBtn').click();
  ok(/先选要补的文件/.test(txt(w2.win.document.querySelector('#toast'))), '什么都没选也提示得清楚',
    txt(w2.win.document.querySelector('#toast')));

  // 还没有题集
  const w3 = openWin({ fq_banks_v1: '[]', fq_current_v1: '' });
  w3.win.document.querySelector('#supText').value = PAPER;
  w3.win.document.querySelector('#supParseBtn').click();
  ok(/还没有题集/.test(txt(w3.win.document.querySelector('#toast'))), '没有题集时提示先建一个',
    txt(w3.win.document.querySelector('#toast')));

  // 不支持的文件类型
  const bad = new win.File(['x'], '表格.xlsx', { type: 'text/plain' });
  let msg = '';
  try { await api.readOneFile(bad); } catch (e) { msg = e.message; }
  ok(/不支持 \.xlsx/.test(msg), '不认识的后缀直接说「不支持 .xlsx」', msg);
}

/* ---------------- 七、老版 .doc：内置转 docx ---------------- */
console.log('\n七、老版 .doc 转 .docx');
{
  const { win, api } = banked();
  const d = win.document;

  // 手搓一个「假 doc」：不是 CFB，应该明确报错而不是崩
  const fake = new win.File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], '假的.doc', { type: 'application/msword' });
  let err = '';
  try { await api.readOneFile(fake); } catch (e) { err = e.message; }
  ok(/老版 Word 解析失败/.test(err) && /不是 Word 97-2003/.test(err), '文件不是真 .doc 时说清楚原因', err);

  // 我们自己造的 docx 结构要能过 zip 校验（反证「先转后读」这条路是通的）
  const docx = api.textToDocx('第一行\n第二行');
  const u8 = docx;
  ok(u8[0] === 0x50 && u8[1] === 0x4B, '转出来的 docx 是 zip（PK 头）', [u8[0], u8[1]]);
  const back = await api.docxLocal(docx.buffer);
  ok(back === '第一行\n第二行', 'docx 能被自己的解析器读回来', back);

  const dir = 'D:/03_文档资料/学习资料/A临床药物治疗学概论';
  const real = fs.existsSync(dir) ? fs.readdirSync(dir).filter(function (n) { return /\.doc$/i.test(n); })[0] : null;
  if (!real) {
    skipped('本机没有真实 .doc 样本，跳过真文件验证');
  } else {
    const buf = fs.readFileSync(path.join(dir, real));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    ok(api.isCfb(ab), '真实 .doc 是 OLE 复合文档（CFB）');
    const text = api.docText(ab);
    ok(text.replace(/\s/g, '').length > 100, '正文抠出来了', text.replace(/\s/g, '').length);
    ok(/单选题|多选题|章/.test(text), '读出来的是能看懂的试卷正文', text.slice(0, 40));

    const conv = api.docToDocx(ab);
    const viaDocx = await api.docxLocal(conv.buffer);
    ok(viaDocx.replace(/\s/g, '') === text.replace(/\s/g, ''), '转成 docx 再读，文字一字不差');
    const r = api.parsePaperDoc(viaDocx);
    ok(r.questions.length > 0, '.doc 转 docx 后能正常解析出题目', r.questions.length);

    // 真文件走完整导入：文件列表里要出现「存 .docx」
    const f = new win.File([buf], real, { type: 'application/msword' });
    await api.importFiles([f], 'paper');
    ok(api.state().paperFiles.length === 1, '真实 .doc 通过了导入（不再是「网页里解析不了」）',
      api.state().paperFiles.map(function (x) { return x.name; }));
    ok(!!api.state().paperFiles[0].docx, '转换出来的 docx 留在内存里，可以另存');
    ok(/存 \.docx/.test(txt(d.querySelector('#paperFiles'))), '文件列表里有「存 .docx」按钮');
  }
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败' + (skip ? ' / ' + skip + ' 跳过' : '') + ' ——\n');
process.exit(fail ? 1 : 0);

})();
