'use strict';
/* 今日战绩卡
   运行： NODE_PATH=<workspace>/node_modules node test/sharecard.test.js

   这个功能的坑不在「画」，在「算什么」：
     · 「今天刷了几题」得按天分，而原来只有 fq_log（每天一个总数，看不出题）
     · 「错得最多的那道」得在同一题上累计错次，不是整场错题数
     · 过了零点再点分享，不能给一张全 0 的空卡
   canvas 本身在 happy-dom 里没有 2d 上下文，所以绘制只能靠真机核（已核过），
   这里守的是喂进去的数据。

   绘图那头的验收（改排版后请重跑）：
     ① 本地起静态服务，用带种子的壳页面出图
     ② pyzbar 解整张截图，解出的地址要和页面地址一致                      */

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
const BODY = (HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1]
  .replace(/<script[\s\S]*?<\/script>/gi, '');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}

const QUESTIONS = [
  { id: 'q1', type: 'fill', stem: '首过效应是指____。', answer: '药物经胃肠道吸收后先经过肝脏代谢' },
  { id: 'q2', type: 'fill', stem: '半衰期是指____。', answer: '血浆药物浓度下降一半所需的时间' },
  { id: 'q3', type: 'single', stem: '属于用药不适宜处方的是____。', answer: '用法、用量不适宜的', opts: ['用法、用量不适宜的', '重复给药的'] }
];

function boot(seed) {
  const win = new Window({ url: 'http://localhost/' });
  win.document.body.innerHTML = BODY;
  win.crypto = require('crypto').webcrypto;
  win.Element.prototype.scrollIntoView = function () {};
  win.confirm = () => true;
  win.prompt = (m, d) => d;
  win.alert = () => {};

  const m = new Map(Object.entries(seed || {}));
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
  const U = globalThis.URL;
  if (!U.createObjectURL) U.createObjectURL = () => 'blob:mock';

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator', APP_SRC
  );
  fn(win, win.document, ls, () => Promise.reject(new TypeError('no fetch')), win.confirm, win.prompt,
    win.alert, setTimeout, clearTimeout, setInterval, clearInterval,
    win.Blob || globalThis.Blob, U, class {}, win.crypto, win.navigator);

  return { win, d: win.document, api: win.FQInternals, ls };
}

function seedWith(daily, questions) {
  return {
    fq_banks_v1: JSON.stringify([{
      id: 'b1', course: '药理学', questions: questions || QUESTIONS
    }]),
    fq_current_v1: 'b1',
    fq_daily_v1: JSON.stringify(daily || []),
    fq_stats_v1: '{}',
    fq_notice_v1: 'seen'
  };
}

console.log('\n[1] 记一笔：对错分开数，简答「部分正确」算对');
{
  const { api } = boot(seedWith([]));
  api.bumpDaily('q1', 'right');
  api.bumpDaily('q1', 'mid');
  api.bumpDaily('q1', 'wrong');
  // bumpDaily 只改内存，落盘交给 recordAnswer 末尾那次 save()（一题只写一次 localStorage）
  const row = api.dailyRows()[0];
  ok(row.d === dayKey(0), '记在今天这一行', row.d);
  ok(row.q.q1.o === 2, 'right + mid 都记成「对」', row.q.q1);
  ok(row.q.q1.b === 1, 'wrong 记成「错」');
}

console.log('\n[2] 汇总：刷了几题、正确率、错得最多的是哪道');
{
  const daily = [{
    d: dayKey(0),
    q: { q1: { o: 1, b: 4 }, q2: { o: 9, b: 1 }, q3: { o: 6, b: 1 } }
  }];
  const { api } = boot(seedWith(daily));
  const s = api.dailySummary(dayKey(0));
  ok(s.total === 22, 'total 是作答次数（1+4 + 9+1 + 6+1）', s.total);
  ok(s.ok === 16, 'ok = 16', s.ok);
  ok(s.bad === 6, 'bad = 6', s.bad);
  ok(s.distinct === 3, 'distinct = 3 道不同的题', s.distinct);
  ok(s.acc === 73, '正确率 16/22 ≈ 73%', s.acc);
  ok(s.worst === 'q1', '错得最多的是 q1（错 4 次）', s.worst);
  ok(s.worstBad === 4, '错次 4', s.worstBad);
}

