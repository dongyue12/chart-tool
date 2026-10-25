/* 真实鼠标拖动测试：验证拖动跟手（不抖）、子树随动、松手后位置不跳、DOM 不被重建、坐标落在像素格上 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9336;
const profile = path.join(os.tmpdir(), 'wbdrag-test-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TITLE = '测试：拖动跟手-' + Date.now().toString(36);
let CHART_ID = null;

(async () => {
  // ---------- 造一张临时图（不碰示例）
  const tpl = {
    nodes: [], links: [], meta: { layout: 'balanced' }, type: 'mindmap', title: TITLE,
  };
  const N = (id, text, parent) => ({ id, text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
  tpl.nodes = [
    N('r', '中心主题'), N('a', '分支甲', 'r'), N('b', '分支乙', 'r'),
    N('a1', '甲-要点一', 'a'), N('a2', '甲-要点二', 'a'),
    N('b1', '乙-要点一', 'b'),
    N('a11', '甲-细节', 'a1'),
  ];
  const mk = await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TITLE, type: 'mindmap', doc: tpl }),
  });
  if (!mk.ok) { console.error('建测试图失败', mk.status); process.exit(1); }
  CHART_ID = (await mk.json()).id;

  const browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
    } catch (e) { /* not ready */ }
  }
  if (!target) { console.error('CDP 未就绪'); cleanup(); process.exit(1); }

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
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('eval error');
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2500);

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };

  const nodeInfo = (id) => ev(`(() => {
    const g = document.querySelector('#layerNode .node[data-id="${id}"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform') || '');
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height,
             tx: m ? +m[1] : null, ty: m ? +m[2] : null, transform: g.getAttribute('transform') };
  })()`);

  const zoom = await ev(`(() => { const m = /scale\\(([\\d.]+)\\)/.exec(document.getElementById('viewport').getAttribute('transform') || ''); return m ? +m[1] : 1; })()`);

  // ---------- 1. 拖动带子节点的分支（树形：子树应整体跟随）
  const dragId = 'a';
  const kids = ['a', 'a1', 'a2', 'a11'];
  await ev(`(() => { document.querySelectorAll('#layerNode .node').forEach(g => { g.__mark = g.dataset.id; }); return 1; })()`);
  const start = await nodeInfo(dragId);
  const rel0 = await ev(`(() => {
    const box = (id) => { const g = document.querySelector('#layerNode .node[data-id="' + id + '"]');
      const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); return { x: +m[1], y: +m[2] }; };
    const a = box('a');
    return ['a1','a2','a11'].map(id => { const b = box(id); return { id, dx: +(b.x - a.x).toFixed(2), dy: +(b.y - a.y).toFixed(2) }; });
  })()`);

  const STEP = 14, STEPS = 9;
  const x0 = Math.round(start.cx), y0 = Math.round(start.cy);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(60);

  const track = [];
  for (let i = 1; i <= STEPS; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + STEP * i, y: y0, button: 'left', buttons: 1, pointerType: 'mouse' });
    await sleep(45);
    const n = await nodeInfo(dragId);
    track.push({ i, screenDx: STEP * i, tx: n.tx, ty: n.ty, transform: n.transform });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + STEP * STEPS, y: y0, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(500);

  const afterUp = await nodeInfo(dragId);

  // 每步位移
  const d = [];
  for (let i = 1; i < track.length; i++) d.push(+(track[i].tx - track[i - 1].tx).toFixed(2));
  const expectStep = +(STEP / zoom).toFixed(2);
  const monotonic = d.every((v) => v > 0);
  const steady = d.every((v) => Math.abs(v - expectStep) <= 1.2);
  check('拖动每帧都朝同一方向（无来回振荡）', monotonic, 'steps=' + d.slice(0, 6).join(','));
  check('每帧位移与鼠标位移一致（跟手）', steady, `期望≈${expectStep} 实测=${d.slice(0, 6).join(',')}`);

  const totalDx = +(afterUp.tx - start.tx).toFixed(2);
  const expectTotal = +(STEP * STEPS / zoom).toFixed(2);
  check('总位移 = 鼠标总位移', Math.abs(totalDx - expectTotal) <= 2, `期望≈${expectTotal} 实测=${totalDx}`);

  const relAfter = await ev(`(() => {
    const box = (id) => { const g = document.querySelector('#layerNode .node[data-id="' + id + '"]');
      const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); return { x: +m[1], y: +m[2] }; };
    const a = box('a');
    return ['a1','a2','a11'].map(id => { const b = box(id); return { id, dx: +(b.x - a.x).toFixed(2), dy: +(b.y - a.y).toFixed(2) }; });
  })()`);
  const relOk = relAfter.every((r, i) => Math.abs(r.dx - rel0[i].dx) <= 0.6 && Math.abs(r.dy - rel0[i].dy) <= 0.6);
  check('子树整体跟随（相对位置不变）', relOk, JSON.stringify(relAfter.map((r) => r.dx)));

  const marksOk = await ev(`(() => Array.from(document.querySelectorAll('#layerNode .node')).every(g => !!g.__mark))()`);
  check('拖动过程节点 DOM 被复用（未重建）', !!marksOk);

  const pxAligned = track.every((t) => Number.isInteger(Math.round(t.tx * zoom * 100) / 100));
  const shortDecimals = track.every((t) => /translate\((-?[\d.]+),(-?[\d.]+)\)/.test(t.transform) && t.transform.replace(/[^.]/g, '').length <= 2);
  check('坐标落在像素格（无超长小数，画面不糊）', pxAligned && shortDecimals, track[3] && track[3].transform);

  // 松手后位置不回跳
  check('松手后位置不跳', Math.abs(afterUp.tx - track[track.length - 1].tx) <= 0.6,
    `${track[track.length - 1].tx} → ${afterUp.tx}`);

  // ---------- 2. 重新打开仍是拖动后的位置（已保存）
  await sleep(400);
  await send('Page.reload');
  await sleep(2200);
  const reopened = await nodeInfo(dragId);
  check('重开后保持拖动位置', Math.abs(reopened.tx - afterUp.tx) <= 1.5, `${afterUp.tx} → ${reopened.tx}`);

  // ---------- 3. 非树形（流程图）拖动也跟手
  await ev(`(async () => { await fetch('/api/charts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '测试：拖动流程', type: 'flow', doc: { nodes: [
        { id: 'f1', text: '开始', x: 0, y: 0 }, { id: 'f2', text: '处理', x: 0, y: 0 }, { id: 'f3', text: '结束', x: 0, y: 0 }
      ], links: [{ id: 'l1', from: 'f1', to: 'f2' }, { id: 'l2', from: 'f2', to: 'f3' }], meta: {} } }) }); return 1; })()`);
  const list = (await (await fetch(BASE + '/api/charts')).json()).charts;
  const flow = list.find((c) => c.title === '测试：拖动流程');
  if (flow) {
    await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(flow.id) });
    await sleep(2200);
    const z2 = await ev(`(() => { const m = /scale\\(([\\d.]+)\\)/.exec(document.getElementById('viewport').getAttribute('transform') || ''); return m ? +m[1] : 1; })()`);
    const st = await nodeInfo('f2');
    const ax = Math.round(st.cx), ay = Math.round(st.cy);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(60);
    const ts = [];
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax + 12 * i, y: ay + 6 * i, button: 'left', buttons: 1, pointerType: 'mouse' });
      await sleep(45);
      const n = await nodeInfo('f2');
      ts.push({ tx: n.tx, ty: n.ty });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ax + 72, y: ay + 36, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(400);
    const fin = await nodeInfo('f2');
    const okX = Math.abs(fin.tx - st.tx - 72 / z2) <= 2, okY = Math.abs(fin.ty - st.ty - 36 / z2) <= 2;
    const stepsX = ts.map((t, i) => i ? +(t.tx - ts[i - 1].tx).toFixed(2) : null).filter((v) => v != null);
    check('流程图节点拖动跟手', okX && okY && stepsX.every((v) => v > 0), `Δx=${(fin.tx - st.tx).toFixed(1)} Δy=${(fin.ty - st.ty).toFixed(1)}`);
    await fetch(BASE + '/api/charts/' + encodeURIComponent(flow.id), { method: 'DELETE' });
  }

  await cleanup();
  console.log(`\n通过 ${12 - fail} / 12`);
  process.exit(fail ? 1 : 0);

  async function cleanup() {
    try { if (CHART_ID) await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID), { method: 'DELETE' }); } catch (e) {}
    try { browser.kill(); } catch (e) {}
    try { ws.close(); } catch (e) {}
    await sleep(200);
    try { require('fs').rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(async (e) => {
  console.error('ERROR', e && e.message);
  // 出错也要收尾，别把测试图留在 charts/ 里
  try { if (CHART_ID) await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID), { method: 'DELETE' }); } catch (err) {}
  process.exit(2);
});
