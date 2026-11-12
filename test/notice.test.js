'use strict';
/* 更新公告弹窗
   运行： NODE_PATH=<workspace>/node_modules node test/notice.test.js

   为什么要有这个：11-09 域名绑定失效，官方链接变成一串会话 ID，
   老域名停在旧版本又没法重新部署 —— 只在小红书/推文里说一句，
   已经打开网站的人看不见。所以公告必须长在站里。

   这里守的线：
     ① 第一次来（没看过这一版）→ 弹
     ② 关掉之后记住，再进来不弹
     ③ 换一版公告（改 id）→ 重新弹一次，但不是每次刷新都弹
     ④ 文案里讲清「旧地址不维护了」，并且把当前地址摆出来
     ⑤ 关得掉：点「知道了」、点遮罩、按 Esc 都行                          */

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

  let copied = null;
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (s) => { copied = s; return Promise.resolve(); } }
  });

  const fn = new Function(
    'window', 'document', 'localStorage', 'fetch', 'confirm', 'prompt', 'alert',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'Blob', 'URL', 'FileReader', 'crypto', 'navigator', APP_SRC
  );
  fn(win, win.document, ls, () => Promise.reject(new TypeError('no fetch')), win.confirm, win.prompt, win.alert,
    setTimeout, clearTimeout, setInterval, clearInterval, win.Blob || globalThis.Blob, U, class {}, win.crypto, win.navigator);

  return { win, d: win.document, api: win.FQInternals, ls, copied: () => copied };
}

const modal = (d) => d.querySelector('#noticeModal');
const seen = (ls) => ls.getItem('fq_notice_v1');

/* ---------------- 一、第一次来就弹，且文案该有的都有 ---------------- */
console.log('\n一、第一次访问：弹公告，把这一版讲清楚');
{
  const { d, api, ls } = boot();
  ok(modal(d).hidden === false, '启动后公告是开着的（不用手点）');
  const title = d.querySelector('#noticeTitle').textContent || '';
  ok(title.indexOf('删') >= 0, '标题说的是「能删题」这事', title);
  const lead = d.querySelector('#noticeLead').textContent || '';
  ok(lead.indexOf('切成两条') >= 0, '导语里点明了「一道题被切成两条」的来由', lead.slice(0, 40));
  const items = d.querySelectorAll('#noticeList li');
  ok(items.length >= 3, '新功能列了 ' + items.length + ' 条');
  // 公告的重点会随版本变（这一版是删题），但每一条变更都得有下落
  const all = Array.prototype.map.call(items, function (li) { return li.textContent || ''; }).join(' ');
  ok(all.indexOf('题集') >= 0, '讲清删的是题集里那一条');
  ok(all.indexOf('找不回来') >= 0, '把「删了找不回」说在前面', all.slice(0, 60));
  // 地址类文案一律取 location.host，不许在公告里写死域名（域名换过三次了）
  const whole = title + lead + all;
  ok(!/https?:\/\/|\.host\b/.test(whole), '公告正文里没有写死域名', whole.match(/https?:\/\/\S*|\.host\b/));
  ok(!/url\(/i.test(all), '没有塞图片外链');
  ok(d.querySelector('#noticeUrl').hidden === false, '把当前地址摆出来了');
  ok(d.querySelector('#noticeUrlText').textContent === 'localhost', '显示的是当前域名',
    d.querySelector('#noticeUrlText').textContent);
  ok(seen(ls) === null, '还没关，就先不记账');
}

/* ---------------- 二、关掉就记住 ---------------- */
console.log('\n二、点「知道了」：关掉并记住，不再打扰');
{
  const { d, api, ls } = boot();
  const btn = Array.from(d.querySelectorAll('#noticeModal [data-noticeclose]'))
    .filter((el) => el.tagName === 'BUTTON' && !el.classList.contains('mini-btn'))[0];
  btn.click();
  ok(modal(d).hidden === true, '关上了');
  ok(seen(ls) === api.NOTICE.id, '记下了这一版的 id', seen(ls));
  ok(api.noticeSeen() === true, 'noticeSeen() 认这个 id');
  ok(api.maybeShowNotice() === false, '再调一次不会再弹');
  ok(modal(d).hidden === true, '还是关着的');
}

/* ---------------- 三、已经看过的人，启动时不该再弹 ---------------- */
console.log('\n三、看过的人第二次打开：启动就是安静的');
{
  // 别把 id 写死：公告换版这里就会跟着失效，直接问当前这一版的 id
  const cur = boot().api.NOTICE.id;
  const { d, api } = boot({ fq_notice_v1: cur });
  ok(modal(d).hidden === true, '不会自己弹出来');
  ok(api.maybeShowNotice() === false, '也不会补弹');
}

/* ---------------- 四、换一版公告，才重新弹 ---------------- */
console.log('\n四、下次大改动：改 NOTICE.id 就重新弹一次');
{
  const { d, api, ls } = boot({ fq_notice_v1: '2026-11-09-link-moved' });
  api.NOTICE.id = '2026-12-01-something-new';
  ok(api.maybeShowNotice() === true, '换了 id 又弹了');
  ok(modal(d).hidden === false, '真的打开了');
  api.closeNotice();
  ok(seen(ls) === '2026-12-01-something-new', '记的是新 id', seen(ls));
  ok(api.maybeShowNotice() === false, '同一个人不会被弹两次');
}

/* ---------------- 五、三条关闭路径 ---------------- */
console.log('\n五、关闭的三条路都能走通');
{
  const { d, api } = boot();
  api.closeNotice();
  api.openNotice();
  d.querySelector('#noticeModal .modal-mask').click();
  ok(modal(d).hidden === true, '点遮罩能关');

  api.openNotice();
  d.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  ok(modal(d).hidden === true, '按 Esc 能关');

  api.openNotice();
  d.querySelector('#noticeModal .modal-head .mini-btn').click();
  ok(modal(d).hidden === true, '点右上角 ✕ 能关');
}

/* ---------------- 六、复制按钮给的是当前地址 ---------------- */
console.log('\n六、「复制新地址」复制的是当前页地址，不是写死的常量');
{
  const { d, api, copied } = boot();
  api.openNotice();
  d.querySelector('#noticeCopyBtn').click();
  return Promise.resolve().then(() => {
    ok(copied() === 'http://localhost/', '复制到了当前地址', copied());
    ok((d.querySelector('#toast').textContent || '').indexOf('复制') >= 0, '顺手给了个提示',
      d.querySelector('#toast').textContent);
    console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过') + '（' + pass + ' 项）');
    process.exit(fail ? 1 : 0);
  });
}