console.log('\n[3] 错次并列时取先遇到的那道（不是随机跳）');
{
  const daily = [{ d: dayKey(0), q: { q1: { o: 1, b: 2 }, q2: { o: 1, b: 2 }, q3: { o: 1, b: 1 } } }];
  const { api } = boot(seedWith(daily));
  ok(api.dailySummary(dayKey(0)).worst === 'q1', '并列时落到 q1');
}

console.log('\n[4] 只留最近 14 天，别把 localStorage 撑爆');
{
  const old = [];
  for (let i = 20; i >= 1; i--) old.push({ d: dayKey(-i), q: { q1: { o: 1, b: 0 } } });
  const { api } = boot(seedWith(old));
  api.bumpDaily('q1', 'right');
  const rows = api.dailyRows();
  ok(rows.length === 14, '超过 14 天就裁掉最老的', rows.length);
  ok(rows[rows.length - 1].d === dayKey(0), '最新的在最后');
  ok(rows[0].d === dayKey(-13), '最老的一条是 13 天前', rows[0].d);
}

console.log('\n[5] 过了零点再点分享：退回最近有记录的那天，不装成今天');
{
  const daily = [{ d: dayKey(-1), q: { q1: { o: 3, b: 2 } } }];
  const { api } = boot(seedWith(daily));
  ok(api.latestDailyKey() === dayKey(-1), '今天没刷 → 取昨天');
  const d = api.cardData();
  ok(d.total === 5, '数据是昨天那 5 次作答', d.total);
  ok(d.isToday === false, '卡片知道自己不是今天的数据');
  ok(d.dayLabel.indexOf('/') > 0, '日期标签形如「11 / 09 周日」', d.dayLabel);
}

console.log('\n[6] 今天有记录就优先今天');
{
  const daily = [
    { d: dayKey(-1), q: { q1: { o: 3, b: 2 } } },
    { d: dayKey(0), q: { q2: { o: 1, b: 0 } } }
  ];
  const { api } = boot(seedWith(daily));
  ok(api.latestDailyKey() === dayKey(0), '取今天');
  ok(api.cardData().isToday === true, '标记成今天');
}

console.log('\n[7] 卡片里的题：查得到原题、题干干净');
{
  const daily = [{ d: dayKey(0), q: { q3: { o: 0, b: 3 }, q1: { o: 5, b: 0 } } }];
  const { api } = boot(seedWith(daily));
  const d = api.cardData();
  ok(d.worstQ && d.worstQ.id === 'q3', 'worstQ 能按 id 找回到原题');
  // 空位一律改写成「六条下划线、前后各一空格」，原卷里几条下划线都归一
  ok(!/_{7,}/.test(api.cardStemText(d.worstQ)), '原卷的长下划线串被收短，没整段糊在一起',
    api.cardStemText(d.worstQ));
  ok(api.cardStemText(d.worstQ).indexOf(' ______ ') > 0, '读起来还是「____」',
    api.cardStemText(d.worstQ));
  ok(api.cardStemText({ stem: '<b>加粗</b>的____题' }) === '加粗的 ______ 题',
    'HTML 标签会被剥掉', api.cardStemText({ stem: '<b>加粗</b>的____题' }));
}

console.log('\n[8] 题被删了也不能炸（worst 指向一个不存在的 id）');
{
  const daily = [{ d: dayKey(0), q: { ghost: { o: 0, b: 2 }, q1: { o: 1, b: 1 } } }];
  const { api } = boot(seedWith(daily));
  const d = api.cardData();
  ok(d.worstQ === null, '查不到就当没有');
  ok(d.total === 4, '总数照常算', d.total);
}

