/* qr-mini.js 的测试。
 *
 * 两道关：
 *   ① 自洽 —— 把生成的矩阵按标准读法反解回来，文本必须一字不差
 *      （这条能抓住填充顺序、掩码、格式信息、RS 交织的错）
 *   ② 基线 —— live 地址的矩阵哈希钉死。改动编码逻辑时哈希会变，
 *      逼你重新做一次「标准一致性」验证再更新基线。
 *
 * 标准一致性没法在 node 里自己证明（自己解自己永远自洽），所以要靠外部解码器。
 * 一次性验法（改编码逻辑后重跑一次，全部 OK 才算过）：
 *
 *   node -e "…把矩阵写成 PBM…"   # 见下，或直接用 test/qr-verify 的历史脚本
 *   python -c "from pyzbar.pyzbar import decode; from PIL import Image; print(decode(Image.open('x.pbm').convert('RGB')))"
 *
 * 2026-11-10 用 pyzbar 验过：v2 / v4 / v5 / v6 五种长度全部正确解回原文。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = {};
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'vendor', 'qr-mini.js'), 'utf8'))(root);
const QR = root.QRMini;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* 按标准读法把矩阵反解成码字序列（和编码时同一套填充顺序，但这里只依赖公开的 at()） */
function readCodewords(q) {
  const n = q.size;
  const fn = [];
  for (let r = 0; r < n; r++) { fn.push(new Array(n).fill(false)); }

  const markFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r >= 0 && c >= 0 && r < n && c < n) fn[r][c] = true;
      }
    }
  };
  markFinder(0, 0); markFinder(0, n - 7); markFinder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { fn[6][i] = true; fn[i][6] = true; }

  // 对齐图案中心（版本 1–6）
  const align = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] }[q.version];
  align.forEach(ar => align.forEach(ac => {
    if ((ar === 6 && ac === 6) || (ar === 6 && ac === n - 7) || (ar === n - 7 && ac === 6)) return;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) fn[ar + dr][ac + dc] = true;
  }));

  // 格式信息区 + 固定黑模块
  for (let i = 0; i < 9; i++) { fn[i][8] = true; fn[8][i] = true; }
  for (let i = 0; i < 8; i++) fn[8][n - 1 - i] = true;
  for (let i = 0; i < 7; i++) fn[n - 1 - i][8] = true;
  fn[n - 8][8] = true;

  const hit = (r, c) => {
    switch (q.mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return false;
  };

  const bits = [];
  let right = n - 1;
  while (right >= 1) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (col < 0) continue;
        const row = up ? n - 1 - vert : vert;
        if (fn[row][col]) continue;
        bits.push((q.at(row, col) ? 1 : 0) ^ (hit(row, col) ? 1 : 0));
      }
    }
    right -= 2;
  }

  const cw = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
    cw.push(v);
  }
  return cw;
}

/* 反交织 + 解析 byte 模式，返回原文 */
const BLOCKS = {
  1: { ec: 10, len: [16] },
  2: { ec: 16, len: [28] },
  3: { ec: 26, len: [44] },
  4: { ec: 18, len: [32, 32] },
  5: { ec: 24, len: [43, 43] },
  6: { ec: 16, len: [27, 27, 27, 27] }
};
function decodeText(q) {
  const spec = BLOCKS[q.version];
  const totalData = spec.len.reduce((a, b) => a + b, 0);
  const cw = readCodewords(q);
  const dataCw = cw.slice(0, totalData);
  // 交织是「第 i 轮依次取各块的第 i 个字节」，反着来一遍
  const out = spec.len.map(() => []);
  let at = 0;
  const maxLen = Math.max.apply(null, spec.len);
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < spec.len.length; b++) {
      if (i < spec.len[b]) out[b].push(dataCw[at++]);
    }
  }
  const data = [].concat.apply([], out);
  const bits = [];
  data.forEach(b => { for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1); });

  const mode = parseInt(bits.slice(0, 4).join(''), 2);
  const countBits = q.version <= 9 ? 8 : 16;
  const count = parseInt(bits.slice(4, 4 + countBits).join(''), 2);
  const body = bits.slice(4 + countBits, 4 + countBits + count * 8);
  const bytes = [];
  for (let i = 0; i < body.length; i += 8) bytes.push(parseInt(body.slice(i, i + 8).join(''), 2));
  return { mode, count, text: Buffer.from(bytes).toString('utf8') };
}

