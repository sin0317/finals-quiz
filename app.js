/* =========================================================
   期末刷题 · 把笔记变成题目
   纯前端实现，数据保存在浏览器 localStorage
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 存储键 ---------------- */
  var LS_BANKS = 'fq_banks_v1';
  var LS_STATS = 'fq_stats_v1';
  var LS_SR = 'fq_sr_v1';   // 间隔复习的排期：每组抽题都用它算「该不该来」
  var LS_QUIZ = 'fq_quiz_v1';   // 这场刷题刷到哪了：刷新 / 关页面再开都能接着答
  var LS_LOG = 'fq_log_v1';
  var LS_CUR = 'fq_current_v1';
  var LS_THEME = 'fq_theme_v1';

  /* 版本号：和 package.json、页脚三处保持一致。
     页脚那行字由下面 stampVersion() 用这个值覆盖写一遍 —— 这样页脚显示的是
     「这份 app.js 自己是哪一版」，而不是 HTML 里可能被缓存下来的旧字。
     用户看到 v1.4.1 就说明浏览器确实拿到新脚本了，排查问题时一眼能确认。 */
  var FQ_VERSION = '1.11.0';

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

  /* ---------------- 原卷真题的识别与匹配 ----------------
     用户定死的一条规矩：选择题只能是卷子上的原题，题干、选项、答案
     都以原卷为准；卷子里没考过的知识点挖成填空，不许自己编干扰项。
     所以要先能分清「这道题的选项是卷子给的」还是「系统凑的」。 */

  /* 选项来自原卷的题才算真题。新的数据带 optsSrc 标记；
     早先入库的（还没有这个字段）用「有章节 + 至少两个选项」兜底认。 */
  function isPaperQ(q) {
    if (!q) return false;
    if (q.optsSrc === 'paper') return true;
    return !!q.chapter && !!(q.opts && q.opts.length >= 2);
  }

  /* 题干去掉括号占位和题号，只留用来比对的那截 */
  var STEM_BLANK = /[（(][\s\u3000]*[）)]/g;
  function stemCore(stem) {
    return normalize(String(stem || '').replace(STEM_BLANK, '').replace(/^\s*\d+[.、)）]\s*/, ''));
  }

  /* 笔记句 ↔ 原卷题干的匹配分。
     卷子上的题干往往只是笔记句的前半截
     （「药物协同作用包括」vs「药物协同作用包括相加作用 增强作用 增敏作用」），
     纯 dice 会被长句稀释掉，所以题干被笔记句整个包住时直接判强命中。 */
  function noteScore(stemN, sentN) {
    if (!stemN || !sentN || stemN.length < 6) return 0;
    if (sentN.indexOf(stemN) >= 0) return 0.9 + 0.1 * Math.min(1, stemN.length / 20);
    return dice(stemN, sentN);
  }

  /* 笔记里这件事卷子考过没有：返回 {q, score} 或 null。
     同一条原卷题只让最像的那句笔记认领，别被几句话重复挂上。 */
  var PAPER_HIT = 0.45;
  function findPaperMatch(cand, pool, taken) {
    var sentN = normalize(cand && (cand.source || cand.stem) || '');
    if (!sentN) return null;
    var best = null, bestScore = 0;
    pool.forEach(function (p) {
      if (taken[p.id]) return;
      var s = noteScore(stemCore(p.stem), sentN);
      if (s > bestScore) { bestScore = s; best = p; }
    });
    return (best && bestScore >= PAPER_HIT) ? { q: best, score: bestScore } : null;
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

  /* 简答题：一条要点算一分。
     用户按句/顿号写，句子和哪条要点对得上就算命中 —— 简答不是默写，
     意思到了就行，所以用二元组相似度，不要求字字一致。 */
  function gradeShort(input, points) {
    var pts = (points || []).filter(function (p) { return normalize(p); });
    var I = normalize(input || '');
    if (!I) return { level: 'empty', hits: [], miss: [], ratio: 0, sim: 0, kind: 'short' };
    var sents = String(input).split(/[。；;，,、\n\r]+/).map(normalize).filter(Boolean);
    if (!sents.length) sents = [I];

    var hits = [], miss = [];
    pts.forEach(function (p) {
      var kp = normalize(p);
      if (!kp) return;
      var best = 0;
      sents.forEach(function (u) {
        var s = dice(u, kp);
        if (u.indexOf(kp) >= 0 || kp.indexOf(u) >= 0) {
          s = Math.max(s, Math.min(u.length, kp.length) / Math.max(u.length, kp.length));
        }
        if (s > best) best = s;
      });
      if (I.indexOf(kp) >= 0) best = 1;            // 整段里就写着
      if (best >= 0.45) hits.push({ raw: p }); else miss.push({ raw: p });
    });
    var ratio = pts.length ? hits.length / pts.length : 0;
    var level = ratio >= 0.85 ? 'right' : ratio >= 0.5 ? 'mid' : 'wrong';
    return { level: level, hits: hits, miss: miss, ratio: ratio, sim: dice(I, normalize(pts.join(''))), kind: 'short' };
  }

  /* 名词解释：默写整段解释。整段一字不差不现实，按关键短语命中的比例给分。 */
  function gradeTerm(input, def) {
    var I = normalize(input || ''), D = normalize(def || '');
    if (!I) return { level: 'empty', hits: [], miss: [], ratio: 0, sim: 0, kind: 'term' };
    if (I === D || (D.indexOf(I) >= 0 && I.length / D.length >= 0.6)) {
      return { level: 'right', hits: [{ raw: def }], miss: [], ratio: 1, sim: 1, kind: 'term' };
    }
    var keys = String(def).split(/[、，,；;。：:（）()\s]+/)
      .map(function (x) { return normalize(x); })
      .filter(function (x) { return x.length >= 2; });
    var hit = [], miss = [];
    keys.forEach(function (k) { (I.indexOf(k) >= 0 ? hit : miss).push(k); });
    var ratio = keys.length ? hit.length / keys.length : 0;
    var sim = dice(I, D);
    var level = (ratio >= 0.7 || sim >= 0.65) ? 'right' : (ratio >= 0.35 || sim >= 0.4) ? 'mid' : 'wrong';
    return {
      level: level, ratio: ratio, sim: sim, kind: 'term',
      hits: hit.map(function (k) { return { raw: k }; }),
      miss: miss.map(function (k) { return { raw: k }; })
    };
  }

  function gradeTyped(q, input) {
    if (q.type === 'short') return gradeShort(input, q.answer);
    if (q.type === 'term') return gradeTerm(input, q.answer);
    return gradeAnswer(input, q.answer);
  }


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
    '允许', '禁止', '规定', '要求', '强调', '指出', '阐明', '论述', '分析', '总结', '归纳',
    // 并列/要求类：药学笔记里「应当/具备/符合/满足 + 一串并列项」极多，
    // 少了这几个词整句会被 ⑥ 从顿号处切坏，题干只剩半句
    '应当', '应该', '具备', '具有', '符合', '满足', '需要', '做到', '遵循', '包含', '涵盖'
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
  var FILL_LEAD = /^(又称之为|又称为|被称为|被誉为|简称为|指的是|称为|是指|即为|就是|应当具备|应当|应该|具备|具有|符合|满足|需要|做到|遵循|包括|分为|主要有|是|指|为|即|由)/;
  /* 「……，又称之为」这种，把引导词归到题干，答案才干净。⑤ ⑥ 两条路都要用，
     否则答案会变成「又称之为恒比消除」这种带壳的脏答案 */
  var LIST_LEAD = /^(应当具备|应当|应该|具备|具有|符合|满足|需要|做到|遵循)/;
  function moveLead(left, right) {
    var m = String(right).match(FILL_LEAD);
    if (m && right.slice(m[1].length).trim().length >= 2) {
      var rest = right.slice(m[1].length).trim();
      // 并列引导词只在后面真跟着一串并列项时才并进题干；
      // 否则「应当在 15 日内报告」会被整段当答案，题干又变半句了
      if (LIST_LEAD.test(right) && rest.indexOf('、') < 0) return { left: left, right: right };
      return { left: left + m[1], right: rest };
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

  /* ---------------------------------------------------------
     分节标题：题库/笔记里常见「一、单选题」「二、多选题」「三、填空题」
     「名词解释」「简答题」。同一个句子落在哪个区，题型就不一样 ——
     单选题区里答案就算是一串并列词，也不能出成多选题。
     --------------------------------------------------------- */
  var SECTION_RES = [
    { re: /多选|多项选择|不定项/, kind: 'multi' },
    { re: /单选|单项选择|最佳选择/, kind: 'single' },
    { re: /填空/, kind: 'fill' },
    { re: /判断/, kind: 'judge' },
    { re: /名词解释|简答|问答|论述|案例/, kind: 'open' }
  ];
  // 标题行要短、且不是一道题本身（「下列属于…的是」不算标题）
  function sectionKind(line) {
    var t = String(line).replace(/^[#\s]+/, '').replace(/[（(]\s*\d+\s*[题分][)）]?/g, '').trim();
    if (!t || t.length > 16) return '';
    if (/[。？：]$/.test(t)) return '';
    for (var i = 0; i < SECTION_RES.length; i++) {
      if (SECTION_RES[i].re.test(t)) return SECTION_RES[i].kind;
    }
    return '';
  }

  function splitSentencesWithSection(text) {
    var out = [], sec = '';
    markBold(String(text)).split(/\r?\n/).forEach(function (line) {
      var k = sectionKind(line);
      if (k) { sec = k; return; }   // 标题行本身不出题
      line = line.replace(/^\s*([-*•·]|\d+[.、)）]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.])\s*/, '');
      line.split(/[。！？；;!?]+/).forEach(function (s) {
        s = s.trim();
        if (s) out.push({ s: s, sec: sec });
      });
    });
    return out;
  }

  /* ---------------------------------------------------------
     一个空该挖在哪：答案只能是一个短语，不能是半句话
     ---------------------------------------------------------
     老逻辑从触发词一路挖到句号，「胃酸分泌增多时，____」的答案会是
     「弱酸性药物的吸收增强」——题干看着完整，其实问不出东西，
     而且答案长到要背书。新规则：
       ① 答案 ≤16 字、不以虚词/连接词开头、不挨着并列标点，才算合格；
       ② 不合格就把空往前挪，挖掉前半句末尾那个名词短语，
          后半句原样留在题干里 —— 题干永远是完整句子，答案一口能答。
     --------------------------------------------------------- */
  var ANS_MAX = 16;
  var BAD_ANS_HEAD = /^(的|了|着|和|或|与|及|是|属于|为|包括|分为|主要有|指|如|例如|即|也就是|则|且|并|可|应|需|使|能|会|有|无)/;
  var PUNCT_END = /[、，,；;：:]$/;      // 题干/答案的收尾标点
  var LIST_END = /[、；;：:]$/;          // 空挖在并列项中间（只剩顿号、分号靠后）

  function hanLen(s) { return (String(s).match(/[\u4e00-\u9fa5]/g) || []).length; }

  /* 数字与英文术语是最靠谱的考点：「15 日内」「40%」「CYP3A4」挖掉之后，
     题干整句都在，答案也短，不会出现「新的、____」这种只剩半句的题。
     排在普通规则后面当兜底：普通规则切不出好空时，才用它救这一句。 */
  function numBlank(sent) {
    var re = /(\d+(?:\.\d+)?\s*(?:%|mg|g|ml|mL|L|h|min|日|天|周|月|年|岁|次|种|个|片|IU|mmol\/L)?)|([A-Za-z][A-Za-z0-9\-]{2,})/g;
    var m, best = null;
    while ((m = re.exec(sent))) {
      var raw = String(m[1] || m[2] || '').trim();
      if (raw.length < 2) continue;
      var pre = sent.slice(0, m.index).trim();
      var post = sent.slice(m.index + m[0].length).trim();
      if (hanLen(pre) < 4 || hanLen(post) < 1) continue;
      // 数字夹在括号里（（1分））多半是分值，跳过
      if (/[（(]$/.test(sent.slice(0, m.index)) && /^[）)]/.test(post)) continue;
      best = { left: pre, right: raw, tail: post };
      break;
    }
    return best;
  }

  function fixBlank(left, trig, right, tail) {
    // 名词解释那种「术语：定义」：空就该留在定义上，答案是整句也没关系，
    // 题干里必须留着术语，否则就成了「____：指血浆药物浓度下降一半所需的时间」
    var defLike = (trig === '：' || trig === ':') && hanLen(left) <= 12 && left.indexOf('，') < 0;
    // 「应当/具备 + 一串并列项」：答案是一整组并列词，不是半句话，别拿长度和首字去卡它
    var isList = !!right && right.split(/[、，,]/).length >= 2;
    // 题干以「，」结尾是正常的（「……效应，包括____」），只有顿号/分号才是挖在并列项中间
    if (defLike || (right && (isList || (right.length <= ANS_MAX && !BAD_ANS_HEAD.test(right)))
        && !LIST_END.test(left))) {
      return { left: left, trig: trig, right: right, tail: tail, reversed: false };
    }
    // 反向挖：在前半句里从右往左找一个 2–14 字的名词块
    var seg = String(left).replace(/[、，,；;：:]+$/, '');
    var m = seg.match(/([^、，,；;：:的在对与和或使把将被由从以]{2,14})$/);
    if (!m) return null;
    var phrase = m[1];
    var pre = seg.slice(0, seg.length - phrase.length);
    if (PUNCT_END.test(pre)) return null;       // 还是挖在并列项中间，宁可不出
    if (hanLen(phrase) < 2) return null;
    var post = String(trig || '') + String(right || '') + String(tail || '');
    if (hanLen(post) < 4) return null;          // 空后面得有内容，否则题干没有信息
    return { left: pre, trig: '', right: phrase, tail: post, reversed: true };
  }

  // 「为」当触发词的条件：紧跟着的不是「了/止/什么」，前面也不是「因/认/行」
  function bestWei(sent) {
    var i = sent.lastIndexOf('为');
    if (i < 4) return -1;
    if ('了止什'.indexOf(sent.charAt(i + 1)) >= 0) return -1;
    if ('因认行作'.indexOf(sent.charAt(i - 1)) >= 0) return -1;
    if (sent.slice(i + 1).trim().length < 2) return -1;
    return i;
  }

  function extractPoints(text) {
    var pts = [], seen = {};
    splitSentencesWithSection(text).forEach(function (line) {
      var sent = line.s, sec = line.sec;
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
        } else if (bestWei(sent) >= 0) {
          // ③' 「……为……」：题库里的标准写法（「溶媒为林格氏液」）。
          // 只认最后那个「为」，且前面至少 4 个字，避开「因为/为了/认为」
          var wi = bestWei(sent);
          left = sent.slice(0, wi).trim();
          trig = '为';
          right = sent.slice(wi + 1).trim().replace(/[。.]$/, '');
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

      // 整句一个标点都没有（「急诊处方一般不得超过3日用量」），前面几步都切不出来：
      // 还有一条最稳的路 —— 挖掉里面的数字或英文术语
      if (!right && !boldOK) {
        var nb0 = numBlank(sent);
        if (nb0) {
          left = nb0.left; trig = ''; right = nb0.right; tail = nb0.tail;
          forcedFill = true; reversed = true;
        }
      }
      if (!right) return;
      // 答案只该是一个短语。以前 right 是从触发词一路吃到句尾的：
      // 「适用于高血压，包括 A、B，用药期间需监测血压」的答案会变成
      // 「A、B，用药期间需监测血压」，题干只剩「…包括____」，后半句凭空消失。
      // 这里把答案后面那半句接回题干尾部，题目才读得完整。
      // 加粗是作者亲手标出来的范围，不切。
      var reversed = false;
      if (!boldOK) {
        var cutAt = right.search(/[，,；;]/);
        if (cutAt >= 2) {
          tail = tail + right.slice(cutAt);
          right = right.slice(0, cutAt).trim();
        }
        // 多选题本来就是一串并列项，长度规则另算，不挪空
        var rawPre = right.split(/[、，,]/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
        var mayMulti = rawPre.length >= 2 && rawPre.length <= 6 &&
          rawPre.every(function (s) { return s.length <= 26; }) &&
          ['包括', '分为', '主要有', '：', ':'].indexOf(trig) >= 0;
        if (!mayMulti) {
          var fixed = fixBlank(left, trig, right, tail);
          if (fixed) {
            left = fixed.left; trig = fixed.trig; right = fixed.right; tail = fixed.tail;
            reversed = fixed.reversed;
          } else {
            // 整句都是「一长串并列/半句话」，切不出短语：退一步挖数字或英文术语
            var nb = numBlank(sent);
            if (!nb) return;
            left = nb.left; trig = ''; right = nb.right; tail = nb.tail;
            forcedFill = true; reversed = true;
          }
        }
      }
      // 答案尾巴上的量词（「安全、有效、经济、适当四个要素」）不是考点，接回题干
      var qm = right.match(/([一二三四五六七八九十两\d]+个?(?:要素|方面|环节|阶段|类型|因素|要点|原则|条件|部分|指标|措施|步骤)|等)$/);
      if (qm && right.length > qm[1].length + 1) {
        tail = qm[1] + (tail || '');
        right = right.slice(0, right.length - qm[1].length).trim();
      }
      // 答案开头的介词/副词（「当药物浓度」的「当」）属于题干，挪过去
      var pm = right.match(/^(当|在|对|由|使|于|从|向|把|将)/);
      if (pm && right.length > pm[1].length + 1) {
        left = left + pm[1];
        right = right.slice(pm[1].length).trim();
      }
      // 加粗/反向挖出来的空，前面就算一个字没有也能出题；普通句子前面的引子太短没意义
      // 上限从 30 放宽到 56：长句（「…的效应，包括个体间和个体内变异」）以前整句被丢，
      // 其实出成填空题很好用，只要题干长一点而已
      if ((!boldOK && !reversed && left.length < 2) || left.length > 56) return;
      if (right.length < 1 || right.length > 60) return;
      if (/^[的了和或与及是]$/.test(right)) return;
      var k = left + '|' + right;
      if (seen[k]) return;
      seen[k] = 1;

      var type = 'single', items = null;
      var raw = right.split(/[、，,]/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
      var listOK = raw.length >= 2 && raw.length <= 6 && raw.every(function (s) { return s.length <= 26; });
      if (forcedFill && listOK && sec === 'multi') {
        // 多选题区里的并列句即使是从谓语兜底切出来的，也还是多选
        type = 'multi'; items = raw;
      } else if (forcedFill) {
        // ⑤ 兜底出来的，一律当填空题考：整句太长，硬凑选项反而难看
        type = 'fill';
      } else if (boldOK && listOK) {
        // 加粗里写的是并列内容（**安全、有效、经济、适当**）→ 直接当多选题考
        type = 'multi'; items = raw;
      } else if (listOK && (['包括', '分为', '主要有', '：', ':'].indexOf(trig) >= 0 || (trig === '是' && raw.length >= 3))) {
        type = 'multi'; items = raw;
      }
      /* 分区决定题型：单选题区里就算答案是一串并列词，也不能出成多选；
         多选题只出现在「多选题」那一节里。填空题/名词解释/简答区一律按手打处理。 */
      if (type === 'multi' && sec === 'single') { type = 'single'; items = null; }
      if (sec === 'fill' || sec === 'open' || sec === 'judge') { type = 'fill'; items = null; }
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

  /* 原来这里有个 multiPool()：从同一份笔记的其他题里抓词当干扰项。
     现在不许自造选项了，它没有调用方，一并删掉 —— 留着容易被人再捡起来用。 */

  function buildQuestions(pts) {
    /* 注意：这里**不再自己配干扰项**。
       用户定的规矩是选择题只能用他上传的卷子原题，系统拼出来的
        「正确答案 + 题库里抓几个词」那种题一律不许出。所以笔记提炼
       出来的题都是填空，多个答案就按顿号分隔考。
       笔记里本来就排好的题库（parseBankQuestions，A/B/C/D 是原文写的）
       不经过这里，那些选项是原文自带的，照旧出选择题。 */
    return pts.map(function (p) {
      var stem = cleanMark(p.left + p.t + '____' + (p.tail || ''));
      if (p.type === 'multi') {
        return {
          id: qidOf(p.left + '|' + p.right),
          type: 'fill',
          stem: stem,
          answer: p.items.map(cleanMark),
          opts: [],
          source: cleanMark(p.sent),
          order: p.order
        };
      }
      return {
        id: qidOf(p.left + '|' + p.right),
        type: 'fill',
        stem: stem,
        answer: cleanMark(p.right),
        opts: [],
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
  /* =========================================================
     带分区标题的原卷 → 题目
     ---------------------------------------------------------
     资料长这样，是卷子不是散文：
         一、单选题（58 题）   二、多选题（46 题）
         填空题   名词解释   简答题
     这种内容逐句提炼只会出一堆残句，得按分区定题型。
     规则（用户拍板的）：
       ① 题型由所在分区决定，单选题区里绝不冒多选题
       ② 多选题没写正确项字母 = 全选（笔记没标答案，就是列出的都对）
       ③ 名词解释：题干只留冒号前的名词，答案是整段解释，自己默写
       ④ 简答题：题干就是那个标题，答案是下面那串要点，自己打字答要点
     ========================================================= */
  var PAPER_HEAD = /^[\s\u3000]*[一二三四五六七八九十\d]*\s*[、.．]?\s*(单项选择题|多项选择题|单选题|多选题|填空题|名词解释|问答题|简答题?|判断题|病例分析|案例分析)[\s\u3000]*([（(][^）)]*[）)])?[\s\u3000]*$/;

  function paperKind(line) {
    var s = String(line == null ? '' : line).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    if (!s || s.length > 26) return null;
    if (/^[AB]\s*卷$/.test(s)) return 'skip';         // A卷 / B卷 只是分隔，不是正文
    var m = s.match(PAPER_HEAD);
    if (!m) return null;
    var h = m[1];
    if (/^多项选择|^多选/.test(h)) return 'multi';
    if (/^单项选择|^单选/.test(h)) return 'single';
    if (/^填空/.test(h)) return 'fill';
    if (/^名词解释/.test(h)) return 'term';
    if (/^(简答|问答)/.test(h)) return 'short';
    return 'skip';
  }

  function paperSections(text) {
    var out = [], cur = { kind: null, lines: [] };
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var k = paperKind(line);
      // 「A卷 / B卷」只是一条分隔线，不是新题型：跳过它，但别把这一节切断
      if (k === 'skip') return;
      if (k) { out.push(cur); cur = { kind: k, lines: [] }; return; }
      cur.lines.push(line);
    });
    out.push(cur);
    return out;
  }

  /* 一行里可能挤着好几个选项（「A.减轻恐惧　B.消除反射　C.提高耐受」），
     也可能一行一个。字母必须从 A 起连续，认不出来就返回空 ——
     宁可少切，也不把「D 型不良反应」当成选项 D。 */
  function splitOpts(line, start) {
    var s = String(line == null ? '' : line), hits = [], want = (start || 'A').charCodeAt(0);
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) !== want) continue;
      var next = s.charAt(i + 1);
      // 选项标记：字母后面跟着「.、．:：)」或空白/行尾
      if (next && !/[.．、:：)）\s\u3000]/.test(next)) continue;
      hits.push(i);
      want++;
    }
    if (!hits.length) return [];
    return hits.map(function (at, k) {
      var end = k + 1 < hits.length ? hits[k + 1] : s.length;
      var seg = s.slice(at + 1, end)
        .replace(/^[\s\u3000]+/, '')
        .replace(/^[.．、:：)）]\s*/, '')
        .replace(/[\s\u3000]+$/, '');
      return { letter: String.fromCharCode(65 + k), text: seg.trim(), at: at };
    });
  }

  function isOptLine(line) {
    return /^[A-E][.．、:：\s\u3000]/.test(String(line || '').trim());
  }

  /* 多选题区：题干行 + 紧跟的选项行 → 一道多选题。
     没标正确项就是全选；万一笔记里写了「答案：ABD」，就按标的来。 */
  function parseChoiceSection(lines, kind) {
    var qs = [], rest = [], i = 0;
    while (i < lines.length) {
      var line = String(lines[i] == null ? '' : lines[i]).trim();
      // 空行也要原样还回去：题与题之间的空行是题库解析的分隔依据，吞掉就串题了
      if (!line) { rest.push(lines[i]); i++; continue; }
      // 「题干（ ）答案 A.选项 B.选项」是标准题库格式，parseBankQuestions 认得
      // 答案字母、能保留干扰项，这里别抢它的活
      if (/[（(][\s\u3000]*[）)]/.test(line)) {
        // 题与题之间补一个空行：题库解析靠空行分题，卷子挤成一坨也要能认
        if (rest.length && String(rest[rest.length - 1] || '').trim()) rest.push('');
        rest.push(lines[i]); i++; continue;
      }
      if (isOptLine(line)) { rest.push(lines[i]); i++; continue; }   // 落单的选项行，留给下面兜着

      var stem = line, opts = [];
      var inline = splitOpts(line, 'A');
      if (inline.length >= 2) {
        // 选项挤在题干同一行：「下列属于…的包括A OCT1　B NTCP　C OAT2」
        stem = line.slice(0, inline[0].at).replace(/[：:，,、\s]+$/, '').trim();
        opts = inline;
      }
      var j = i + 1;
      while (opts.length < 8 && j < lines.length) {
        var l2 = String(lines[j] == null ? '' : lines[j]).trim();
        if (!l2) break;
        // 这一行自己就带着题干和选项（「药品不良事件包括A…B…」）：
        // 它是下一题，不是本题漏出来的续行，别把它的选项抢过来
        var own = splitOpts(l2, 'A');
        if (own.length >= 2 && hanLen(l2.slice(0, own[0].at)) >= 4) break;
        var more = splitOpts(l2, String.fromCharCode(65 + opts.length));
        if (!more.length) break;                     // 字母接不上，说明已经出了本题
        opts = opts.concat(more);
        j++;
      }

      var mark = stem.match(/(?:答案|正确答案)\s*[：:]\s*([A-E]{1,6})/);
      var picked = mark ? mark[1].split('') : null;
      if (mark) stem = stem.replace(/(?:答案|正确答案)\s*[：:]\s*[A-E]{1,6}/, '').trim();

      var good = opts.length >= 3 && opts.length <= 8 && hanLen(stem) >= 4 &&
        opts.every(function (o) { return o.text && o.text.length <= 200; });
      // 单选题区不在这里硬猜答案：猜错的题比没题更糟，交给后面按句子提炼
      if (!good || kind === 'single') { rest.push(lines[i]); i++; continue; }

      var all = opts.map(function (o) { return cleanMark(o.text).replace(/[；;，,。.、]+$/, ''); });
      var ans = picked ? all.filter(function (t, k) { return picked.indexOf(opts[k].letter) >= 0; }) : all.slice();
      if (!ans.length) { rest.push(lines[i]); i++; continue; }

      qs.push({
        id: qidOf(cleanMark(stem) + '|' + ans.join('|')),
        type: 'multi',
        stem: cleanMark(stem),
        answer: ans,
        opts: [],
        source: [stem].concat(opts.map(function (o) { return o.letter + '. ' + o.text; })).join('\n'),
        order: 0
      });
      i = j;
    }
    return { qs: qs, rest: rest };
  }

  // 去掉行首的星号/题号、行尾的「（4分）」
  function stripScore(s) {
    return String(s == null ? '' : s)
      .replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]/g, '')
      .trim();
  }
  function stripLead(s) {
    return String(s == null ? '' : s)
      .replace(/^[★☆▲●◆■\s\u3000]+/, '')
      .replace(/^\d{1,2}\s*[、.．]\s*/, '')
      .replace(/^[（(]\s*[一二三四五六七八九十]{1,3}\s*[）)]\s*/, '')
      .trim();
  }
  var PT_PREFIX = /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*|^\d{1,2}\s*[）)]\s*|^[（(]\s*\d{1,2}\s*[）)]\s*|^\d{1,2}\s*[、.．]\s*|^[（(]\s*[一二三四五六七八九十]{1,3}\s*[）)]\s*|^[-—·•]\s*/;

  /* 名词解释 / 填空题：「术语：解释」。
     解释短（≤18 字、没有逗号）挖空考；解释长就当名词解释默写。
     解释里又把术语念一遍（「药物警戒就是研究…」）的，剥掉，只留解释本身。 */
  function parseDefSection(lines, kind) {
    var out = [], rest = [];
    lines.forEach(function (raw) {
      var s = stripScore(stripLead(raw));
      var m = s.length >= 6 ? s.match(/^(.{2,40}?)\s*[：:]\s*(.+)$/) : null;
      // 不是「名词：解释」的句子别扔，原样还回去继续提炼
      if (!m) { if (String(raw || '').trim()) rest.push(raw); return; }
      var termRaw = m[1].trim();
      var def = m[2].trim();
      if (def.indexOf(termRaw) === 0) def = def.slice(termRaw.length).replace(/^(就是|是指|即是|指的是|也就是)/, '是').trim();
      var term = termRaw.replace(/[（(][^）)]*[）)]/g, '').trim() || termRaw;
      if (hanLen(term) < 2 || hanLen(def) < 3) { rest.push(raw); return; }
      // 名词解释区一律默写（题干给名词，自己写出解释）；
      // 填空题区里答案短、没有句内标点的才挖空，长解释同样按默写考
      var brief = kind !== 'term' && hanLen(def) <= 18 && !/[，,。；;]/.test(def);
      out.push({
        id: qidOf(term + '|' + def),
        type: brief ? 'fill' : 'term',
        stem: brief ? term + '：____' : term,
        answer: def,
        opts: [],
        source: stripScore(String(raw)).replace(/^[★☆\s\u3000]+/, ''),
        order: 0
      });
    });
    return { qs: out, rest: rest };
  }

  // 这些词当名词解释的题干毫无意义（它们是简答要点的小标题）
  var VAGUE_TERM = /^(原因|特点|目的|最终目的|主要目的|范围|意义|方法|分类|原则|作用|步骤|内容|表现|危害|处理|治疗|预防|机制|概念|定义|要点|注意事项|基本原则)$/;

  /* 「名词：解释」里的解释得真像一段定义。
     简答题的要点常写成「子标题：a；b；c」的样子（「主观性资料：主诉；病史；…」），
     那不是名词解释，别把要点偷出来当名词解释考。 */
  function defLooksLikeDef(def) {
    if (/[。.]\s*$/.test(def)) return true;
    return /^(指|是|由|通过|以|在|用于|对|表示|又称|即|研究|临床|凡|合格|能够|可以)/.test(def);
  }

  var SHORT_Q_HINT = /(简述|试述|论述|叙述|阐述|哪些|什么|如何|为什么|原则|意义|措施|方法|包括|区别|联系|分类|要点|作用|指征|因素|步骤)/;

  function isShortStem(s) {
    var t = stripScore(stripLead(s));
    if (/^[★☆]/.test(s)) return true;
    // 「…有哪些？」「…包括哪些?」这类直接就是题干
    if (/[？?]\s*$/.test(t) && hanLen(t) >= 4) return true;
    if (/^(简述|试述|论述|叙述|阐述)\S/.test(t) && hanLen(t) >= 5) return true;
    if (/^\d{1,2}\s*[、.．]/.test(s) && SHORT_Q_HINT.test(t)) return true;
    return false;
  }

  /* 简答题区：★标题（或「1、简述…」）+ 下面一串要点。
     题干只留标题，要点逐条收进来 —— 用户手打答要点，按命中几条判分。 */
  function parseShortSection(lines) {
    var qs = [], cur = null, buf = [], terms = [];

    function flush() {
      if (!cur) return;
      var pts = [];
      buf.forEach(function (p) {
        var t = stripScore(stripLead(p)).replace(PT_PREFIX, '').replace(/[；;，,。.、]+$/, '').trim();
        if (!t || hanLen(t) < 2) return;
        // 「范围：」「（一）药物相关因素」这种半截小标题，并到上一条里，别单独成要点
        if (pts.length && hanLen(t) < 4) { pts[pts.length - 1] += '；' + t; return; }
        pts.push(t);
      });
      if (pts.length >= 2 && hanLen(cur.stem) >= 4) {
        qs.push({
          id: qidOf('S' + cur.stem),
          type: 'short',
          stem: cur.stem,
          answer: pts.slice(0, 14),
          opts: [],
          source: [cur.stem].concat(pts).join('\n'),
          order: 0
        });
      }
      cur = null; buf = [];
    }

    lines.forEach(function (raw) {
      var s = String(raw == null ? '' : raw).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      if (!s) return;                                  // 空行不切题：简答之间常有空行
      // B 卷常常不再写「名词解释」标题，直接接着写「1、处方：是指…」。
      // 「短术语 + 长解释」这种行还是名词解释 —— 必须在题干判断之前拦下来，
      // 否则「姑息疗法：…治疗方法」会因为句子里有「方法」被当成简答题干。
      var mm = s.replace(/^\d{1,2}\s*[、.．]\s*/, '').match(/^(.{2,14}?)\s*[：:]\s*(.{24,})$/);
      if (mm && !/[①②③④⑤⑥⑦⑧⑨⑩]/.test(s) && hanLen(mm[1]) >= 2 &&
          !VAGUE_TERM.test(mm[1]) && defLooksLikeDef(mm[2])) {
        terms.push({ term: mm[1].replace(/[（(][^）)]*[）)]/g, '').trim(), def: stripScore(mm[2]).trim() });
        return;
      }
      if (isShortStem(s)) {
        flush();
        cur = { stem: stripScore(stripLead(s)).replace(/[：:]\s*$/, '').trim() };
        return;
      }
      if (cur) buf.push(s);
    });
    flush();
    return { qs: qs, terms: terms };
  }

  /* 整份原卷：按分区解析，没认出来的行原样还回去（后面还有老的提炼流程兜着） */
  function parsePaper(text) {
    var secs = paperSections(text);
    var all = [], rest = [], seen = {};

    function push(qs) {
      qs.forEach(function (q) {
        var k = normalize(q.stem) + '|' + normalize(answerText(q));
        if (seen[k]) return;                            // 名词解释和填空题区常重复同一条
        seen[k] = 1;
        q.order = all.length;
        all.push(q);
      });
    }

    secs.forEach(function (sec) {
      var k = sec.kind;
      if (k === 'multi') {
        var r = parseChoiceSection(sec.lines, 'multi');
        push(r.qs);
        // 区名留在正文里，提炼时才知道「这一段是多选题区」。
        // 用【】包住是故意的：parseBankQuestions 认不出它，就不会在这里截断；
        // 出了它那道门再翻译成标准区名交给 extractPoints。
        rest = rest.concat(['【多选】'], r.rest);
      } else if (k === 'term' || k === 'fill') {
        var rd = parseDefSection(sec.lines, k);
        push(rd.qs);
        if (rd.rest.length) rest = rest.concat([k === 'term' ? '【名词解释】' : '【填空】'], rd.rest);
      } else if (k === 'short') {
        var rs = parseShortSection(sec.lines);
        push(rs.qs);
        push(rs.terms.map(function (t) {
          return {
            id: qidOf(t.term + '|' + t.def), type: 'term', stem: t.term,
            answer: t.def, opts: [], source: t.term + '：' + t.def, order: 0
          };
        }));
      } else {
        rest = rest.concat(sec.lines);
      }
    });

    return { questions: all, rest: rest.join('\n') };
  }

  /* =========================================================
     导入原卷：按试卷格式解析
     ---------------------------------------------------------
     原卷不是标准题库格式，长这样：

         单选题（每题2分）
         药物治疗的核心问题是（     ）A
         A、合理用药            B、获得最佳疗效
         2. 新的、严重的ADR应当在（  ）日内报告   D
         0   B. 1    C. 7   D.15

     答案的两种写法都认：印在括号后面（`（　）A`，可以隔着半句话）、
     或者直接印在括号里（`（A）`、`（A、C）`）。特点：选项一行两个、
     甚至某一项缺标号、长选项还跨行。这一层只做「照着原卷抄」，
     不改写、不提炼、不猜题意 —— 抄错了用户在「✎ 改题」里还能修。
     ========================================================= */
  var PAPER_SEC = [
    { k: 'single', re: /^(?:[一二三四五六七八九十]+\s*[、.．]|\d+\s*[、.．])?\s*(?:单项?选择|单选题|选择题)/ },
    { k: 'multi', re: /^(?:[一二三四五六七八九十]+\s*[、.．]|\d+\s*[、.．])?\s*(?:多项?选择|多选题)/ },
    { k: 'term', re: /^(?:[一二三四五六七八九十]+\s*[、.．]|\d+\s*[、.．])?\s*名词解释/ },
    { k: 'short', re: /^(?:[一二三四五六七八九十]+\s*[、.．]|\d+\s*[、.．])?\s*(?:简答|问答|论述)/ },
    { k: 'fill', re: /^(?:[一二三四五六七八九十]+\s*[、.．]|\d+\s*[、.．])?\s*填空题/ },
    { k: 'judge', re: /^(?:[一二三四五六七八九十]+\s*[、.．]|\d+\s*[、.．])?\s*判断/ }
  ];
  /* 空括号「（　）」和「答案印在括号里」的「（A）」「（A、C）」都算题干上的空位。
     只认括号里全是选项字母的，避免把「（A型题）」「（B超）」这种正文误当空位。 */
  var PAPER_ANS_IN = /[（(][\s\u3000]*([A-Ea-e](?:[\s\u3000]*[、,，\/和]?[\s\u3000]*[A-Ea-e]){0,4})[\s\u3000]*[）)]/;
  var PAPER_BLANK = /[（(][\s\u3000]*[）)]/;
  var PAPER_NUM = /^\s*\d+\s*[.、．)）]\s*/;
  // 以「A、」「B.」开头的行是选项，哪怕里面带括号也不能当题干
  var PAPER_OPT_START = /^\s*[A-E]\s*[、.．。\)）]/;

  function paperSecKind(line) {
    var t = String(line || '').trim();
    if (!t || t.length > 30) return null;                 // 标题都很短
    for (var i = 0; i < PAPER_SEC.length; i++) {
      if (PAPER_SEC[i].re.test(t) && !PAPER_BLANK.test(t)) return PAPER_SEC[i].k;
    }
    return null;
  }

  /* 题干后面那个答案字母。括号后面的正文里也可能有孤立大写字母，
     所以只在「不是字母也不是汉字」的边界上认，避免把「维生素D」当成 D 项。
     答案有两种写法，都认：
         药物治疗的核心问题是（     ）A     ← 印在括号后面（可隔半句话）
         药物治疗的核心问题是（A）           ← 印在括号里面
     括号里写了就优先用括号里的，不再去后面找。 */
  function paperAnswerOf(line) {
    var s = String(line);
    var inParen = s.match(PAPER_ANS_IN);
    if (inParen) return inParen[1].replace(/[^A-Ea-e]/g, '').toUpperCase();
    var m = s.match(PAPER_BLANK);
    if (!m) return '';
    var rest = s.slice(m.index + m[0].length);
    var re = /(^|[^A-Za-z0-9\u4e00-\u9fa5])([A-E]{1,5})(?![A-Za-z0-9])/;
    var k = rest.match(re);
    return k ? k[2] : '';
  }

  /* 题干去掉题号、去掉答案字母、括号统一成（　） */
  function paperStemOf(line) {
    var t = String(line).replace(PAPER_NUM, '').trim();
    // 答案印在括号里：先把「（A）」换成「（　）」，后面按尾随字母切尾巴的逻辑
    // 才不会把括号里的那个 A 当成句子尾巴切掉半个题干
    var inner = PAPER_ANS_IN.test(t);
    if (inner) t = t.replace(PAPER_ANS_IN, '（　）');
    var ans = inner ? '' : paperAnswerOf(t);
    if (ans) {
      // 右侧连着答案的那一小截切掉（可能是「A」「。C」「 ABC」）
      var i = t.lastIndexOf(ans);
      var head = t.slice(0, i).replace(/[\s\u3000]*[。．.、，,;；:：]?[\s\u3000]*$/, '');
      t = head || t;
    }
    t = t.replace(/[（(][\s\u3000]*[）)]/g, '（　）')
         .replace(/[（(][\s\u3000]+[）)]/g, '（　）')
         .replace(/[\s\u3000]{2,}/g, ' ')
         .trim();
    return t;
  }

  /* 一行里可能并排好几个选项：A、xx   B、yy。也可能是「0   B. 1  C. 7」——
     第一项缺标号，得算成 A。 */
  function paperSplitOpts(line) {
    var t = String(line);
    var re = /([A-E])\s*[、.．。\)）]\s*/g;
    var marks = [], m;
    while ((m = re.exec(t))) {
      // 前面的字符也是字母数字时，这个「字母 + 括号」是正文不是标号：
      // 选项写成「D、（AC）均正确」时，里面的「C）」会被误当成 C 项
      var prev = m.index > 0 ? t.charAt(m.index - 1) : '';
      if (/[A-Za-z0-9]/.test(prev)) continue;
      marks.push({ letter: m[1], at: m.index, textAt: m.index + m[0].length });
    }
    if (!marks.length) return [];
    var out = [];
    var head = t.slice(0, marks[0].at).trim();
    if (head) out.push({ letter: '', text: head });
    marks.forEach(function (mk, i) {
      var end = i + 1 < marks.length ? marks[i + 1].at : t.length;
      var txt = t.slice(mk.textAt, end).trim();
      out.push({ letter: mk.letter, text: txt });
    });
    return out.filter(function (o) { return o.text; });
  }

  /* 选择题块：按题干行切题，题干后面到下一个题干之前都是选项 */
  function paperChoiceQs(lines, kind) {
    var qs = [], warn = [];
    var cur = null;

    function flush() {
      if (!cur) return;
      var opts = cur.opts.filter(function (o) { return o.text; });
      var letters = cur.letters;
      if (!letters) {
        warn.push({ why: '缺答案', stem: cur.stem.slice(0, 30) });
        cur = null; return;
      }
      if (opts.length < 2) {
        warn.push({ why: '选项不足两项', stem: cur.stem.slice(0, 30) });
        cur = null; return;
      }
      var idx = letters.split('').map(function (c) { return c.charCodeAt(0) - 65; });
      var bad = idx.filter(function (i) { return i >= opts.length; });
      if (bad.length) {
        warn.push({ why: '答案字母超出选项', stem: cur.stem.slice(0, 30) });
        cur = null; return;
      }
      var texts = idx.map(function (i) { return opts[i].text; });
      // 按「答案给了几个字母」判单选多选，比按分段标题判更准 ——
      // 原卷里多选题区偶尔只有一道正确答案（老师漏标），那时候按单选出更实用
      var multi = texts.length > 1;
      if (multi) {
        qs.push({
          type: 'multi', stem: cur.stem, answer: texts,
          opts: opts.map(function (o) { return o.text; }),
          // optsSrc: 选项是卷子印的，不是系统凑的 —— 出题时据此放行选择题
          optsSrc: 'paper',
          source: cur.stem, order: qs.length
        });
      } else {
        qs.push({
          type: 'single', stem: cur.stem, answer: texts[0],
          opts: opts.map(function (o) { return o.text; }),
          optsSrc: 'paper',
          source: cur.stem, order: qs.length
        });
      }
      cur = null;
    }

    lines.forEach(function (raw) {
      var line = String(raw || '').trim();
      if (!line) return;

      if ((PAPER_BLANK.test(line) || PAPER_ANS_IN.test(line)) && !PAPER_OPT_START.test(line)) {
        flush();
        cur = { stem: paperStemOf(line), letters: paperAnswerOf(line), opts: [], rawLines: [] };
        // 题干和第一个选项挤在同一行的（「…（ ）A  A.xxx」）后面再切
        var after = line.slice(line.indexOf(')') >= 0 ? 0 : 0);
        void after;
        return;
      }
      if (!cur) return;

      var segs = paperSplitOpts(line);
      if (segs.length) {
        cur.rawLines.push({ line: line, segs: segs });
        segs.forEach(function (sg) { cur.opts.push(sg); });
      } else {
        // 没有任何标号：先记下来，最后再判断是「续行」还是「缺标号的选项」
        cur.rawLines.push({ line: line, segs: [] });
        cur.opts.push({ letter: '', text: line, bare: true });
      }
    });
    flush();
    return { qs: qs, warn: warn };
  }

  function parsePaperDoc(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var chapter = '';
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      var t = (lines[i] || '').trim();
      if (/^第[一二三四五六七八九十百]+章/.test(t) || /^第[一二三四五六七八九十百]+章/.test(t.replace(/\s+/g, ''))) {
        chapter = t; break;
      }
    }
    if (!chapter) {
      for (var j = 0; j < Math.min(lines.length, 4); j++) {
        var v = (lines[j] || '').trim();
        if (v && v.length < 40) { chapter = v; break; }
      }
    }

    // 按题型标题切块
    var blocks = [], curKind = '', buf = [];
    lines.forEach(function (raw) {
      var line = String(raw || '');
      var k = paperSecKind(line);
      if (k) {
        if (curKind && buf.length) blocks.push({ kind: curKind, lines: buf.slice() });
        else if (!curKind && buf.length) blocks.push({ kind: 'free', lines: buf.slice() });
        curKind = k; buf = [];
        return;
      }
      buf.push(line);
    });
    if (buf.length) blocks.push({ kind: curKind || 'free', lines: buf.slice() });

    var qs = [], warn = [];
    blocks.forEach(function (b) {
      if (b.kind === 'single' || b.kind === 'multi') {
        var r = paperChoiceQs(b.lines, b.kind);
        r.qs.forEach(function (q) { q.order = qs.length; qs.push(q); });
        r.warn.forEach(function (w) { warn.push(w); });
      } else if (b.kind === 'term') {
        qs = qs.concat(paperTermQs(b.lines)).map(function (q, i) { q.order = i; return q; });
      } else if (b.kind === 'short') {
        qs = qs.concat(paperShortQs(b.lines)).map(function (q, i) { q.order = i; return q; });
      }
    });

    var stats = { single: 0, multi: 0, term: 0, short: 0, fill: 0 };
    qs.forEach(function (q) { stats[q.type] = (stats[q.type] || 0) + 1; });
    return { chapter: chapter, questions: qs, stats: stats, warn: warn };
  }

  /* 名词解释块：一行一条「术语：解释」。解释里本来就有逗号顿号，只认第一个冒号。
     没有冒号的行往前一条的解释后面接 —— 原卷排版换行很随意。 */
  function paperTermQs(lines) {
    var out = [], cur = null;
    function flush() {
      if (!cur) return;
      var term = cur.term.trim();
      var def = cur.def.replace(/[（(]\s*\d+\s*分\s*[）)]/g, '').replace(/\s+/g, ' ').trim();
      if (term && def && term.length <= 30) {
        out.push({
          type: 'term', stem: term, answer: def,
          opts: [], source: term + '：' + def, order: out.length
        });
      }
      cur = null;
    }
    lines.forEach(function (raw) {
      var line = String(raw || '').trim();
      if (!line) return;
      var m = line.match(/^([^：:]{2,30})[：:]\s*(.+)$/);
      if (m) { flush(); cur = { term: m[1], def: m[2] }; }
      else if (cur) { cur.def += ' ' + line; }
      else if (line.length > 8) { cur = { term: line.slice(0, 12), def: line }; }
    });
    flush();
    return out;
  }

  /* 简答的题干长什么样？
     · 以「（10分）」（8 分以上）结尾，后面可能跟个年份「2025」
     · 以问号结尾
     · 以「简述/试述/何谓…」开头且不长
     要点行同样可能带（1分）（2分），所以分值低于 6 分的一律不当题干 ——
     不然「病人能自行判断并准确选择（1分）」会被当成下一道题，上一题只剩个「特点」。 */
  var PAPER_POINT_HEAD = /^\s*(?:\d+\s*[）).、．]|[（(]\s*[一二三四五六七八九十]+\s*[）)]|[①-⑩]|[a-zA-Z][）)])/;
  var PAPER_ASK = /^\s*(?:简述|试述|论述|说明|试比较|试分析|何谓|什么是|什么|哪些|如何|为什么|请|谈|列举|概括|归纳|比较)/;

  function paperIsShortStem(line) {
    if (PAPER_POINT_HEAD.test(line)) return false;
    var m = line.match(/[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]\s*((19|20)\d{2}\s*)?$/);
    if (m) return parseFloat(m[1]) >= 6;
    if (/[？?]\s*$/.test(line)) return true;
    if (PAPER_ASK.test(line) && line.length <= 60) return true;
    return false;
  }

  /* 原卷常把好几个要点挤在一行（「1）…（1分）；2）…（1分）」），
     拆开才数得清答中了几条。行首得是编号才算，正文里出现的「（1）」不动。 */
  function paperSplitPoints(line) {
    var re = /(\d+\s*[）).、．]|[①-⑩]|[（(]\s*[一二三四五六七八九十]+\s*[）)])/g;
    var marks = [], m;
    while ((m = re.exec(line))) marks.push({ at: m.index });
    if (marks.length < 2) return [line];
    if (line.slice(0, marks[0].at).trim()) return [line];
    var out = [];
    marks.forEach(function (mk, i) {
      var end = i + 1 < marks.length ? marks[i + 1].at : line.length;
      var seg = line.slice(mk.at, end).trim().replace(/[；;、,，]\s*$/, '');
      if (seg) out.push(seg);
    });
    return out.length >= 2 ? out : [line];
  }

  /* 简答块：题干以「（10分）」或问号结尾；后面的编号句子是要点 */
  function paperShortQs(lines) {
    var out = [], cur = null;
    function flush() {
      if (!cur) return;
      var stem = cur.stem.replace(/[（(]\s*\d+\s*分\s*[）)]/g, '')
        .replace(/\s*\b(19|20)\d{2}\s*$/, '').replace(/\s+/g, ' ').trim();
      var pts = cur.pts.map(function (x) {
        return x.replace(/^\s*(?:\d+\s*[）).、．]|\(\s*\d+\s*\)|（\s*[一二三四五六七八九十]+\s*）|[①-⑩])\s*/, '').trim();
      }).filter(Boolean);
      if (stem && pts.length) {
        out.push({
          type: 'short', stem: stem, answer: pts,
          opts: [], source: stem + '：' + pts.join('；'), order: out.length
        });
      }
      cur = null;
    }
    lines.forEach(function (raw) {
      var line = String(raw || '').trim();
      if (!line) return;
      var isStem = paperIsShortStem(line);
      if (isStem) { flush(); cur = { stem: line, pts: [] }; return; }
      if (cur) paperSplitPoints(line).forEach(function (x) { cur.pts.push(x); });
    });
    flush();
    return out;
  }

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
      // 但区名得留下：后面要靠它判断「这一节的题不许出成多选」
      out += '\n' + name + '\n' + seg;
    }
    return out;
  }

  /* 提炼入口，三层依次兜底：
     ① 标准题库（题干（ ）答案 A.选项…）→ 原样还原，干扰项都留着
     ② 原卷分区（多选全选 / 名词解释默写 / 简答答要点）→ 按分区出题
     ③ 剩下的散文 → 逐句提炼填空
     顺序不能反：先还原的能保住干扰项，让 ② 先跑会把 ① 的题抢走。 */
  function buildFromNote(text) {
    var paper = parsePaper(text);
    var qs = paper.questions.slice();

    var parsed = parseBankQuestions(paper.rest);
    parsed.questions.forEach(function (q) { q.order = qs.length; qs.push(q); });

    // 【多选】这类标记是给 parsePaper 内部用的，到了提炼引擎门口要换成它认的区名
    var rest = parsed.rest.replace(/【(多选|名词解释|简答|填空|单选)】/g, function (m, k) {
      return k === '多选' ? '多选题' : k === '单选' ? '单选题' : k === '填空' ? '填空题' : k;
    });
    if (rest.trim()) {
      var pts = extractPoints(rest);
      var extra = buildQuestions(pts);
      extra.forEach(function (q, i) { q.order = qs.length + i; });
      qs = qs.concat(extra);
    }

    // 同一道题被两个流程各出一遍（原卷里「名词解释」和「填空题」内容一样很常见）
    var seen = {};
    return qs.filter(function (q) {
      var k = normalize(q.stem) + '|' + normalize(answerText(q));
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).map(function (q, i) { q.order = i; return q; });
  }

  /* =========================================================
     用户反馈：这道题该怎么出
     ---------------------------------------------------------
     解析器再聪明也会猜错（空挖多了、题干预感被截断、名词解释被当成填空）。
     与其让人回头改笔记原文再重新提炼一遍，不如在刷题时直接说一句
     「这题应该这么考」，把改法记在这道题上：
         q.fix = { type, stem, answer, opts, note, at }
     之后不管刷题、背卡片、错题本还是导出，都按 q.fix 来 —— 这就是
     「下次这个知识点按用户反馈出题」。
     原始解析结果先备份进 q.orig，点「恢复系统原样」能还原。
     ========================================================= */
  var FIX_TYPES = ['fill', 'single', 'multi', 'term', 'short'];

  /* 答案怎么拆，每种题型不一样 —— 拆错了判分全乱：
       fill  多个空按顺序来，顿号分隔；只有一个空就是一个整体
       single/term  整体（解释里本来就有逗号，不能拆）
       multi 正确项之间顿号/逗号
       short 要点按行或分号，逗号不拆（要点内部常带逗号） */
  function fixAnswerOf(type, text) {
    var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
    var parts;
    if (!t) return type === 'multi' || type === 'short' ? [] : '';
    if (type === 'multi') {
      parts = t.split(/[、，,;；\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      return parts;
    }
    if (type === 'short') {
      parts = t.split(/\n+|[；;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      return parts;
    }
    if (type === 'fill') {
      parts = t.split(/[、\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      return parts.length > 1 ? parts : (parts[0] || '');
    }
    return t;
  }

  /* 从题库里凑干扰项：把别的题的答案拿来当错项，够用就行 */
  function fixOpts(corrects, exclude) {
    var pool = [];
    getQs().forEach(function (o) {
      if (o === exclude) return;
      (Array.isArray(o.answer) ? o.answer : [o.answer]).forEach(function (a) {
        if (a) pool.push(String(a));
      });
    });
    var list = (Array.isArray(corrects) ? corrects : [corrects]).map(String);
    return pickDistractors(list, pool, 2).map(cleanMark);
  }

  /* 一道选择题渲染时用的选项（还没打乱）。
     用户教过的题，fix.opts 就是完整的四（五）个选项，里面本来就含正确答案，
     再和 answer 拼一次会出现「血浆 / 尿液 / 脑脊液 / 汗液 / 脑脊液」这种重复项；
     只有系统自己凑的干扰项才是「不含答案」的，才需要拼。 */
  function choiceOptions(q, isMulti) {
    var list;
    if (q.fix && q.fix.opts && q.fix.opts.length) list = q.fix.opts.slice();
    else list = (isMulti ? (q.answer || []).slice() : [q.answer]).concat(q.opts || []);
    var ansArr = Array.isArray(q.answer) ? q.answer : [q.answer];
    ansArr.forEach(function (a) {
      if (a && !list.some(function (o) { return sameOpt(o, a); })) list.push(a);
    });
    var out = [];
    list.forEach(function (o) {
      var t = String(o == null ? '' : o).trim();
      if (t && !out.some(function (x) { return sameOpt(x, t); })) out.push(t);
    });
    return out;
  }

  /* 两个选项算不算同一个：全等，或者一方把另一方整个包住
     （原卷常见「剂量相关型不良反应」与「剂量相关型不良反应，为药理作用增强所致」） */
  function sameOpt(a, b) {
    var x = normalize(cleanMark(a)), y = normalize(cleanMark(b));
    if (!x || !y) return false;
    return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
  }

  /* 面板里的选项行。勾上的是正确答案。
     顺序上优先用「用户上次给的选项」→「题目自带的选项」→「题库凑的干扰项」，
     所以改过一次之后再打开，看到的还是自己那四个。 */
  function fixOptRows(q, answer) {
    var list = [];
    if (q.fix && q.fix.opts && q.fix.opts.length) list = q.fix.opts.slice();
    else if (q.opts && q.opts.length >= 2) list = q.opts.slice();
    var ansArr = (Array.isArray(answer) ? answer : [answer]).map(String).filter(Boolean);
    // 正确答案必须出现在选项里，否则渲染出来根本勾不到
    ansArr.forEach(function (a) {
      if (!list.some(function (o) { return sameOpt(o, a); })) list.push(a);
    });
    if (list.length < 2) {
      fixOpts(ansArr, q).forEach(function (d) {
        if (!list.some(function (o) { return sameOpt(o, d); })) list.push(d);
      });
    }
    return list.map(function (text) {
      return { text: String(text), on: ansArr.some(function (a) { return sameOpt(text, a); }) };
    });
  }

  /* 把 q.fix 落到题上。所有展示、判分都读改后的字段，所以只要在
     加载题库时统一跑一遍，别的地方一行都不用动。 */
  function applyFix(q) {
    if (!q) return q;
    if (!q.fix) { if (q.orig) restoreOrig(q); return q; }
    if (!q.orig) {
      q.orig = {
        type: q.type,
        stem: q.stem,
        answer: Array.isArray(q.answer) ? q.answer.slice() : q.answer,
        opts: (q.opts || []).slice()
      };
    }
    var f = q.fix;
    q.type = FIX_TYPES.indexOf(f.type) >= 0 ? f.type : q.orig.type;
    q.stem = String(f.stem || q.orig.stem || '');
    q.answer = Array.isArray(f.answer) ? f.answer.slice() : f.answer;
    if (f.opts && f.opts.length) q.opts = f.opts.slice();
    else if (q.type === 'single' || q.type === 'multi') q.opts = fixOpts(q.answer, q);
    return q;
  }

  function restoreOrig(q) {
    if (!q || !q.orig) return q;
    q.type = q.orig.type;
    q.stem = q.orig.stem;
    q.answer = Array.isArray(q.orig.answer) ? q.orig.answer.slice() : q.orig.answer;
    q.opts = (q.orig.opts || []).slice();
    delete q.orig;
    return q;
  }

  /* 每次打开题集都把反馈跑一遍：云端同步 / 换设备 / 刷新之后改法还在 */
  function applyAllFixes() {
    S.banks.forEach(function (b) {
      (b.questions || []).forEach(function (q) { applyFix(q); });
    });
  }

  function saveFix(q, fix) {
    if (!q) return null;
    q.fix = fix;
    // 之前已经备份过 orig 就不要覆盖，否则「恢复原样」会恢复成改过的版本
    applyFix(q);
    save();
    return q;
  }

  function clearFix(q) {
    if (!q) return null;
    delete q.fix;
    restoreOrig(q);
    save();
    return q;
  }

  /* ---------------- 状态 ---------------- */
  /* 间隔复习的排期。round 是「第几组」，items 里每道题记连对次数和到期组号。
     存在 localStorage 里：关掉页面明天再来，做对的题也不会立刻又冒出来。 */
  var SR = { round: 0, items: {} };

  var S = {
    banks: [],
    stats: {},
    log: [],
    cur: null,
    preview: [],
    view: 'import',
    quiz: null,
    recite: null,
    noteRaw: null,
    inputMode: 'note',        // 'note' 提炼笔记 / 'paper' 照抄原卷
    paperInfo: null,          // 上一次原卷解析的统计（跳过了几道、为什么）
    paperMatch: null,         // 上一次笔记解析里对上了几道卷子原题
  };

  function save() {
    try {
      localStorage.setItem(LS_BANKS, JSON.stringify(S.banks));
      localStorage.setItem(LS_STATS, JSON.stringify(S.stats));
      localStorage.setItem(LS_LOG, JSON.stringify(S.log));
      localStorage.setItem(LS_SR, JSON.stringify(SR));
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
      var sr = JSON.parse(localStorage.getItem(LS_SR) || 'null');
      if (sr && typeof sr === 'object') SR = { round: sr.round || 0, items: sr.items || {} };
      S.cur = localStorage.getItem(LS_CUR) || '';
      var th = localStorage.getItem(LS_THEME);
      if (th) document.documentElement.setAttribute('data-theme', th);
    } catch (e) { S.banks = []; S.stats = {}; S.log = []; }
    if (S.banks.length && !S.banks.some(function (b) { return b.id === S.cur; })) S.cur = S.banks[0].id;
    applyAllFixes();
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
  /* 间隔复习的间隔：答对一次隔 1 组再来，连对 2 次隔 3 组，连对 3 次隔 7 组
     （这场基本就不见了）。「隔 N 组」= 中间空过 N 组，所以到期组号是 rn + N + 1。 */
  function srGap(streak) {
    if (streak <= 0) return 0;
    if (streak === 1) return 2;
    if (streak === 2) return 4;
    return 8;
  }

  /* 按这次作答重排「这题下次什么时候来」。答错的、只答对一半的，下一组必来。 */
  function srApply(qid, level) {
    var it = SR.items[qid] || { streak: 0, due: 0, seen: 0 };
    it.seen = (it.seen || 0) + 1;
    it.last = Date.now();
    if (level === 'right') {
      it.streak = (it.streak || 0) + 1;
      // 已经算「已掌握」的题，这轮就别再塞回来了
      it.due = SR.round + (getStat(qid).mastered ? 99 : srGap(it.streak));
    } else {
      it.streak = 0;
      it.due = SR.round + 1;
    }
    SR.items[qid] = it;
  }

  function recordAnswer(qid, level, opts) {
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
    // 答对了就记进这场刷题的「过关名单」，后面的组里不再重复抽它（「一路推新题」模式用）。
    // 只认 right：简答「部分正确」还得再看一遍，不能算过。
    if (level === 'right') DRILL.done[qid] = 1;
    // 间隔复习的排期要用刚更新过的掌握度，所以放在这里；背知识点不参与排期
    if (opts && opts.sr) srApply(qid, level);
    save();
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(name) {
    S.view = name;
    // 换页时把改题面板收起来：面板是挂在这一页里的，留着会跟着切回来一起出现，
    // 里面还停在上一页那道题上，容易被当成新题的改法
    closeFixPanel();
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

  // 题干：有空就把空画成下划线；没有空（简答/名词解释）就原样显示。
  // 以前对谁都补一个空，结果这两类题的题干后面被填上答案，看着像题干的一部分。
  function stemHtml(q) {
    var stem = typeof q === 'string' ? q : (q && q.stem) || '';
    var s = esc(stem);
    // 简答/名词解释本来就没有空；多选题的题干是个问句，也不该拖一条下划线
    if (typeof q !== 'string' && (isTypedQ(q) || (q.type === 'multi' && s.indexOf('____') < 0))) return s;
    // 用户教过的选择题：答案在选项里，题干既不该补空，残留的 ____ 也换成括号
    if (typeof q !== 'string' && q.fix && (q.type === 'single' || q.type === 'multi')) {
      return s.replace(/_{2,}/g, '（　）');
    }
    // 题干里本来就有「（　）」占位的（原卷录进来的选择题都长这样），别再拖一条下划线
    if (s.indexOf('____') < 0 && /[（(]\s*[）)]/.test(stem)) return s;
    if (s.indexOf('____') < 0) s += '<span class="blank-mark">____</span>';
    else s = s.replace(/____/g, '<span class="blank-mark">________</span>');
    return s;
  }
  function answerText(q) { return Array.isArray(q.answer) ? q.answer.join('、') : q.answer; }

  /* 笔记里对这道题的讲解。真题优先之后，原卷题的题干和选项都来自卷子，
     笔记那句话就退到「讲解」的位置 —— 答完能看到自己笔记里怎么说的。 */
  function noteLine(q) {
    if (!q || !q.note) return '';
    var t = String(q.note).trim();
    if (!t || t === q.stem) return '';
    return '<div class="source note-src">笔记里怎么说：' + esc(t) + '</div>';
  }

  // 题型标签：简答和名词解释是手打题，界面上要让人一眼知道这题怎么答
  var TYPE_LABEL = { single: '单选', multi: '多选', fill: '填空', term: '名词解释', short: '简答' };
  function typeLabel(q) { return TYPE_LABEL[(q && q.type) || ''] || '选择'; }
  function isTypedQ(q) { return !!q && (q.type === 'term' || q.type === 'short'); }


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
    forgetQuiz();          // 换题集了，上一本刷到哪儿不再适用
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
      forgetQuiz();
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
    if (S.inputMode === 'paper') return doExtractPaper(text, silent);
    var qs = buildFromNote(text);
    if (!qs.length) {
      toast('没提炼出判断句，试试用「……是……」「……的标志是……」这样的句式写笔记');
      return false;
    }
    // 笔记对得上卷子里的原题，就出原题；对不上的按笔记挖空
    var m = preferPaper(qs);
    S.paperMatch = m;
    qs = m.list;
    if (!qs.length && m.hit) {
      toast('这 ' + m.hit + ' 条笔记卷子里全都考过，已给题库里的原题补上讲解，没有重复出题');
      return false;
    }
    S.preview = qs;
    renderPreview();
    $('#previewCard').hidden = false;
    if (!silent) {
      $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      var parts = [];
      if (m.hit) parts.push(m.hit + ' 道对上了卷子原题（用原题干、原选项）');
      if (m.dup) parts.push('其中 ' + m.dup + ' 道题库里已有，只补讲解');
      if (m.fresh) parts.push(m.fresh + ' 道卷子里没考过，按笔记挖空出填空');
      toast(parts.length ? parts.join('；') : ('共 ' + qs.length + ' 道题'));
    }
    return true;
  }

  /* =========================================================
     真题优先：笔记里这件事卷子考过，就出卷子那道原题
     ---------------------------------------------------------
     用户定的规矩（原话）：「选择题来自我上传的卷子原题，并以原题的
     题干和选项为准；不要自行编造干扰性选择题或改动原题内容。」

     所以解析笔记时先拿每条笔记去题库里翻已导入的原卷题：
       · 对上了 → 直接吐那道原卷题，题干、选项、答案一个字不动，
                  笔记那句话说到底就是它的讲解，存进 q.note
       · 没对上 → 按笔记挖空出填空（buildFromNote 已经不出选择题了）
     题库里本来就有的原卷题不重复加，只把讲解补上去。
     ========================================================= */
  function preferPaper(cands) {
    var pool = getQs().filter(isPaperQ);
    var res = { list: cands, hit: 0, dup: 0, demoted: 0, fresh: 0, noPool: !pool.length };
    if (!pool.length) {
      // 还没导入原卷：没什么可对的，老实按笔记出填空
      var out0 = cands.map(demoteToFill);
      res.list = out0;
      res.demoted = out0.filter(function (q, i) { return q !== cands[i]; }).length;
      res.fresh = out0.length;
      return res;
    }

    var exist = {};
    pool.forEach(function (p) { exist[p.id] = 1; });
    var taken = {}, out = [];

    cands.forEach(function (cand) {
      var m = findPaperMatch(cand, pool, taken);
      if (!m) { out.push(demoteToFill(cand)); res.demoted++; res.fresh++; return; }

      taken[m.q.id] = 1;
      res.hit++;
      if (exist[m.q.id]) {
        // 已经在题库里了：不重复添加，只带一条「补讲解」的指令回去
        out.push({
          id: m.q.id, stem: m.q.stem, answer: m.q.answer, opts: m.q.opts,
          type: m.q.type, source: m.q.source, chapter: m.q.chapter,
          optsSrc: m.q.optsSrc, order: m.q.order,
          note: String(cand.source || cand.stem || '').trim(),
          onlyAttachNote: true
        });
        res.dup++;
        return;
      }
      // 题库里还没有这道真题：整条照卷子抄，答案也用卷子上的
      var q = {};
      for (var k in m.q) if (Object.prototype.hasOwnProperty.call(m.q, k)) q[k] = m.q[k];
      q.answer = Array.isArray(m.q.answer) ? m.q.answer.slice() : m.q.answer;
      q.opts = (m.q.opts || []).slice();
      q.note = String(cand.source || cand.stem || '').trim();
      out.push(q);
    });

    // 同一条原卷题只留一份（几条笔记可能都对上同一道题）
    var seen = {}, dedup = [];
    out.forEach(function (q) {
      if (seen[q.id]) return;
      seen[q.id] = 1;
      dedup.push(q);
    });

    res.list = dedup;
    return res;
  }

  /* 笔记提炼出来的选择题（选项是系统拼的）一律降级成填空。
     名词解释 / 简答 / 本来就是填空的不动。 */
  function demoteToFill(q) {
    if (!q || (q.type !== 'single' && q.type !== 'multi')) return q;
    if (isPaperQ(q)) return q;               // 选项本来就是卷子的，放过
    var c = {};
    for (var k in q) if (Object.prototype.hasOwnProperty.call(q, k)) c[k] = q[k];
    c.type = 'fill';
    c.opts = [];
    return c;
  }

  /* 原卷：不提炼、不猜，照着试卷抄。老师给的分值、括号、选项顺序一律不动，
     只把「答案字母」翻译成「答案原文」，不然判分没法做。 */
  function doExtractPaper(text, silent) {
    var r = parsePaperDoc(text);
    S.paperInfo = r;
    if (!r.questions.length) {
      toast('没解析出题目 —— 原卷里要有「单选题 / 多选题 / 名词解释 / 简答题」这样的分段标题');
      return false;
    }
    if (!$('#courseName').value.trim()) {
      $('#courseName').value = S.paperChapter || r.chapter.replace(/^第.+?章\s*/, '') || '原卷题库';
    }
    S.preview = r.questions;
    renderPreview();
    $('#previewCard').hidden = false;
    if (!silent) {
      $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      var sk = r.warn.length ? '，跳过 ' + r.warn.length + ' 道（' + r.warn.map(function (w) { return w.why; }).slice(0, 2).join('、') + '）' : '';
      toast('照原卷录入 ' + r.questions.length + ' 道题' + sk);
    }
    return true;
  }

  $('#extractBtn').addEventListener('click', function () { doExtract(false); });

  /* ---------------- 导入笔记 / 导入原卷 ---------------- */
  var NOTE_TIP = '从乐享复制正文粘进来，或直接拖入 .docx / .pdf / .md / .txt（文件不上传，只在你电脑里解析）；题目按笔记原文顺序生成';
  var PAPER_TIP = '支持 .docx / .txt，也可以直接把试卷文字粘进来；按原卷的分段照抄，题干、选项、答案都不改写。答案字母写在括号里（A）或跟在括号后面都认得';
  var NOTE_PH = '把笔记整段粘进来。写的时候尽量用「……是……」「……的标志是……」「……包括……」这样的判断句，提炼效果最好。';
  var PAPER_PH = '把试卷整段粘进来，保留原来的分段标题，例如：\n\n单选题（每题2分）\n药物治疗的核心问题是（     ）A\nA、合理用药        B、获得最佳疗效\n首过效应最明显的给药途径是（B）\nA、静脉注射        B、口服\n\n多选题（每题2分）\n药物治疗要求（     ）ABCD\nA.安全  B.有效  C.经济  D.适当\n\n名词解释（每题4分）\n处方：是指由注册的执业医师……';

  function setInputMode(mode) {
    S.inputMode = mode === 'paper' ? 'paper' : 'note';
    var isPaper = S.inputMode === 'paper';
    $$('#inputSeg .seg-btn').forEach(function (b) {
      var on = b.dataset.mode === S.inputMode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#importTitle').textContent = isPaper ? '① 把整份原卷贴进来' : '① 贴上你的课程笔记';
    $('#importHint').textContent = isPaper ? PAPER_TIP : NOTE_TIP;
    $('#segHint').textContent = isPaper
      ? '原卷 = 老师发的试卷：单选题（每题2分）/ 多选题 / 名词解释 / 简答题，答案字母写在括号里（A）或跟在括号后面都认'
      : '笔记 = 课本或讲义正文，系统从判断句里提炼题目；换成「导入原卷」则一条一条照着试卷抄';
    $('#extractBtn').textContent = isPaper ? '解析原卷' : '一键提炼知识点';
    $('#pickFileBtn').textContent = isPaper ? '选择原卷文件' : '选择笔记文件';
    $('#loadSampleBtn').hidden = isPaper;
    $('#builtinPaperBtn').hidden = !isPaper;
    var ta = $('#noteText');
    if (ta) {
      ta.placeholder = isPaper ? PAPER_PH : NOTE_PH;
      // 原卷的示例占位有 14 行，行数给不够会把它从底部切掉
      ta.rows = isPaper ? 15 : 12;
    }
    $('#previewTitle').textContent = isPaper ? '② 核对原卷题目，可随手改' : '② 核对题目，可随手改';
  }

  $('#inputSeg').addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.seg-btn') : null;
    if (!btn || btn.dataset.mode === S.inputMode) return;
    setInputMode(btn.dataset.mode);
    // 换了来源，之前那批预览就作废了，免得把笔记的题混进原卷里
    S.preview = [];
    $('#previewCard').hidden = true;
    updateNoteStat();
  });
  setInputMode('note');

  /* 内置原卷题库：把《临床药物治疗学概论》15 章教材里有卷的 14 章原卷一次装进来（第一章没卷）。
     224 道题铺进预览表太长，直接存成题集更实在。 */
  $('#builtinPaperBtn').addEventListener('click', function () {
    var btn = this;
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在载入原卷…';
    fetch('assets/paper_bank.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('题库文件没找到（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (data) {
      var list = [];
      (data.chapters || []).forEach(function (ch) {
        (ch.questions || []).forEach(function (q) {
          list.push({
            type: q.type, stem: q.stem, answer: q.answer, opts: q.opts || [],
            source: q.source || q.stem, chapter: ch.chapter || '', order: list.length,
            // 内置题库同样是卷子上的原题，选项不是系统凑的
            optsSrc: (q.opts && q.opts.length >= 2) ? 'paper' : null
          });
        });
      });
      if (!list.length) throw new Error('题库是空的');
      var bank = saveQuestionsToBank(list, data.course || '原卷题库');
      if (bank) {
        toast('已载入 ' + list.length + ' 道原卷题到「' + bank.course + '」，共 ' +
          (data.chapters || []).length + ' 章');
      }
    }).catch(function (e) {
      toast('载入失败：' + e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  });

  function renderPreview() {
    var tb = $('#previewBody');
    tb.innerHTML = '';
    S.preview.forEach(function (q, i) {
      var tr = document.createElement('tr');
      tr.dataset.i = i;
      tr.innerHTML =
        '<td class="c-chk"><input type="checkbox" class="p-chk" checked></td>' +
        '<td class="c-type"><span class="tag' + (q.type === 'multi' ? ' multi' : (q.type === 'short' || q.type === 'term') ? ' typed' : '') + '">' +
        typeLabel(q) + '</span>' +
        (q.onlyAttachNote ? '<span class="tag paper" title="题库里已经有这道真题，这次只把笔记里的讲解补上去">已有·补讲解</span>'
          : isPaperQ(q) ? '<span class="tag paper" title="题干、选项、答案都照你上传的原卷">原卷真题</span>' : '') +
        '</td>' +
        '<td><input class="cell-input p-stem" value="' + esc(q.stem) + '">' +
        ((q.opts && q.opts.length)
          ? '<div class="p-opts">' + q.opts.map(function (o, k) {
              return '<span class="p-opt"><b>' + String.fromCharCode(65 + k) + '</b>' + esc(o) + '</span>';
            }).join('') + '</div>'
          : '') +
        (q.chapter ? '<div class="p-chapter">' + esc(q.chapter) + '</div>' : '') +
        (q.note ? '<div class="p-note">笔记：' + esc(q.note) + '</div>' : '') +
        '</td>' +
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
      // 多选和「多个答案的填空」都是顿号分隔的，两种都要拆开
      q.answer = (q.type === 'multi' || Array.isArray(q.answer))
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
      list.push({
        id: q.id, type: q.type, stem: q.stem, answer: ans, opts: q.opts || [],
        source: q.source || '', chapter: q.chapter || '',
        // optsSrc 决定这题能不能出选择题（只能来自原卷）；
        // note 是笔记里对它的讲解，别在这层白名单上丢掉
        optsSrc: q.optsSrc || null,
        note: q.note || null
      });
    });
    if (!list.length) { toast('请先勾选要保存的题目'); return; }
    var bank = saveQuestionsToBank(list, $('#courseName').value.trim() || '我的题集');
    if (bank) toast('已保存到「' + bank.course + '」，共 ' + bank.questions.length + ' 道');
  });

  /* 存题集：预览保存和「一键载入内置原卷」都走这里，免得两套逻辑各写一遍 */
  function saveQuestionsToBank(list, courseName) {
    // 重新提炼同一份笔记时，之前「教过」的改法要跟着搬过来。
    // 按原文句子认领：解析规则以后变了、题目 id 跟着变，反馈也不会白教。
    var fixBySrc = {};
    S.banks.forEach(function (bb) {
      (bb.questions || []).forEach(function (q) {
        if (!q.fix) return;
        var k = normalize(q.source || q.stem);
        if (k) fixBySrc[k] = q.fix;
      });
    });
    list.forEach(function (q) {
      var k = normalize(q.source || q.stem);
      if (!q.fix && k && fixBySrc[k]) q.fix = fixBySrc[k];
      if (q.fix) applyFix(q);
    });

    // 按课程名归题集：同名就往里追加，换了一门课就另起一个，不串味
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
    var add = 0, noted = 0;
    list.forEach(function (q, i) {
      // 原卷解析出来的题不带 id，得在这里补上：
      // 掌握度、错题、改题面板都按 id 记账，没有 id 会全挤到 undefined 上
      if (!q.id) {
        q.id = qidOf(String(q.stem || '') + '|' +
          (Array.isArray(q.answer) ? q.answer.join('') : String(q.answer || '')));
      }
      if (exist[q.id]) {
        // 这道真题已经在题库里了：不重复加，只把笔记里的讲解挂上去
        if (q.note) {
          var old = null;
          for (var j = 0; j < bank.questions.length; j++) {
            if (bank.questions[j].id === q.id) { old = bank.questions[j]; break; }
          }
          if (old && !old.note) { old.note = q.note; noted++; }
        }
        return;
      }
      // onlyAttachNote 是「题库里已有」的标记，别把这条幽灵题当新题存进去
      if (q.onlyAttachNote) return;
      q.order = maxOrder + 1 + i;   // 新题接在旧题后面，still 按笔记顺序
      bank.questions.push(q);
      exist[q.id] = 1;              // 同一批里重复的题也别加两遍
      add++;
    });
    bank.questions.sort(byOrder);
    save();
    renderBankSelect();
    bindStars();
    bank._lastAdded = add;
    bank._lastNoted = noted;
    return bank;
  }

  /* 导出 / 导入题集 */
  function exportBankJson(b) {
    download(b.course + '.json', JSON.stringify({
      course: b.course,
      questions: b.questions.map(function (q, i) {
        return {
          type: q.type, stem: q.stem, answer: q.answer, opts: q.opts || [],
          source: q.source || '', chapter: q.chapter || '', order: q.order == null ? i : q.order,
          optsSrc: q.optsSrc || null,          // 选项来自原卷时带 'paper'
          note: q.note || null,                // 笔记里对这道题的讲解
          // 带上用户教过的改法：换台设备 / 换个人接着用，反馈不丢
          fix: q.fix || null, orig: q.orig || null
        };
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
      L.push((i + 1) + '. ' + q.stem + '　【' + typeLabel(q) + '】');
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
          forgetQuiz();
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
    var out = {
      id: q.id || qidOf(seed),
      type: TYPE_LABEL[q.type] ? q.type : 'single',
      stem: String(q.stem || ''),
      answer: answer,
      opts: Array.isArray(q.opts) ? q.opts : [],
      source: q.source || '',
      chapter: q.chapter || '',
      order: q.order == null ? (idx || 0) : q.order
    };
    // 选项是卷子印的还是系统凑的，出题时要看这个标记
    if (q.optsSrc) out.optsSrc = q.optsSrc;
    // 笔记里对这道题的讲解（刷题答完显示「笔记里怎么说」）
    if (q.note) out.note = String(q.note);
    // 导入别人导出的题库时，「教过的改法」也一起接住
    if (q.fix) { out.fix = q.fix; out.orig = q.orig || null; applyFix(out); }
    return out;
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

  /* 按工具栏的「范围 / 题型」先过一遍，抽题和背知识点共用 */
  function filterPool(qs, range, type) {
    if (type && type !== 'all') qs = qs.filter(function (q) { return q.type === type; });
    if (range === 'new') qs = qs.filter(function (q) { return !S.stats[q.id] || !(S.stats[q.id].ok + S.stats[q.id].bad); });
    else if (range === 'wrong') qs = qs.filter(function (q) { var s = S.stats[q.id]; return s && s.bad > 0 && !s.mastered; });
    else if (range === 'weak') qs = qs.filter(function (q) { var s = S.stats[q.id]; return !s || !s.mastered; });
    return qs;
  }

  function pickQuestions(opt) {
    var qs = filterPool(getQs().slice().sort(byOrder), opt.range, opt.type);
    if (opt.shuffle) qs = shuffle(qs);
    if (opt.count > 0) qs = qs.slice(0, opt.count);
    return qs;
  }

  /* 一场刷题的进度：这场里已经答对的题（done）和已经出现过的题（served）。
     点「开始刷题」是新开一场，清空；点「再来一组」接着用。 */
  var DRILL = { done: {}, served: {} };
  var MASTER_PCT = 90;   // 「已掌握」的门槛，跟 mastered 的算法同一个口径

  /* =========================================================
     刷题进度存档
     ---------------------------------------------------------
     刷新一下整场就没了，是这站最反直觉的地方：答到第 12 题手滑按了 F5，
     回来又得从第 1 题点起。这里把「这一组抽了哪几道、答到第几题、每题怎么答的」
     存进 localStorage，重进页面直接接着答。
     只存题目 id 和作答结果，题目本身按 id 从题库现取 —— 中途用「✎ 改题」
     改过题、或者重新提炼过笔记，恢复出来也是最新的说法，不会翻出一份旧快照。
     ========================================================= */
  var QUIZ_OPT_IDS = ['qRange', 'qType', 'qCount', 'qOrder', 'qForm', 'qMode'];

  function quizOptsNow() {
    var o = {};
    QUIZ_OPT_IDS.forEach(function (id) { var el = $('#' + id); if (el) o[id] = el.value; });
    return o;
  }

  function restoreQuizOpts(o) {
    if (!o) return;
    QUIZ_OPT_IDS.forEach(function (id) {
      var el = $('#' + id);
      if (el && o[id] != null && String(o[id]) !== '') el.value = String(o[id]);
    });
  }

  function persistQuiz() {
    try {
      if (!S.quiz) { localStorage.removeItem(LS_QUIZ); return; }
      var st = S.quiz;
      localStorage.setItem(LS_QUIZ, JSON.stringify({
        v: 1,
        bank: S.cur || '',
        at: Date.now(),
        round: st.round || 1,
        idx: st.idx || 0,
        mode: st.mode || 'srs',
        remain: st.remain || 0,
        opt: st.opt || quizOptsNow(),
        forms: st.forms || [],
        draft: st.draft || '',
        draftFor: st.draftFor || '',
        ids: (st.list || []).map(function (q) { return q.id; }),
        results: (st.results || []).map(function (r) {
          return {
            q: (r.q && r.q.id) || '',
            ok: !!r.ok,
            partial: !!r.partial,
            multi: !!r.multi,
            input: r.input == null ? null : r.input,
            picked: r.picked || null
          };
        }),
        drill: { done: DRILL.done, served: DRILL.served }
      }));
    } catch (e) { /* 存不下就算了，不能因此答不了题 */ }
  }

  // 打字时每敲一下就写库太浪费，攒一下再落盘
  var quizSaveTimer = null;
  function scheduleQuizSave() {
    if (quizSaveTimer) return;
    quizSaveTimer = setTimeout(function () { quizSaveTimer = null; persistQuiz(); }, 350);
  }

  /* 扔掉存档（换题集、删题集、点「重新开始」时用）。
     注意只清存档不动 S.quiz 以外的东西：练习记录和间隔复习排期照旧。 */
  function forgetQuiz() {
    S.quiz = null;
    try { localStorage.removeItem(LS_QUIZ); } catch (e) {}
  }

  /* 把上次那场捞回来。认不出来（换了题集、题目被删、存档坏了）就返回 false，
     老老实实从「开始刷题」开始 —— 半截会话比没有更麻烦。 */
  function restoreQuiz() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_QUIZ) || 'null'); } catch (e) { raw = null; }
    if (!raw || !raw.ids || !raw.ids.length) return false;
    if (raw.bank && S.cur && raw.bank !== S.cur) return false;

    var map = {};
    getQs().forEach(function (q) { map[q.id] = q; });
    var list = [];
    for (var i = 0; i < raw.ids.length; i++) {
      if (!map[raw.ids[i]]) return false;   // 有一道认不出来，整场作废
      list.push(map[raw.ids[i]]);
    }

    var results = (raw.results || []).map(function (r) {
      return {
        q: map[r.q] || null,
        ok: !!r.ok,
        partial: !!r.partial,
        multi: !!r.multi,
        input: r.input == null ? null : r.input,
        picked: r.picked || null
      };
    });

    S.quiz = {
      list: list,
      idx: Math.max(0, Math.min(raw.idx || 0, list.length)),
      results: results,
      timer: null,
      round: raw.round || 1,
      mode: raw.mode || 'srs',
      remain: raw.remain || 0,
      draft: raw.draft || '',
      draftFor: raw.draftFor || '',
      opt: raw.opt || null,
      // 题型排布也一并恢复：不然恢复出来的题可能跟上次看到的考法不一样
      forms: (raw.forms && raw.forms.length === list.length)
        ? raw.forms
        : decideForms(list, ($('#qForm') || {}).value || 'mix'),
      resumed: true
    };
    if (raw.drill) DRILL = { done: raw.drill.done || {}, served: raw.drill.served || {} };
    restoreQuizOpts(raw.opt);
    return true;
  }

  /* 下一组抽哪几道。以前「再来一组」只是重新点了一次「开始刷题」，
     而抽题是「按笔记顺序取前 N 道」，所以永远回到第 1 题 —— 它压根不知道
     自己刷到哪儿了。现在按两种模式往下推：
       new    ：先推没出现过的题，做对的这场不再出现；新题推完了再回头刷没答对的
       master ：只抽掌握度不到 90% 的，最生的排前面，全达标了才放新题 */
  function pickBatch(opt) {
    var pool = filterPool(getQs().slice().sort(byOrder), opt.range, opt.type);
    var done = opt.done || {}, served = opt.served || {};
    var cands;

    if (opt.mode === 'srs') {
      // 间隔复习：到期的复习题先来（拖得最久的排最前），不够再补没见过的题。
      // 这样「做对的短时间不用再做」和「一直有新题」同时成立。
      var rn = opt.round == null ? SR.round : opt.round;
      var due = [], fresh = [], later = [];
      pool.forEach(function (q) {
        var it = SR.items[q.id];
        if (!it) fresh.push(q);
        else if ((it.due || 0) <= rn) due.push(q);
        else later.push(q);
      });
      due.sort(function (a, b) {
        return (SR.items[a.id].due || 0) - (SR.items[b.id].due || 0) || byOrder(a, b);
      });
      if (opt.shuffle) fresh = shuffle(fresh);
      cands = due.concat(fresh);
      if (!cands.length) {
        // 全在冷却里：别让人卡在「没题可刷」，把最早到期的捞出来过一遍
        later.sort(function (a, b) { return (SR.items[a.id].due || 0) - (SR.items[b.id].due || 0); });
        if (!later.length) return { list: [], remain: 0, why: 'done' };
        var early = opt.count > 0 ? later.slice(0, opt.count) : later;
        return { list: early, remain: later.length, why: '', early: true };
      }
    } else if (opt.mode === 'master') {
      cands = pool.filter(function (q) { return masteryPct(q) < MASTER_PCT; });
      if (opt.shuffle) cands = shuffle(cands);
      // 最生的先来（shuffle 之后再按掌握度排，等于同分之间随机）
      cands.sort(function (a, b) { return masteryPct(a) - masteryPct(b); });
      if (!cands.length) return { list: [], remain: 0, why: 'mastered' };
    } else {
      cands = pool.filter(function (q) { return !done[q.id]; });
      // 没出现过的排前面，出现过的（上几组答错的）排在后面等回头刷
      var fresh = [], back = [];
      cands.forEach(function (q) { (served[q.id] ? back : fresh).push(q); });
      if (opt.shuffle) { fresh = shuffle(fresh); back = shuffle(back); }
      cands = fresh.concat(back);
      if (!cands.length) return { list: [], remain: 0, why: 'done' };
    }
    var remain = cands.length;
    var list = opt.count > 0 ? cands.slice(0, opt.count) : cands;
    return { list: list, remain: remain, why: '' };
  }

  function quizMode() {
    var el = $('#qMode');
    return el && el.value ? el.value : 'srs';
  }

  function batchOpt(extra) {
    var o = {
      range: $('#qRange').value,
      type: $('#qType').value,
      count: +$('#qCount').value,
      shuffle: $('#qOrder').value === 'rand',
      mode: quizMode(),
      done: DRILL.done,
      served: DRILL.served
    };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  function startQuiz(next) {
    if (!next) DRILL = { done: {}, served: {} };   // 新开一场：这场答对的记录归零
    var round = next && S.quiz ? (S.quiz.round || 1) + 1 : 1;
    // 组号也是复习排期的时钟：这一组算第 SR.round+1 组
    var rn = (SR.round || 0) + 1;
    var got = pickBatch(batchOpt({ round: rn }));
    if (!got.list.length) {
      toast(got.why === 'mastered'
        ? '这个范围里的题都到 ' + MASTER_PCT + '% 了，取消勾选「刷到 90% 才换新题」就能继续刷'
        : '这个范围里的题这场都刷完且答对过了，换个范围（比如「未掌握」）再刷');
      return;
    }
    SR.round = rn;                                  // 真开工了才推进时钟
    got.list.forEach(function (q) { DRILL.served[q.id] = 1; });
    S.quiz = {
      list: got.list, idx: 0, results: [], timer: null, round: round,
      mode: quizMode(), remain: got.remain,
      opt: quizOptsNow(), draft: '', draftFor: '',
      forms: decideForms(got.list, $('#qForm').value)
    };
    renderQuiz();
  }

  function masteryPct(q) { return Math.round(getStat(q.id).mastery * 100); }

  /* =========================================================
     ② 刷题
     ========================================================= */
  // 「答完自动下一题」这个开关已经去掉了：答案至少要看一眼原文，
  // 自动翻页只会把答案顶走。翻页统一由用户点「下一题」。

  $('#quizStartBtn').addEventListener('click', function () { startQuiz(false); });

  // 刷题时每道题怎么考：给选项，还是自己填
  function decideForms(list, mode) {
    return list.map(function (q) {
      // 用户亲手教过的题，按他指定的题型来 —— 不然「混合」模式
      // 一看到掌握度高，又会把单选题掰回填空，等于白改
      if (q.fix && q.fix.type) {
        if (isTypedQ(q) || q.type === 'fill') return 'fill';
        // 用户把选项删光了，就别硬撑一道没有选项的选择题
        if (!(q.opts && q.opts.length >= 2)) return 'fill';
        return 'choice';
      }
      // 简答 / 名词解释天生就是手打，给不了选项
      if (isTypedQ(q)) return 'fill';
      // 手里没有两个以上选项就不是选择题 —— 选择题只能是卷子原题，
      // 系统不许临时拼干扰项凑一道出来（「形式：全部给选项」也一样）
      if (!(q.opts && q.opts.length >= 2)) return 'fill';
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

  /* =========================================================
     刷题页 · 「这题出得不对？」
     ---------------------------------------------------------
     解析器只能猜，用户最清楚这道题该怎么考。点按钮 → 说清楚
     「题型 / 题干 / 答案」→ 存进 q.fix，从此这个知识点按用户
     的版本出题（刷题、背卡片、错题本、导出全都跟着变）。
     ========================================================= */
  var FIX_TYPE_OPT = [
    ['fill', '填空（挖空，自己填）'],
    ['single', '单选（一个正确项 + 干扰项）'],
    ['multi', '多选（多个正确项，全对才得分）'],
    ['term', '名词解释（只留名词，默写解释）'],
    ['short', '简答（标题 + 答要点）']
  ];
  var FIX_ANS_HINT = {
    fill: '多个空按顺序用顿号隔开，例如：血药浓度、谷浓度',
    single: '填正确项原文；选项要你自己填，或者在下面点「补几个干扰项」（那是系统编的，不是原卷）',
    multi: '多个正确项用顿号隔开，全部选对才算对',
    term: '填这个名词的完整解释，考试时你要默写出来',
    short: '一条要点一行（也可以用分号隔开），按要点给分'
  };

  /* 面板里正在编的那几行选项。同一时刻只有一个面板开着，模块级数组够用。 */
  var FIXROWS = [];

  function loadOptRows(q, type, answer) {
    FIXROWS = (type === 'single' || type === 'multi') ? fixOptRows(q, answer) : [];
    renderOptRows();
    syncAnsFromOpts();
  }

  function renderOptRows() {
    var box = $('#fixOptsList');
    if (!box) return;
    if (!FIXROWS.length) {
      box.innerHTML = '<div class="muted fix-opt-empty">这道题还没有选项，点下面「加一个选项」</div>';
      return;
    }
    box.innerHTML = FIXROWS.map(function (r, i) {
      return '<div class="fix-opt">' +
        '<label class="fix-opt-pick" title="勾上表示它是正确答案">' +
        '<input type="checkbox" data-on="' + i + '"' + (r.on ? ' checked' : '') + '>' +
        '<b>' + String.fromCharCode(65 + i) + '</b></label>' +
        '<input class="input fix-opt-text" data-ot="' + i + '" autocomplete="off"' +
        ' value="' + esc(r.text) + '" placeholder="选项文字">' +
        '<button class="mini-btn" data-odel="' + i + '" type="button" title="删掉这个选项">✕</button>' +
        '</div>';
    }).join('');
  }

  /* 勾了哪个，答案框就写哪个 —— 选择题的答案永远等于勾选，省得两处对不上 */
  function syncAnsFromOpts() {
    var el = $('#fixAns');
    if (!el) return;
    var type = $('#fixType') ? $('#fixType').value : '';
    if (type !== 'single' && type !== 'multi') return;
    var picks = FIXROWS.filter(function (r) { return r.on && String(r.text || '').trim(); });
    el.value = picks.map(function (r) { return String(r.text).trim(); }).join('、');
  }

  /* 反过来：用户直接改答案框时，把它落到选项上 ——
     答案里有的项勾上、没有的加一条、原来勾着但答案里没了的取消。
     不然「我把答案改成血浆」和上面的选项会各说各话。 */
  function syncOptsFromAns() {
    var el = $('#fixAns');
    if (!el) return;
    var type = $('#fixType') ? $('#fixType').value : '';
    if (type !== 'single' && type !== 'multi') return;
    var txt = String(el.value || '').trim();
    var arr = txt ? fixAnswerOf(type, txt) : [];
    var list = (Array.isArray(arr) ? arr : [arr]).map(function (a) { return String(a).trim(); }).filter(Boolean);
    if (!list.length) { FIXROWS.forEach(function (r) { r.on = false; }); return renderOptRows(); }
    FIXROWS.forEach(function (r) { r.on = list.some(function (a) { return sameOpt(r.text, a); }); });
    list.forEach(function (a) {
      if (!FIXROWS.some(function (r) { return sameOpt(r.text, a); })) FIXROWS.push({ text: a, on: true });
    });
    renderOptRows();
  }

  /* 单选只能有一个勾。keep 指刚才勾的那一行（勾新的就把旧的去掉）；
     不传就保留原来勾着的第一个（切题型时用）。 */
  function enforceSingleOpt(keep) {
    if (!$('#fixType') || $('#fixType').value !== 'single') return;
    var k = typeof keep === 'number' ? keep : -1;
    if (k < 0) { FIXROWS.forEach(function (r, i) { if (r.on && k < 0) k = i; }); }
    FIXROWS.forEach(function (r, i) { r.on = (i === k); });
  }

  /* 面板有两个落点：#fixPanel 在刷题页、#fixPanelRecite 在背知识点页。
     背知识点正是「看到这句话觉得挖错了」的地方，非要切回刷题页才能改太绕。
     两个落点是同一套表单，同一时刻只留一个在页面上，免得 #fixType 撞 id。 */
  function fixPanelOf(view) {
    return view === 'recite' ? $('#fixPanelRecite') : $('#fixPanel');
  }

  function emptyPanel(box) {
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
  }

  function closeFixPanel() {
    emptyPanel($('#fixPanel'));
    emptyPanel($('#fixPanelRecite'));
  }

  function openFixPanel(q) {
    var box = fixPanelOf(S.view);
    if (!box || !q) return;
    // 先把另一页那个表单清空，保证页面上只有这一份 #fixType / #fixStem
    emptyPanel(box === $('#fixPanel') ? $('#fixPanelRecite') : $('#fixPanel'));
    var type = (q.fix && q.fix.type) || q.type || 'fill';
    var ans = q.fix ? q.fix.answer : q.answer;
    var ansText = Array.isArray(ans) ? ans.join('、') : (ans == null ? '' : ans);
    var note = (q.fix && q.fix.note) || '';
    var isChoice = type === 'single' || type === 'multi';

    box.innerHTML =
      '<div class="fix-head">' +
      '<div class="fix-title"><b>教它怎么出这道题</b>' +
      '<span class="muted">改完以后，这个知识点每次都按你这一版出</span></div>' +
      '<button class="mini-btn" id="fixClose" title="关闭">✕</button>' +
      '</div>' +
      '<div class="fix-now">系统现在这么出：<span class="pill">' + typeLabel(q) + '</span>' +
      '<span class="fix-now-stem">' + esc(q.stem) + '</span>' +
      (q.fix ? '<span class="pill ok">已按你的版本</span>' : '') + '</div>' +
      '<label class="fld"><span>① 这题该怎么考</span>' +
      '<select id="fixType" class="select">' +
      FIX_TYPE_OPT.map(function (o) {
        return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>';
      }).join('') +
      '</select></label>' +
      '<label class="fld"><span>② 题干（要挖空的地方写 ____，挖几个空就写几个；名词解释/简答直接写标题）</span>' +
      '<textarea id="fixStem" class="fix-textarea" rows="4" spellcheck="false">' + esc(q.stem) + '</textarea></label>' +
      '<div class="fix-tools">' +
      '<button class="btn ghost tiny" id="fixBlankBtn" type="button">✂ 把选中的字挖成空</button>' +
      '<span class="muted">在题干里选中要考的那几个字，点一下，答案会自动填到下面</span>' +
      '</div>' +
      '<div class="fix-opts" id="fixOptsWrap"' + (isChoice ? '' : ' hidden') + '>' +
      '<div class="fld-head"><span>③ 选项</span>' +
      '<em class="muted" id="fixOptsTip">勾上的是正确答案' + (type === 'single' ? '，单选只能勾一个' : '，多选勾几个都行') + '</em></div>' +
      '<div id="fixOptsList"></div>' +
      '<div class="fix-opt-tools">' +
      '<button class="btn ghost tiny" id="fixOptAdd" type="button">+ 加一个选项</button>' +
      '<button class="btn ghost tiny" id="fixOptFill" type="button" title="从题库里抓几个词当干扰项 —— 这是系统编的，不是原卷上的选项">↻ 补几个干扰项（系统编的，非原卷）</button>' +
      '</div></div>' +
      '<label class="fld"><span>④ 答案</span>' +
      '<input id="fixAns" class="input" autocomplete="off" value="' + esc(ansText) + '"' +
      (isChoice ? ' title="改这里会自动在选项里加一条并勾上"' : '') + '></label>' +
      '<div class="muted fix-hint" id="fixAnsHint">' + esc(FIX_ANS_HINT[type] || '') + '</div>' +
      '<label class="fld"><span>⑤ 想补充一句（可留空）</span>' +
      '<input id="fixNote" class="input" maxlength="120" autocomplete="off" value="' + esc(note) + '"' +
      ' placeholder="例如：这句只该挖「血药浓度」，后面是解释不用挖"></label>' +
      '<div class="fix-foot">' +
      '<button class="btn primary" id="fixSave" type="button">保存，以后都按这个出</button>' +
      (q.fix ? '<button class="btn ghost" id="fixUndo" type="button">恢复系统原样</button>' : '') +
      '<button class="btn ghost" id="fixCancel" type="button">取消</button>' +
      '<span class="grow"></span>' +
      '<span class="muted" id="fixErr"></span>' +
      '</div>';

    box.hidden = false;
    $('#fixType').value = type;
    bindFixEvents(q);
    loadOptRows(q, type, ans);
    $('#fixStem').focus();
    try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* 老浏览器 */ }
  }

  function bindFixEvents(q) {
    function warn(msg) {
      var el = $('#fixErr');
      if (el) { el.textContent = msg; }
      toast(msg);
    }

    $('#fixClose').addEventListener('click', closeFixPanel);
    $('#fixCancel').addEventListener('click', closeFixPanel);
    $('#fixType').addEventListener('change', function () {
      var t = this.value;
      var hint = $('#fixAnsHint');
      if (hint) hint.textContent = FIX_ANS_HINT[t] || '';
      // 名词解释 / 简答没有空，题干里留着 ____ 反而会误导
      var stem = $('#fixStem');
      if ((t === 'term' || t === 'short') && stem.value.indexOf('____') >= 0) {
        hint.textContent = '这两种题型没有空，记得把题干里的 ____ 换成完整标题';
      }
      var isChoice = t === 'single' || t === 'multi';
      var wrap = $('#fixOptsWrap');
      if (wrap) wrap.hidden = !isChoice;
      var tip = $('#fixOptsTip');
      if (tip) tip.textContent = '勾上的是正确答案' + (t === 'single' ? '，单选只能勾一个' : '，多选勾几个都行');
      var ansEl = $('#fixAns');
      if (ansEl) {
        if (isChoice) {
          ansEl.setAttribute('readonly', 'readonly');
          ansEl.setAttribute('title', '选择题的答案由上面勾选的选项决定');
        } else {
          ansEl.removeAttribute('readonly');
          ansEl.removeAttribute('title');
        }
      }
      if (isChoice) {
        // 刚刚才改成选择题的：现在按原答案摊一份选项出来，再让人改
        if (!FIXROWS.length) {
          var cur = ansEl ? ansEl.value.trim() : '';
          FIXROWS = fixOptRows(q, cur ? fixAnswerOf(t, cur) : q.answer);
        }
        if (t === 'single') enforceSingleOpt();
        renderOptRows();
        syncAnsFromOpts();
      }
    });

    if ($('#fixAns')) {
      // 用 change（失焦/回车）而不是 input：边打字边加选项会攒一堆「血」「血浆」的半截词
      $('#fixAns').addEventListener('change', function () {
        var type = $('#fixType').value;
        if (type !== 'single' && type !== 'multi') return;
        if (String(this.value || '').trim()) syncOptsFromAns();
      });
    }

    if ($('#fixOptsList')) {
      var optBox = $('#fixOptsList');
      optBox.addEventListener('change', function (e) {
        var t = e.target;
        if (!t || !t.dataset || t.dataset.on == null) return;
        var i = +t.dataset.on;
        if (!FIXROWS[i]) return;
        FIXROWS[i].on = !!t.checked;
        if ($('#fixType').value === 'single') {
          if (t.checked) enforceSingleOpt(i);   // 勾新的，旧的自动取消
          renderOptRows();
        }
        syncAnsFromOpts();
      });
      optBox.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.dataset || t.dataset.ot == null) return;
        if (FIXROWS[+t.dataset.ot]) FIXROWS[+t.dataset.ot].text = t.value;
        syncAnsFromOpts();
      });
      optBox.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-odel]') : null;
        if (!btn) return;
        FIXROWS.splice(+btn.dataset.odel, 1);
        renderOptRows();
        syncAnsFromOpts();
      });
    }

    if ($('#fixOptAdd')) {
      $('#fixOptAdd').addEventListener('click', function () {
        if (FIXROWS.length >= 8) { warn('最多 8 个选项，再多就不像选择题了'); return; }
        FIXROWS.push({ text: '', on: FIXROWS.length === 0 });
        renderOptRows();
        var ins = $$('#fixOptsList .fix-opt-text');
        if (ins.length) ins[ins.length - 1].focus();
      });
    }

    if ($('#fixOptFill')) {
      $('#fixOptFill').addEventListener('click', function () {
        var picks = FIXROWS.filter(function (r) { return r.on && String(r.text || '').trim(); })
          .map(function (r) { return String(r.text).trim(); });
        if (!picks.length) { warn('先勾一个正确答案，才知道该给谁配干扰项'); return; }
        var fresh = fixOpts(picks, q).filter(function (d) {
          return !picks.some(function (p) { return sameOpt(p, d); });
        });
        // 勾着的原样留着，没勾的全换成题库里新凑的。
        // 题库小的时候只能凑出两个，那就给三个选项 —— 别把刚换掉的旧项又塞回来
        var out = FIXROWS.filter(function (r) { return r.on; });
        fresh.slice(0, Math.max(0, 4 - out.length)).forEach(function (d) {
          out.push({ text: d, on: false });
        });
        if (out.length < 2) { warn('题库里凑不出别的选项，手动加一个吧'); return; }
        FIXROWS = out;
        renderOptRows();
        syncAnsFromOpts();
        toast('换了一批干扰项（系统编的，不是原卷上的选项）');
      });
    }

    // 选中一段文字 → 变成 ____，同时把这段字填进答案
    $('#fixBlankBtn').addEventListener('click', function () {
      var ta = $('#fixStem');
      var s = ta.selectionStart, e = ta.selectionEnd;
      if (s == null || s === e) { warn('先在题干里选中要挖掉的那几个字'); return; }
      var picked = ta.value.slice(s, e).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      if (!picked) { warn('选中的是空白，重新选一段字'); return; }
      // 挖空位置两边各留一个空格，避免「是____。」糊在一起看不清
      var before = ta.value.slice(0, s).replace(/[\s\u3000]+$/, ' ');
      if (!/\s$/.test(before)) before += ' ';
      var after = ta.value.slice(e).replace(/^[\s\u3000]+/, '');
      ta.value = before + '____' + after;
      var ansEl = $('#fixAns');
      var cur = ansEl.value.trim();
      if (!cur) ansEl.value = picked;
      else if (cur.indexOf(picked) < 0) ansEl.value = cur.replace(/[、，,]\s*$/, '') + '、' + picked;
      var pos = before.length + 4;
      ta.selectionStart = ta.selectionEnd = pos;
      ta.focus();
      toast('已挖空：' + picked);
    });

    $('#fixSave').addEventListener('click', function () {
      var type = $('#fixType').value;
      var stem = $('#fixStem').value.replace(/\r\n?/g, '\n').trim();
      var note = $('#fixNote').value.trim();
      if (!stem) { warn('题干不能空着'); return; }

      var answer = null;
      var choiceOpts = null;

      if (type === 'single' || type === 'multi') {
        // 选项区还没铺开（题型是脚本改的、或从填空题刚切过来）：先按原答案摊一份
        if (!FIXROWS.length) {
          var seed = String($('#fixAns').value || '').trim();
          FIXROWS = fixOptRows(q, seed ? fixAnswerOf(type, seed) : q.answer);
          renderOptRows();
        }
        // 答案框被改过（还没来得及失焦就点了保存）：先把它落到选项上
        var ansBox = String($('#fixAns').value || '').trim();
        var picked0 = FIXROWS.filter(function (r) { return r.on; })
          .map(function (r) { return String(r.text || '').trim(); }).filter(Boolean).join('、');
        if (ansBox && normalize(ansBox) !== normalize(picked0)) syncOptsFromAns();

        // 选择题：答案和选项都以「勾选 + 编辑框」为准
        var rows = FIXROWS.map(function (r) {
          return { text: String(r.text == null ? '' : r.text).trim(), on: !!r.on };
        }).filter(function (r) { return r.text; });

        var picks = rows.filter(function (r) { return r.on; });
        if (!picks.length) {
          // 一个都没勾：把答案框里写的补成选项并勾上，别让人卡在这
          var arr0 = String($('#fixAns').value || '').trim();
          if (arr0) {
            var parts0 = fixAnswerOf(type, arr0);
            (Array.isArray(parts0) ? parts0 : [parts0]).forEach(function (a) {
              var hit = rows.filter(function (r) { return sameOpt(r.text, a); })[0];
              if (hit) hit.on = true;
              else rows.push({ text: String(a), on: true });
            });
          }
          picks = rows.filter(function (r) { return r.on; });
        }
        if (!picks.length) { warn('至少勾一个选项当正确答案'); return; }
        if (type === 'single' && picks.length > 1) {
          warn('单选只能勾一个正确答案；要多个就先把题型改成「多选」');
          return;
        }
        if (type === 'multi' && picks.length < 2) {
          warn('多选至少要勾两个正确答案；只有一个就改成「单选」');
          return;
        }
        answer = type === 'multi'
          ? picks.map(function (r) { return r.text; })
          : picks[0].text;
        choiceOpts = rows.map(function (r) { return r.text; });
        // 正确答案必须在选项里，否则渲染出来勾不到
        (Array.isArray(answer) ? answer : [answer]).forEach(function (a) {
          if (!choiceOpts.some(function (o) { return sameOpt(o, a); })) choiceOpts.push(String(a));
        });
      } else {
        var ansRaw = $('#fixAns').value.trim();
        if (!ansRaw) { warn('答案得填一个，不然没法判分'); return; }
        answer = fixAnswerOf(type, ansRaw);
        var empty = Array.isArray(answer) ? !answer.length : !String(answer).trim();
        if (empty) { warn('答案得填一个，不然没法判分'); return; }
        if (type === 'term' && Array.isArray(answer)) answer = answer.join('、');
        if (type === 'short' && !Array.isArray(answer)) answer = [answer];
        if (type === 'fill' && stem.indexOf('____') < 0) stem += ' ____';
      }

      // 选择题的答案就在选项里，题干再拖一条下划线只会让人以为还要手写
      if ((type === 'single' || type === 'multi') && stem.indexOf('____') >= 0) {
        stem = stem.replace(/[ \t\u3000]*_{2,}[ \t\u3000]*/g, '（　）');
      }

      var fix = { type: type, stem: stem, answer: answer, note: note, at: Date.now() };
      if (choiceOpts) {
        if (choiceOpts.length < 2) {
          // 只剩一个选项（正确答案）时别硬造选择题：等于直接送分
          fix.type = 'fill';
          if (fix.stem.indexOf('（　）') >= 0) fix.stem = fix.stem.replace('（　）', '____');
          else if (fix.stem.indexOf('____') < 0) fix.stem += ' ____';
          fix.answer = Array.isArray(answer) ? answer.join('、') : answer;
          toast('只留了一个选项，这题先按填空出');
        } else {
          fix.opts = choiceOpts;
        }
      }

      saveFix(q, fix);
      // 这题的呈现形式跟着改：本来决定给选项的，现在要按新题型来
      syncFormsAfterFix(q);
      closeFixPanel();
      toast('记住了：以后这题按「' + typeLabel(q) + '」出');
      refreshAfterFix();
    });

    if ($('#fixUndo')) {
      $('#fixUndo').addEventListener('click', function () {
        clearFix(q);
        syncFormsAfterFix(q);
        closeFixPanel();
        toast('已恢复成系统原来的出法');
        refreshAfterFix();
      });
    }
  }

  /* 改完之后两个页面都得跟着变：在背知识点里改的，切回刷题也得是新版本。
     刷题会话已经开着的话，它的 forms（给选项还是手填）要按新题型重算一次，
     否则「本来按混合模式派成填空的题」改成单选后还挂着填空的壳。 */
  function syncFormsAfterFix(q) {
    if (!S.quiz || !S.quiz.forms || !S.quiz.list) return;
    var i = S.quiz.list.indexOf(q);
    if (i < 0) return;
    S.quiz.forms[i] = decideForms([q], $('#qForm') ? $('#qForm').value : 'mix')[0];
  }

  function refreshAfterFix() {
    if (S.recite) renderRecite();
    if (S.quiz) renderQuiz();
    bindFixButtons();
  }

  /* 每张卡片右上角的入口。刷题、回顾、背知识点都要有 —— 答完看到答案才最想改。 */
  function bindFixButtons() {
    $$('#quizBody [data-fix], #reciteBody [data-fix]').forEach(function (b) {
      if (b.dataset.fixBound) return;   // 答完后会再调一次，别重复绑
      b.dataset.fixBound = '1';
      b.addEventListener('click', function () {
        // 背知识点和刷题拿的是同一批题目对象，改一边两边一起变；
        // 两个会话里都可能拿着这道题，先按会话找，找不到再回题库找
        var id = b.dataset.fix;
        var q = null;
        [S.quiz, S.recite].forEach(function (st) {
          if (q || !st || !st.list) return;
          q = st.list.filter(function (x) { return x.id === id; })[0] || null;
        });
        if (!q) q = getQ(id);
        if (q) openFixPanel(q); else toast('找不到这道题，刷新一下试试');
      });
    });
  }

  function fixBtnHtml(q, label) {
    return '<button class="btn ghost tiny fix-open" data-fix="' + esc(q.id) + '" type="button">' +
      (label || '✎ 改题') + '</button>';
  }

  function renderQuiz() {
    var st = S.quiz;
    if (!st) return renderQuizEmpty();
    persistQuiz();                                  // 每翻一题就落盘：刷新不丢进度
    if (st.idx >= st.list.length) return renderQuizResult();
    // 这道题已经答过了（从后面的题回看过来的），直接显示当时的结果，不让人重复作答
    if (st.results[st.idx]) return renderQuizReview();
    var q = st.list[st.idx];
    var typed = isTypedQ(q);                        // 简答 / 名词解释：整段自己打
    // 填空题类型的题，不管「形式」怎么排都得自己打字。以前只看 forms，
    // 一旦 forms 和题目错位，它会渲染成一堆选项 —— 而且只有「答案」这一个选项，
    // 点一下就判对、紧接着自动跳到下一题，看着就是「填空提交后没显示答案」
    var isFill = st.forms[st.idx] === 'fill' || q.type === 'fill';
    var isMulti = q.type === 'multi' && !isFill && !typed;
    var opts = (isFill || typed) ? [] : shuffle(choiceOptions(q, isMulti));

    var bodyHtml = typed
      ? '<div class="typed-row">' +
        '<textarea class="typed-input" id="fillInput" rows="' + (q.type === 'short' ? 6 : 4) + '" placeholder="' +
        (q.type === 'short' ? '一条一条写要点，能写几条写几条' : '把解释写下来，记得多少写多少') + '"></textarea>' +
        '<div class="row" style="margin-top:10px"><button class="btn primary" id="fillSubmit">提交（Ctrl+Enter）</button>' +
        '<span class="muted">' + (q.type === 'short' ? '答中几条要点算几条' : '按关键内容给分，不用一字不差') + '</span></div></div>'
      : isFill
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
      '<div class="q-meta"><span>第 ' + (st.round > 1 ? st.round + ' 组 · ' : '') +
      (st.idx + 1) + ' / ' + st.list.length + ' 题</span>' +
      '<span class="pill">' + (typed ? typeLabel(q) : isFill ? '填空' : isMulti ? '多选' : '单选') + '</span>' +
      '<span>掌握度 ' + masteryPct(q) + '%</span>' +
      (st.resumed ? '<span class="pill ok" title="刷新或重开页面后接着上次的进度">已恢复</span>' : '') +
      '<span class="grow"></span>' +
      fixBtnHtml(q) +
      (st.idx > 0 ? '<button class="btn ghost tiny" id="prevQBtn">← 上一题</button>' : '') +
      (st.resumed ? '<button class="btn ghost tiny" id="quizResetBtn" title="扔掉这次进度，从第一组重新抽题">重新开始</button>' : '') +
      '</div>' +
      '<div class="stem">' + stemHtml(q) + '</div>' +
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
    // 恢复出来的那一题，可能上次正写到一半 —— 把草稿放回输入框
    if (st.draft && st.draftFor === q.id && $('#fillInput')) {
      $('#fillInput').value = st.draft;
    }
    // 扔掉这次进度重新抽题（只在恢复态显示，平时不占地方）
    if ($('#quizResetBtn')) {
      $('#quizResetBtn').addEventListener('click', function () {
        forgetQuiz();
        startQuiz(false);
        toast('已重新开始一组');
      });
    }

    if (typed) {
      $('#fillInput').focus();
      $('#fillInput').addEventListener('input', function () {
        st.draft = this.value; st.draftFor = q.id; scheduleQuizSave();
      });
      $('#fillInput').addEventListener('keydown', function (e) {
        // 手打大段文字时 Enter 是换行，只有 Ctrl/⌘+Enter 才提交
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        submitFill();
      });
      $('#fillSubmit').addEventListener('click', submitFill);
    } else if (isFill) {
      $('#fillInput').focus();
      $('#fillInput').addEventListener('input', function () {
        st.draft = this.value; st.draftFor = q.id; scheduleQuizSave();
      });
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
    bindFixButtons();
  }

  // 刷题里碰到手打题（填空 / 名词解释 / 简答）：自己写，判分方式和背诵模式一样
  function submitFill() {
    var st = S.quiz;
    var q = st.list[st.idx];
    if (!$('#fillInput')) return;
    var v = $('#fillInput').value.trim();
    if (!v) { toast('先写个答案，哪怕只记得一半'); return; }
    var typed = isTypedQ(q);
    var g = typed ? gradeTyped(q, v) : gradeAnswer(v, q.answer);
    recordAnswer(q.id, g.level, { sr: true });
    st.results.push({ q: q, ok: g.level === 'right', partial: g.level === 'mid', input: v });
    st.draft = ''; st.draftFor = '';             // 交卷了，草稿没用了
    st.resumed = false;
    persistQuiz();

    $('#fillInput').disabled = true;
    var fb = $('#fillSubmit');
    if (fb) fb.remove();

    // 把答案直接补进题干那个空里，一眼就能看到正确答案（简答/名词解释没有空，跳过）
    fillStemBlank($('#quizBody'), q, g.level === 'right');

    // 手打题（含填空）答案长，读一遍至少十来秒 —— 不管有没有勾
    // 「答完自动下一题」，这一题都停住不动，等你自己点「下一题」。
    // 勾选只对选择题生效，免得答案还没看清就被下一题顶掉。
    $('#quizFb').innerHTML = verdictHtml(q, v, g) +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="nextQBtn">' +
      (st.idx + 1 >= st.list.length ? '看看这组成绩' : '下一题 →') + '</button>' +
      fixBtnHtml(q, '✎ 这题出得不对？') +
      '<span class="muted">' + (typed ? '自己写的题不会自动跳，看完答案再点' : '手打题不会自动跳，看完答案再点') + '</span>' +
      '</div>';
    $('#nextQBtn').addEventListener('click', function () {
      quizTimerStop(st);
      st.resumed = false;                        // 「已恢复」提示只挂在捞回来的那一道上
      st.idx++;
      renderQuiz();
    });
    bindFixButtons();
    // 反馈在输入框下面，手机上常常在屏幕外，主动滚过去
    scrollToFb($('#quizFb'));
  }

  // 清掉可能残留的定时器。自动翻页已经取消了，这里留着是为了让
  // 翻页 / 回看 / 重开一轮时不会有一个旧的计时器突然把页面顶走。
  function quizTimerStop(st) {
    if (st && st.timer) { clearTimeout(st.timer); st.timer = null; }
  }

  // 回看已经答过的题：只看不答，不重复统计
  function renderQuizReview() {
    var st = S.quiz;
    persistQuiz();                                  // 翻页也落盘，刷新后回到同一处
    var i = st.idx;
    var r = st.results[i];
    var q = r.q || st.list[i];
    var isFill = r.input != null;
    // 单选的 picked 存的是字符串，多选才是数组 —— 这里统一成数组再拼，
    // 不然回顾单选会炸在 .join 上
    var pickedArr = Array.isArray(r.picked) ? r.picked : (r.picked == null || r.picked === '' ? [] : [r.picked]);
    var your = isFill ? r.input : pickedArr.join('、');
    var cls = r.ok ? 'ok' : (r.partial ? 'mid' : 'bad');
    var title = r.ok ? '✅ 这题你答对了' : (r.partial ? '🟡 这题你记住了大半' : '❌ 这题你答错了');
    var html = '<div class="quiz-card">' +
      '<div class="progress"><i style="width:' + (i / st.list.length * 100) + '%"></i></div>' +
      '<div class="q-meta"><span>第 ' + (i + 1) + ' / ' + st.list.length + ' 题 · 回顾</span>' +
      '<span class="pill">' + (isTypedQ(q) ? typeLabel(q) : isFill ? '填空' : r.multi ? '多选' : '单选') + '</span>' +
      '<span class="grow"></span>' + fixBtnHtml(q) + '</div>' +
      '<div class="stem">' + stemHtml(q) + '</div>' +
      '<div class="verdict ' + cls + '" style="margin-top:12px">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-body">' +
      (isFill ? '你写的是：' : '你选的是：') + '<strong>' + esc(your) + '</strong><br>' +
      (q.type === 'short' ? '要点：<strong>' + (q.answer || []).length + ' 条</strong>'
        : q.type === 'term' ? '参考答案：<strong>' + esc(q.answer) + '</strong>'
        : '正确答案：<strong>' + esc(answerText(q)) + '</strong>') +
      '</div>' +
      (q.source && q.source !== q.stem ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      noteLine(q) +
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

  // 反馈卡片在输入框下面。桌面端视口高，它整块落在屏幕外很常见，
  // 而 block:'nearest' 只要元素露出一丁点边就不滚 —— 用户就一直看不到答案，
  // 只能靠「上一题」翻回去看。所以这里自己判断：卡片被顶栏挡住、或底部出屏，就滚到中间。
  function scrollToFb(el) {
    if (!el) return;
    try {
      var r = el.getBoundingClientRect();
      var bar = document.querySelector('.topbar');
      var barH = bar ? bar.getBoundingClientRect().height : 0;
      var vh = document.documentElement.clientHeight || window.innerHeight || 0;
      if (!vh) return;
      if (r.bottom > vh || r.top < barH) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) { /* 老浏览器 */ }
  }

  function answerQuiz(picked) {
    var st = S.quiz;
    var q = st.list[st.idx];
    var isMulti = q.type === 'multi' && st.forms[st.idx] !== 'fill';
    var right = isMulti
      ? (picked.length === q.answer.length && q.answer.every(function (a) { return picked.indexOf(a) >= 0; }))
      : (picked === q.answer);
    recordAnswer(q.id, right ? 'right' : 'wrong', { sr: true });
    st.results.push({ q: q, ok: right, multi: isMulti, picked: picked });
    st.resumed = false;
    persistQuiz();

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
      '<div class="verdict-body">你选：<strong>' + esc(pickedText) + '</strong></div>' +
      // 答对也把「正确答案」摆出来：只写「你选」时，答对的题看着就像没给答案
      '<div class="answer-line ans-key">正确答案：<strong>' + esc(corrects.join('、')) + '</strong></div>' +
      (q.source && q.source !== q.stem ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      noteLine(q) +
      '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="nextQBtn">' +
      (st.idx + 1 >= st.list.length ? '看看这组成绩' : '下一题 →') + '</button>' +
      fixBtnHtml(q, '✎ 这题出得不对？') + '</div>';
    $('#nextQBtn').addEventListener('click', function () {
      quizTimerStop(st);
      st.resumed = false;                        // 「已恢复」提示只挂在捞回来的那一道上
      st.idx++;
      renderQuiz();
    });
    bindFixButtons();
    // 以前这里会 setTimeout 1.5 秒（答对）/ 2.5 秒（答错）自动翻页。
    // 1.5 秒连「你选了什么」都来不及看，更别说原文，于是看起来就是
    // 「没显示答案就跳了」。现在一律停住，等用户自己点「下一题」。
    scrollToFb($('#quizFb'));
  }

  function renderQuizResult() {
    var st = S.quiz;
    quizTimerStop(st);
    persistQuiz();                                  // 结账页也算一处进度：刷新后还在这儿
    var ok = st.results.filter(function (r) { return r.ok; }).length;
    var mid = st.results.filter(function (r) { return r.partial; }).length;
    var total = st.results.length;
    var pct = total ? Math.round(ok / total * 100) : 0;
    var wrongs = st.results.filter(function (r) { return !r.ok; });
    // 下一组还剩多少可刷：这里只是预估（不落状态），让人知道「再来一组」不会从头再来
    var next = pickBatch(batchOpt({ round: (SR.round || 0) + 1 }));
    var nextTip = next.why === 'mastered'
      ? '这个范围里的题都到 ' + MASTER_PCT + '% 了，把抽题方式换成「一路推新题」就能继续'
      : next.why === 'done'
      ? '这个范围里的题这场都刷完并答对过了，换个范围还能继续'
      : st.mode === 'master'
      ? '下一组还有 ' + next.remain + ' 道没到 ' + MASTER_PCT + '% 的，接着刷'
      : st.mode === 'srs'
      ? (next.early
        ? '都还没到期，下一组先把最早到期的 ' + next.remain + ' 道捞回来复习'
        : '下一组从 ' + next.remain + ' 道里抽' +
          (+$('#qCount').value > 0 ? ' ' + $('#qCount').value + ' 道' : '') +
          '：到期的复习题先来，不够再补新题')
      : '下一组还有 ' + next.remain + ' 道可刷（这场答对的题不再出现）';
    var html = '<div class="quiz-card"><div class="result-card">' +
      '<div class="score">' + pct + '<span style="font-size:18px">%</span></div>' +
      '<div class="result-sub">第 ' + (st.round || 1) + ' 组 · ' + total + ' 题：完全正确 ' + ok + ' · 部分正确 ' + mid + ' · 答错 ' + (total - ok - mid) +
      '　' + (pct >= 90 ? '稳了，继续保持' : pct >= 60 ? '还行，错题再背两遍' : '别慌，先把下面的错题啃下来') + '</div>' +
      '</div>';
    if (wrongs.length) {
      html += '<h3 style="margin:18px 0 8px">这一组的错题</h3><div class="list">' +
        wrongs.map(function (r) {
          return '<div class="item"><div class="item-main"><div class="item-stem">' + stemHtml(r.q) + '</div>' +
            '<div class="item-sub">正确答案：<strong>' + esc(answerText(r.q)) + '</strong></div></div>' +
            '<span class="pill err">错了</span></div>';
        }).join('') + '</div>' +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="drillWrong">马上背这些错题</button>' +
        '<button class="btn ghost" id="toWrongView">打开错题本</button></div>';
    }
    html += '<div class="row" style="margin-top:14px"><button class="btn primary" id="againBtn">再来一组</button>' +
      '<span class="muted">' + esc(nextTip) + '</span></div></div>';
    $('#quizBody').innerHTML = html;

    $('#againBtn').addEventListener('click', function () { startQuiz(true); });
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
    S.recite = {
      list: list, phase: 'cards', cardIdx: 0, seenIdx: {},
      idx: 0, prev: null, hint: $('#rHint').checked, ok: 0, mid: 0, bad: 0
    };
    renderRecite();
  });

  function renderReciteEmpty() {
    $('#reciteBody').innerHTML = '<div class="empty">还没有可以看的知识点。<br>到「① 导入笔记」提炼题目后，回到这里先一张张看知识点 —— 看满 20 张（题少就看完为止）再开始做题。</div>';
  }

  /* 先看知识点卡片，看够 KN_GOAL 张才解锁做题。
     以前一进来就把句子挖空考人，等于没学过就先考试；
     卡片模式先把完整表述亮出来（考点高亮成卡片），看过再考。 */
  var KN_GOAL = 20;

  function knGoal(total) { return Math.max(1, Math.min(KN_GOAL, total)); }

  // 卡片正文：题干里的空用答案填上并高亮 —— 这才叫「知识点」，不是「题目」
  // 简答/名词解释的卡片是「标题 + 答案一起背」：标题在上，答案整段在下
  function knText(q) {
    var stem = cleanMark(q.stem || '');
    var ans = answerText(q);
    // 有空的句子，把答案填进去并高亮。
    // 用户把题改成单选以后，空会被写成「（　）」—— 知识卡片上也得把答案填回去，
    // 不然这张卡就只剩一个括号，等于没背。
    function filled() {
      var at = stem.indexOf('____');
      var len = 4;
      if (at < 0) { at = stem.indexOf('（　）'); len = 3; }
      if (at < 0) return esc(stem);
      return esc(stem.slice(0, at)) + '<mark class="kn-mark">' + esc(ans) + '</mark>' + esc(stem.slice(at + len));
    }
    if (q.type === 'short') {
      var pts = (q.answer || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
      return '<div class="kn-term">' + esc(stem) + '</div><ol class="kn-points">' + pts + '</ol>';
    }
    if (q.type === 'term') {
      return '<div class="kn-term">' + esc(stem) + '</div><div class="kn-def">' + esc(q.answer) + '</div>';
    }
    if (q.type === 'multi') {
      // 多选题的卡片：题干 + 所有正确项（没标答案的卷子就是全选）
      var items = (q.answer || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
      return '<div class="kn-q">' + filled() + '</div><ol class="kn-points">' + items + '</ol>';
    }
    return filled();
  }

  // 卡片阶段「给首字提示」没有意义，先藏起来，免得看着奇怪
  function recitePhaseUI(phase) {
    [$('#rHint')].forEach(function (el) {
      if (!el || !el.closest) return;
      var lab = el.closest('label');
      if (lab) lab.hidden = (phase === 'cards');
    });
  }

  function renderReciteCards() {
    var st = S.recite;
    var total = st.list.length;
    var goal = knGoal(total);
    var i = Math.max(0, Math.min(st.cardIdx, total - 1));
    st.cardIdx = i;
    var q = st.list[i];

    // 渲染出来就算「看过」；往回翻不重复计数，所以用下标集合而不是计数
    st.seenIdx[i] = 1;
    var seen = Object.keys(st.seenIdx).length;
    var unlocked = seen >= goal;
    var pct = Math.round(Math.min(seen, goal) / goal * 100);

    var html = '<div class="quiz-card">' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="q-meta"><span>第 ' + (i + 1) + ' / ' + total + ' 张</span>' +
      '<span class="pill">' + (q.type === 'fill' || q.type === 'single' ? '知识点' : typeLabel(q)) + '</span>' +
      '<span>已看 ' + Math.min(seen, goal) + ' / ' + goal + ' 张</span>' +
      '<span class="grow"></span>' +
      fixBtnHtml(q) +
      '</div>' +
      '<div class="kn-card" id="knCard">' + knText(q) + '</div>' +
      '<div class="kn-foot">' +
      (i > 0 ? '<button class="btn ghost" id="knPrev">← 上一张</button>' : '') +
      '<span class="muted">' + (unlocked ? '看够了，随时可以开始做题' : '再看 ' + (goal - seen) + ' 张就能开始做题') + '</span>' +
      '<div class="grow"></div>' +
      (i + 1 < total ? '<button class="btn" id="knNext">下一张 →</button>' : '') +
      (unlocked ? '<button class="btn primary" id="knStart">开始做题 →</button>' : '') +
      '</div></div>';
    $('#reciteBody').innerHTML = html;
    recitePhaseUI('cards');

    if ($('#knPrev')) {
      $('#knPrev').addEventListener('click', function () { st.cardIdx--; renderReciteCards(); });
    }
    if ($('#knNext')) {
      $('#knNext').addEventListener('click', function () { st.cardIdx++; renderReciteCards(); });
    }
    if ($('#knStart')) {
      $('#knStart').addEventListener('click', function () {
        st.phase = 'drill';
        st.idx = 0;
        renderRecite();
      });
    }
    bindFixButtons();
  }

  function renderRecite() {
    var st = S.recite;
    if (!st) return renderReciteEmpty();
    if (!st.phase || st.phase === 'cards') return renderReciteCards();
    recitePhaseUI('drill');
    if (st.idx >= st.list.length) return renderReciteEnd();
    var q = st.list[st.idx];
    var isMulti = q.type === 'multi';
    var typed = isTypedQ(q);
    var full = answerText(q);
    var hint = '';
    if (st.hint) {
      var first = full.charAt(0);
      hint = '（提示：' + esc(first) + '…… 共 ' + full.length + ' 字' +
        (isMulti ? '，含 ' + q.answer.length + ' 项' : q.type === 'short' ? '，共 ' + q.answer.length + ' 条要点' : '') + '）';
    }
    var inputHtml = typed
      ? '<div class="typed-row"><textarea class="typed-input" id="reciteInput" rows="' + (q.type === 'short' ? 6 : 4) + '" placeholder="' +
        (q.type === 'short' ? '一条一条写要点，Ctrl+Enter 提交' : '把解释写下来，Ctrl+Enter 提交') + '"></textarea>' +
        '<div class="row" style="margin-top:10px"><button class="btn primary" id="reciteSubmit">作答（Ctrl+Enter）</button></div></div>'
      : '<div class="recite-input-row">' +
        '<input class="recite-input" id="reciteInput" autocomplete="off" placeholder="' + (isMulti ? '多项之间用顿号或空格隔开' : '把空填上，Enter 提交') + '">' +
        '<button class="btn primary" id="reciteSubmit">作答</button>' +
        '</div>';
    var html = '<div class="quiz-card">' +
      '<div class="progress"><i style="width:' + (st.idx / st.list.length * 100) + '%"></i></div>' +
      (st.prev ? '<div class="prev-note">' + st.prev + '</div>' : '') +
      '<div class="q-meta"><span>第 ' + (st.idx + 1) + ' / ' + st.list.length + ' 问</span>' +
      '<span class="pill">' + (typed ? typeLabel(q) : isMulti ? '列举题' : '填空') + '</span>' +
      '<span>掌握度 ' + masteryPct(q) + '%</span>' +
      '<span class="grow"></span>' +
      fixBtnHtml(q) +
      '</div>' +
      '<div class="stem">' + stemHtml(q) + '</div>' +
      inputHtml +
      (hint ? '<div class="muted" style="margin-top:8px">' + hint + '</div>' : '') +
      '<div id="reciteVb"></div>' +
      '</div>';
    $('#reciteBody').innerHTML = html;
    $('#reciteInput').focus();
    $('#reciteInput').addEventListener('keydown', function (e) {
      // 同刷题页：输入法还在组合状态时，Enter 是选词，不当提交；
      // 大段手写时 Enter 是换行，只有 Ctrl/⌘+Enter 才交卷
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;
      if (typed && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      submitRecite();
    });
    $('#reciteSubmit').addEventListener('click', submitRecite);
    bindFixButtons();
  }

  // 简答：把要点一条条列出来，答到的打勾，漏掉的空着 —— 比只给一段话有用
  function shortVerdict(q, input, g) {
    var pts = (q.answer || []).slice();
    var hit = {};
    (g.hits || []).forEach(function (h) { hit[h.raw] = 1; });
    var cls = g.level === 'right' ? 'ok' : g.level === 'mid' ? 'mid' : 'bad';
    var title = g.level === 'right' ? '✅ 要点都答到了'
      : g.level === 'mid' ? '🟡 答到 ' + g.hits.length + ' / ' + pts.length + ' 条'
      : '❌ 只答到 ' + g.hits.length + ' / ' + pts.length + ' 条';
    var list = pts.map(function (p) {
      return '<li class="' + (hit[p] ? 'hit' : 'miss') + '">' + (hit[p] ? '✅ ' : '⬜ ') + esc(p) + '</li>';
    }).join('');
    return '<div class="verdict ' + cls + '">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-body">标准答案的要点共 ' + pts.length + ' 条，你答到 ' + g.hits.length + ' 条。</div>' +
      '<ol class="pt-list">' + list + '</ol>' +
      (q.source && q.source !== q.stem ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      noteLine(q) +
      '</div>';
  }

  // 名词解释：整段解释摆出来，再点出漏掉的关键词
  function termVerdict(q, input, g) {
    var cls = g.level === 'right' ? 'ok' : g.level === 'mid' ? 'mid' : 'bad';
    var title = g.level === 'right' ? '✅ 解释基本对上了'
      : g.level === 'mid' ? '🟡 关键内容对了一半，照着补' : '❌ 这解释还差得多';
    var miss = (g.miss || []).slice(0, 8).map(function (m) { return m.raw; }).join('、');
    return '<div class="verdict ' + cls + '">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-body">你写的是：' + esc(input) + '</div>' +
      '<div class="answer-line ans-key">参考答案：<strong>' + esc(q.answer) + '</strong></div>' +
      (miss ? '<div class="answer-line">漏掉的关键内容：<strong>' + esc(miss) + '</strong></div>' : '') +
      (q.source && q.source !== q.stem ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      noteLine(q) +
      '</div>';
  }

  // 判分后的反馈卡片（刷题的填空题和背诵模式共用）
  function verdictHtml(q, input, g) {
    if (q.type === 'short') return shortVerdict(q, input, g);
    if (q.type === 'term') return termVerdict(q, input, g);
    var title, cls, body;
    if (g.level === 'right') {
      title = '✅ 正确';
      cls = 'ok';
      body = '你写的是：' + esc(input);
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
      body = '你写的是：' + esc(input);
    }
    // 不管答对答错，都把「正确答案」单独摆一行。
    // 答对时只写"完整表述"会让人以为没给答案——尤其会自动跳下一题的时候。
    return '<div class="verdict ' + cls + '">' +
      '<div class="verdict-title">' + title + '</div>' +
      '<div class="verdict-body">' + body + '</div>' +
      '<div class="answer-line ans-key">正确答案：<strong>' + esc(answerText(q)) + '</strong></div>' +
      '<div class="answer-line">完整表述：<strong>' + esc(q.stem.replace('____', answerText(q))) + '</strong></div>' +
      (q.source && q.source !== q.stem ? '<div class="source">原文：' + esc(q.source) + '</div>' : '') +
      noteLine(q) +
      '</div>';
  }

  function submitRecite() {
    var st = S.recite;
    var input = $('#reciteInput').value.trim();
    if (!input) { toast('先写出你的答案，哪怕只记得一半'); return; }
    var q = st.list[st.idx];
    var g = gradeTyped(q, input);
    if (g.level === 'right') st.ok++;
    else if (g.level === 'mid') st.mid++;
    else st.bad++;
    recordAnswer(q.id, g.level === 'empty' ? 'wrong' : g.level);

    // 把答案直接补进题干那个空里，一眼就能看到正确答案
    fillStemBlank($('#reciteBody'), q, g.level === 'right');

    $('#reciteVb').innerHTML = verdictHtml(q, input, g) +
      '<div class="row" style="margin-top:12px"><button class="btn primary" id="reciteNext">' +
      (st.idx + 1 >= st.list.length ? '这一轮结束' : '下一问 →') + '</button>' +
      fixBtnHtml(q, '✎ 这题出得不对？') +
      '<span class="muted">手打题不会自动跳，看完答案再点</span></div>';
    $('.recite-input-row').remove();
    scrollToFb($('#reciteVb'));
    bindFixButtons();

    var prevNote = '上一问：' + esc(q.stem) + '　你答「' + esc(input) + '」 → ' +
      (g.level === 'right' ? '<span style="color:var(--ok)">正确</span>'
        : g.level === 'mid' ? '<span style="color:var(--warn)">部分正确' + (q.type === 'short' ? '（' + g.hits.length + '/' + (q.answer || []).length + ' 条）' : '') + '</span>'
        : '<span style="color:var(--err)">记错了，答案是 <strong>' + esc(q.type === 'short' ? (q.answer || []).join('；') : answerText(q)) + '</strong></span>');

    function goNext() { st.prev = prevNote; st.idx++; renderRecite(); }
    $('#reciteNext').addEventListener('click', goNext);
    $('#reciteNext').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      goNext();
    });
    // 这里以前挂着一个 2.8 秒 / 4.5 秒的 setTimeout，配合默认勾着的
    // 「判定后自动下一问」——答案刚显示出来就被下一问顶掉，看着就是
    // 「提交后没显示答案直接跳了」。背知识点全是手打题，答案长、要慢慢看，
    // 一律停住等用户自己点。不自动聚焦「下一问」按钮，免得回车误触跳走。
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
      $('#wrongList').innerHTML = '<div class="empty">这里空空的 —— 说明最近还没做错过，或者还没开始练。<br>去「② 刷题」或「③ 背知识点」试试。</div>';
      return;
    }
    $('#wrongList').innerHTML = qs.map(function (q) {
      var s = getStat(q.id);
      return '<div class="item">' +
        '<div class="item-main">' +
        '<div class="item-stem">' + stemHtml(q) + '</div>' +
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
        S.recite = {
          list: [q], phase: 'cards', cardIdx: 0, seenIdx: {},
          idx: 0, prev: null, hint: false, ok: 0, mid: 0, bad: 0
        };
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
      return '<div class="item"><div class="item-main"><div class="item-stem">' + stemHtml(q) + '</div>' +
        '<div class="item-sub">正确答案：<strong>' + esc(answerText(q)) + '</strong></div></div>' +
        '<div class="bar"><i style="width:' + Math.round(s.mastery * 100) + '%"></i></div>' +
        '<span class="pill ' + (s.mastery < 0.4 ? 'err' : s.mastery < 0.8 ? 'warn' : 'ok') + '">' + Math.round(s.mastery * 100) + '%</span>' +
        '<button class="btn ghost" data-drill="' + q.id + '">背它</button></div>';
    }).join('') : '<div class="muted">还没有题目</div>';

    $$('#weakList [data-drill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = getQ(b.dataset.drill);
        if (!q) return;
        S.recite = {
          list: [q], phase: 'cards', cardIdx: 0, seenIdx: {},
          idx: 0, prev: null, hint: false, ok: 0, mid: 0, bad: 0
        };
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
        forgetQuiz();
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
    forgetQuiz();
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
  // 上次刷到一半就刷新 / 关页面的，直接回到那道题上，不用从头点一遍。
  // 认领失败（换了题集、题被删了）就当没这回事，照旧从导入页开始。
  var resumedQuiz = restoreQuiz();
  switchView(resumedQuiz ? 'quiz' : 'import');
  if (resumedQuiz) {
    renderQuiz();
    var st0 = S.quiz;
    toast(st0.idx >= st0.list.length
      ? '已恢复上一组的成绩'
      : '已接着上次的进度：第 ' + (st0.round > 1 ? st0.round + ' 组 · ' : '') +
        (st0.idx + 1) + ' / ' + st0.list.length + ' 题');
  }

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
  /* 页脚版本号：改用脚本里的常量覆盖一遍。
     HTML 里那行字有可能是缓存下来的旧值，这里写的才是真正在跑的 JS 版本。 */
  (function stampVersion() {
    var el = document.getElementById('appVer');
    if (el) el.textContent = '期末刷题站 v' + FQ_VERSION;
  })();

  window.FQInternals = {
    buildFromNote: buildFromNote,
    parseBankQuestions: parseBankQuestions,
    parsePaper: parsePaper,
    parsePaperDoc: parsePaperDoc,
    pickBatch: pickBatch,
    pickQuestions: pickQuestions,
    persistQuiz: persistQuiz,
    restoreQuiz: restoreQuiz,
    forgetQuiz: forgetQuiz,
    srGap: srGap,
    srApply: srApply,
    getSR: function () { return SR; },
    setSR: function (v) { SR = v || { round: 0, items: {} }; },
    applyFix: applyFix,
    clearFix: clearFix,
    fixAnswerOf: fixAnswerOf,
    fixOpts: fixOpts,
    fixOptRows: fixOptRows,
    choiceOptions: choiceOptions,
    sameOpt: sameOpt,
    applyAllFixes: applyAllFixes,
    openFixPanel: openFixPanel,
    closeFixPanel: closeFixPanel,
    gradeTyped: gradeTyped,
    gradeAnswer: gradeAnswer,
    decideForms: decideForms,
    stemHtml: stemHtml,
    /* 真题优先：笔记命中卷子原题就用原题，命中不了才挖空 */
    isPaperQ: isPaperQ,
    stemCore: stemCore,
    noteScore: noteScore,
    findPaperMatch: findPaperMatch,
    preferPaper: preferPaper,
    demoteToFill: demoteToFill,
    noteLine: noteLine,
    extractPoints: extractPoints,
    buildQuestions: buildQuestions,
    splitSentences: splitSentences,
    cleanMark: cleanMark,
    markBold: markBold
  };
})();