console.log('\n[9] 二维码扫的是当前地址：一次性参数要摘掉');
{
  const daily = [{ d: dayKey(0), q: { q1: { o: 1, b: 0 } } }];
  const { api } = boot(seedWith(daily));
  const saved = globalThis.location;
  globalThis.location = new globalThis.URL('https://x.app.traesite7.host/?sharecode=ABC&code=zz&state=yy#/quiz');
  const u = api.shareUrl();
  globalThis.location = saved;
  ok(u.indexOf('sharecode=ABC') > 0, '分享码要留住', u);
  // 注意别用 indexOf('code=')：sharecode=ABC 里就含子串 code=，会自己误判
  const q = new globalThis.URL(u).searchParams;
  ok(!q.has('code'), '登录回调的 code 不能印进码里', u);
  ok(!q.has('state'), 'state 也不能', u);
  ok(u.indexOf('#') < 0, 'hash 去掉', u);
}

console.log('\n[10] 今天一题没刷：不给空卡');
{
  const { api } = boot(seedWith([]));
  ok(api.cardImageUrl() === '', '没有数据就不出图（外面会提示先去刷一组）');
  const d = api.cardData();
  ok(d.total === 0, 'data 里 total 是 0');
  ok(d.worstBad === 0, '没有「错最多」这回事');
}

console.log('\n[11] 画不出来也不抛异常（老浏览器 / canvas 被禁）');
{
  const daily = [{ d: dayKey(0), q: { q1: { o: 1, b: 1 } } }];
  const { api } = boot(seedWith(daily));
  let threw = false;
  let url = 'x';
  try { url = api.cardImageUrl(); } catch (e) { threw = true; }
  ok(threw === false, '不往外抛');
  // happy-dom 没有 2d 上下文，正好模拟「画不了」这一路
  ok(url === '', '画不了就返回空串，交给界面提示', url);
}

console.log('\n[12] 入口在页面上摆着');
{
  const { d } = boot(seedWith([]));
  ok(!!d.querySelector('#genCardBtn'), '统计页有「生成战绩卡」按钮');
  ok(!!d.querySelector('#todayLine'), '按钮下面有一行今日数据（点开前先看一眼）');
  ok(!!d.querySelector('#cardModal'), '弹窗结构在');
  ok(!!d.querySelector('#cardPreview'), '预览图位在');
  ok(!!d.querySelector('#cardSaveBtn'), '保存按钮在');
  const foot = d.querySelector('#cardModal .modal-foot');
  ok(!!foot, '弹窗有底栏（按钮不会被内容挤出去）');
}

console.log('\n[13] 统计页那行今日数据：有数说数，没数说人话');
{
  const daily = [{ d: dayKey(0), q: { q1: { o: 1, b: 4 }, q2: { o: 9, b: 1 } } }];
  const withData = boot(seedWith(daily));
  withData.api.renderStats();
  const t1 = withData.d.querySelector('#todayLine').textContent || '';
  const s = withData.api.dailySummary(dayKey(0));
  ok(t1.indexOf(s.total + ' 题') >= 0, '说的是当天总题数', t1);
  ok(t1.indexOf(s.acc + '%') >= 0, '带上正确率', t1 + ' / acc=' + s.acc);
  ok(t1.indexOf('最缠人') >= 0, '点了名：错最多的那道', t1);

  const empty = boot(seedWith([]));
  empty.api.renderStats();
  const t2 = empty.d.querySelector('#todayLine').textContent || '';
  ok(t2.indexOf('还没开始') >= 0, '今天没刷就直说，不摆 0 题的空数', t2);
  ok(t2.indexOf('%') < 0, '没数据不显示 0% 这种废话', t2);
}

console.log('\n[14] qr-mini 是独立脚本，app.js 之前就得就位');
{
  const idx = HTML.indexOf('vendor/qr-mini.js');
  const app = HTML.indexOf('app.js?v=');
  ok(idx > 0, 'index.html 引了 qr-mini.js');
  ok(idx < app, '它排在 app.js 前面（app 里要用 QRMini）');
  const qrSrc = fs.readFileSync(path.join(ROOT, 'vendor', 'qr-mini.js'), 'utf8');
  ok(qrSrc.indexOf('QRMini') > 0, 'qr-mini.js 确实导出 QRMini');
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) process.exit(1);
