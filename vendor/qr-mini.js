/*!
 * qr-mini.js —— 只够画「把站点链接变成二维码」这一件事的最小 QR 编码器。
 *
 * 为什么自己写：分享卡是 canvas 画的，二维码必须本地生成 —— 不能走外链图床
 * （对方 404 过一次），也不能依赖第三方接口（可能被墙、还会把链接发出去）。
 *
 * 范围刻意收窄，换来代码小、好验证：
 *   - 只用 byte 模式（UTF-8 直接塞字节），纠错等级固定 M
 *   - 版本 1–6（最多 106 字节左右的容量），站点链接那种长度绰绰有余
 *   - 不做 v7+ 的版本信息区、不做汉字/数字模式、不做结构化追加
 *
 * 用法：
 *   var q = QRMini.encode('https://...');
 *   q.size     // 边长（模块数）
 *   q.at(r, c) // 该模块是不是黑的（true/false）
 *
 * 正确性靠「画出来能被 pyzbar 解回原文」验证，不靠肉眼。
 */
(function (root) {
  'use strict';

  /* ---------- GF(256) ---------- */
  var EXP = new Array(512);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function genPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(g.length + 1);
      for (var k = 0; k < next.length; k++) next[k] = 0;
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= gfMul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }

  function rsEncode(data, ecLen) {
    var g = genPoly(ecLen);
    var res = new Array(ecLen);
    for (var i = 0; i < ecLen; i++) res[i] = 0;
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ res[0];
      for (var s = 0; s < ecLen - 1; s++) res[s] = res[s + 1];
      res[ecLen - 1] = 0;
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) res[j] ^= gfMul(g[j + 1], factor);
      }
    }
    return res;
  }

  /* ---------- 纠错等级 M 的分块参数（版本 1–6） ---------- */
  /* blocks 是每块的数据码字数，按标准顺序：短块在前……这里各版本长度都很整齐，
     除了 v8+ 才有长短混排，v1–v6 都是等长，所以直接列出来就够。 */
  var ECC_M = {
    1: { ec: 10, blocks: [16] },
    2: { ec: 16, blocks: [28] },
    3: { ec: 26, blocks: [44] },
    4: { ec: 18, blocks: [32, 32] },
    5: { ec: 24, blocks: [43, 43] },
    6: { ec: 16, blocks: [27, 27, 27, 27] }
  };

  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34]
  };

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 6; v++) {
      var total = ECC_M[v].blocks.reduce(function (a, b) { return a + b; }, 0);
      var countBits = v <= 9 ? 8 : 16;
      if (4 + countBits + byteLen * 8 <= total * 8) return v;
    }
    throw new Error('内容太长，这个迷你编码器只做到版本 6（约 100 字节）');
  }

  /* ---------- 位流 → 码字 ---------- */
  function buildCodewords(bytes, version) {
    var spec = ECC_M[version];
    var totalData = spec.blocks.reduce(function (a, b) { return a + b; }, 0);
    var bits = [];

    function put(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }

    put(4, 4);                       // byte 模式
    put(bytes.length, version <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);

    // 终止符：最多 4 位
    var cap = totalData * 8;
    var term = Math.min(4, cap - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    // 补到整字节
    while (bits.length % 8 !== 0) bits.push(0);

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      data.push(byte);
    }
    // 填充码字，交替 0xEC / 0x11
    var pad = [0xec, 0x11];
    var p = 0;
    while (data.length < totalData) data.push(pad[p++ % 2]);
    return data;
  }

  /* 交织：数据块依次取字节 → 各块的纠错码字依次取字节 */
  function interleave(data, version) {
    var spec = ECC_M[version];
    var offset = 0;
    var blocks = spec.blocks.map(function (len) {
      var chunk = data.slice(offset, offset + len);
      offset += len;
      return { data: chunk, ec: rsEncode(chunk, spec.ec) };
    });
    var out = [];
    var maxLen = Math.max.apply(null, spec.blocks);
    for (var i = 0; i < maxLen; i++) {
      blocks.forEach(function (bl) { if (i < bl.data.length) out.push(bl.data[i]); });
    }
    for (var e = 0; e < spec.ec; e++) {
      blocks.forEach(function (bl) { out.push(bl.ec[e]); });
    }
    return out;
  }

  /* ---------- 矩阵 ---------- */
  function buildMatrix(codewords, version, mask) {
    var size = version * 4 + 17;
    var mod = [];
    var fn = [];
    var r, c;

    for (r = 0; r < size; r++) {
      mod.push(new Array(size));
      fn.push(new Array(size));
      for (c = 0; c < size; c++) { mod[r][c] = false; fn[r][c] = false; }
    }

    function setFn(row, col, dark) {
      if (row < 0 || col < 0 || row >= size || col >= size) return;
      mod[row][col] = !!dark;
      fn[row][col] = true;
    }

    // 定位角 + 分隔带
    function finder(row, col) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = row + dr, cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          var dark = inside && (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setFn(rr, cc, dark);
        }
      }
    }
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // 定时线
    for (var i = 8; i < size - 8; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }

    // 对齐图案
    var centers = ALIGN[version] || [];
    centers.forEach(function (ar) {
      centers.forEach(function (ac) {
        // 靠三个角的那些跟定位角重叠，跳过
        var nearFinders = (ar === 6 && ac === 6) ||
          (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6);
        if (nearFinders) return;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFn(ar + dr, ac + dc, dark);
          }
        }
      });
    });

    // 先占位格式信息区（真值最后填），避免数据长到那里去
    drawFormat(mask, true);

    // 数据按「从右下角开始、两列一组、蛇形向上向下」填
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var col = right - j;
          var upward = ((right + 1) & 2) === 0;
          var row = upward ? size - 1 - vert : vert;
          if (fn[row][col]) continue;
          var dark = false;
          if (bitIdx < totalBits) {
            var byte = codewords[bitIdx >>> 3];
            dark = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          mod[row][col] = dark;
        }
      }
    }

    applyMask(mask);
    drawFormat(mask, false);

    function applyMask(m) {
      for (var r2 = 0; r2 < size; r2++) {
        for (var c2 = 0; c2 < size; c2++) {
          if (fn[r2][c2]) continue;
          if (maskHit(m, r2, c2)) mod[r2][c2] = !mod[r2][c2];
        }
      }
    }

    function drawFormat(m, dummy) {
      var data = (0 << 3) | m;        // 纠错等级 M = 00
      var rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bits = ((data << 10) | rem) ^ 0x5412;
      var bit = function (n) { return ((bits >>> n) & 1) === 1; };

      // 第一份：左上角
      for (var i = 0; i <= 5; i++) setFn(i, 8, dummy ? false : bit(i));
      setFn(7, 8, dummy ? false : bit(6));
      setFn(8, 8, dummy ? false : bit(7));
      setFn(8, 7, dummy ? false : bit(8));
      for (var j = 9; j < 15; j++) setFn(8, 14 - j, dummy ? false : bit(j));
      // 第二份：右上 + 左下
      for (var a = 0; a < 8; a++) setFn(8, size - 1 - a, dummy ? false : bit(a));
      for (var b = 8; b < 15; b++) setFn(size - 15 + b, 8, dummy ? false : bit(b));
      setFn(size - 8, 8, true);       // 固定的黑模块
    }

    return { size: size, mod: mod };
  }

  function maskHit(m, r, c) {
    switch (m) {
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
  }

  /* 选掩码：算 4 条标准罚分里最影响识别的三条（略过「类似定位角的图案」那条，
     它对能否扫出来影响最小，代码却最长）。分数低的更均衡。 */
  function penalty(m, size) {
    var score = 0;
    var r, c, run, dark = 0;

    // 规则 1：同色连续 5 个以上
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // 规则 2：2×2 同色块
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // 规则 4：黑块比例偏离 50%
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var ratio = dark * 100 / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

    return score;
  }

  function encode(text) {
    var bytes = utf8Bytes(String(text));
    var version = pickVersion(bytes.length);
    var data = buildCodewords(bytes, version);
    var codewords = interleave(data, version);

    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var made = buildMatrix(codewords, version, mask);
      var score = penalty(made.mod, made.size);
      if (!best || score < best.score) best = { score: score, made: made, mask: mask };
    }

    var size = best.made.size;
    return {
      size: size,
      version: version,
      mask: best.mask,
      at: function (r, c) { return best.made.mod[r][c]; },
      codewords: codewords          // 调试/测试用：交织后的码字序列
    };
  }

  root.QRMini = { encode: encode, _ECC_M: ECC_M, _utf8Bytes: utf8Bytes,
    _buildMatrix: buildMatrix, _interleave: interleave, _buildCodewords: buildCodewords };
})(typeof window !== 'undefined' ? window : this);
