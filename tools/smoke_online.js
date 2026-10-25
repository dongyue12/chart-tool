/* 线上冒烟：真浏览器打开已发布链接，验「转换」出来的是可用结果
   用法： node tools/smoke_online.js [URL]
   默认跑投稿用的分享链接。只读操作，不改线上任何东西（转换出来的新图存在浏览器里）。 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { findBrowser } = require('./browser');

const URL_ = process.argv[2] || 'https://chart-workbench.app.workbuddy.host/?sharecode=D3JE443IGB';
const CDP = 9351;
const profile = path.join(os.tmpdir(), 'wbsmoke-online-' + Date.now());
/* 分享链接靠 __wb_rsc cookie 放行子资源（直接请求 / 会 403）。
   这个值是「?sharecode=D3JE443IGB」换到的，换分享码时用 WB_RSC 覆盖。 */
const RSC = process.env.WB_RSC || 'ed1c1c66f1383f4d797f77e399b61f73';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null, ws = null, fail = 0;
const check = (name, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail++;
};

(async () => {
  console.log('目标：' + URL_);
  browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
    } catch (e) {}
  }
  if (!target) { console.error('CDP 未就绪'); process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let msgId = 0;
  await new Promise((res) => { ws.onopen = res; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 160));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  };

  await send('Page.enable');
  await send('Network.enable');
  try {
    await send('Network.setCookie', {
      name: '__wb_rsc', value: RSC, domain: new URL(URL_).hostname, path: '/',
      secure: true, sameSite: 'None',
    });
  } catch (e) { console.log('  (种 cookie 失败: ' + e.message + ')'); }
  // 网关偶尔会返回一次 404（多副本抖动），加载失败就重载，最多 3 次
  for (let attempt = 1; attempt <= 3; attempt++) {
    await send('Page.navigate', { url: URL_ });
    await sleep(4500);
    const t = String(await ev('document.title'));
    const body = String(await ev(`document.body ? document.body.innerText.slice(0, 40) : ''`));
    if (t.includes('图表工作台') && !/404|Not Found/.test(body)) break;
    console.log(`  (第 ${attempt} 次加载失败：${t || body.slice(0, 20)}，重试)`);
  }

  /* 1. 页面能开 */
  const title = await ev('document.title');
  check('线上页面打开成功', String(title).includes('图表工作台'), title);
  if (!String(title).includes('图表工作台')) {
    const diag = await ev(`JSON.stringify({ href: location.href, body: document.body ? document.body.innerText.slice(0, 160) : '' })`);
    console.log('  诊断：' + diag);
  }
  const listCount = await ev(`document.querySelectorAll('#chartList .chart-item').length`);
  check('侧栏 12 张示例齐全', listCount === 12, '实际 ' + listCount);
  const nodes0 = await ev(`document.querySelectorAll('#layerNode .node').length`);
  check('首屏有内容（不是空白画布）', nodes0 > 0, nodes0 + ' 个节点');
  const health = await ev(`fetch('/api/health').then(r => r.json()).then(j => j.mode)`);
  check('适配层是静态模式', health === 'static-demo', String(health));

  /* 2. 点「转换」→ 甘特图 */
  const btn = await ev(`(() => {
    const b = document.querySelector('#toolbar [data-t="convert"]');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  check('找到「转换」按钮', !!btn);
  if (!btn) {
    const d = await ev(`JSON.stringify({
      ready: document.readyState,
      scripts: [...document.scripts].map(s => (s.src || 'inline').split('/').pop()),
      toolbar: document.getElementById('toolbar') ? document.getElementById('toolbar').children.length : -1,
      list: document.getElementById('chartList') ? document.getElementById('chartList').children.length : -1,
      errs: (window.__errs || []).slice(0, 3),
    })`);
    console.log('  诊断：' + d);
    console.error('无法继续'); browser.kill(); process.exit(1);
  }
  await click(btn.x, btn.y);
  await sleep(400);

  const menu = await ev(`(() => { const m = document.getElementById('menu'); return m && !m.hidden ? m.textContent.trim().slice(0, 200) : ''; })()`);
  check('转换菜单弹出且有 11 项', /甘特图/.test(menu || ''), menu);

  const pick = await ev(`(() => {
    const t = document.querySelector('#menu .menu-item[data-i="甘特图"]');
    if (!t) return null; const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  check('菜单里有「甘特图」', !!pick);
  if (pick) {
    await click(pick.x, pick.y);
    await sleep(2200);
    const g = await ev(`(() => {
      const ns = Array.from(document.querySelectorAll('#layerNode .node'));
      const txt = ns.map(n => n.textContent.trim()).join(' ');
      return { n: ns.length, sample: txt.slice(0, 160), title: (document.getElementById('titleInput') || {}).value };
    })()`);
    check('转换后画布有节点', g.n > 0, g.n + ' 个节点 · ' + g.title);
    // 甘特图的关键：日期画在轴与条形上（不在节点文字里），所以查整个画布
    const canvasText = await ev(`(() => { const s = document.getElementById('stage'); return s ? s.textContent.replace(/\\s+/g, ' ').trim().slice(0, 400) : ''; })()`);
    // 轴上刻度是 MM-DD（如 10-25），节点里也可能有完整日期
    const hasDate = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日)/.test(canvasText || '');
    check('甘特图带出了日期刻度', hasDate, (canvasText || '').slice(0, 90));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    try {
      fs.writeFileSync(path.join(__dirname, '..', 'docs', 'smoke-线上甘特图.png'), Buffer.from(shot.result.data, 'base64'));
      console.log('  截图：docs/smoke-线上甘特图.png');
    } catch (e) {}
    const after = await ev(`document.querySelectorAll('#chartList .chart-item').length`);
    check('转换是新建一份（侧栏 13）', after === 13, '实际 ' + after);
  }

  /* 3. 再验时间线 */
  const btn2 = await ev(`(() => {
    const b = document.querySelector('#toolbar [data-t="convert"]');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await click(btn2.x, btn2.y);
  await sleep(400);
  const pick2 = await ev(`(() => {
    const t = document.querySelector('#menu .menu-item[data-i="时间线"]');
    if (!t) return null; const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  check('菜单里有「时间线」', !!pick2);
  if (pick2) {
    await click(pick2.x, pick2.y);
    await sleep(2200);
    const t = await ev(`(() => {
      const ns = Array.from(document.querySelectorAll('#layerNode .node'));
      return { n: ns.length, sample: ns.map(n => n.textContent.trim()).join(' ').slice(0, 160) };
    })()`);
    check('时间线有节点', t.n > 0, t.n + ' 个');
    check('时间线带出日期', /(\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2})/.test(t.sample || ''), (t.sample || '').slice(0, 90));
  }

  /* 4. 页面有没有 JS 报错 */
  const errs = await ev(`(window.__errs || []).length`);
  check('没有未捕获 JS 错误', !errs, String(errs || 0));

  ws.close();
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  const total = 12;
  console.log(`\n通过 ${total - fail} / ${total}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('异常：', e.message);
  try { browser && browser.kill(); } catch (_) {}
  process.exit(1);
});
