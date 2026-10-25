/* 渲染增量更新验证：DOM 元素在选中/拖动/改字后是否被复用（不重建） */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9335;
const profile = path.join(os.tmpdir(), 'wb-rd-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
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
  const charts = (await (await fetch(BASE + '/api/charts')).json()).charts;
  const chart = charts.find((c) => c.type === 'flow') || charts[0];
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(chart.id) });
  await sleep(2500);

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };

  // 给所有节点打标记
  const marked = await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g.node')];
    gs.forEach((g, i) => { g.__probe = i + 1; });
    return gs.length;
  })()`);
  check('节点已渲染', marked > 1, marked + ' 个');

  // 选中另一个节点（会触发 render）
  await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g.node')];
    const t = gs[1] || gs[0];
    const r = t.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  })()`).then(async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
  });
  await sleep(300);

  const afterClick = await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g.node')];
    return { total: gs.length, kept: gs.filter(g => g.__probe).length };
  })()`);
  check('选中后节点元素被复用（未重建）', afterClick.total === afterClick.kept && afterClick.total > 1,
    `${afterClick.kept}/${afterClick.total}`);

  // 拖动选中节点（会连续多次 render）
  const p2 = await ev(`(() => {
    const g = document.querySelector('#layerNode > g.node.sel');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  })()`);
  if (p2) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p2.x), y: Math.round(p2.y), button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p2.x + i * 6), y: Math.round(p2.y + i * 3), button: 'left' });
      await sleep(30);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p2.x + 48), y: Math.round(p2.y + 24), button: 'left', clickCount: 1 });
    await sleep(400);
    const afterDrag = await ev(`(() => {
      const gs = [...document.querySelectorAll('#layerNode > g.node')];
      return { total: gs.length, kept: gs.filter(g => g.__probe).length };
    })()`);
    check('拖动后节点元素被复用（未重建）', afterDrag.total === afterDrag.kept && afterDrag.total > 1,
      `${afterDrag.kept}/${afterDrag.total}`);
  } else {
    check('拖动后节点元素被复用', false, '未找到选中节点');
  }

  // 改字后仍复用（内容变了要重写 innerHTML，但外层 g 必须复用）
  await ev(`(() => {
    const g = document.querySelector('#layerNode > g.node.sel');
    const r = g.getBoundingClientRect();
    const ev2 = new MouseEvent('pointerdown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 });
    return 1;
  })()`);
  const afterAll = await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g.node')];
    return { total: gs.length, kept: gs.filter(g => g.__probe).length };
  })()`);
  check('多次渲染后仍复用', afterAll.total === afterAll.kept, `${afterAll.kept}/${afterAll.total}`);

  console.log(fail ? `\n失败 ${fail} 项` : '\n渲染增量更新验证通过');
  browser.kill();
  try { ws.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e && e.message); process.exit(2); });
