'use strict';
/* 小样卷导入 + 挖空拼句 的回归
   运行： NODE_PATH=<workspace>/node_modules node test/answerline.test.js

   用户（小黑盒 @Zerone，南理工研究生）报的两条：
     A. 「我另贴了一份含单选题标题、选项和答案的小样卷，系统提示没有解析出题目」
        —— 其实出了，出成了垃圾填空题：答案是「（ ）」、题干只剩半句。
        真因：parseBankQuestions 只认印在括号后面的答案（「（ ）B」），
        答案单独一行（「答案：B」）时它找不到锚点，整道题掉进提炼引擎。
     B.「原句「无监督学习是从无标签数据中发现结构的方法」被生成成
        「无监督学习从是____」，有语病」
        —— 介词「从」被挪到了触发词「是」前面，拼出来就成了「从是」。

   现在的规矩：
     · 独立的答案行（答案 / 【答案】/ 正确答案 / 参考答案）并回上一题的括号后
     · 题干、选项、答案挤成一行的，也把答案挪进括号
     · 找不到带空括号的题干就不动，宁可不出题也不乱塞
     · 代词只拼在触发词之后：「……是从____中发现……」 */

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

function open() {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = function () { return true; };
  win.alert = function () {};
  try { win.localStorage.clear(); } catch (e) { /* happy-dom 自带实现 */ }
  const api = win.eval('(function(){' + APP_SRC + '; return window.FQInternals; })()');
  return { win, api, d: win.document };
}

const { api } = open();
const build = api.buildFromNote;

function choice(qs) {
  return qs.filter(function (q) { return q.type === 'single' || q.type === 'multi'; });
}
function ansOf(q) {
  return Array.isArray(q.answer) ? q.answer.join('|') : String(q.answer);
}

/* ============ 1 用户那份小样卷：每行一个选项 + 答案单起一行 ============ */
console.log('\n[1] 「一、单选题」+ 每行一个选项 + 「答案：B」');
{
  const src = [
    '一、单选题',
    '1. 机器学习中，使用带标签数据训练模型的方法是（ ）',
    'A. 无监督学习',
    'B. 监督学习',
    'C. 强化学习',
    'D. 半监督学习',
    '答案：B',
    '',
    '2. 下列哪项属于无监督学习（ ）',
    'A. 线性回归',
    'B. 朴素贝叶斯',
    'C. K-means 聚类',
    'D. 逻辑回归',
    '答案：C'
  ].join('\n');

  const qs = build(src);
  const cs = choice(qs);
  ok(cs.length === 2, '出 2 道选择题（以前一道都没有，全是垃圾填空）', cs.map(function (q) { return q.type + ':' + q.stem; }));
  ok(cs[0] && cs[0].type === 'single', '第 1 题是单选', cs[0] && cs[0].type);
  ok(cs[0] && ansOf(cs[0]) === '监督学习', '第 1 题答案是「监督学习」', cs[0] && ansOf(cs[0]));
  ok(cs[1] && ansOf(cs[1]) === 'K-means 聚类', '第 2 题答案是「K-means 聚类」', cs[1] && ansOf(cs[1]));
  ok(cs[0] && cs[0].opts.length === 3, '第 1 题带 3 个干扰项', cs[0] && cs[0].opts);
  ok(cs.every(function (q) { return q.stem.indexOf('____') >= 0; }), '题干里的空位统一成 ____');
  ok(cs.every(function (q) { return q.stem.indexOf('（ ）') < 0 && q.stem.indexOf('（）') < 0; }), '题干不再残留空括号');
  ok(!qs.some(function (q) { return q.type === 'fill' && /（\s*）/.test(String(q.answer)); }),
    '不再拿「（ ）」当答案');
}

/* ============ 2 三种答案标记都要认 ============ */
console.log('\n[2] 【答案】/ 正确答案 / 参考答案');
{
  ['【答案】B', '正确答案：B', '参考答案: B', '答案 B', '答案：B。'].forEach(function (mark) {
    const src = ['单选题', '1. 药物治疗的核心问题是（ ）', 'A、合理用药', 'B、获得最佳疗效', 'C、保证药品供应', 'D、降低药价', mark].join('\n');
    const cs = choice(build(src));
    ok(cs.length === 1 && ansOf(cs[0]) === '获得最佳疗效', '「' + mark + '」能认出来', cs.length ? ansOf(cs[0]) : cs);
  });
}

