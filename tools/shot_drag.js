/* 拖动截图 + 帧率统计：验证拖动过程画面稳定、不发虚（人工查看 tools/out/drag-*.png） */
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9337;
const profile = path.join(os.tmpdir(), 'wbshot-drag-' + Date.now());
const OUT = path.join(__dirname, 'out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const charts = (await (await fetch(BASE + '/api/charts')).json()).charts;
  const chart = charts.find((c) => c.type === 'mindmap' && c.example) || charts[0];

  const browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1500,940', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
    } catch (e) { /* not ready */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.result.data, 'base64'));
    console.log('  截图', name);
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(chart.id) });
  await sleep(2600);

  // 帧率探针
  await ev(`(() => { window.__f = []; let last = 0;
    const tick = (t) => { if (last) window.__f.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return 1; })()`);

  const pos = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => {
      const r = x.getBoundingClientRect(); return r.width > 0 && r.left > 300 && r.top > 120;
    });
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             w: Math.round(r.width), h: Math.round(r.height), text: g.textContent.trim().slice(0, 10) };
  })()`);
  console.log('  拖动节点:', pos.text, pos.w + 'x' + pos.h);

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(80);
  for (let i = 1; i <= 16; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x + i * 14, y: pos.y + i * 7, button: 'left', buttons: 1, pointerType: 'mouse' });
    await sleep(28);
    if (i === 10) await shot('drag-mid.png');
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x + 14 * 16, y: pos.y + 7 * 16, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(300);
  await shot('drag-after.png');

  const frames = await ev(`(() => { const f = window.__f.slice(-90); f.sort((a,b)=>a-b);
    const avg = f.reduce((s, v) => s + v, 0) / (f.length || 1);
    return { n: f.length, avg: +avg.toFixed(1), p95: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(1) }; })()`);
  console.log(`  拖动期间帧间隔：平均 ${frames.avg}ms（约 ${(1000 / frames.avg).toFixed(0)}fps），p95 ${frames.p95}ms`);

  // 拖动会被自动保存，示例图用底稿重置回来，别留痕迹
  await sleep(1800);
  const r = await fetch(BASE + '/api/charts/' + encodeURIComponent(chart.id) + '/reset', { method: 'POST' });
  console.log('  示例已重置回底稿', r.status);

  ws.close(); browser.kill();
  await sleep(200);
  fs.rmSync(profile, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('ERROR', e && e.message); process.exit(2); });