const LIVE = 'https://2119633980357275648.app.workbuddy.host/?sharecode=6PMDOKLNBN';

console.log('\n[1] 版本按长度自己选');
{
  // 各版本 M 级的数据容量（字节）：14 / 26 / 42 / 62 / 84 / 106
  ok(QR.encode('abc').version === 1, '3 字节 → 版本 1');
  ok(QR.encode('a'.repeat(14)).version === 1, '14 字节刚好装满版本 1');
  ok(QR.encode('a'.repeat(15)).version === 2, '15 字节撑到版本 2');
  ok(QR.encode('a'.repeat(20)).version === 2, '20 字节 → 版本 2');
  ok(QR.encode('a'.repeat(30)).version === 3, '30 字节 → 版本 3（v3 容量 42）');
  ok(QR.encode('a'.repeat(50)).version === 4, '50 字节 → 版本 4（v4 容量 62）');
  ok(QR.encode(LIVE).version === 5, '线上链接（68 字节）→ 版本 5');
  ok(QR.encode('a'.repeat(100)).version === 6, '100 字节 → 版本 6');
  let long = false;
  try { QR.encode('a'.repeat(120)); } catch (e) { long = /太长/.test(e.message); }
  ok(long, '超过版本 6 容量时明确报错，不悄悄截断');
  ok(QR.encode(LIVE).size === 37, '版本 5 边长 37');
}

console.log('\n[2] 反解回来必须一字不差');
{
  [LIVE,
   'https://a.cn/?s=ABC',
   'https://finals-quiz.app.workbuddy.host/?sharecode=LKWARVTOI6',
   'https://2119633980357275648.app.workbuddy.host/?sharecode=6PMDOKLNBN&from=card'
  ].forEach(text => {
    const q = QR.encode(text);
    const got = decodeText(q);
    ok(got.mode === 4, 'byte 模式（4）· v' + q.version);
    ok(got.count === Buffer.byteLength(text), '长度字段对得上 · v' + q.version, got.count);
    ok(got.text === text, '原文一致 · v' + q.version);
  });
}

console.log('\n[3] 中文链接也不能崩（UTF-8 多字节）');
{
  const text = 'https://a.cn/笔记';
  const q = QR.encode(text);
  ok(decodeText(q).text === text, 'UTF-8 内容原样还原');
}

console.log('\n[4] 矩阵基线（改了编码逻辑就会变，逼你重新用解码器验一遍）');
{
  const q = QR.encode(LIVE);
  let dump = '';
  for (let r = 0; r < q.size; r++) {
    for (let c = 0; c < q.size; c++) dump += q.at(r, c) ? '1' : '0';
  }
  const hash = crypto.createHash('sha256').update(dump).digest('hex').slice(0, 16);
  console.log('    当前矩阵哈希: ' + hash + '  (v' + q.version + ' mask' + q.mask + ')');
  ok(hash === 'daf8b4de7a5c5083', 'live 地址的矩阵哈希与基线一致', hash);
}

console.log('\n[5] 三个定位角必须是标准样式（黑框-白环-黑心）');
{
  const q = QR.encode(LIVE);
  const corner = (r0, c0) => {
    const get = (r, c) => q.at(r0 + r, c0 + c);
    let okAll = true;
    for (let i = 0; i < 7; i++) {
      if (!get(0, i) || !get(6, i) || !get(i, 0) || !get(i, 6)) okAll = false;   // 外框全黑
    }
    for (let i = 1; i <= 5; i++) {
      if (get(1, i) || get(5, i) || get(i, 1) || get(i, 5)) okAll = false;        // 白环
    }
    for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) {
      if (!get(r, c)) okAll = false;                                              // 黑心
    }
    return okAll;
  };
  ok(corner(0, 0), '左上角');
  ok(corner(0, q.size - 7), '右上角');
  ok(corner(q.size - 7, 0), '左下角');
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) process.exit(1);
