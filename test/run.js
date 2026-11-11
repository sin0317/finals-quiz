'use strict';
/* =========================================================
   一键跑测试
   ---------------------------------------------------------
   以前每改一版，都要手写这段循环、还要记 NODE_PATH、还要人工数
   42 套里哪套挂了（各套摘要格式并不统一，grep「通过 N」会漏）。
   现在一条命令：

     node test/run.js                跑全部
     node test/run.js fav delq       只跑名字里带 fav / delq 的
     node test/run.js --quiet        只打汇总和失败项

   退出码：全绿 0，有失败 1 —— 直接可以接在构建脚本后面。
   ========================================================= */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;

const argv = process.argv.slice(2);
const quiet = argv.indexOf('--quiet') >= 0;
const filters = argv.filter(function (a) { return a.charAt(0) !== '-'; });

/* happy-dom 装在【工作空间根】。子进程是独立的 node，NODE_PATH 得显式传下去，
   否则每套测试都会在 require 那一行倒掉。 */
const env = Object.assign({}, process.env);
const wsModules = path.resolve(ROOT, '..', 'node_modules');
const localModules = path.join(ROOT, 'node_modules');
const extraPaths = [wsModules, localModules].filter(function (p) { return fs.existsSync(p); });
if (extraPaths.length) {
  env.NODE_PATH = extraPaths.concat(env.NODE_PATH ? [env.NODE_PATH] : []).join(path.delimiter);
}

let files = fs.readdirSync(TEST_DIR)
  .filter(function (f) { return /\.test\.js$/.test(f); })
  .sort();

if (filters.length) {
  files = files.filter(function (f) {
    return filters.some(function (k) { return f.indexOf(k) >= 0; });
  });
  if (!files.length) {
    console.error('没有匹配这些关键字的测试：' + filters.join(' '));
    process.exit(1);
  }
}

/* 从输出里抠「通过几项 / 失败几项」。
   42 套测试是不同时期写的，摘要行有六种写法（这也是以前只能靠退出码 +
   人工 grep 的原因，「通过 N」这类 grep 一定会漏）。按从精确到宽松的顺序认：

     #RESULT pass=68 fail=0        ← 新测试（_harness）打的机器可读行
     —— 24 通过 / 0 失败 ——
     结果： 51 通过 / 0 失败
     通过 31 项，失败 0 项
     通过 16，失败 0
     ✓ 全部通过（27 项）            ← 没有失败数，等于全过
   */
const PATTERNS = [
  { re: /#RESULT pass=(\d+) fail=(\d+)/, pass: 1, fail: 2 },
  { re: /(\d+)\s*通过\s*[/／]\s*(\d+)\s*失败/, pass: 1, fail: 2 },
  { re: /通过\s*(\d+)\s*项?\s*[，,]\s*失败\s*(\d+)\s*项?/, pass: 1, fail: 2 },
  { re: /全部通过\s*[（(]\s*(\d+)\s*项/, pass: 1, fail: null },
  { re: /通过\s*(\d+)\s*项/, pass: 1, fail: null }
];

function parseCounts(out) {
  for (const p of PATTERNS) {
    const m = out.match(p.re);
    if (m) return { pass: +m[p.pass], fail: p.fail ? +m[p.fail] : 0 };
  }
  return null;
}

function failLines(out) {
  return out.split(/\r?\n/).filter(function (l) { return /✗/.test(l); });
}

const t0 = Date.now();
let passSets = 0;
const badSets = [];
let totalCases = 0;

console.log('\n跑 ' + files.length + ' 套测试…\n');

files.forEach(function (f, i) {
  const st = Date.now();
  const r = spawnSync(process.execPath, [path.join(TEST_DIR, f)], {
    cwd: ROOT,
    env: env,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ms = Date.now() - st;
  const c = parseCounts(out);
  const crashed = r.status !== 0;
  const passed = !crashed && c && c.fail === 0;
  const label = '[' + String(i + 1).padStart(2, ' ') + '/' + files.length + ']';

  if (passed) {
    passSets++;
    totalCases += (c && c.pass) || 0;
    if (!quiet) {
      console.log('  ok   ' + label + ' ' + f.padEnd(26, ' ') +
        String((c && c.pass) || 0).padStart(5, ' ') + ' 项  ' + (ms / 1000).toFixed(1) + 's');
    }
  } else {
    badSets.push({ file: f, out: out, counts: c, status: r.status, signal: r.signal });
    if (c) totalCases += c.pass || 0;
    console.log('  FAIL ' + label + ' ' + f.padEnd(26, ' ') +
      (c ? String(c.pass).padStart(5) + ' 项' : '   崩溃') + '  ' + (ms / 1000).toFixed(1) + 's');
  }
});

const sec = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n' + '─'.repeat(58));
if (!badSets.length) {
  console.log(files.length + ' 套全绿 · 合计 ' + totalCases + ' 项断言 · 用时 ' + sec + 's');
  console.log('─'.repeat(58) + '\n');
  process.exit(0);
}

console.log((files.length - badSets.length) + ' 套通过 / ' + badSets.length + ' 套失败 · 合计 ' + totalCases + ' 项');
console.log('─'.repeat(58));

badSets.forEach(function (b) {
  console.log('\n【' + b.file + '】' + (b.status === null ? ' 超时' : ' 退出码 ' + b.status));
  const lines = failLines(b.out);
  if (lines.length) {
    lines.slice(0, 12).forEach(function (l) { console.log('   ' + l.trim()); });
    if (lines.length > 12) console.log('   …还有 ' + (lines.length - 12) + ' 条');
  } else {
    // 没打出 ✗ 就挂了：多半是语法错或模块找不到，把末尾几行贴出来
    b.out.trim().split(/\r?\n/).slice(-8).forEach(function (l) { console.log('   ' + l); });
  }
});

console.log('\n看单套详情： node test/' + badSets[0].file + '\n');
process.exit(1);