/* ============ 3 题干、选项、答案挤在一行 ============ */
console.log('\n[3] 一行到底');
{
  const src = '单选题\n1、机器学习中，使用带标签数据训练模型的方法是（ ）A.无监督学习 B.监督学习 C.强化学习 D.半监督学习  答案：B';
  const cs = choice(build(src));
  ok(cs.length === 1, '出 1 道选择题', cs.length);
  ok(cs[0] && ansOf(cs[0]) === '监督学习', '答案对', cs[0] && ansOf(cs[0]));
  ok(cs[0] && /^机器学习中/.test(cs[0].stem), '题干没被答案尾巴污染', cs[0] && cs[0].stem);
}

/* ============ 4 原本就支持的写法别弄坏 ============ */
console.log('\n[4] 答案印在括号后面（原有能力）');
{
  const src = '单选题\n1. 下列哪项属于无监督学习（ ）C\nA. 线性回归  B. 朴素贝叶斯  C. K-means  D. 逻辑回归';
  const cs = choice(build(src));
  ok(cs.length === 1 && ansOf(cs[0]) === 'K-means', '括号后印答案照旧能认', cs.length ? ansOf(cs[0]) : cs);
}

/* ============ 5 不猜：没有空括号就别塞 ============ */
console.log('\n[5] 找不到空括号时不动手');
{
  const cs = choice(build([
    '单选题',
    '1. 以下关于用药原则的说法',
    'A、安全',
    'B、有效',
    'C、经济',
    'D、适当',
    '答案：A'
  ].join('\n')));
  ok(cs.length === 0, '题干没有空括号，不硬塞答案', cs.map(function (q) { return q.stem; }));
}

/* ============ 6 多选题的答案行 ============ */
console.log('\n[6] 多选题「答案：ABD」');
{
  const src = [
    '二、多选题',
    '1. 合理用药的基本要素包括（ ）',
    'A. 安全',
    'B. 有效',
    'C. 便宜',
    'D. 经济',
    '答案：ABD'
  ].join('\n');
  const cs = choice(build(src));
  ok(cs.length === 1, '出 1 道题', cs.length);
  ok(cs[0] && cs[0].type === 'multi', '认成多选', cs[0] && cs[0].type);
  ok(cs[0] && ansOf(cs[0]).split('|').length === 3, '三个正确项都在', cs[0] && ansOf(cs[0]));
}

/* ============ 7 「从是____」的语病 ============ */
console.log('\n[7] 介词不能跨过触发词');
{
  const qs = build([
    '无监督学习是从无标签数据中发现结构的方法。',
    '监督学习是使用带标签数据训练模型的方法。'
  ].join('\n'));
  const all = qs.map(function (q) { return q.stem; }).join('\n');
  ok(all.indexOf('从是') < 0, '题干里不再出现「从是」', all);
  const q0 = qs[0];
  ok(q0 && q0.stem.indexOf('是从____') >= 0, '第 1 题拼成「……是从____……」，介词在触发词之后', q0 && q0.stem);
  // 题干 + 答案拼起来必须还原整句 —— 一个字都不许凭空消失
  const whole = q0 ? q0.stem.replace('____', ansOf(q0)) : '';
  ok(whole.indexOf('无标签数据') >= 0 && whole.indexOf('中发现结构的方法') >= 0,
    '题干和答案拼起来是完整原句，没丢字', whole);
}

/* ============ 8 其它介词同样不能错位 ============ */
console.log('\n[8] 把 / 将 / 在 / 对 也走同一条路');
{
  ['用药前应把患者的过敏史问清楚。', '治疗方案应对患者的肝肾功能做评估。'].forEach(function (line) {
    const qs = build(line);
    qs.forEach(function (q) {
      ok(String(q.stem).indexOf('是把') < 0 && String(q.stem).indexOf('是对') < 0,
        '「' + line.slice(0, 8) + '…」题干预感正常：' + q.stem);
    });
  });
}

console.log('\n—— ' + pass + ' 通过 / ' + fail + ' 失败 ——');
process.exit(fail ? 1 : 0);
