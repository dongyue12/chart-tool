/* 批量图片：粘贴 / 拖入自动建节点，多张统一装进一个节点 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9343;
const profile = path.join(os.tmpdir(), 'wbimgbatch-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TITLE = '测试：批量图片-' + Date.now().toString(36);
let CHART_ID = null;

(async () => {
  const mk = await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: TITLE, type: 'mindmap',
      doc: { nodes: [{ id: 'r', text: '中心主题', parent: null }], links: [], meta: { layout: 'balanced' } },
    }),
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
    try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) {}
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
    if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  await send('Page.enable');

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };
  const docJson = async () => (await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json());
  const nodeStat = () => ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g.node')];
    const last = gs[gs.length - 1];
    if (!last) return null;
    const rect = last.querySelector('rect');
    return { count: gs.length, id: last.dataset.id, imgs: last.querySelectorAll('image').length,
             w: +rect.getAttribute('width'), h: +rect.getAttribute('height') };
  })()`);

  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2300);

  // ---------- 1. 先选中根节点，再粘贴 3 张不同尺寸的图
  const rootPos = await ev(`(() => { const g = document.querySelector('#layerNode > g.node[data-id="r"]'); const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rootPos.x, y: rootPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rootPos.x, y: rootPos.y, button: 'left', clickCount: 1 });
  await sleep(350);

  const pasted = await ev(`(async () => {
    const dt = new DataTransfer();
    for (const [w, h, c] of [[300, 160, '#2f6fed'], [200, 200, '#e8712f'], [400, 120, '#2f9e6f']]) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g2 = cv.getContext('2d'); g2.fillStyle = c; g2.fillRect(0, 0, w, h);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      dt.items.add(new File([blob], 'p' + w + '.png', { type: 'image/png' }));
    }
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.items.length;
  })()`);
  await sleep(2000);
  const s1 = await nodeStat();
  check('粘贴 3 张后自动多出 1 个节点', s1 && s1.count === 2, s1 && `节点数 ${s1.count}`);
  check('三张图都在同一个节点里', s1 && s1.imgs === 3, s1 && s1.imgs + ' 张');
  check('节点按 2 列网格撑开（不是三张叠一起）', s1 && s1.w > 240 && s1.h > 130, s1 && `${s1.w}×${s1.h}`);
  const saved1 = await docJson();
  const n1 = saved1.nodes.find((n) => n.id === (s1 && s1.id));
  check('落盘为 images 数组（3 项）', !!n1 && Array.isArray(n1.images) && n1.images.length === 3, n1 && (n1.images || []).length);
  check('新节点挂在选中节点下面', !!n1 && n1.parent === 'r', n1 && n1.parent);

  // ---------- 2. 重新打开，多图仍在
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2300);
  const s2 = await nodeStat();
  check('重开后 3 张图仍在一个节点里', s2 && s2.imgs === 3, s2 && s2.imgs + ' 张');

  // ---------- 3. 不选中节点，直接往画布拖入 2 张
  const dropped = await ev(`(async () => {
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 180;
    const g2 = cv.getContext('2d'); g2.fillStyle = '#7c5cf0'; g2.fillRect(0, 0, 240, 180);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'd1.png', { type: 'image/png' }));
    dt.items.add(new File([blob], 'd2.png', { type: 'image/png' }));
    const stage = document.getElementById('stage');
    const r = stage.getBoundingClientRect();
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true,
      clientX: r.left + r.width * 0.72, clientY: r.top + r.height * 0.7 }));
    return dt.items.length;
  })()`);
  await sleep(2000);
  const s3 = await nodeStat();
  check('拖入 2 张也自动建节点', s3 && s3.count === 3 && s3.imgs === 2, s3 && `${s3.count} 节点 / ${s3.imgs} 张`);
  const saved3 = await docJson();
  const n3 = saved3.nodes.find((n) => n.id === (s3 && s3.id));
  check('拖入的图也收在一个节点里', !!n3 && Array.isArray(n3.images) && n3.images.length === 2);

  // ---------- 4. 属性面板能逐张移除
  const cells = await ev(`document.querySelectorAll('#inspBody .img-cell').length`);
  check('属性面板列出每张缩略图', cells === 2, cells + ' 个缩略图');
  await ev(`(() => { const b = document.querySelector('#inspBody [data-imgdel]'); if (b) b.click(); return 1; })()`);
  await sleep(600);
  const s4 = await nodeStat();
  check('删掉一张后节点里剩 1 张', s4 && s4.imgs === 1, s4 && s4.imgs + ' 张');
  await sleep(1600);
  const saved4 = await docJson();
  const n4 = saved4.nodes.find((n) => n.id === (s3 && s3.id));
  check('删除也落盘', !!n4 && Array.isArray(n4.images) && n4.images.length === 1, n4 && (n4.images || []).length);

  // ---------- 5. 拖到某个节点上：挂到它下面（而不是根）
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2300);
  const targetR = await ev(`(() => { const g = document.querySelector('#layerNode > g.node[data-id="${s1.id}"]'); const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
  await ev(`(async () => {
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 160;
    const g2 = cv.getContext('2d'); g2.fillStyle = '#d14343'; g2.fillRect(0, 0, 160, 160);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'e1.png', { type: 'image/png' }));
    const stage = document.getElementById('stage');
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${targetR.x}, clientY: ${targetR.y} }));
    return 1;
  })()`);
  await sleep(2000);
  const saved5 = await docJson();
  const kidsOfHost = saved5.nodes.filter((n) => n.parent === s1.id);
  check('拖到节点上：新图片节点挂到它下面', kidsOfHost.length === 1 && (kidsOfHost[0].images || []).length === 1,
    '子节点数 ' + kidsOfHost.length);

  await cleanup();
  console.log(`\n通过 ${11 - fail} / 11`);
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
  try { if (CHART_ID) await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID), { method: 'DELETE' }); } catch (err) {}
  process.exit(2);
});
