/* 静态演示版（site/）验收：起一个纯静态服务器 + 真实浏览器，验证「没有后端也能用」 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { findBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const PORT = process.argv[2] || '8899';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9341;
const profile = path.join(os.tmpdir(), 'wbsite-test-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PY = process.env.PYTHON || process.env.PY || 'python';

let srv = null, browser = null, ws = null;
let fail = 0;
let TEMP_IDS = [];
let evFn = null;          // 页面内求值，cleanup 里也要用

const check = (name, cond, extra) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) fail++;
};

(async () => {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) {
    console.error('site/index.html 不存在，先跑： python tools/build_site.py');
    process.exit(1);
  }

  // 1) 纯静态服务器（等价于线上托管，没有任何 API）
  srv = spawn(PY, ['-m', 'http.server', PORT, '--directory', SITE], { cwd: ROOT, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(200);
    try {
      const r = await fetch(BASE + '/index.html', { method: 'HEAD' });
      up = r.ok;
    } catch (e) {}
  }
  if (!up) { console.error('静态服务器没起来'); await cleanup(); process.exit(1); }

  // 2) 真实浏览器
  browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) {}
  }
  if (!target) { console.error('CDP 未就绪'); await cleanup(); process.exit(1); }

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
    if (r.result && r.result.exceptionDetails) {
      throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  evFn = ev;
  await send('Page.enable');

  await send('Page.navigate', { url: BASE + '/' });
  await sleep(2600);

  /* ---------------------------------------------------- 1. 页面与资源 */
  check('静态页打开成功', (await ev('document.title')).includes('图表工作台'), await ev('document.title'));
  check('样式表已加载', (await ev('document.styleSheets.length')) >= 1);

  const listCount = await ev(`document.querySelectorAll('#chartList .chart-item').length`);
  check('侧栏列出 12 张示例', listCount === 12, '实际 ' + listCount);

  const first = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node'));
    return { n: g.length, title: (document.getElementById('titleInput') || {}).value };
  })()`);
  check('首屏自动打开一张图', first.n > 0, `${first.n} 个节点 · ${first.title}`);

  check('侧栏有演示版说明', await ev(`!!document.getElementById('demoNote')`));

  /* ---------------------------------------------------- 2. 适配层接口 */
  const apiList = await ev(`fetch('/api/charts').then(r => r.json())`);
  check('GET /api/charts 走本地适配层', apiList.charts.length === 12, '返回 ' + apiList.charts.length);
  check('12 张全部标记为示例', apiList.charts.every((c) => c.example === true));

  const health = await ev(`fetch('/api/health').then(r => r.json())`);
  check('/api/health 返回静态模式', health.mode === 'static-demo', health.mode);

  const delCode = await ev(`fetch('/api/charts/' + encodeURIComponent(${JSON.stringify(first.title || '示例：如何与 WorkBuddy 协作')}), { method: 'DELETE' }).then(r => r.status)`);
  check('示例图拒绝删除（403）', delCode === 403, 'HTTP ' + delCode);

  /* ---------------------------------------------------- 3. 双击改文字 → 刷新还在 */
  const pos = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => x.getBoundingClientRect().width > 0);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: g.dataset.id };
  })()`);
  check('找到可编辑节点', !!pos, pos && pos.id);
  if (!pos) { await cleanup(); console.log(`\n通过 ${21 - fail} / 21`); process.exit(1); }

  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  };
  await click(pos.x, pos.y);
  await sleep(130);
  await click(pos.x, pos.y);
  await sleep(400);

  const boxOpen = await ev(`(() => { const b = document.getElementById('editBox'); return !b.hidden && b.dataset.id === ${JSON.stringify(pos.id)}; })()`);
  check('双击弹出就地编辑框', boxOpen);

  const NEWTEXT = '静态版改过了';
  await ev(`document.getElementById('editBox').select(); 1`);
  await send('Input.insertText', { text: NEWTEXT });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(700);

  const shown = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => x.dataset.id === ${JSON.stringify(pos.id)});
    if (!g) return null;
    const t = g.querySelector('.nd-text') || g;
    return t.textContent.trim();
  })()`);
  check('节点文字已改', shown === NEWTEXT, shown);

  await sleep(1800);   // 等 1.4s 自动保存防抖
  const stored = await ev(`(() => {
    const raw = localStorage.getItem('chartstudio.demo.v1');
    if (!raw) return null;
    const db = JSON.parse(raw);
    const k = Object.keys(db.charts)[0];
    return { key: k, text: db.charts[k].nodes.find(n => n.id === ${JSON.stringify(pos.id)}).text };
  })()`);
  check('改动写进了浏览器存储', !!stored && stored.text === NEWTEXT, stored && stored.text);

  await send('Page.reload');
  await sleep(2600);
  const afterReload = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => x.dataset.id === ${JSON.stringify(pos.id)});
    if (!g) return null;
    const t = g.querySelector('.nd-text') || g;
    return t.textContent.trim();
  })()`);
  check('刷新后改动仍在', afterReload === NEWTEXT, afterReload);

  /* ---------------------------------------------------- 4. 新建 / 历史 / 恢复 / 重置 */
  const created = await ev(`(async () => {
    const r = await fetch('/api/charts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '测试：静态新建', type: 'flow',
        doc: { nodes: [{ id: 'n1', text: '甲' }], links: [] } }),
    });
    return r.json();
  })()`);
  if (created && created.id) TEMP_IDS.push(created.id);
  check('演示版里能新建图表', !!created && !!created.id, created && created.id);

  const list2 = await ev(`fetch('/api/charts').then(r => r.json()).then(d => d.charts.length)`);
  check('新建后列表变 13 张', list2 === 13, '实际 ' + list2);

  // 存两次，攒出两个历史版本
  await ev(`(async () => {
    const id = ${JSON.stringify(created.id)};
    const put = (text) => fetch('/api/charts/' + encodeURIComponent(id), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: { id, type: 'flow', title: '测试：静态新建',
        nodes: [{ id: 'n1', text }], links: [] } }),
    }).then(r => r.json());
    await put('版本甲');
    await put('版本乙');
    return 1;
  })()`);

  const hist = await ev(`fetch('/api/charts/' + encodeURIComponent(${JSON.stringify(created.id)}) + '/history').then(r => r.json())`);
  check('保存后能列出历史版本', (hist.history || []).length >= 2, (hist.history || []).length + ' 个');

  const restored = await ev(`(async () => {
    const id = ${JSON.stringify(created.id)};
    const h = await fetch('/api/charts/' + encodeURIComponent(id) + '/history').then(r => r.json());
    const oldest = h.history[h.history.length - 1].stamp;
    await fetch('/api/charts/' + encodeURIComponent(id) + '/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamp: oldest }),
    });
    return fetch('/api/charts/' + encodeURIComponent(id)).then(r => r.json()).then(d => d.nodes[0].text);
  })()`);
  check('历史版本能恢复', restored === '甲', restored);

  const delOk = await ev(`fetch('/api/charts/' + encodeURIComponent(${JSON.stringify(created.id)}), { method: 'DELETE' }).then(r => r.status)`);
  check('自建图表可以删除', delOk === 200, 'HTTP ' + delOk);
  TEMP_IDS = [];

  /* ---------------------------------------------------- 5. 示例重置 */
  const resetText = await ev(`(async () => {
    const list = await fetch('/api/charts').then(r => r.json());
    const id = list.charts.find(c => c.example).id;
    await fetch('/api/charts/' + encodeURIComponent(id) + '/reset', { method: 'POST' });
    const d = await fetch('/api/charts/' + encodeURIComponent(id)).then(r => r.json());
    return { id, n: d.nodes.length };
  })()`);
  check('示例可一键重置回底稿', resetText.n > 0, `${resetText.id} · ${resetText.n} 节点`);

  /* ---------------------------------------------------- 6. 导出不炸 */
  const svgOk = await ev(`(() => {
    try {
      const g = document.getElementById('stage');
      const s = new XMLSerializer().serializeToString(g);
      return s.length > 200 && s.indexOf('<svg') === 0;
    } catch (e) { return false; }
  })()`);
  check('画布可序列化成 SVG（导出链路可用）', svgOk);

  await cleanup();
  console.log(`\n通过 ${21 - fail} / 21`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e && e.message);
  await cleanup();
  process.exit(2);
});

async function cleanup() {
  for (const id of TEMP_IDS) {
    try { await evFn(`fetch('/api/charts/' + encodeURIComponent(${JSON.stringify(id)}), {method:'DELETE'})`); } catch (e) {}
  }
  try { if (srv) srv.kill(); } catch (e) {}
  try { if (browser) browser.kill(); } catch (e) {}
  try { if (ws) ws.close(); } catch (e) {}
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
