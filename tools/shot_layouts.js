/* 思维导图 5 种布局截图：切布局 → 截画布区域，输出到 tools/out/layout-*.png
 * 用法：node tools/shot_layouts.js [port]
 */
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9341;
const OUT = path.join(__dirname, 'out');
const profile = path.join(os.tmpdir(), 'wb-lay-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = ['balanced', 'right', 'down', 'up', 'radial'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const n = (text, parent) => ({ id: 'n' + Math.random().toString(36).slice(2, 8), text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
  const root = n('产品新版规划');
  const b1 = n('用户研究', root.id), b2 = n('功能设计', root.id), b3 = n('技术方案', root.id), b4 = n('上线节奏', root.id);
  const n11 = n('访谈 20 位用户', b1.id), n12 = n('竞品功能拆解', b1.id);
  const n21 = n('工作台改版', b2.id), n22 = n('多图表布局', b2.id), n23 = n('导出增强', b2.id);
  const n31 = n('零依赖前端', b3.id), n32 = n('文件即数据', b3.id);
  const n41 = n('内测灰度', b4.id), n42 = n('全量发布', b4.id);
  const n211 = n('侧栏分组', n21.id), n212 = n('快捷键', n21.id), n221 = n('双向发散', n22.id), n222 = n('环形放射', n22.id);
  const nodes = [root, b1, b2, b3, b4, n11, n12, n21, n22, n23, n31, n32, n41, n42, n211, n212, n221, n222];
  const doc = { id: 'tmp-layouts', type: 'mindmap', title: '布局预览', nodes, links: [], meta: { layout: 'balanced' } };
  await fetch(BASE + '/api/charts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });

  const browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1500,940', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) {}
  }
  if (!target) { console.error('CDP 未就绪'); browser.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let msgId = 0;
  await new Promise((res) => { ws.onopen = res; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception.description || 'eval error');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/studio/?id=tmp-layouts' });
  await sleep(2600);

  for (const key of KEYS) {
    const ok = await ev(`(() => {
      const b = document.querySelector('[data-layout="${key}"]');
      if (!b) return 'no-chip';
      b.click();
      return 'ok';
    })()`);
    if (ok !== 'ok') { console.error(key, ok); continue; }
    await sleep(700);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `layout-${key}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('saved', key);
  }

  // 顺手验证：来回切布局后回到同一布局，坐标与首次一致（幂等）
  const idem = await ev(`(async () => {
    const click = async (k) => { document.querySelector('[data-layout="' + k + '"]').click(); await new Promise(r => setTimeout(r, 400)); };
    const snap = () => [...document.querySelectorAll('#layerNode > g')].map(g => g.getAttribute('transform')).join('|');
    await click('balanced'); const first = snap();
    await click('radial'); await click('balanced'); const again = snap();
    return first === again ? 'same' : 'diff';
  })()`);
  console.log('balanced 往返后是否一致：', idem);

  ws.close();
  browser.kill();
  await fetch(BASE + '/api/charts/tmp-layouts', { method: 'DELETE' }).catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(0);
})();
