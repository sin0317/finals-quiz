/* =========================================================
   期末刷题 · 把笔记变成题目
   纯前端实现，数据保存在浏览器 localStorage
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 存储键 ---------------- */
  var LS_BANKS = 'fq_banks_v1';
  var LS_STATS = 'fq_stats_v1';
  var LS_LOG = 'fq_log_v1';
  var LS_CUR = 'fq_current_v1';
  var LS_THEME = 'fq_theme_v1';

  /* ---------------- 小工具 ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return (h >>> 0).toString(36);
  }
  function qidOf(seed) { return 'q' + hash(seed); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------------- 文本归一 / 判分 ---------------- */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[\s\u3000]/g, '')
      .replace(/[，。、；：？！,.!?;:'"“”‘’（）()\[\]【】《》·—_\-]/g, '')
      .toLowerCase();
  }
  function bigrams(s) {
    var a = [];
    if (!s) return a;
    for (var i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2));
    if (!a.length) a.push(s);
    return a;
  }
  function dice(a, b) {
    if (!a || !b) return 0;
    var A = bigrams(a), B = bigrams(b), setB = new Set(B), hit = 0;
    A.forEach(function (g) { if (setB.has(g)) hit++; });
    return 2 * hit / (A.length + B.length);
  }
  function keyList(text) {
    var raw = String(text).split(/[、，,;；]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!raw.length) raw = [String(text)];
    return raw.map(function (r) { return { raw: r, n: normalize(r) }; });
  }

  /**
   * 判定背诵答案
   * @returns {level:'right'|'mid'|'wrong'|'empty', hits:[], miss:[], ratio, sim}
   */
  // 把「辽沈、淮海、平津战役」这种共享词尾的写法补全
  function expandShared(text) {
    var segs = String(text).split(/[、，,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (segs.length < 2) return text;
    var suffix = segs[segs.length - 1].slice(-2);
    if (!/^[\u4e00-\u9fa5]{2}$/.test(suffix)) return text;
    return segs.map(function (s) {
      return (s.length >= 2 && s.slice(-2) !== suffix) ? s + suffix : s;
    }).join('、');
  }

  function gradeAnswer(input, answer) {
    var arr = Array.isArray(answer) ? answer : [answer];
    var isMulti = arr.length > 1;
    if (isMulti) input = expandShared(input);
    var A = normalize(arr.join(''));
    var I = normalize(input || '');
    if (!I) return { level: 'empty', hits: [], miss: [], ratio: 0, sim: 0 };
    if (I === A) return { level: 'right', hits: arr.map(function (a) { return { raw: a }; }), miss: [], ratio: 1, sim: 1 };
    if (!isMulti) {
      // 单选：答案被完整说出（允许带一点多余内容）→ 直接算对
      if (A.indexOf(I) >= 0 && I.length / A.length >= 0.6) return { level: 'right', hits: [{ raw: arr[0] }], miss: [], ratio: 1, sim: 1 };
      if (I.indexOf(A) >= 0 && A.length / I.length >= 0.6) return { level: 'right', hits: [{ raw: arr[0] }], miss: [], ratio: 1, sim: 1 };
    }

    var keys = [];
    arr.forEach(function (a) { keyList(a).forEach(function (k) { if (k.n) keys.push(k); }); });
    var parts = String(input).split(/[、，,;；\s]+/).map(normalize).filter(Boolean);

    function match(k) {
      if (I.indexOf(k.n) >= 0) return 2;           // 整句里能找到
      for (var i = 0; i < parts.length; i++) {
        var u = parts[i];
        if (u === k.n) return 2;
        if (dice(u, k.n) >= 0.65) return 2;         // 个别字漏写、次序颠倒
        if (u.length >= 2 && k.n.length >= 2 && (k.n.indexOf(u) >= 0 || u.indexOf(k.n) >= 0)) {
          var r = Math.min(u.length, k.n.length) / Math.max(u.length, k.n.length);
          if (r >= 0.5) return 2;                  // 说了要点，说法基本一致
          if (r >= 0.3) return 1;                  // 只沾了个边，比如漏了时间
        }
      }
      return 0;
    }

    var hits = [], miss = [], strong = 0;
    keys.forEach(function (k) {
      var m = match(k);
      if (m > 0) { hits.push(k); if (m === 2) strong++; } else miss.push(k);
    });
    var ratio = keys.length ? hits.length / keys.length : 0;
    var sim = dice(I, A);
    var allStrong = strong === keys.length && keys.length > 0;
    var level;
    if (ratio === 1 && allStrong) level = 'right';
    else if (ratio >= 0.6 || sim >= 0.6) level = 'mid';
    else level = 'wrong';
    return { level: level, hits: hits, miss: miss, ratio: ratio, sim: sim };
  }

  /* ---------------- 笔记 → 知识点 ---------------- */
  // 「是」单独放一类：先找实词触发词，找不到才退回「是」
  var TRIGGERS = ['指的是', '标志着', '意味着', '发生于', '爆发于', '提出了', '创办了', '被称为', '被誉为', '主要有', '包括', '分为'];
  var TRIGGER_SHI = '是';

  /* ⑤ 兜底用：常见谓语起点。笔记里大量句子既没有「是」也没有冒号
     （「辛亥革命推翻了清王朝的统治」），以前会被直接丢掉；现在扫到谓语起点，
     把整句改成填空题「辛亥革命____」，不再损失题目。 */
  var VERBS = [
    '标志着', '意味着', '发生于', '爆发于', '成立于', '创办于', '始建于', '完成于', '逝世于', '出生于',
    '毕业于', '指的是', '被称为', '被誉为', '又称为', '简称为', '兴起于', '产生于', '起源于', '来源于',
    '推翻了', '建立了', '提出了', '创办了', '颁布了', '签订了', '通过了', '发表了', '组织了', '领导了',
    '发动了', '召开了', '割让了', '结束了', '开始了', '实现了', '完成了', '打击了', '促进了', '推动了',
    '导致了', '产生了', '出现了', '沦为', '废除', '消灭', '镇压', '反抗', '侵略', '占领', '统治',
    '推翻', '成立', '建立', '提出', '创办', '颁布', '签订', '通过', '发表', '组织', '领导', '发动',
    '召开', '割让', '赔偿', '又称', '也叫', '位于', '属于', '具有', '主张', '认为', '宣布', '决定',
    '实行', '推行', '制定', '采用', '采取', '坚持', '依靠', '经历', '达到', '获得', '取得', '保持',
    '维护', '反对', '抵抗', '争夺', '揭示', '表明', '说明', '反映', '体现', '包含', '标志', '促进',
    '推动', '导致', '取决于', '依赖于', '制约', '开始', '进入', '走向', '成为', '促使', '迫使',
    '允许', '禁止', '规定', '要求', '强调', '指出', '阐明', '论述', '分析', '总结', '归纳'
  ];

  // 从下标 2 起找最靠前的谓语起点（多字优先），避免把「中国共产党」切成「中国 / 共产党…」
  function findPredicate(sent) {
    for (var i = 2; i < sent.length; i++) {
      var hit = 0;
      for (var v = 0; v < VERBS.length; v++) {
        var w = VERBS[v];
        if (sent.substr(i, w.length) === w && w.length > hit) hit = w.length;
      }
      if (hit) return i;
    }
    return -1;
  }

  /* ⑥ 最后兜底：连谓语都扫不到时，从句子内部最后一个标点后面切开。
     切在标点后能保证挖出来的是完整短语，不会把词斩成两半。
     动词表不可能穷举（笔记里写「又称之为」「可归于」都扫不到），
     所以这一层不再依赖词表，只要是完整句子就保下来当填空题。
     ⚠️ 只在句子内部真的有分隔时才切：短语和简答提纲（「常用的给药方案设计方法有哪些」）
        没有标点，靠这一条自动排除，否则会吐出一堆残句垃圾题。 */
  var FILL_LEAD = /^(又称之为|又称为|被称为|被誉为|简称为|指的是|称为|是指|即为|就是|包括|分为|主要有|是|指|为|即|由)/;
  /* 「……，又称之为」这种，把引导词归到题干，答案才干净。⑤ ⑥ 两条路都要用，
     否则答案会变成「又称之为恒比消除」这种带壳的脏答案 */
  function moveLead(left, right) {
    var m = String(right).match(FILL_LEAD);
    if (m && right.slice(m[1].length).trim().length >= 2) {
      return { left: left + m[1], right: right.slice(m[1].length).trim() };
    }
    return { left: left, right: right };
  }
  function fallbackSplit(sent) {
    var i = -1;
    for (var k = sent.length - 2; k >= 2; k--) {
      // 只认中文标点。空格不能算：「第十四章 常见症状与药物治疗」这种
      // 章节标题一切就变成垃圾题了
      if ('，、；,;'.indexOf(sent.charAt(k)) >= 0) { i = k + 1; break; }
    }
    if (i < 2) return null;
    var moved = moveLead(sent.slice(0, i).trim(), sent.slice(i).trim().replace(/[。.]$/, ''));
    if (moved.right.length < 2 || moved.right.length > 30 || moved.left.length < 2) return null;
    return moved;
  }

  /* ---------------------------------------------------------
     加粗标记：笔记里习惯用 **重点** 或 *重点* 标出考点
     ---------------------------------------------------------
     直接拿正则去匹 **xxx** 会错位（从第二个星号开始匹配），
     两端各剩一个孤零零的 * 漏进题干，看着像乱码。
     所以这里先把它们统一换成内部占位符，后面所有切分只看占位符，
     最后在出口把星号彻底抹掉。用控制字符是为了避免和正文撞车。
     --------------------------------------------------------- */
  var BD_O = '\u0001', BD_C = '\u0002';
  function markBold(text) {
    return String(text)
      // 先双后单：双星号处理完就变成占位符了，不会被单星号规则二次切
      .replace(/[＊*]{2}([^*＊\r\n]{1,60})[＊*]{2}/g, BD_O + '$1' + BD_C)
      .replace(/[＊*]([^*＊\r\n]{1,60})[＊*]/g, BD_O + '$1' + BD_C);
  }
  // 出题前把残留的星号、占位符全部抹掉，保证题干干干净净
  function cleanMark(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0001\u0002]/g, '')
      .replace(/[＊*]/g, '')
      .trim();
  }

  function splitSentences(text) {
    var out = [];
    markBold(String(text)).split(/\r?\n/).forEach(function (line) {
      line = line.replace(/^\s*([-*•·]|\d+[.、)）]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.])\s*/, '');
      line.split(/[。！？；;!?]+/).forEach(function (s) {
        s = s.trim();
        if (s) out.push(s);
      });
    });
    return out;
  }

  var BOLD_RE = new RegExp(BD_O + '([^' + BD_C + ']{1,60})' + BD_C);
  /* 选项行（「A. xxx」「A、苯妥英钠 B、地高辛」）：本来就是选择题的一部分，
     漏进散文后一准切出「A、____」这种碎片，直接跳过，别拿它出题 */
  var OPT_ROW_RE = /(^|[、，,;；])\s*[A-E]\s*[.、．]/;

  function extractPoints(text) {
    var pts = [], seen = {};
    splitSentences(text).forEach(function (sent) {
      if (sent.length < 6 || sent.length > 90) return;
      if (OPT_ROW_RE.test(sent)) return;
      var left = '', trig = '', right = '', tail = '', forcedFill = false;
      var bold = sent.match(BOLD_RE);

      var boldOK = false;
      if (bold) {
        // ① 笔记里用 **xxx** / *xxx* 标了重点，那就是要考的空
        //    left 允许为空：加粗顶在句首时（「**安全**是首要前提」）照样要出题
        var bi = sent.indexOf(bold[0]);
        var bl = sent.slice(0, bi).trim();
        var bt = sent.slice(bi + bold[0].length).trim().replace(/[。.]$/, '');
        // 前后都没别的话，等于把整句都当答案，出不了题 → 退回普通路径
        if (bl || bt) {
          left = bl; right = bold[1].trim(); tail = bt; boldOK = true;
        }
      }
      if (!boldOK) {
        var best = null;
        TRIGGERS.forEach(function (t) {
          var i = sent.lastIndexOf(t);
          if (i < 0) return;
          if (!best || i > best.i || (i === best.i && t.length > best.t.length)) best = { i: i, t: t };
        });
        if (best) {
          // ② 有实词触发词：……标志着…… / ……包括……
          left = sent.slice(0, best.i).trim();
          trig = best.t;
          right = sent.slice(best.i + best.t.length).trim().replace(/[。.]$/, '');
        } else if (sent.lastIndexOf(TRIGGER_SHI) >= 0) {
          // ③ 退回最通用的「……是……」
          var i2 = sent.lastIndexOf(TRIGGER_SHI);
          left = sent.slice(0, i2).trim();
          trig = TRIGGER_SHI;
          right = sent.slice(i2 + 1).trim().replace(/[。.]$/, '');
        } else {
          // ④ 兜底：冒号后面挖空（跳过 12:30 这种时间里的半角冒号）
          var ci = -1;
          if (sent.indexOf('：') >= 0) ci = sent.indexOf('：');
          else if (/[^0-9]:[^0-9]/.test(sent)) ci = sent.indexOf(':');
          if (ci >= 2) {
            left = sent.slice(0, ci).trim();
            trig = sent.charAt(ci);
            right = sent.slice(ci + 1).trim().replace(/[。.]$/, '');
          } else {
            // ⑤ 再兜底：没有「是」也没有冒号，就找谓语起点，整句改成填空
            var vi = findPredicate(sent);
            if (vi >= 2) {
              var m5 = moveLead(sent.slice(0, vi).trim(), sent.slice(vi).trim().replace(/[。.]$/, ''));
              left = m5.left; right = m5.right;
              forcedFill = true;
            } else {
              // ⑥ 连谓语都扫不到：从最后一个标点后切开，仍然是填空题
              var fb = fallbackSplit(sent);
              if (fb) { left = fb.left; right = fb.right; forcedFill = true; }
            }
          }
        }
      }

      if (!right) return;
      // 加粗指认的空，前面就算一个字没有也能出题；普通句子前面的引子太短没意义
      // 上限从 30 放宽到 56：长句（「…的效应，包括个体间和个体内变异」）以前整句被丢，
      // 其实出成填空题很好用，只要题干长一点而已
      if (left.length < (boldOK ? 0 : 2) || left.length > 56) return;
      if (right.length < 1 || right.length > 60) return;
      if (/^[的了和或与及是]$/.test(right)) return;
      var k = left + '|' + right;
      if (seen[k]) return;
      seen[k] = 1;

      var type = 'single', items = null;
      var raw = right.split(/[、，,]/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
      var listOK = raw.length >= 2 && raw.length <= 6 && raw.every(function (s) { return s.length <= 26; });
      if (forcedFill) {
        // ⑤ 兜底出来的，一律当填空题考：整句太长，硬凑选项反而难看
        type = 'fill';
      } else if (boldOK && listOK) {
        // 加粗里写的是并列内容（**安全、有效、经济、适当**）→ 直接当多选题考
        type = 'multi'; items = raw;
      } else if (listOK && (['包括', '分为', '主要有', '：', ':'].indexOf(trig) >= 0 || (trig === '是' && raw.length >= 3))) {
        type = 'multi'; items = raw;
      }
      // order 记录这个知识点在笔记原文里出现的先后，用来「跟着笔记顺序出题」
      pts.push({
        left: left, t: trig, right: right, tail: tail,
        type: type, items: items, sent: sent, order: pts.length
      });
    });
    return pts;
  }

  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }

  function pickDistractors(corrects, pool, n) {
    var used = corrects.map(normalize);
    var cand = shuffle(uniq(pool)).filter(function (x) {
      if (!x || x.length > 40) return false;
      var nx = normalize(x);
      if (used.indexOf(nx) >= 0) return false;
      for (var i = 0; i < used.length; i++) { if (dice(nx, used[i]) > 0.55) return false; }
      return true;
    });
    var out = [];
    for (var i = 0; i < cand.length && out.length < n; i++) {
      var nx = normalize(cand[i]);
      var dup = out.some(function (o) { return dice(normalize(o), nx) > 0.55; });
      if (!dup) { out.push(cand[i]); used.push(nx); }
    }
    return out;
  }

  function multiPool(p, pts) {
    var pool = [];
    pts.forEach(function (o) {
      if (o === p) return;
      if (o.type === 'multi') o.items.forEach(function (x) { pool.push(x); });
      else pool.push(o.right);
    });
    return pool;
  }

  function buildQuestions(pts) {
    var answerPool = [];
    pts.forEach(function (p) {
      if (p.type === 'multi') p.items.forEach(function (x) { answerPool.push(x); });
      else answerPool.push(p.right);
    });
    return pts.map(function (p) {
      var stem = cleanMark(p.left + p.t + '____' + (p.tail || ''));
      if (p.type === 'multi') {
        return {
          id: qidOf(p.left + '|' + p.right),
          type: 'multi',
          stem: stem,
          answer: p.items.map(cleanMark),
          opts: pickDistractors(p.items, multiPool(p, pts), 2).map(cleanMark),
          source: cleanMark(p.sent),
          order: p.order
        };
      }
      var opts = pickDistractors([p.right], answerPool, 3).map(cleanMark);
      // 干扰项凑不够就不硬编选项，直接当填空题考；⑤ 兜底出来的也保持填空
      return {
        id: qidOf(p.left + '|' + p.right),
        type: (p.type === 'fill' || opts.length < 2) ? 'fill' : 'single',
        stem: stem,
        answer: cleanMark(p.right),
        opts: opts,
        source: cleanMark(p.sent),
        order: p.order
      };
    });
  }

  /* =========================================================
     已成型的题库：按原样还原单选 / 多选
     ---------------------------------------------------------
     不管是老师发的卷子还是从哪个笔记软件导出的，很多资料本来就是
     排好的题库：
         题干（ ）B
         A.选项  B.选项  C.选项  D.选项
     这种内容再"提炼"会把原题打散，所以先按原样解析出来；
     散文部分仍交给 extractPoints，两部分按原文顺序拼接。
     ========================================================= */
  var BANK_BLANK = /[（(][\s\u3000]*[）)]/;
  var BANK_SECTION = /(单选题|多选题|名词解释|简答题|填空题|判断题)/g;

  /* 找出每一题的锚点：答案字母紧贴选项组首「A.」
     答案后面可能带句号（"…基本要素 C."），要允许 */
  function bankAnchors(src) {
    // 答案后面常常跟着年份（「（ ）ABCDE 2025」），以前要求答案紧邻「A.」，
    // 遇到年份就整题漏掉，选项行跟着漏进散文被切得乱七八糟
    var out = [], re = /([A-E]{1,5})[.。]?[\s\u3000]*(?:20\d{2})?[\s\u3000]*(?=A\s*[.、．])/g, m;
    while ((m = re.exec(src))) {
      var after = m.index + m[1].length;
      var gm = /A\s*[.、．]/.exec(src.slice(after, after + 16));
      if (!gm) continue;
      out.push({ ans: m[1], ansStart: m.index, optStart: after + gm.index });
    }
    return out;
  }

  /* 题干起点：优先认「1.」「2.」这样的题号，否则退回上一个空行 */
  function bankStemStart(src, blankPos, floor) {
    var para = src.lastIndexOf('\n\n', blankPos);
    if (para < floor) para = floor - 2;
    if (para < -2) para = -2;
    var seg = src.slice(para + 2, blankPos);
    var num = null, re = /\d{1,2}\s*[.、]\s*(?=[\u4e00-\u9fa5“（(])/g, m;
    while ((m = re.exec(seg))) num = m;
    if (num) return para + 2 + num.index;
    return para + 2;
  }

  /* 把 "A.xx B.yy" 拆成选项；字母重复（题库手滑）时按位置重新编号 */
  function bankOptions(s) {
    var marks = [], re = /([A-E])\s*[.、．]\s*/g, m;
    while ((m = re.exec(s))) marks.push({ letter: m[1], at: m.index, end: re.lastIndex });
    var out = [];
    for (var i = 0; i < marks.length; i++) {
      var to = i + 1 < marks.length ? marks[i + 1].at : s.length;
      out.push({
        letter: marks[i].letter,
        // 末尾的「；」「。」是原笔记的分隔符，跟着进答案很脏
        text: s.slice(marks[i].end, to).replace(/\s+/g, ' ').trim().replace(/[；;。]+$/, '')
      });
    }
    return out;
  }

  function parseBankQuestions(text) {
    var src = String(text).replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    var anchors = bankAnchors(src);
    var units = [], floor = 0;

    anchors.forEach(function (a) {
      var pre = src.slice(floor, a.ansStart);
      var blankPos = -1, bm, bre = /[（(][\s\u3000]*[）)]/g;
      while ((bm = bre.exec(pre))) blankPos = floor + bm.index;
      if (blankPos < 0) return;                    // 前面没有空括号，不是题目
      if (a.ansStart - blankPos > 300) return;     // 离得太远，多半是误判
      var stemStart = bankStemStart(src, blankPos, floor);
      units.push({ ans: a.ans, ansStart: a.ansStart, optStart: a.optStart, stemStart: stemStart });
      floor = a.optStart;
    });

    // 每题的选项区间：到下一题题干之前，或到本节标题为止
    function sectionEndAfter(pos) {
      var end = src.length, re = new RegExp(BANK_SECTION.source, 'g'), m;
      while ((m = re.exec(src))) {
        if (m.index > pos) { end = m.index; break; }
      }
      return end;
    }

    var qs = [], spans = [];
    units.forEach(function (u, i) {
      var optEnd = sectionEndAfter(u.optStart);
      if (i + 1 < units.length) optEnd = Math.min(optEnd, units[i + 1].stemStart);
      var raw = src.slice(u.optStart, optEnd);
      if (i === units.length - 1) raw = raw.replace(/(单选题|多选题|名词解释|简答题|填空题)[^\n]*$/, '');
      var opts = bankOptions(raw);
      // 末项常把下一节标题吞进来，清掉
      if (opts.length) {
        opts[opts.length - 1].text = opts[opts.length - 1].text
          .replace(/(单选题|多选题|名词解释|简答题|填空题)[^\n]*$/, '').trim();
      }
      if (opts.length < 2 || opts.length > 8) return;
      if (opts[0].letter !== 'A') return;
      if (opts.some(function (o) { return !o.text || o.text.length > 220; })) return;

      var map = {};
      opts.forEach(function (o, idx) { if (!map[o.letter]) map[o.letter] = opts[idx]; });
      var letters = u.ans.split('');
      if (letters.some(function (l) { return !map[l]; })) return;

      var stem = src.slice(u.stemStart, u.ansStart).trim()
        .replace(/^\d{1,2}\s*[.、]\s*/, '')
        .replace(/[。.．]\s*$/, '');
      if (!BANK_BLANK.test(stem) || stem.length < 4) return;

      var isMulti = letters.length > 1;
      var right = letters.map(function (l) { return map[l].text; });
      // 加粗标记是笔记里的记法，不该出现在题面里（顺带清掉误带的占位符）
      stem = cleanMark(stem);
      var right = letters.map(function (l) { return cleanMark(map[l].text); });
      qs.push({
        id: qidOf(stem + '|' + right.join('')),
        type: isMulti ? 'multi' : 'single',
        // 顺手吃掉空括号前面那个空格（「包括 （ ）」→「包括____」）
        stem: stem.replace(/\s*[（(][\s\u3000]*[）)]/, '____'),
        answer: isMulti ? right : right[0],
        // 先抹掉标记再比对，否则带 ** 的正确项会被当成干扰项混进去
        opts: opts.map(function (o) { return cleanMark(o.text); })
          .filter(function (t) { return right.indexOf(t) < 0; }),
        source: stem,
        order: qs.length
      });
      spans.push([u.stemStart, optEnd]);
    });

    // 剩下的散文（名词解释等）交给提炼
    var rest = src;
    spans.slice().reverse().forEach(function (s) {
      rest = rest.slice(0, s[0]) + '\n\n' + rest.slice(s[1]);
    });
    // 简答题是提纲（"①xxx ②yyy"），硬出题只会出一堆残句，整段跳过
    rest = dropOutlineSections(rest);

    return { questions: qs, rest: rest };
  }

  /* 按小节切分：简答/案例分析丢给背诵，不进提炼；其余（名词解释等）保留正文 */
  var BANK_SECTION_HEAD = /(名词解释|简答题?|单选题|多选题|填空题|判断题|案例分析题|[A-D]\s*卷)/g;

  function dropOutlineSections(text) {
    var marks = [], m, re = new RegExp(BANK_SECTION_HEAD.source, 'g');
    while ((m = re.exec(text))) marks.push({ at: m.index, name: m[1].replace(/\s/g, '') });
    if (!marks.length) return text;

    var out = text.slice(0, marks[0].at);
    for (var i = 0; i < marks.length; i++) {
      var end = i + 1 < marks.length ? marks[i + 1].at : text.length;
      var name = marks[i].name;
      if (/简答|案例分析/.test(name)) continue;          // 提纲不提炼
      var seg = text.slice(marks[i].at, end);
      seg = seg.replace(/^[^\n]*\n?/, '');               // 去掉标题那一行
      out += seg;
    }
    return out;
  }

  /* 提炼入口：题库部分直接还原，散文部分照旧提炼 */
  function buildFromNote(text) {
    var parsed = parseBankQuestions(text);
    var qs = parsed.questions.slice();
    var rest = parsed.rest;
    if (rest.trim()) {
      var pts = extractPoints(rest);
      var extra = buildQuestions(pts);
      extra.forEach(function (q, i) { q.order = qs.length + i; });
      qs = qs.concat(extra);
    }
    return qs;
  }

  /* ---------------- 状态 ---------------- */
  var S = {
    banks: [],
    stats: {},
    log: [],
    cur: null,
    preview: [],
    view: 'import',
    quiz: null,
    recite: null,
    noteRaw: null
  };

  function save() {
    try {
      localStorage.setItem(LS_BANKS, JSON.stringify(S.banks));
      localStorage.setItem(LS_STATS, JSON.stringify(S.stats));
      localStorage.setItem(LS_LOG, JSON.stringify(S.log));
      localStorage.setItem(LS_CUR, S.cur || '');
    } catch (e) {
      toast('本地存储写入失败，可能是空间已满');
    }
    schedulePush(); // 已登录就顺带把改动推到云端（未登录 / 离线时自动跳过）
  }
  function load() {
    try {
      S.banks = JSON.parse(localStorage.getItem(LS_BANKS) || '[]') || [];
      S.stats = JSON.parse(localStorage.getItem(LS_STATS) || '{}') || {};
      S.log = JSON.parse(localStorage.getItem(LS_LOG) || '[]') || [];
      S.cur = localStorage.getItem(LS_CUR) || '';
      var th = localStorage.getItem(LS_THEME);
      if (th) document.documentElement.setAttribute('data-theme', th);
    } catch (e) { S.banks = []; S.stats = {}; S.log = []; }
    if (S.banks.length && !S.banks.some(function (b) { return b.id === S.cur; })) S.cur = S.banks[0].id;
  }

  function getBank() { return S.banks.filter(function (b) { return b.id === S.cur; })[0] || null; }
  function getQs() { var b = getBank(); return b ? b.questions : []; }
  function getQ(id) { return getQs().filter(function (q) { return q.id === id; })[0] || null; }

  /* ---------------- 统计 ---------------- */
  function getStat(qid) {
    return S.stats[qid] || { ok: 0, bad: 0, streak: 0, mastery: 0, mastered: false, lastAt: 0 };
  }
  function calcMastery(st) {
    var tot = st.ok + st.bad;
    var acc = tot ? st.ok / tot : 0;
    return Math.min(1, acc * 0.6 + Math.min(st.streak, 3) / 3 * 0.4);
  }
  function recordAnswer(qid, level) {
    var st = getStat(qid);
    if (level === 'right') { st.ok++; st.streak++; }
    else if (level === 'mid') { st.ok++; }
    else { st.bad++; st.streak = 0; }
    st.lastAt = Date.now();
    st.mastery = calcMastery(st);
    st.mastered = st.mastery >= 0.9 && st.streak >= 3;
    S.stats[qid] = st;
    var d = today();
    var row = S.log.filter(function (x) { return x.d === d; })[0];
    if (!row) { row = { d: d, n: 0 }; S.log.push(row); }
    row.n++;
    if (S.log.length > 60) S.log = S.log.slice(-60);
    save();
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(name) {
    S.view = name;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    // 光加 .active 不够：styles.css 里有 [hidden]{display:none !important} 兜底，
    // 属性不摘掉的话整页永远是导入页，其他几个视图看着就是一片空白。
    $$('.view').forEach(function (v) {
      var on = v.id === 'view-' + name;
      v.classList.toggle('active', on);
      v.hidden = !on;
    });
    if (name === 'wrong') renderWrong();
    if (name === 'stats') { renderStats(); loadAdmin(); }
    if (name === 'plaza') { renderPlazaList(); loadPlaza(); }
    if (name === 'quiz' && !S.quiz) renderQuizEmpty();
    if (name === 'recite' && !S.recite) renderReciteEmpty();
  }

  function stemHtml(stem) {
    var s = esc(stem);
    if (s.indexOf('____') < 0) s += '<span class="blank-mark">____</span>';
    else s = s.replace(/____/g, '<span class="blank-mark">________</span>');
    return s;
  }
  function answerText(q) { return Array.isArray(q.answer) ? q.answer.join('、') : q.answer; }

  /* =========================================================
     题集选择下拉
     ========================================================= */
  function renderBankSelect() {
    var sel = $('#bankSelect');
    sel.innerHTML = '';
    if (!S.banks.length) {
      var o0 = document.createElement('option');
      o0.textContent = '暂无题集';
      sel.appendChild(o0);
    }
    S.banks.forEach(function (b) {
      var o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.course + '（' + b.questions.length + '题）';
      if (b.id === S.cur) o.selected = true;
      sel.appendChild(o);
    });
    var on = document.createElement('option');
    on.value = '__new';
    on.textContent = '＋ 新建题集';
    sel.appendChild(on);
    if (S.banks.length && S.cur) sel.value = S.cur;
    renderBankList();
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function switchBank(id) {
    S.cur = id;
    save();
    S.quiz = null;
    S.recite = null;
    renderBankSelect();
    if (S.view === 'quiz') renderQuizEmpty();
    if (S.view === 'recite') renderReciteEmpty();
    if (S.view === 'wrong') renderWrong();
    if (S.view === 'stats') renderStats();
  }

  // 我的题集列表：左键切换，右键（或点 ⋯）重命名 / 导出 / 删除
  function renderBankList() {
    var el = $('#bankList');
    if (!el) return;
    if (!S.banks.length) {
      el.innerHTML = '<div class="muted">还没有题集 —— 在上面贴一段笔记，提炼后点「保存到题集」就会出现在这里。</div>';
      return;
    }
    el.innerHTML = S.banks.map(function (b) {
      var cur = b.id === S.cur;
      var done = b.questions.filter(function (q) {
        var s = S.stats[q.id];
        return s && s.mastered;
      }).length;
      return '<div class="item bank-item' + (cur ? ' cur' : '') + '" data-id="' + b.id + '">' +
        '<div class="item-main">' +
        '<div class="item-stem">' + esc(b.course) + (cur ? ' <span class="pill ok">当前</span>' : '') + '</div>' +
        '<div class="item-sub">' + b.questions.length + ' 题 · 已掌握 ' + done + ' · 建于 ' + fmtDate(b.createdAt) + '</div>' +
        '</div>' +
        '<button class="btn ghost bank-more" data-id="' + b.id + '" title="更多操作">⋯</button>' +
        '</div>';
    }).join('');
  }

  var ctxId = null;
  function closeCtx() {
    var m = $('#ctxMenu');
    if (m) m.hidden = true;
    ctxId = null;
  }
  function openCtx(id, ev) {
    ctxId = id;
    var m = $('#ctxMenu');
    m.hidden = false;
    var w = m.offsetWidth || 170, h = m.offsetHeight || 195;
    var x = ev.clientX || 0, y = ev.clientY || 0;
    if (x + w > window.innerWidth - 8) x = Math.max(8, window.innerWidth - w - 8);
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }

  $('#bankList').addEventListener('click', function (e) {
    var more = e.target.closest('.bank-more');
    if (more) {
      e.stopPropagation();
      var r = more.getBoundingClientRect();
      openCtx(more.dataset.id, { clientX: r.left, clientY: r.bottom + 4 });
      return;
    }
    var item = e.target.closest('.bank-item');
    if (item) switchBank(item.dataset.id);
  });

  $('#bankList').addEventListener('contextmenu', function (e) {
    var item = e.target.closest('.bank-item');
    if (!item) return;
    e.preventDefault();
    openCtx(item.dataset.id, e);
  });

  $('#ctxMenu').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || !ctxId) return;
    var id = ctxId, act = btn.dataset.act;
    var bank = S.banks.filter(function (x) { return x.id === id; })[0];
    closeCtx();
    if (!bank) return;
    if (act === 'use') {
      switchBank(bank.id);
      toast('当前题集：' + bank.course);
    } else if (act === 'rename') {
      var n = (prompt('题集名称', bank.course) || '').trim();
      if (n && n !== bank.course) { bank.course = n; save(); renderBankSelect(); toast('已重命名'); }
    } else if (act === 'export') {
      exportBankJson(bank);
    } else if (act === 'share') {
      openShare(bank.id);
    } else if (act === 'md') {
      exportBankMd(bank);
    } else if (act === 'del') {
      if (!confirm('删除题集「' + bank.course + '」及其 ' + bank.questions.length + ' 道题？删掉就找不回来了。')) return;
      S.banks = S.banks.filter(function (x) { return x.id !== bank.id; });
      if (S.cur === bank.id) S.cur = S.banks.length ? S.banks[0].id : '';
      S.quiz = null;
      S.recite = null;
      save();
      renderBankSelect();
      if (S.view === 'stats') renderStats();
      if (S.view === 'wrong') renderWrong();
      toast('已删除：' + bank.course);
    }
  });

  $('#bankSelect').addEventListener('change', function () {
    if (this.value === '__new') {
      var name = (prompt('新题集 / 课程名称', '') || '').trim();
      if (!name) { renderBankSelect(); return; }
      var b = { id: 'b_' + Date.now().toString(36), course: name, questions: [], createdAt: Date.now() };
      S.banks.push(b);
      S.cur = b.id;
      save(); renderBankSelect();
      toast('已新建题集：' + name);
    } else {
      switchBank(this.value);
    }
  });

  document.addEventListener('click', function (e) {
    var m = $('#ctxMenu');
    if (m && !m.hidden && !(e.target.closest && e.target.closest('#ctxMenu'))) closeCtx();
  });
  document.addEventListener('contextmenu', function (e) {
    if (!(e.target.closest && e.target.closest('#bankList'))) closeCtx();
  });
  window.addEventListener('scroll', closeCtx, true);

  /* =========================================================
     ① 导入笔记
     ========================================================= */
  var SAMPLE_NOTE = [
    '林则徐是开眼看世界的第一人。',
    '魏源编写的《海国图志》提出了“师夷长技以制夷”的主张。',
    '太平天国运动爆发的标志是1851年金田起义。',
    '洋务运动的指导思想是中学为体、西学为用。',
    '甲午中日战争后清政府签订的条约是《马关条约》。',
    '戊戌变法的性质是一场资产阶级性质的改良运动。',
    '辛亥革命的首义是武昌起义。',
    '新文化运动兴起的标志是1915年陈独秀创办《青年杂志》。',
    '五四运动爆发的导火线是巴黎和会上中国外交的失败。',
    '五四运动标志着中国新民主主义革命的开端。',
    '中国共产党成立的时间是1921年7月。',
    '国民大革命失败的标志是四一二反革命政变。',
    '南昌起义的意义是打响了武装反抗国民党反动派的第一枪。',
    '遵义会议的意义是党的历史上一个生死攸关的转折点。',
    '抗日战争胜利的时间是1945年8月15日。',
    '三大战役包括辽沈战役、淮海战役、平津战役。',
    '新民主主义革命的三大法宝包括统一战线、武装斗争、党的建设。',
    '毛泽东思想活的灵魂包括实事求是、群众路线、独立自主。'
  ].join('\n');

  $('#loadSampleBtn').addEventListener('click', function () {
    S.noteRaw = null;
    $('#fileChip').hidden = true;
    $('#noteText').value = SAMPLE_NOTE;
    if (!$('#courseName').value.trim()) $('#courseName').value = '中国近代史';
    updateNoteStat();
    toast('示例笔记已载入，点「一键提炼知识点」试试');
  });

  $('#pickFileBtn').addEventListener('click', function () { $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', function () {
    var f = this.files[0];
    if (f) readNoteFile(f);
    this.value = '';
  });

  /* ---------- 各种格式的文件解析 ---------- */
  function readAsText(f) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result || '')); };
      fr.onerror = function () { rej(new Error('文件读取失败')); };
      fr.readAsText(f, 'utf-8');
    });
  }
  function readAsBuf(f) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('文件读取失败')); };
      fr.readAsArrayBuffer(f);
    });
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('脚本加载失败')); };
      document.head.appendChild(s);
    });
  }
  function loadAny(list) {
    function go(i) {
      if (i >= list.length) return Promise.reject(new Error('网络不给力，加载解析引擎失败'));
      return loadScript(list[i]).catch(function () { return go(i + 1); });
    }
    return go(0);
  }

  // 极简 zip 读取（docx 本质就是 zip）
  function zipEntries(buf) {
    var dv = new DataView(buf);
    var eocd = -1;
    for (var i = buf.byteLength - 22; i >= 0 && i >= buf.byteLength - 22 - 65535; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('文件结构不对，可能不是 Word 文档');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    var out = {};
    for (var n = 0; n < count; n++) {
      if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(new Uint8Array(buf, p + 46, nameLen));
      var lName = 0, lExtra = 0;
      if (lho + 30 <= buf.byteLength) {
        lName = dv.getUint16(lho + 26, true);
        lExtra = dv.getUint16(lho + 28, true);
      }
      var off = lho + 30 + lName + lExtra;
      if (compSize > 0 && off + compSize <= buf.byteLength) {
        out[name] = { method: method, data: new Uint8Array(buf, off, compSize) };
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function inflateRaw(u8, method) {
    if (method === 0) return Promise.resolve(new TextDecoder('utf-8').decode(u8));
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('浏览器不支持解压'));
    var stream;
    try {
      stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch (e) {
      return Promise.reject(new Error('浏览器不支持解压'));
    }
    return new Response(stream).text();
  }

  function xmlUnescape(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function docxLocal(buf) {
    var e = zipEntries(buf)['word/document.xml'];
    if (!e) return Promise.reject(new Error('Word 文件里没有正文'));
    return inflateRaw(e.data, e.method).then(function (xml) {
      var lines = [];
      xml.split(/<w:p(?:\s[^>]*)?>/).forEach(function (seg) {
        var end = seg.indexOf('</w:p>');
        var body = end >= 0 ? seg.slice(0, end) : seg;
        var texts = body.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
        var s = texts.map(function (t) {
          return xmlUnescape(t.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''));
        }).join('');
        if (s.trim()) lines.push(s);
      });
      var text = lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
      if (!text.trim()) throw new Error('Word 文件里没有文字');
      return text;
    });
  }

  // 浏览器不支持本地解压时的兜底
  function docxViaLib(buf) {
    var urls = [
      'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js',
      'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
    ];
    return loadAny(urls).then(function () {
      if (!window.mammoth) throw new Error('Word 解析引擎没加载上');
      return window.mammoth.extractRawText({ arrayBuffer: buf });
    }).then(function (r) { return r.value; });
  }

  function docxToText(buf) {
    if (typeof DecompressionStream === 'function') {
      return docxLocal(buf).catch(function () { return docxViaLib(buf); });
    }
    return docxViaLib(buf);
  }

  function itemsToLines(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str) return;
      var y = it.transform[5], x = it.transform[4];
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].y - y) < 3) { row = rows[i]; break; }
      }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      return r.parts.map(function (p) { return p.s; }).join('');
    }).join('\n');
  }

  var PDF_BASES = [
    'https://unpkg.com/pdfjs-dist@4.0.379/',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/'
  ];

  function loadPdfJs() {
    var base = PDF_BASES[0];
    // 优先官方 ESM 版，加载不到再退回 UMD 版，最后换备用 CDN
    return import(base + 'build/pdf.min.mjs').then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = base + 'build/pdf.worker.min.mjs';
      return { lib: lib, cMapUrl: base + 'cmaps/' };
    }).catch(function () {
      return loadScript(base + 'legacy/build/pdf.min.js').then(function () {
        if (!window.pdfjsLib) throw new Error('PDF 引擎没加载上');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'legacy/build/pdf.worker.min.js';
        return { lib: window.pdfjsLib, cMapUrl: base + 'cmaps/' };
      });
    }).catch(function () {
      var b2 = PDF_BASES[1];
      return loadScript(b2 + 'legacy/build/pdf.min.js').then(function () {
        if (!window.pdfjsLib) throw new Error('PDF 引擎没加载上');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = b2 + 'legacy/build/pdf.worker.min.js';
        return { lib: window.pdfjsLib, cMapUrl: b2 + 'cmaps/' };
      });
    });
  }

  function pdfToText(buf) {
    return loadPdfJs().then(function (eng) {
      return eng.lib.getDocument({
        data: new Uint8Array(buf),
        cMapUrl: eng.cMapUrl,
        cMapPacked: true
      }).promise;
    }).then(function (pdf) {
      var pages = [], i = 1;
      function next() {
        if (i > pdf.numPages) return Promise.resolve(pages.join('\n'));
        var n = i++;
        return pdf.getPage(n).then(function (page) {
          return page.getTextContent();
        }).then(function (tc) {
          pages.push(itemsToLines(tc.items));
          return next();
        });
      }
      return next();
    }).then(function (t) { return t.replace(/\n{3,}/g, '\n\n'); });
  }

  function readNoteFile(f) {
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    var finish = function (text) {
      if (!$('#courseName').value.trim()) $('#courseName').value = f.name.replace(/\.[^.]+$/, '');
      showFileChip(f.name, text);   // 原文进内存，不摊在页面上
    };
    var afterExtract = function () {
      var n = doExtract(true) ? S.preview.length : 0;
      if (n) toast('已读取 ' + f.name + '，提炼出 ' + n + ' 道题');
      else toast('已读取 ' + f.name + '，但没提炼出判断句 —— 点「查看 / 编辑原文」看看内容对不对');
    };

    if (ext === 'docx') {
      toast('正在解析 Word 文档…');
      return readAsBuf(f).then(docxToText).then(function (t) {
        finish(t);
        afterExtract();
      }).catch(function (e) {
        toast('Word 解析失败：' + e.message + '，也可以直接复制正文粘贴');
      });
    }
    if (ext === 'pdf') {
      toast('正在解析 PDF，页数多时要等一会儿…');
      return readAsBuf(f).then(pdfToText).then(function (t) {
        if (!t.replace(/\s/g, '')) {
          toast('这个 PDF 没有文字层，是扫描件 —— 复制正文粘贴进来吧');
          return;
        }
        finish(t);
        afterExtract();
      }).catch(function (e) {
        toast('PDF 解析失败：' + e.message + '，也可以直接复制正文粘贴');
      });
    }
    if (ext === 'doc') {
      toast('老版 .doc 在网页里解析不了 —— 用 Word 打开另存为 .docx 再来，或直接复制正文');
      return;
    }
    if (['txt', 'md', 'markdown', 'text', 'csv'].indexOf(ext) < 0) {
      toast('暂不支持 .' + ext + ' 文件，可以复制正文粘贴进来');
      return;
    }
    readAsText(f).then(function (t) {
      finish(t);
      afterExtract();
    }).catch(function (e) { toast(e.message); });
  }

  var dz = $('#dropZone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.style.outline = '2px dashed var(--brand)'; });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.style.outline = ''; });
  });
  dz.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) readNoteFile(f);
  });

  // 文件读进来的原文放在内存里，不铺到页面上（Word/PDF 的结构没必要摊开，也容易乱）
  function activeText() {
    var v = $('#noteText').value;
    return v.trim() ? v : (S.noteRaw || '');
  }

  function updateNoteStat() {
    var t = activeText();
    $('#noteStat').textContent = t.trim() ? ('共 ' + t.replace(/\s/g, '').length + ' 字，' + splitSentences(t).length + ' 句') : '';
  }
  $('#noteText').addEventListener('input', updateNoteStat);

  function showFileChip(name, text) {
    S.noteRaw = text;
    $('#chipName').textContent = name;
    $('#chipMeta').textContent = text.replace(/\s/g, '').length + ' 字 · ' + splitSentences(text).length + ' 句 · 表格会按行展开成文字';
    $('#fileChip').hidden = false;
    updateNoteStat();
  }

  $('#chipView').addEventListener('click', function () {
    $('#noteText').value = S.noteRaw || '';
    S.noteRaw = null;
    $('#fileChip').hidden = true;
    updateNoteStat();
    $('#noteText').focus();
    toast('原文已展开，可以直接改');
  });
  $('#chipClear').addEventListener('click', function () {
    S.noteRaw = null;
    $('#noteText').value = '';
    $('#fileChip').hidden = true;
    updateNoteStat();
    toast('已移除文件');
  });

  function doExtract(silent) {
    var text = activeText();
    if (!text.trim()) { toast('先把笔记粘进来，或选一个笔记文件'); return false; }
    var qs = buildFromNote(text);
    if (!qs.length) {
      toast('没提炼出判断句，试试用「……是……」「……的标志是……」这样的句式写笔记');
      return false;
    }
    S.preview = qs;
    renderPreview();
    $('#previewCard').hidden = false;
    if (!silent) {
      $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      var banked = qs.filter(function (q) { return q.type !== 'fill'; }).length;
      toast('共 ' + qs.length + ' 道题' + (banked ? '（其中 ' + banked + ' 道是原题库还原）' : ''));
    }
    return true;
  }

  $('#extractBtn').addEventListener('click', function () { doExtract(false); });

  function renderPreview() {
    var tb = $('#previewBody');
    tb.innerHTML = '';
    S.preview.forEach(function (q, i) {
      var tr = document.createElement('tr');
      tr.dataset.i = i;
      tr.innerHTML =
        '<td class="c-chk"><input type="checkbox" class="p-chk" checked></td>' +
        '<td class="c-type"><span class="tag' + (q.type === 'multi' ? ' multi' : '') + '">' +
        (q.type === 'multi' ? '多选' : q.type === 'fill' ? '填空' : '选择') + '</span></td>' +
        '<td><input class="cell-input p-stem" value="' + esc(q.stem) + '"></td>' +
        '<td class="c-ans"><input class="cell-input p-ans" value="' + esc(answerText(q)) + '"></td>' +
        '<td class="c-op">' +
        '<button class="mini-btn p-up" title="上移">↑</button>' +
        '<button class="mini-btn p-down" title="下移">↓</button>' +
        '<button class="mini-btn p-del" title="删除">✕</button>' +
        '</td>';
      tb.appendChild(tr);
    });
    updatePreviewCount();
  }

  function updatePreviewCount() {
    var n = $$('.p-chk:checked').length;
    $('#previewCount').textContent = '共 ' + S.preview.length + ' 道，已选 ' + n + ' 道';
  }

  $('#previewBody').addEventListener('change', function (e) {
    if (e.target.classList.contains('p-chk')) updatePreviewCount();
  });
  // 把表格里改过的内容写回内存（每行顺序就是出题顺序）
  function syncPreview() {
    $$('#previewBody tr').forEach(function (tr) {
      var i = +tr.dataset.i;
      var q = S.preview[i];
      if (!q) return;
      q.stem = $('.p-stem', tr).value.trim() || q.stem;
      var av = $('.p-ans', tr).value.trim();
      q.answer = q.type === 'multi'
        ? av.split(/[、，,]/).map(function (s) { return s.trim(); }).filter(Boolean)
        : (av || q.answer);
    });
  }

  $('#previewBody').addEventListener('click', function (e) {
    var btn = e.target.closest('.mini-btn');
    if (!btn) return;
    var i = +btn.closest('tr').dataset.i;
    if (btn.classList.contains('p-del')) {
      S.preview.splice(i, 1);
      renderPreview();
      return;
    }
    syncPreview();
    var j = btn.classList.contains('p-up') ? i - 1 : i + 1;
    if (j < 0 || j >= S.preview.length) return;
    var tmp = S.preview[i];
    S.preview[i] = S.preview[j];
    S.preview[j] = tmp;
    renderPreview();
  });
  $('#chkAll').addEventListener('change', function () {
    $$('.p-chk').forEach(function (c) { c.checked = $('#chkAll').checked; });
    updatePreviewCount();
  });
  $('#delSelectedBtn').addEventListener('click', function () {
    syncPreview();
    var keep = [];
    $$('#previewBody tr').forEach(function (tr) {
      if (!$('.p-chk', tr).checked) {
        var q = S.preview[+tr.dataset.i];
        if (q) keep.push(q);
      }
    });
    S.preview = keep;
    renderPreview();
  });

  $('#saveBankBtn').addEventListener('click', function () {
    if (!S.preview.length) { toast('没有可保存的题目'); return; }
    syncPreview();
    var list = [];
    $$('#previewBody tr').forEach(function (tr) {
      if (!$('.p-chk', tr).checked) return;
      var q = S.preview[+tr.dataset.i];
      if (!q || !q.stem) return;
      var ans = Array.isArray(q.answer) ? q.answer.filter(Boolean) : q.answer;
      if (!ans || (Array.isArray(ans) && !ans.length)) return;
      list.push({ id: q.id, type: q.type, stem: q.stem, answer: ans, opts: q.opts || [], source: q.source || '' });
    });
    if (!list.length) { toast('请先勾选要保存的题目'); return; }

    // 按课程名归题集：同名就往里追加，换了一门课就另起一个，不串味
    var courseName = $('#courseName').value.trim() || '我的题集';
    var bank = S.banks.filter(function (b) { return b.course === courseName; })[0];
    if (!bank) {
      bank = { id: 'b_' + Date.now().toString(36), course: courseName, questions: [], createdAt: Date.now() };
      S.banks.push(bank);
    }
    S.cur = bank.id;
    var exist = {};
    var maxOrder = -1;
    bank.questions.forEach(function (q) {
      exist[q.id] = 1;
      if (q.order != null && q.order > maxOrder) maxOrder = q.order;
    });
    var add = 0;
    list.forEach(function (q, i) {
      if (exist[q.id]) return;
      q.order = maxOrder + 1 + i;   // 新题接在旧题后面，still 按笔记顺序
      bank.questions.push(q);
      add++;
    });
    bank.questions.sort(byOrder);
    save();
    renderBankSelect();
    toast('已保存 ' + add + ' 道新题到「' + bank.course + '」，现有 ' + bank.questions.length + ' 道');
  });

  /* 导出 / 导入题集 */
  function exportBankJson(b) {
    download(b.course + '.json', JSON.stringify({
      course: b.course,
      questions: b.questions.map(function (q, i) {
        return { type: q.type, stem: q.stem, answer: q.answer, opts: q.opts || [], source: q.source || '', order: q.order == null ? i : q.order };
      })
    }, null, 2));
  }

  $('#exportBtn').addEventListener('click', function () {
    var b = getBank();
    if (!b) { toast('还没有题集'); return; }
    exportBankJson(b);
  });

  // 导出成 Markdown：前半部分自测题，后半部分答案速查，方便粘进乐享 / 笔记软件
  function exportBankMd(b) {
    if (!b || !b.questions.length) { toast('题集里还没有题目'); return; }
    var qs = b.questions.slice().sort(byOrder);
    var L = ['# ' + b.course + ' · 期末刷题清单', '', '> 共 ' + qs.length + ' 题，按笔记原文顺序排列', ''];
    L.push('## 一、自测题（先盖住答案做一遍）', '');
    qs.forEach(function (q, i) {
      L.push((i + 1) + '. ' + q.stem + '　【' + (q.type === 'multi' ? '多选' : '填空') + '】');
    });
    L.push('', '## 二、答案速查', '');
    qs.forEach(function (q, i) {
      L.push((i + 1) + '. ' + answerText(q));
    });
    L.push('', '## 三、笔记原文', '');
    qs.forEach(function (q, i) {
      L.push((i + 1) + '. ' + (q.source || '—'));
    });
    download(b.course + '-刷题清单.md', L.join('\n'));
    toast('已导出 Markdown，可粘贴到乐享');
  }

  $('#exportMdBtn').addEventListener('click', function () {
    var b = getBank();
    if (!b) { toast('还没有题集'); return; }
    exportBankMd(b);
  });

  $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
  $('#importFile').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var data = JSON.parse(String(fr.result));
        if (data.banks) { // 全量数据
          S.banks = data.banks.map(function (b) {
            return { id: b.id, course: b.course, createdAt: b.createdAt, questions: (b.questions || []).map(normQ) };
          });
          S.stats = data.stats || {}; S.log = data.log || [];
          S.cur = S.banks.length ? S.banks[0].id : '';
          save(); renderBankSelect(); switchView('stats');
          toast('已导入全部数据');
          return;
        }
        var qs = (data.questions || []).map(function (q, i) { return normQ(q, i); });
        if (!qs.length) { toast('文件里没有题目'); return; }
        var bank = { id: 'b_' + Date.now().toString(36), course: data.course || f.name.replace(/\.json$/i, ''), questions: qs, createdAt: Date.now() };
        S.banks.push(bank); S.cur = bank.id;
        save(); renderBankSelect();
        toast('已导入题集：' + bank.course + '（' + qs.length + '题）');
      } catch (e) { toast('JSON 解析失败：' + e.message); }
    };
    fr.readAsText(f, 'utf-8');
  });

  function normQ(q, idx) {
    var answer = Array.isArray(q.answer) ? q.answer.slice() : String(q.answer || '');
    var seed = (q.stem || '') + '|' + (Array.isArray(answer) ? answer.join('') : answer);
    return {
      id: q.id || qidOf(seed),
      type: q.type === 'multi' ? 'multi' : (q.type === 'fill' ? 'fill' : 'single'),
      stem: String(q.stem || ''),
      answer: answer,
      opts: Array.isArray(q.opts) ? q.opts : [],
      source: q.source || '',
      order: q.order == null ? (idx || 0) : q.order
    };
  }

  function download(name, content) {
    var type = /\.md$/i.test(name) ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8';
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  /* =========================================================
     选题逻辑
     ========================================================= */
  function byOrder(a, b) {
    var oa = a.order == null ? 1e9 : a.order;
    var ob = b.order == null ? 1e9 : b.order;
    return oa - ob;
  }

  function pickQuestions(opt) {
    var qs = getQs().slice().sort(byOrder);
    if (opt.type && opt.type !== 'all') qs = qs.filter(function (q) { return q.type === opt.type; });
    if (opt.range === 'new') qs = qs.filter(function (q) { return !S.stats[q.id] || !(S.stats[q.id].ok + S.stats[q.id].bad); });
    else if (opt.range === 'wrong') qs = qs.filter(function (q) { var s = S.stats[q.id]; return s && s.bad > 0 && !s.mastered; });
    else if (opt.range === 'weak') qs = qs.filter(function (q) { var s = S.stats[q.id]; return !s || !s.mastered; });
    if (opt.shuffle) qs = shuffle(qs);
    if (opt.count > 0) qs = qs.slice(0, opt.count);
    return qs;
  }

  function masteryPct(q) { return Math.round(getStat(q.id).mastery * 100); }

  /* =========================================================
     ② 刷选择题
     ========================================================= */
  $('#quizStartBtn').addEventListener('click', function () {
    var list = pickQuestions({
      range: $('#qRange').value,
      type: $('#qType').value,
      count: +$('#qCount').value,
      shuffle: $('#qOrder').value === 'rand'
    });
    if (!list.length) { toast('这个范围里没有题，换个筛选条件'); return; }
    S.quiz = { list: list, idx: 0, results: [], timer: null, forms: decideForms(list, $('#qForm').value) };
    renderQuiz();
  });

  // 刷题时每道题怎么考：给选项，还是自己填
  function decideForms(list, mode) {
    return list.map(function (q) {
      if (mode === 'fill') return 'fill';
      if (mode === 'choice') return q.type === 'fill' ? 'fill' : 'choice';
      // 混合：已经练熟的改成填空考（更难），还生疏的先给选项
      if (q.type === 'fill') return 'fill';
      if (q.type === 'multi') return 'choice';
      var s = getStat(q.id);
      return (s.ok + s.bad) > 0 && s.mastery >= 0.6 ? 'fill' : 'choice';
    });
  }

  function renderQuizEmpty() {
    $('#quizBody').innerHTML = '<div class="empty">选择题库还没有生成。<br>先到「① 导入笔记」提炼题目，或用顶部下拉切换题集，再点「开始刷题」。</div>';
  }

  function renderQuiz() {
    var st = S.quiz;
    if (!st) return renderQuizEmpty();
    if (st.idx >= st.list.length) return renderQuizResult();
    // 这道题已经答过了（从后面的题回看过来的），直接显示当时的结果，不让人重复作答
    if (st.results[st.idx]) return renderQuizReview();
    var q = st.list[st.idx];
    var isMulti = q.type === 'multi' && st.forms[st.idx] !== 'fill';
    var isFill = st.forms[st.idx] === 'fill';
    var opts = isFill ? [] : shuffle((isMulti ? q.answer.slice() : [q.answer]).concat(q.opts || []));

    var bodyHtml = isFill
      ? '<div class="recite-input-row">' +
        '<input class="recite-input" id="fillInput" autocomplete="off" placeholder="把空填上，Enter 提交">' +
        '<button class="btn primary" id="fillSubmit">作答</button></div>'
      : '<div class="opts" id="optsBox">' +
        opts.map(function (o, i) {
          return '<button class="opt" data-v="' + esc(o) + '"><span class="key">' + String.fromCharCode(65 + i) + '</span><span class="opt-text">' + esc(o) + '</span></button>';
        }).join('') +
        '</div>' +
        (isMulti ? '<div class="row" style="margin-top:14px"><button class="btn primary" id="multiSubmit">提交答案</button><span class="muted">可多选</span></div>' : '');

    var html = '<div class="quiz-card">' +
      '<div class="progress"><i style="width:' + (st.idx / st.list.length * 100) + '%"></i></div>' +
      '<div class="q-meta"><span>第 ' + (st.idx + 1) + ' / ' + st.list.length + ' 题</span>' +
      '<span class="pill">' + (isFill ? '填空' : isMulti ? '多选' : '单选') + '</span>' +
      '<span>掌握度 ' + masteryPct(q) + '%</span>' +
      (st.idx > 0 ? '<button class="btn ghost tiny" id="prevQBtn">← 上一题</button>' : '') +
      '</div>' +
      '<div class="stem">' + stemHtml(q.stem) + '</div>' +
      bodyHtml +
      '<div id="quizFb"></div>' +
      '</div>';
    $('#quizBody').innerHTML = html;

    // 回头看看上一题怎么答的（会停在回顾态，不会重复统计）
    if ($('#prevQBtn')) {
      $('#prevQBtn').addEventListener('click', function () {
        quizTimerStop(st);
        st.idx--;
        renderQuiz();
      });
    }

    if (isFill) {
      $('#fillInput').focus();
      $('#fillInput').addEventListener('keydown', function (e) {
        // 中文输入法打字时按 Enter 是在选候选词，那一下不能当提交，
        // 否则提交的是拼音串（还会把候选词吞掉不上屏）
        if (e.key !== 'Enter') return;
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        submitFill();
      });
      $('#fillSubmit').addEventListener('click', submitFill);
    } else if (isMulti) {
      $$('#optsBox .opt').forEach(function (b) {
        b.addEventListener('click', function () { b.classList.toggle('sel'); });
      });
      $('#multiSubmit').addEventListener('click', function () {
        var picked = $$('#optsBox .opt.sel').map(function (b) { return b.dataset.v; });
        if (!picked.length) { toast('先选一个答案'); return; }
        answerQuiz(picked);
      });
    } else {
      $$('#optsBox .opt').forEach(function (b) {
        b.addEventListener('click', function () { answerQuiz(b.dataset.v); });
      });
    }
  }

  // 刷题里碰到填空题：自己打字，判分方式和背诵模式一样
  function submitFill() {
    var st = S.quiz;
    var q = st.list[st.idx];
    if (!$('#fillInput')) return;
    var v = $('#fillInput').value.trim();
    if (!v) { toast('先写个答案，哪怕只记得一半'); return; }
    var g = gradeAnswer(v, q.answer);
    recordAnswer(q.id, g.level);
    st.results.push({ q: q, ok: g.level === 'right', partial: g.level === 'mid', input: v });

    $('#fillInput').disabled = true;
    var fb = $('#fillSubmit');
    if (fb) fb.remove();

    // 把答案直接补进题干那个空里，一眼就能看到正确答案
    fillStemBlank($('#quizBody'), q, g.level === 'right');

    $('#quizFb').innerHTML = verdictHtml(q, v, g) +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="nextQBtn">' +
      (st.idx + 1 >= st.list.length ? '看看这组成绩' : '下一题 →') + '</button></div>';
    $('#nextQBtn').addEventListener('click', function () {
      quizTimerStop(st);
      st.idx++;
      renderQuiz();
    });
    // 反馈在输入框下面，手机上常常在屏幕外，主动滚过去
    scrollToFb($('#quizFb'));
    // 填空题是手打的，读完答案需要时间，自动跳得比选择题慢
    quizAutoNext(st, q, g.level === 'wrong' ? 4500 : 2800);
  }

  // 自动下一题：只管当前这一题，用户翻页了 / 正在打字就都不插手
  function quizTimerStop(st) {
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
  }

  function quizAutoNext(st, q, delay) {
    if (!$('#qAutoNext').checked) return;
    st.timer = setTimeout(function () {
      st.timer = null;
      // 用户已经自己翻页或回看过，就别再动它
      if (S.quiz !== st || st.list[st.idx] !== q) return;
      var inp = $('#fillInput');
      // 人家正打着字呢，不能给冲掉
      if (inp && !inp.disabled && inp.value.trim()) return;
      st.idx++;
      renderQuiz();
    }, delay);
  }

  // 回看已经答过的题：只看不答，不重复统计
  function renderQuizReview() {
    var st = S.quiz;
    var i = st.idx;
    var r = st.results[i];
    var q = r.q || st.list[i];
    var isFill = r.input != null;
    var your = isFill ? r.input : (r.picked || []).join('、');
    var cls = r.ok ? 'ok' : (r.partial ? 'mid' : 'bad');
    var title = r.ok ? '✅ 这题你答对了' : (r.partial ? '🟡 这题你记住了大半' : '❌ 这题你答错了');
    var html = '<div class="quiz-card">' +
      '<div class="progress"><i style="width:' + (i / st.list.length * 100) + '%"></i></div>' +
      '<div class="q-meta"><span>第 ' + (i + 1) + ' / ' + st.list.length + ' 题 · 回顾</span>' +
      '<span class="pill">' + (isFill ? '填空' : r.multi ? '多选' : '单选') + '</span></div>' +
      '<div class="stem">' + stemHtml(q.stem) + '</div>' +
      '<div class="verdict ' + cls + '" style="margin-top:12px">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-body">' +
      (isFill ? '你写的是：' : '你选的是：') + '<strong>' + esc(your) + '</strong><br>' +
      '正确答案：<strong>' + esc(answerText(q)) + '</strong>' +
      '</div>' +
      (q.source ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      '</div>' +
      '<div class="row" style="margin-top:12px">' +
      (i > 0 ? '<button class="btn ghost" id="revPrevBtn">← 更早一题</button>' : '') +
      '<button class="btn primary" id="revNextBtn">' +
      (i + 1 >= st.list.length ? '看看这组成绩 →' : '继续第 ' + (i + 2) + ' 题 →') + '</button>' +
      '</div></div>';
    $('#quizBody').innerHTML = html;
    fillStemBlank($('#quizBody'), q, r.ok);
    $('#revNextBtn').addEventListener('click', function () {
      quizTimerStop(st);
      st.idx++;
      renderQuiz();
    });
    if ($('#revPrevBtn')) {
      $('#revPrevBtn').addEventListener('click', function () {
        quizTimerStop(st);
        st.idx--;
        renderQuiz();
      });
    }
  }

  // 把正确答案写进题干的空格里（题干有多个空就不猜了，反馈卡片里有完整表述）
  function fillStemBlank(box, q, right) {
    if (!box) return;
    var blanks = box.querySelectorAll('.stem .blank-mark');
    if (blanks.length !== 1) return;
    blanks[0].textContent = answerText(q);
    blanks[0].className = 'blank-mark filled' + (right ? ' ok' : '');
  }

  function scrollToFb(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 老浏览器 */ }
  }

  function answerQuiz(picked) {
    var st = S.quiz;
    var q = st.list[st.idx];
    var isMulti = q.type === 'multi' && st.forms[st.idx] !== 'fill';
    var right = isMulti
      ? (picked.length === q.answer.length && q.answer.every(function (a) { return picked.indexOf(a) >= 0; }))
      : (picked === q.answer);
    recordAnswer(q.id, right ? 'right' : 'wrong');
    st.results.push({ q: q, ok: right, multi: isMulti, picked: picked });

    var corrects = isMulti ? q.answer.slice() : [q.answer];
    $$('#optsBox .opt').forEach(function (b) {
      b.disabled = true;
      b.classList.remove('sel');
      if (corrects.indexOf(b.dataset.v) >= 0) b.classList.add('right');
      else if ((isMulti ? picked.indexOf(b.dataset.v) >= 0 : b.dataset.v === picked)) b.classList.add('wrong');
    });
    var ms = $('#multiSubmit');
    if (ms) ms.remove();

    // 选择题题干末尾也有个空，作答后把正确答案补上去
    fillStemBlank($('#quizBody'), q, right);

    var pickedText = isMulti ? picked.join('、') : picked;
    $('#quizFb').innerHTML =
      '<div class="verdict ' + (right ? 'ok' : 'bad') + '" style="margin-top:14px">' +
      '<div class="verdict-title">' + (right ? '✅ 答对了' : '❌ 答错了') + '</div>' +
      '<div class="verdict-body">' +
      (right ? '你选：<strong>' + esc(pickedText) + '</strong>' : '你选：<strong>' + esc(pickedText) + '</strong>　正确答案：<strong>' + esc(corrects.join('、')) + '</strong>') +
      '</div>' +
      (q.source ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="nextQBtn">' +
      (st.idx + 1 >= st.list.length ? '看看这组成绩' : '下一题 →') + '</button></div>';
    $('#nextQBtn').addEventListener('click', function () {
      quizTimerStop(st);
      st.idx++;
      renderQuiz();
    });
    scrollToFb($('#quizFb'));
    quizAutoNext(st, q, right ? 1500 : 2500);
  }

  function renderQuizResult() {
    var st = S.quiz;
    quizTimerStop(st);
    var ok = st.results.filter(function (r) { return r.ok; }).length;
    var mid = st.results.filter(function (r) { return r.partial; }).length;
    var total = st.results.length;
    var pct = total ? Math.round(ok / total * 100) : 0;
    var wrongs = st.results.filter(function (r) { return !r.ok; });
    var html = '<div class="quiz-card"><div class="result-card">' +
      '<div class="score">' + pct + '<span style="font-size:18px">%</span></div>' +
      '<div class="result-sub">' + total + ' 题：完全正确 ' + ok + ' · 部分正确 ' + mid + ' · 答错 ' + (total - ok - mid) +
      '　' + (pct >= 90 ? '稳了，继续保持' : pct >= 60 ? '还行，错题再背两遍' : '别慌，先把下面的错题啃下来') + '</div>' +
      '</div>';
    if (wrongs.length) {
      html += '<h3 style="margin:18px 0 8px">这一组的错题</h3><div class="list">' +
        wrongs.map(function (r) {
          return '<div class="item"><div class="item-main"><div class="item-stem">' + stemHtml(r.q.stem) + '</div>' +
            '<div class="item-sub">正确答案：<strong>' + esc(answerText(r.q)) + '</strong></div></div>' +
            '<span class="pill err">错了</span></div>';
        }).join('') + '</div>' +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="drillWrong">马上背这些错题</button>' +
        '<button class="btn ghost" id="toWrongView">打开错题本</button></div>';
    }
    html += '<div class="row" style="margin-top:14px"><button class="btn" id="againBtn">再来一组</button></div></div>';
    $('#quizBody').innerHTML = html;

    $('#againBtn').addEventListener('click', function () { $('#quizStartBtn').click(); });
    if ($('#drillWrong')) $('#drillWrong').addEventListener('click', function () {
      $('#rRange').value = 'wrong';
      switchView('recite');
      $('#reciteStartBtn').click();
    });
    if ($('#toWrongView')) $('#toWrongView').addEventListener('click', function () { switchView('wrong'); });
  }

  /* =========================================================
     ③ 背知识点（苏格拉底式）
     ========================================================= */
  $('#reciteStartBtn').addEventListener('click', function () {
    S.recite = null;
    var range = $('#rRange').value;
    var list = pickQuestions({ range: range, type: 'all', count: 0, shuffle: $('#rOrder').value === 'rand' });
    if (!list.length) { toast('这个范围里没有题'); return; }
    S.recite = { list: list, idx: 0, prev: null, hint: $('#rHint').checked, ok: 0, mid: 0, bad: 0 };
    renderRecite();
  });

  function renderReciteEmpty() {
    $('#reciteBody').innerHTML = '<div class="empty">还没有可以背的知识点。<br>到「① 导入笔记」提炼题目后，回到这里开始背诵 —— 每答一问，立刻给正误，并马上追问下一问。</div>';
  }

  function renderRecite() {
    var st = S.recite;
    if (!st) return renderReciteEmpty();
    if (st.idx >= st.list.length) return renderReciteEnd();
    var q = st.list[st.idx];
    var isMulti = q.type === 'multi';
    var full = answerText(q);
    var hint = '';
    if (st.hint) {
      var first = full.charAt(0);
      hint = '（提示：' + esc(first) + '…… 共 ' + full.length + ' 字' + (isMulti ? '，含 ' + q.answer.length + ' 项' : '') + '）';
    }
    var html = '<div class="quiz-card">' +
      '<div class="progress"><i style="width:' + (st.idx / st.list.length * 100) + '%"></i></div>' +
      (st.prev ? '<div class="prev-note">' + st.prev + '</div>' : '') +
      '<div class="q-meta"><span>第 ' + (st.idx + 1) + ' / ' + st.list.length + ' 问</span>' +
      '<span class="pill">' + (isMulti ? '列举题' : '填空') + '</span>' +
      '<span>掌握度 ' + masteryPct(q) + '%</span></div>' +
      '<div class="stem">' + stemHtml(q.stem) + '</div>' +
      '<div class="recite-input-row">' +
      '<input class="recite-input" id="reciteInput" autocomplete="off" placeholder="' + (isMulti ? '多项之间用顿号或空格隔开' : '把空填上，Enter 提交') + '">' +
      '<button class="btn primary" id="reciteSubmit">作答</button>' +
      '</div>' +
      (hint ? '<div class="muted" style="margin-top:8px">' + hint + '</div>' : '') +
      '<div id="reciteVb"></div>' +
      '</div>';
    $('#reciteBody').innerHTML = html;
    $('#reciteInput').focus();
    $('#reciteInput').addEventListener('keydown', function (e) {
      // 同刷题页：输入法还在组合状态时，Enter 是选词，不当提交
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submitRecite();
    });
    $('#reciteSubmit').addEventListener('click', submitRecite);
  }

  // 判分后的反馈卡片（刷题的填空题和背诵模式共用）
  function verdictHtml(q, input, g) {
    var title, cls, body;
    if (g.level === 'right') {
      title = '✅ 正确';
      cls = 'ok';
      body = '你说的是：' + esc(input) + '　—— 记住了。';
    } else if (g.level === 'mid') {
      var missTxt = g.miss.map(function (m) { return m.raw; }).join('、');
      title = '🟡 记住了大半，还差一点';
      cls = 'mid';
      body = '你已经答出：' + esc(g.hits.map(function (h) { return h.raw; }).join('、')) + '<br>' +
        (missTxt ? '还差的关键部分是：<strong>' + esc(missTxt) + '</strong>'
          : '要点都在，但说法还不完整 —— 按原文再跟我念一遍');
    } else {
      title = '❌ 记错了，跟我再念一遍';
      cls = 'bad';
      body = '你答的是：' + esc(input) + '<br>正确说法是：<strong>' + esc(answerText(q)) + '</strong>';
    }
    return '<div class="verdict ' + cls + '">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-body">' + body + '</div>' +
      '<div class="answer-line">完整表述：<strong>' + esc(q.stem.replace('____', answerText(q))) + '</strong></div>' +
      (q.source ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      '</div>';
  }

  function submitRecite() {
    var st = S.recite;
    var input = $('#reciteInput').value.trim();
    if (!input) { toast('先写出你的答案，哪怕只记得一半'); return; }
    var q = st.list[st.idx];
    var g = gradeAnswer(input, q.answer);
    if (g.level === 'right') st.ok++;
    else if (g.level === 'mid') st.mid++;
    else st.bad++;
    recordAnswer(q.id, g.level === 'empty' ? 'wrong' : g.level);

    // 把答案直接补进题干那个空里，一眼就能看到正确答案
    fillStemBlank($('#reciteBody'), q, g.level === 'right');

    $('#reciteVb').innerHTML = verdictHtml(q, input, g) +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="reciteNext">' +
      (st.idx + 1 >= st.list.length ? '这一轮结束' : '下一问 → （Enter）') + '</button></div>';
    $('.recite-input-row').remove();
    $('#reciteNext').focus();
    scrollToFb($('#reciteVb'));

    var prevNote = '上一问：' + esc(q.stem) + '　你答「' + esc(input) + '」 → ' +
      (g.level === 'right' ? '<span style="color:var(--ok)">正确</span>' : g.level === 'mid' ? '<span style="color:var(--warn)">部分正确</span>' : '<span style="color:var(--err)">记错了，答案是 <strong>' + esc(answerText(q)) + '</strong></span>');

    function goNext() { st.prev = prevNote; st.idx++; renderRecite(); }
    $('#reciteNext').addEventListener('click', goNext);
    $('#reciteNext').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      goNext();
    });
    // 手打完要看答案，自动跳得比选择题慢
    if ($('#rAutoNext').checked) {
      setTimeout(function () { if (S.recite === st && st.list[st.idx] === q) goNext(); }, g.level === 'wrong' ? 4500 : 2800);
    }
  }

  function renderReciteEnd() {
    var st = S.recite;
    var total = st.list.length;
    var acc = total ? Math.round(st.ok / total * 100) : 0;
    $('#reciteBody').innerHTML = '<div class="quiz-card"><div class="result-card">' +
      '<div class="score">' + acc + '<span style="font-size:18px">%</span></div>' +
      '<div class="result-sub">这一轮 ' + total + ' 问：完全正确 ' + st.ok + ' · 部分正确 ' + st.mid + ' · 记错 ' + st.bad + '</div>' +
      '</div>' +
      '<div class="row" style="margin-top:18px;justify-content:center">' +
      '<button class="btn primary" id="reciteAgain">再背一轮</button>' +
      '<button class="btn ghost" id="reciteToWrong">去背错题</button>' +
      '<button class="btn ghost" id="reciteToStats">看看统计</button>' +
      '</div></div>';
    $('#reciteAgain').addEventListener('click', function () { $('#reciteStartBtn').click(); });
    $('#reciteToWrong').addEventListener('click', function () {
      $('#rRange').value = 'wrong';
      $('#reciteStartBtn').click();
    });
    $('#reciteToStats').addEventListener('click', function () { switchView('stats'); });
  }

  /* =========================================================
     ④ 错题本
     ========================================================= */
  $('#wrongDrillBtn').addEventListener('click', function () {
    $('#rRange').value = $('#wFilter').value === 'all' ? 'all' : ($('#wFilter').value === 'weak' ? 'weak' : 'wrong');
    switchView('recite');
    $('#reciteStartBtn').click();
  });
  $('#clearWrongBtn').addEventListener('click', function () {
    if (!confirm('确定清空错题记录？题目会保留，练习记录会被清除。')) return;
    var ids = getQs().map(function (q) { return q.id; });
    ids.forEach(function (id) { delete S.stats[id]; });
    save(); renderWrong(); toast('错题记录已清空');
  });
  $('#wFilter').addEventListener('change', renderWrong);

  function renderWrong() {
    var f = $('#wFilter').value;
    var qs = getQs().filter(function (q) {
      var s = S.stats[q.id];
      if (f === 'wrong') return s && s.bad > 0 && !s.mastered;
      if (f === 'weak') return !s || !s.mastered;
      return true;
    });
    qs.sort(function (a, b) {
      var sa = getStat(a.id), sb = getStat(b.id);
      return (sa.mastery - sb.mastery) || (sb.bad - sa.bad);
    });
    if (!qs.length) {
      $('#wrongList').innerHTML = '<div class="empty">这里空空的 —— 说明最近还没做错过，或者还没开始练。<br>去「② 刷选择题」或「③ 背知识点」试试。</div>';
      return;
    }
    $('#wrongList').innerHTML = qs.map(function (q) {
      var s = getStat(q.id);
      return '<div class="item">' +
        '<div class="item-main">' +
        '<div class="item-stem">' + stemHtml(q.stem) + '</div>' +
        '<div class="item-sub">正确答案：<strong>' + esc(answerText(q)) + '</strong>　·　练 ' + (s.ok + s.bad) + ' 次，错 ' + s.bad + ' 次</div>' +
        '</div>' +
        '<div class="bar" title="掌握度"><i style="width:' + Math.round(s.mastery * 100) + '%"></i></div>' +
        '<span class="pill ' + (s.bad > 0 ? 'err' : s.mastered ? 'ok' : 'warn') + '">' + (s.bad > 0 ? '错过' : s.mastered ? '已掌握' : '待巩固') + '</span>' +
        '<button class="btn ghost" data-drill="' + q.id + '">背它</button>' +
        '<button class="mini-btn" data-clear="' + q.id + '" title="清除这道题的记录">✕</button>' +
        '</div>';
    }).join('');

    $$('#wrongList [data-drill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = getQ(b.dataset.drill);
        if (!q) return;
        S.recite = { list: [q], idx: 0, prev: null, hint: false, ok: 0, mid: 0, bad: 0 };
        switchView('recite');
        renderRecite();
      });
    });
    $$('#wrongList [data-clear]').forEach(function (b) {
      b.addEventListener('click', function () {
        delete S.stats[b.dataset.clear];
        save(); renderWrong();
      });
    });
  }

  /* =========================================================
     ⑤ 数据统计
     ========================================================= */
  function renderStats() {
    var qs = getQs();
    var practiced = qs.filter(function (q) { var s = S.stats[q.id]; return s && (s.ok + s.bad) > 0; });
    var totOk = 0, totAll = 0;
    practiced.forEach(function (q) { var s = S.stats[q.id]; totOk += s.ok; totAll += s.ok + s.bad; });
    var mastered = qs.filter(function (q) { var s = S.stats[q.id]; return s && s.mastered; }).length;
    var acc = totAll ? Math.round(totOk / totAll * 100) : 0;

    $('#kpis').innerHTML = [
      ['题目总数', qs.length],
      ['已练习', practiced.length],
      ['总正确率', acc + '%'],
      ['已掌握', mastered]
    ].map(function (p) {
      return '<div class="kpi"><div class="kpi-num">' + p[1] + '</div><div class="kpi-label">' + p[0] + '</div></div>';
    }).join('');

    // 掌握度分布
    var buckets = [
      { label: '生疏 0-20%', c: 'var(--err)', v: 0 },
      { label: '20-40%', c: '#f97316', v: 0 },
      { label: '40-60%', c: 'var(--warn)', v: 0 },
      { label: '60-80%', c: 'var(--brand)', v: 0 },
      { label: '牢固 80-100%', c: 'var(--ok)', v: 0 }
    ];
    qs.forEach(function (q) {
      var m = getStat(q.id).mastery;
      var i = m < 0.2 ? 0 : m < 0.4 ? 1 : m < 0.6 ? 2 : m < 0.8 ? 3 : 4;
      buckets[i].v++;
    });
    var max = Math.max.apply(null, buckets.map(function (b) { return b.v; }).concat([1]));
    $('#dist').innerHTML = qs.length ? buckets.map(function (b) {
      return '<div class="dist-row"><span class="dist-label">' + b.label + '</span>' +
        '<span class="dist-track"><i style="width:' + (b.v / max * 100) + '%;background:' + b.c + '"></i></span>' +
        '<span class="dist-val">' + b.v + '</span></div>';
    }).join('') : '<div class="muted">还没有题目</div>';

    // 最近 7 天
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var row = S.log.filter(function (x) { return x.d === key; })[0];
      days.push({ lb: (d.getMonth() + 1) + '/' + d.getDate(), n: row ? row.n : 0 });
    }
    var dmax = Math.max.apply(null, days.map(function (x) { return x.n; }).concat([1]));
    $('#weekly').innerHTML = days.map(function (x) {
      return '<div class="col"><div class="bwrap"><div class="b" style="height:' + (x.n / dmax * 100) + '%" title="' + x.n + ' 题"></div></div>' +
        '<div class="lb">' + x.lb + '</div></div>';
    }).join('');

    // 薄弱 TOP10
    var sorted = qs.slice().sort(function (a, b) {
      var sa = getStat(a.id), sb = getStat(b.id);
      return (sa.mastery - sb.mastery) || (sb.bad - sa.bad);
    }).slice(0, 10);
    $('#weakList').innerHTML = sorted.length ? sorted.map(function (q) {
      var s = getStat(q.id);
      return '<div class="item"><div class="item-main"><div class="item-stem">' + stemHtml(q.stem) + '</div>' +
        '<div class="item-sub">正确答案：<strong>' + esc(answerText(q)) + '</strong></div></div>' +
        '<div class="bar"><i style="width:' + Math.round(s.mastery * 100) + '%"></i></div>' +
        '<span class="pill ' + (s.mastery < 0.4 ? 'err' : s.mastery < 0.8 ? 'warn' : 'ok') + '">' + Math.round(s.mastery * 100) + '%</span>' +
        '<button class="btn ghost" data-drill="' + q.id + '">背它</button></div>';
    }).join('') : '<div class="muted">还没有题目</div>';

    $$('#weakList [data-drill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = getQ(b.dataset.drill);
        if (!q) return;
        S.recite = { list: [q], idx: 0, prev: null, hint: false, ok: 0, mid: 0, bad: 0 };
        switchView('recite');
        renderRecite();
      });
    });
  }

  $('#exportAllBtn').addEventListener('click', function () {
    download('期末刷题-全部数据.json', JSON.stringify({ v: 1, banks: S.banks, stats: S.stats, log: S.log }, null, 2));
  });
  $('#importAllBtn').addEventListener('click', function () { $('#importAllFile').click(); });
  $('#importAllFile').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(String(fr.result));
        if (!d.banks) { toast('这不是全部数据文件'); return; }
        if (!confirm('导入会覆盖当前的题集与记录，继续吗？')) return;
        S.banks = d.banks; S.stats = d.stats || {}; S.log = d.log || [];
        S.cur = S.banks.length ? S.banks[0].id : '';
        save(); renderBankSelect(); switchView('stats');
        toast('数据已导入');
      } catch (e) { toast('解析失败：' + e.message); }
    };
    fr.readAsText(f, 'utf-8');
  });
  $('#resetStatsBtn').addEventListener('click', function () {
    if (!confirm('清空所有练习记录？题目本身会保留。')) return;
    S.stats = {}; S.log = [];
    save(); renderStats(); toast('练习记录已清空');
  });
  $('#delBankBtn').addEventListener('click', function () {
    var b = getBank();
    if (!b) { toast('没有题集'); return; }
    if (!confirm('删除题集「' + b.course + '」及其全部题目？')) return;
    S.banks = S.banks.filter(function (x) { return x.id !== b.id; });
    S.cur = S.banks.length ? S.banks[0].id : '';
    save(); renderBankSelect(); renderStats();
    toast('题集已删除');
  });

  /* ---------------- 主题 / 导航 ---------------- */
  $('#themeBtn').addEventListener('click', function () {
    var now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', now);
    localStorage.setItem(LS_THEME, now);
    this.textContent = now === 'dark' ? '☀️' : '🌙';
  });
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () { switchView(t.dataset.view); });
  });

  /* =========================================================
     云端账号与同步
     —— 完全可选。后端不可用时（例如直接双击打开 index.html）
        自动退回纯本地游客模式，原有功能不受任何影响。
     ========================================================= */
  var Cloud = { online: false, user: null, gid: null, pulling: false, pushTimer: null, lastSyncAt: 0, lastErr: null };

  function randId() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) { /* 老浏览器 */ }
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function gidGet() {
    var g = null;
    try { g = localStorage.getItem('fq_gid_v1'); } catch (e) {}
    if (!g) {
      g = randId();
      try { localStorage.setItem('fq_gid_v1', g); } catch (e) {}
    }
    return g;
  }

  function api(method, path, body) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('浏览器不支持 fetch'));
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        if (!j) throw new Error('服务器返回了异常内容（' + r.status + '）');
        if (!r.ok || j.ok === false) {
          var err = new Error(j.error || ('请求失败（' + r.status + '）'));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  /* ---- 合并策略：只增不减，谁练得多听谁的 ---- */
  function bankKey(b) { return String((b && b.course) || '').trim().toLowerCase() || (b && b.id) || ''; }

  function mergeBanks(local, remote) {
    var order = [];
    var map = {};
    (local || []).forEach(function (b) {
      if (!b) return;
      var k = bankKey(b);
      if (!map[k]) { map[k] = b; order.push(k); }
    });
    (remote || []).forEach(function (b) {
      if (!b) return;
      var k = bankKey(b);
      if (!map[k]) { map[k] = b; order.push(k); return; }
      var mine = map[k];
      // 题集已存在：题目按 id 取并集，本地优先
      var qs = (mine.questions || []).slice();
      var seen = {};
      qs.forEach(function (q) { if (q && q.id) seen[q.id] = true; });
      (b.questions || []).forEach(function (q) {
        if (q && q.id && !seen[q.id]) { qs.push(q); seen[q.id] = true; }
      });
      qs.sort(function (a, c) { return (a.order || 0) - (c.order || 0); });
      mine.questions = qs;
      if (!mine.course && b.course) mine.course = b.course;
      mine.createdAt = Math.min(mine.createdAt || Date.now(), b.createdAt || Date.now());
    });
    return order.map(function (k) { return map[k]; });
  }

  function mergeStats(local, remote) {
    var out = {};
    Object.keys(local || {}).forEach(function (k) { out[k] = local[k]; });
    Object.keys(remote || {}).forEach(function (k) {
      var a = out[k], b = remote[k];
      if (!a || !b) { out[k] = a || b; return; }
      var sa = (a.ok || 0) + (a.bad || 0);
      var sb = (b.ok || 0) + (b.bad || 0);
      out[k] = (sb > sa || (sb === sa && (b.lastAt || 0) > (a.lastAt || 0))) ? b : a;
    });
    return out;
  }

  function mergeLog(local, remote) {
    var m = {};
    (local || []).forEach(function (r) { if (r && r.d) m[r.d] = Math.max(m[r.d] || 0, r.n || 0); });
    (remote || []).forEach(function (r) { if (r && r.d) m[r.d] = Math.max(m[r.d] || 0, r.n || 0); });
    return Object.keys(m).sort().slice(-60).map(function (d) { return { d: d, n: m[d] }; });
  }

  /* ---- 同步状态指示灯 ---- */
  function setDot(kind) {
    var d = $('#acctDot');
    if (!d) return;
    d.className = 'acct-dot ' + kind;
    d.title = { online: '已登录，云同步开启', syncing: '正在同步…', error: '同步失败', offline: '未同步（游客或离线）' }[kind] || '';
  }
  function refreshDot() {
    if (!Cloud.online) return setDot('offline');
    if (Cloud.pulling || Cloud.pushTimer) return setDot('syncing');
    if (Cloud.user && Cloud.lastErr) return setDot('error');
    setDot(Cloud.user ? 'online' : 'offline');
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtDateTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + fmtTime(ts);
  }
  function ago(ts) {
    if (!ts) return '—';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }

  function renderAccount() {
    var u = Cloud.user;
    var name = u ? (u.name || u.username) : '游客';
    var av = name.slice(0, 1);
    var cls = 'acct-avatar' + (u ? '' : ' guest');

    $('#acctAvatar').textContent = av;
    $('#acctAvatar').className = cls;
    $('#acctAvatar2').textContent = av;
    $('#acctAvatar2').className = 'acct-avatar big' + (u ? '' : ' guest');
    $('#acctName').textContent = name;
    $('#acctName2').textContent = name + (u && u.role === 'admin' ? '（站长）' : '');

    var sub, hint;
    if (!Cloud.online) {
      sub = '现在是纯本地模式 —— 直接用浏览器打开的网页文件，数据只存在这台设备上。想用登录和同步的话，需要从服务端地址打开。';
      hint = '离线模式 · 未连接服务端';
    } else if (!u) {
      sub = '登录后可换设备继续刷，题集和练习记录会自动跟着走';
      hint = '未登录，数据只存在这台设备的浏览器里';
    } else {
      sub = '已登录' + (u.provider === 'workbuddy' ? '（WorkBuddy 账号）' : '') +
        ' · 上次同步 ' + (Cloud.lastSyncAt ? ago(Cloud.lastSyncAt) : '尚未同步') +
        (u.role === 'admin' ? ' · 你是站长，可在下方查看站点使用情况' : '');
      hint = '云同步已开启 · 上次同步 ' + (Cloud.lastSyncAt ? fmtTime(Cloud.lastSyncAt) : '—');
    }
    $('#acctSub').textContent = sub;
    $('#syncHint').textContent = hint;

    $('#loginBtn').hidden = !!u || !Cloud.online;
    $('#syncNowBtn').hidden = !u;
    $('#logoutBtn').hidden = !u;
    $('#acctBtn').title = u ? ('已登录：' + name + '（点击管理账号）') : '游客模式（点击登录）';
    refreshDot();
  }

  /* ---- 拉取云端数据 ---- */
  function cloudPull() {
    if (!Cloud.online || !Cloud.user) return Promise.resolve(null);
    Cloud.pulling = true;
    refreshDot();
    return api('GET', '/api/sync').then(function (j) {
      var before = S.banks.reduce(function (n, b) { return n + ((b && b.questions) ? b.questions.length : 0); }, 0);
      var remoteQ = (j.banks || []).reduce(function (n, b) { return n + ((b && b.questions) ? b.questions.length : 0); }, 0);

      S.banks = mergeBanks(S.banks, j.banks);
      S.stats = mergeStats(S.stats, j.stats);
      S.log = mergeLog(S.log, j.log);
      if (!S.banks.some(function (b) { return b.id === S.cur; })) S.cur = S.banks.length ? S.banks[0].id : '';

      save(); // 落本地；此时 Cloud.pulling 为真，不会反向推送
      renderBankSelect();
      if (S.view === 'stats') renderStats();
      if (S.view === 'wrong') renderWrong();
      Cloud.lastSyncAt = j.updatedAt || Date.now();
      Cloud.lastErr = null;
      return { before: before, remoteQ: remoteQ };
    }).catch(function (e) {
      Cloud.lastErr = e.message;
      throw e;
    }).then(function (v) {
      Cloud.pulling = false;
      refreshDot();
      renderAccount();
      return v;
    }, function (e) {
      Cloud.pulling = false;
      renderAccount();
      throw e;
    });
  }

  /* ---- 推送本地数据（防抖） ---- */
  function schedulePush() {
    if (!Cloud.online || !Cloud.user || Cloud.pulling) return;
    refreshDot();
    clearTimeout(Cloud.pushTimer);
    Cloud.pushTimer = setTimeout(function () {
      Cloud.pushTimer = null;
      api('PUT', '/api/sync', { banks: S.banks, stats: S.stats, log: S.log }).then(function (j) {
        Cloud.lastSyncAt = j.updatedAt || Date.now();
        Cloud.lastErr = null;
        renderAccount();
      }).catch(function (e) {
        Cloud.lastErr = e.message;
        setDot('error');
        if (e.status === 401) { Cloud.user = null; renderAccount(); }
      });
    }, 1800);
  }

  function cloudInit() {
    Cloud.gid = gidGet();
    return api('GET', '/api/ping').then(function (j) {
      Cloud.online = true;
      Cloud.user = j.user || null;
      renderAccount();
      if (Cloud.user) return cloudPull().catch(function () { /* 拉取失败不阻断使用 */ });
    }).catch(function () {
      Cloud.online = false;
      Cloud.user = null;
    }).then(function () {
      renderAccount();
      if (!Cloud.online) return null;
      return api('POST', '/api/visit', { gid: Cloud.gid }).then(function (j) {
        if (j && j.user && !Cloud.user) { Cloud.user = j.user; renderAccount(); }
      }).catch(function () { /* 统计失败无所谓 */ });
    });
  }

  /* ---------------- WorkBuddy 账号登录（走云服务 OAuth 中继） ----------------
     流程：点按钮 → SDK 生成 PKCE → 跳 WorkBuddy 授权页 → 中继回调到本站根
          → handleWorkBuddyCallback 换回云端会话 → 拿云端 uid 换本站会话。 */
  var CLOUD_CFG = {
    endpoint: 'https://finals-quiz.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_idrw8H9MnUVN6sG965sN3U_ErepyHkZC72EhMXZ1ac0ILh555i9TdEw'
  };
  var WBAuth = { client: null, ready: false, why: '' };

  function wbInit() {
    try {
      if (!window.WorkBuddyCloud || typeof window.WorkBuddyCloud.createWorkBuddyCloud !== 'function') {
        WBAuth.why = '登录组件没加载';
        return false;
      }
      WBAuth.client = window.WorkBuddyCloud.createWorkBuddyCloud({
        endpoint: CLOUD_CFG.endpoint,
        oauthRelayBaseUrl: CLOUD_CFG.oauthRelayBaseUrl,
        publishableKey: CLOUD_CFG.publishableKey
      });
      WBAuth.ready = true;
      return true;
    } catch (e) {
      WBAuth.why = (e && e.message) || '初始化失败';
      return false;
    }
  }

  /* 只删回调参数，保住 ?sharecode= 这类业务参数，否则分享进来的同学会掉到错误页面 */
  function wbStripCb() {
    try {
      var u = new URL(window.location.href);
      ['code', 'state', 'provider'].forEach(function (k) { u.searchParams.delete(k); });
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { /* 老浏览器就算了 */ }
  }

  /* 云端身份 → 本站会话（云端 uid 作为稳定主键，换设备能认回同一个账号） */
  function wbBind(session) {
    var cu = session && session.user;
    if (!cu || !cu.id) return Promise.reject(new Error('没拿到 WorkBuddy 身份'));
    return api('POST', '/api/cloud-login', {
      cloudId: cu.id,
      name: String(cu.name || '').slice(0, 20),
      avatar: cu.avatarUrl || ''
    }).then(function (j) {
      Cloud.user = j.user;
      renderAccount();
      return j;
    });
  }

  /* 页面入口：要么是授权回调落地，要么是普通访问（试着恢复已有云端会话） */
  function wbRestore() {
    if (!WBAuth.ready) return Promise.resolve(null);
    var url;
    try { url = new URL(window.location.href); } catch (e) { return Promise.resolve(null); }

    var hasCb = url.searchParams.has('code') || url.searchParams.has('error');
    if (!hasCb) {
      return WBAuth.client.auth.getSession().then(function (r) {
        if (!r || !r.data) return null;
        return wbBind(r.data).catch(function () { return null; });
      }).catch(function () { return null; });
    }

    var provider = url.searchParams.get('provider');
    if (provider !== 'workbuddy') {
      wbStripCb();
      return Promise.reject(new Error('授权回调缺少有效的登录方式，请重新登录'));
    }
    if (typeof WBAuth.client.auth.handleWorkBuddyCallback !== 'function') {
      wbStripCb();
      return Promise.reject(new Error('当前登录组件版本不支持这种登录方式'));
    }

    return WBAuth.client.auth.handleWorkBuddyCallback().then(function (r) {
      if (r && r.error) {
        wbStripCb();
        throw new Error(r.error.message || 'WorkBuddy 登录失败');
      }
      if (!r || !r.data) { wbStripCb(); return null; }
      wbStripCb();
      return wbBind(r.data);
    }, function (e) {
      wbStripCb();
      throw e;
    });
  }

  function wbSignIn() {
    if (!Cloud.online) return authErr('现在是纯本地模式，无法登录 —— 需要通过服务端地址打开本页');
    if (!WBAuth.ready) return authErr('WorkBuddy 登录组件没加载成功，刷新一下页面再试');
    var btn = $('#wbLoginBtn');
    btn.disabled = true;

    var back = null;
    try {
      back = new URL(window.location.href);
      back.pathname = '/';
      ['code', 'state', 'provider'].forEach(function (k) { back.searchParams.delete(k); });
    } catch (e) { /* 老浏览器用默认 */ }

    var p;
    try {
      p = WBAuth.client.auth.signInWithOAuth({
        provider: 'workbuddy',
        redirectTo: back ? back.toString() : undefined
      });
    } catch (e) {
      btn.disabled = false;
      return authErr(e.message || 'WorkBuddy 登录发起失败');
    }

    Promise.resolve(p).then(function (r) {
      if (r && r.error) {
        btn.disabled = false;
        return authErr(r.error.message || 'WorkBuddy 登录发起失败');
      }
      var go = r && r.data && r.data.url;
      if (!go) {
        btn.disabled = false;
        return authErr('没拿到授权地址，请稍后再试');
      }
      window.location.assign(go); // 必须同标签页跳转，PKCE 证明存在当前标签页
    }).catch(function (e) {
      btn.disabled = false;
      authErr(e.message || 'WorkBuddy 登录发起失败');
    });
  }

  /* ---- 登录弹窗 ---- */
  var authMode = 'login';
  function openAuth(mode) {
    setAuthMode(mode || 'login');
    $('#authErr').hidden = true;
    $('#authUser').value = '';
    $('#authPass').value = '';
    $('#authName').value = '';
    $('#authModal').hidden = false;
    setTimeout(function () { $('#authUser').focus(); }, 30);
  }
  function closeAuth() { $('#authModal').hidden = true; }
  function setAuthMode(m) {
    authMode = m;
    $$('#authModal .mtab').forEach(function (b) { b.classList.toggle('active', b.dataset.mtab === m); });
    $('#authNameFld').hidden = (m !== 'reg');
    $('#authSubmit').textContent = (m === 'reg' ? '注册并登录' : '登录');
    $('#authFootHint').textContent = (m === 'reg' ? '第一个注册的账号会成为站长' : '还没有账号？点上面「注册」');
    $('#authTip').textContent = (m === 'reg'
      ? '注册只存昵称和密码哈希，不需要手机号邮箱。密码用 scrypt 加盐保存。'
      : '不登录也能正常使用；登录后题集会存到云端，换台设备继续刷。');
    $('#authErr').hidden = true;
  }
  function authErr(msg) {
    var e = $('#authErr');
    e.textContent = msg;
    e.hidden = false;
  }

  function submitAuth() {
    var username = $('#authUser').value.trim();
    var password = $('#authPass').value;
    if (!username) return authErr('填一下昵称');
    if (password.length < 6) return authErr('密码至少 6 位');
    var payload = { username: username, password: password };
    if (authMode === 'reg') payload.name = $('#authName').value.trim();
    var btn = $('#authSubmit');
    btn.disabled = true;
    btn.textContent = '处理中…';
    api('POST', authMode === 'reg' ? '/api/register' : '/api/login', payload).then(function (j) {
      Cloud.user = j.user;
      closeAuth();
      renderAccount();
      toast(j.user.role === 'admin' ? '注册成功，你是本站站长' : '登录成功，正在同步题集…');
      return cloudPull();
    }).then(function (v) {
      if (v && v.remoteQ > 0) toast('云端题集已合并到本地');
      else schedulePush();
      if (S.view === 'stats') renderStats();
    }).catch(function (e) {
      authErr(e.message || '登录失败');
    }).then(function () {
      btn.disabled = false;
      setAuthMode(authMode);
    });
  }

  $('#acctBtn').addEventListener('click', function () {
    if (Cloud.user) { switchView('stats'); $('#acctCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (Cloud.online) openAuth('login');
    else toast('现在是本地模式，无法登录 —— 需要通过服务端地址打开本页');
  });
  $('#loginBtn').addEventListener('click', function () { openAuth('login'); });
  $('#wbLoginBtn').addEventListener('click', wbSignIn);
  $('#logoutBtn').addEventListener('click', function () {
    if (!confirm('退出登录？本地的题集和记录会保留，只是不再自动同步。')) return;
    api('POST', '/api/logout', {}).catch(function () {}).then(function () {
      // 云端会话也要退，否则下次打开会被 getSession 自动登回来
      if (WBAuth.ready) {
        try { Promise.resolve(WBAuth.client.auth.signOut()).catch(function () {}); } catch (e) { /* 忽略 */ }
      }
      Cloud.user = null;
      clearTimeout(Cloud.pushTimer);
      Cloud.pushTimer = null;
      renderAccount();
      $('#adminCard').hidden = true;
      toast('已退出，数据仍保留在本机');
    });
  });
  $('#syncNowBtn').addEventListener('click', function () {
    cloudPull().then(function () {
      schedulePush();
      toast('已和云端对齐');
    }).catch(function (e) { toast('同步失败：' + e.message); });
  });

  $('#authModal').addEventListener('click', function (e) {
    if (e.target.dataset && e.target.dataset.close) { closeAuth(); return; }
    var t = e.target.closest('.mtab');
    if (t) setAuthMode(t.dataset.mtab);
  });
  $('#authSubmit').addEventListener('click', submitAuth);
  ['#authUser', '#authPass', '#authName'].forEach(function (s) {
    $(s).addEventListener('keydown', function (e) { if (e.key === 'Enter') submitAuth(); });
  });

  /* ---- 站长看板 ---- */
  function loadAdmin() {
    var card = $('#adminCard');
    if (!card) return;
    if (!Cloud.user || Cloud.user.role !== 'admin' || !Cloud.online) { card.hidden = true; return; }
    card.hidden = false;
    var tbody = $('#adminTable tbody');
    tbody.innerHTML = '<tr><td colspan="9" class="muted">加载中…</td></tr>';
    api('GET', '/api/admin/overview').then(function (j) { renderAdmin(j); })
      .catch(function (e) {
        tbody.innerHTML = '<tr><td colspan="9" class="muted">加载失败：' + esc(e.message) + '</td></tr>';
      });
  }

  function renderAdmin(j) {
    var t = j.total || {};
    var kp = [
      { n: t.users || 0, l: '注册用户' },
      { n: t.guests || 0, l: '游客（匿名）' },
      { n: (t.activeUser || 0) + ' / ' + (t.activeGuest || 0), l: '今日活跃（用户/游客）' },
      { n: t.questions || 0, l: '云端题目总数' },
      { n: t.answers || 0, l: '累计作答次数' }
    ];
    $('#adminKpis').innerHTML = kp.map(function (k) {
      return '<div class="kpi"><b>' + esc(k.n) + '</b><span>' + esc(k.l) + '</span></div>';
    }).join('');

    var rows = (j.users || []).map(function (u) {
      return '<tr>' +
        '<td><strong>' + esc(u.name) + '</strong>' + (u.role === 'admin' ? ' <span class="pill ok">站长</span>' : '') + '</td>' +
        '<td class="num">' + fmtDateTime(u.createdAt) + '</td>' +
        '<td class="num">' + ago(u.lastSeenAt || u.lastLoginAt) + '</td>' +
        '<td class="num">' + (u.loginCount || 0) + '</td>' +
        '<td class="num">' + (u.bankCount || 0) + '</td>' +
        '<td class="num">' + (u.questionCount || 0) + '</td>' +
        '<td class="num">' + (u.answerCount || 0) + '</td>' +
        '<td class="num">' + (u.accuracy == null ? '—' : u.accuracy + '%') + '</td>' +
        '<td class="num">' + (u.syncedAt ? ago(u.syncedAt) : '未同步') + '</td>' +
        '</tr>';
    }).join('');
    $('#adminTable tbody').innerHTML = rows || '<tr><td colspan="9" class="muted">还没有人注册</td></tr>';

    var daily = j.daily || [];
    var max = 1;
    daily.forEach(function (d) { max = Math.max(max, d.guests || 0, d.users || 0); });
    $('#adminDaily').innerHTML = '<div style="width:100%"><div class="muted" style="font-size:12.5px;margin-bottom:6px">最近 7 天访问次数（灰=游客，紫=登录用户）</div><div style="display:flex;gap:8px;align-items:flex-end">' +
      daily.map(function (d) {
        var hg = Math.round((d.guests || 0) / max * 58);
        var hu = Math.round((d.users || 0) / max * 58);
        return '<div class="cday"><div class="cbars">' +
          '<span class="cbar g" style="height:' + Math.max(2, hg) + 'px" title="游客 ' + (d.guests || 0) + '"></span>' +
          '<span class="cbar u" style="height:' + Math.max(2, hu) + 'px" title="用户 ' + (d.users || 0) + '"></span>' +
          '</div><div class="cval">' + (d.guests || 0) + '/' + (d.users || 0) + '</div>' +
          '<div class="clab">' + d.d.slice(5) + '</div></div>';
      }).join('') + '</div></div>';
  }
  $('#adminRefreshBtn').addEventListener('click', loadAdmin);

  /* ---------------- 启动 ---------------- */
  load();
  if (localStorage.getItem(LS_THEME) === 'dark') $('#themeBtn').textContent = '☀️';
  renderBankSelect();
  updateNoteStat();
  switchView('import');

  // 先处理 WorkBuddy 授权回来的人（换好会话），再走常规的 ping / 拉取
  wbInit();
  // 必须在 wbRestore 之前记下来：它会清掉 URL 上的 code，之后就看不出是不是回调了
  var wbIsCallback = false;
  try {
    var wbUrl = new URL(window.location.href);
    wbIsCallback = wbUrl.searchParams.has('code') || wbUrl.searchParams.has('error');
  } catch (e) { /* 老浏览器 */ }

  wbRestore().then(function (bound) {
    if (bound) closeAuth();   // 登录成功必须把弹窗收掉，否则遮罩会把整页挡住
    return cloudInit().then(function () { return bound; });
  }).then(function (bound) {
    if (bound) toast('已用 WorkBuddy 账号登录，正在同步题集…');
  }).catch(function (e) {
    // 只有"确实是授权回调"才弹窗报错；普通访问出错静默降级成游客
    cloudInit();
    if (wbIsCallback) {
      openAuth('login');
      authErr((e && e.message) || 'WorkBuddy 登录失败，请重试或改用昵称密码');
    }
  });

  /* =========================================================
     ⑥ 题集广场：别人分享的题集，按专业 / 科目筛，一键复制成自己的
     只有浏览需要联网；本地刷题完全不受影响。
     ========================================================= */
  var Plaza = { items: [], majors: [], subjects: [], loaded: false, loading: false, mine: false, err: null };
  var plazaSearchTimer = null;

  function plazaQuery() {
    var p = ['sort=' + ($('#plazaSort').value || 'new')];
    var kw = ($('#plazaSearch').value || '').trim();
    if (kw) p.push('q=' + encodeURIComponent(kw));
    if ($('#plazaMajor').value) p.push('major=' + encodeURIComponent($('#plazaMajor').value));
    if ($('#plazaSubject').value) p.push('subject=' + encodeURIComponent($('#plazaSubject').value));
    if (Plaza.mine) p.push('mine=1');
    return p.join('&');
  }

  function fillTagSelect(sel, list, allLabel) {
    var el = $(sel);
    if (!el) return;
    var cur = el.value;
    el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + list.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    el.value = (cur && list.indexOf(cur) >= 0) ? cur : '';
  }

  function fillDatalist(sel, list) {
    var el = $(sel);
    if (!el) return;
    el.innerHTML = list.map(function (t) { return '<option value="' + esc(t) + '"></option>'; }).join('');
  }

  function loadPlaza(force) {
    if (Plaza.loading) return Promise.resolve();
    if (Plaza.loaded && !force) return Promise.resolve();
    Plaza.loading = true;
    $('#plazaHint').textContent = '正在拉取…';
    return api('GET', '/api/plaza/list?' + plazaQuery()).then(function (j) {
      Plaza.loaded = true;
      Plaza.items = j.items || [];
      Plaza.majors = j.majors || [];
      Plaza.subjects = j.subjects || [];
      Plaza.err = null;
      fillTagSelect('#plazaMajor', Plaza.majors, '全部专业');
      fillTagSelect('#plazaSubject', Plaza.subjects, '全部科目');
      fillDatalist('#majorList', Plaza.majors);
      fillDatalist('#subjectList', Plaza.subjects);
      renderPlazaList();
    }).catch(function (e) {
      Plaza.err = (e && e.message) || '连不上服务器';
      Plaza.items = [];
      renderPlazaList();
    }).then(function () { Plaza.loading = false; });
  }

  function renderPlazaList() {
    var box = $('#plazaList');
    if (!box) return;
    var hint = $('#plazaHint');

    if (Plaza.err) {
      box.innerHTML = '<div class="empty">连不上服务器：' + esc(Plaza.err) +
        '<br>广场要联网才能看，本地题集和练习记录不受影响。</div>';
      hint.textContent = '';
      return;
    }
    if (!Plaza.items.length) {
      var filtered = ($('#plazaSearch').value || '').trim() || $('#plazaMajor').value ||
        $('#plazaSubject').value || Plaza.mine;
      box.innerHTML = '<div class="empty">' + (filtered
        ? '这个条件下还没有题集，换个专业 / 科目或清掉搜索再看看。'
        : '广场还空着 —— 点右上角「分享我的题集」，当第一个。') + '</div>';
      hint.textContent = '';
      return;
    }

    hint.textContent = '共 ' + Plaza.items.length + ' 份' +
      (Plaza.mine ? '（你自己分享的）' : '') +
      ' · 点「加入我的题集」就复制一份到自己这儿，不动原作者的';

    box.innerHTML = Plaza.items.map(function (it) {
      var tags = '';
      if (it.major) tags += '<span class="tag plain">' + esc(it.major) + '</span>';
      if (it.subject) tags += '<span class="tag plain">' + esc(it.subject) + '</span>';
      return '<div class="item plaza-item" data-id="' + esc(it.id) + '">' +
        '<div class="item-main">' +
        '<div class="item-stem">' + esc(it.course) +
        (it.mine ? ' <span class="pill ok">我分享的</span>' : '') + '</div>' +
        '<div class="item-sub">' + tags +
        '<span class="plaza-num">' + it.qCount + ' 题</span>' +
        '<span class="plaza-dot">·</span>' + esc(it.author) +
        '<span class="plaza-dot">·</span>' + (it.downloads || 0) + ' 人取用' +
        '<span class="plaza-dot">·</span>' + fmtDate(it.createdAt) + '</div>' +
        (it.note ? '<div class="plaza-note">' + esc(it.note) + '</div>' : '') +
        '</div>' +
        '<button class="btn primary" data-take="' + esc(it.id) + '">加入我的题集</button>' +
        (it.mine ? '<button class="mini-btn" data-unshare="' + esc(it.id) +
          '" title="从广场撤下">✕</button>' : '') +
        '</div>';
    }).join('');
  }

  // 同一个人重复点同一份：已有就直接切过去，别叠出一堆副本
  function bankFromPlaza(plazaId) {
    return S.banks.filter(function (b) { return b.from && b.from.plazaId === plazaId; })[0] || null;
  }

  function takePlaza(id, btn) {
    var it = Plaza.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var dup = bankFromPlaza(id);
    if (dup) {
      switchBank(dup.id);
      toast('这份你已经取过了，已切到「' + dup.course + '」');
      return;
    }
    if (btn) btn.disabled = true;
    api('POST', '/api/plaza/take', { id: id }).then(function (j) {
      var qs = (j.questions || []).map(function (q, i) { return normQ(q, i); });
      if (!qs.length) throw new Error('这份题集是空的');
      var bank = {
        id: 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        course: j.course + '（广场）',
        questions: qs,
        createdAt: Date.now(),
        from: { plazaId: id, author: j.author, major: j.major, subject: j.subject, at: Date.now() }
      };
      S.banks.push(bank);
      S.cur = bank.id;
      save();
      renderBankSelect();
      it.downloads = (it.downloads || 0) + 1;
      renderPlazaList();
      toast('已加入「' + bank.course + '」，共 ' + qs.length + ' 题');
    }).catch(function (e) {
      toast('取用失败：' + ((e && e.message) || '未知错误'));
    }).then(function () { if (btn) btn.disabled = false; });
  }

  /* ---- 分享 ---- */
  var shareBankId = null;

  function openShare(bankId) {
    if (!Cloud.user) {
      openAuth('login');
      authErr('分享题集要先登录 —— 题集得存到服务器上，别人才能取用');
      return;
    }
    if (!S.banks.length) { toast('还没有题集，先把笔记提炼成题集'); return; }

    var sel = $('#shareBank');
    shareBankId = bankId || S.cur || S.banks[0].id;
    sel.innerHTML = S.banks.map(function (b) {
      return '<option value="' + esc(b.id) + '">' + esc(b.course) + '（' + b.questions.length + ' 题）</option>';
    }).join('');
    if (!S.banks.some(function (b) { return b.id === shareBankId; })) shareBankId = S.banks[0].id;
    sel.value = shareBankId;

    var b = S.banks.filter(function (x) { return x.id === shareBankId; })[0];
    $('#shareMajor').value = b.shareMajor || localStorage.getItem('fq_tag_major') || '';
    $('#shareSubject').value = b.shareSubject || b.course || '';
    $('#shareNote').value = b.shareNote || '';
    $('#shareErr').hidden = true;
    var qn = b.questions.filter(function (q) { return q.stem; }).length;
    $('#shareMeta').textContent = b.shareId ? ('已分享过，改完会覆盖原来那份 · ' + qn + ' 题') : (qn + ' 题');
    $('#shareModal').hidden = false;
    $('#shareMajor').focus();

    if (!Plaza.loaded) loadPlaza();
  }

  function closeShare() {
    var m = $('#shareModal');
    if (m) m.hidden = true;
  }

  function shareErr(msg) {
    var e = $('#shareErr');
    e.textContent = msg;
    e.hidden = false;
  }

  function doShare() {
    var b = S.banks.filter(function (x) { return x.id === shareBankId; })[0];
    if (!b) return;
    var major = ($('#shareMajor').value || '').trim();
    var subject = ($('#shareSubject').value || '').trim();
    var note = ($('#shareNote').value || '').trim();
    if (!major) { shareErr('填一下专业，同学才能按专业找到'); return; }
    if (!subject) { shareErr('填一下科目'); return; }

    var qs = b.questions.filter(function (q) { return q && q.stem; });
    if (!qs.length) { shareErr('这个题集里还没有题'); return; }

    var btn = $('#shareDoBtn');
    btn.disabled = true;
    api('POST', '/api/plaza/share', {
      shareId: b.shareId || '',
      course: b.course,
      major: major,
      subject: subject,
      note: note,
      questions: qs
    }).then(function (j) {
      b.shareId = j.id;
      b.shareMajor = major;
      b.shareSubject = subject;
      b.shareNote = note;
      try { localStorage.setItem('fq_tag_major', major); } catch (e) { /* 存不下就算了 */ }
      save();
      closeShare();
      Plaza.loaded = false;
      loadPlaza(true);
      toast(j.updated ? '已更新广场上的「' + b.course + '」' : '已分享到广场：' + b.course);
    }).catch(function (e) {
      shareErr((e && e.message) || '分享失败，检查一下网络');
    }).then(function () { btn.disabled = false; });
  }

  function unsharePlaza(id) {
    if (!confirm('把这份题集从广场撤下？别人就看不到了，已经取走的副本不受影响。')) return;
    api('POST', '/api/plaza/remove', { id: id }).then(function () {
      S.banks.forEach(function (b) { if (b.shareId === id) delete b.shareId; });
      save();
      Plaza.loaded = false;
      loadPlaza(true);
      toast('已从广场撤下');
    }).catch(function (e) {
      toast('撤下失败：' + ((e && e.message) || '未知错误'));
    });
  }

  $('#plazaShareBtn').addEventListener('click', function () { openShare(); });
  $('#plazaRefreshBtn').addEventListener('click', function () { loadPlaza(true); });
  $('#plazaMineBtn').addEventListener('click', function () {
    Plaza.mine = !Plaza.mine;
    this.classList.toggle('on', Plaza.mine);
    Plaza.loaded = false;
    loadPlaza(true);
  });
  $('#plazaSort').addEventListener('change', function () { Plaza.loaded = false; loadPlaza(true); });
  $('#plazaMajor').addEventListener('change', function () { Plaza.loaded = false; loadPlaza(true); });
  $('#plazaSubject').addEventListener('change', function () { Plaza.loaded = false; loadPlaza(true); });
  $('#plazaSearch').addEventListener('input', function () {
    clearTimeout(plazaSearchTimer);
    plazaSearchTimer = setTimeout(function () { Plaza.loaded = false; loadPlaza(true); }, 280);
  });

  $('#plazaList').addEventListener('click', function (e) {
    var take = e.target.closest('[data-take]');
    if (take) { takePlaza(take.dataset.take, take); return; }
    var un = e.target.closest('[data-unshare]');
    if (un) unsharePlaza(un.dataset.unshare);
  });

  $('#shareModal').addEventListener('click', function (e) {
    if (e.target.dataset && e.target.dataset.shareclose) closeShare();
  });
  $('#shareBank').addEventListener('change', function () {
    var b = S.banks.filter(function (x) { return x.id === this.value; })[0];
    if (!b) return;
    shareBankId = b.id;
    $('#shareMajor').value = b.shareMajor || localStorage.getItem('fq_tag_major') || '';
    $('#shareSubject').value = b.shareSubject || b.course || '';
    $('#shareNote').value = b.shareNote || '';
    var qn = b.questions.filter(function (q) { return q.stem; }).length;
    $('#shareMeta').textContent = b.shareId ? ('已分享过，改完会覆盖原来那份 · ' + qn + ' 题') : (qn + ' 题');
  });
  $('#shareDoBtn').addEventListener('click', doShare);

  // 全局快捷键：Enter 进入下一问
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeCtx(); closeAuth(); closeShare(); }
    if (e.key === 'Enter' && document.activeElement === $('body')) {
      var b = $('#reciteNext') || $('#nextQBtn');
      if (b) { e.preventDefault(); b.click(); }
    }
  });

  /* 供自动化测试调用（不参与界面逻辑） */
  window.FQInternals = {
    buildFromNote: buildFromNote,
    parseBankQuestions: parseBankQuestions,
    extractPoints: extractPoints,
    buildQuestions: buildQuestions,
    splitSentences: splitSentences,
    cleanMark: cleanMark,
    markBold: markBold
  };
})();
