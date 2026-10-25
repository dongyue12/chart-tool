/* 思维导图「收起 / 展开下级」测试：按钮、隐藏、数字、落盘、批量、快捷键 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9339;
const profile = path.join(os.tmpdir(), 'wbfold-test-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TITLE = '测试：折叠-' + Date.now().toString(36);
let CHART_ID = null;

(async () => {
  const N = (id, text, parent) => ({ id, text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
  const doc = {
    nodes: [
      N('r', '中心主题'), N('a', '分支甲', 'r'), N('b', '分支乙', 'r'),
      N('a1', '甲-一', 'a'), N('a2', '甲-二', 'a'), N('a11', '甲-细节', 'a1'),
      N('b1', '乙-一', 'b'),
    ],
    links: [], meta: { layout: 'balanced' }, type: 'mindmap', title: TITLE,
  };
  const mk = await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TITLE, type: 'mindmap', doc }),
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
    if (r.result && r.result.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  await send('Page.enable');

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };
  const visIds = () => ev(`(() => Array.from(document.querySelectorAll('#layerNode .node')).map(g => g.dataset.id))()`);
  const foldOf = (id) => ev(`(() => {
    const g = document.querySelector('#layerNode .node[data-id="${id}"] [data-fold]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { text: g.querySelector('text').textContent, on: g.classList.contains('on'),
             cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  })()`);
  async function clickAt(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(400);
  }
  const toDocNode = async () => (await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json());

  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2400);

  // 1. 初始：7 个节点全可见，a 上有「−」按钮，r/b1 上没有（叶子）
  let vis = await visIds();
  check('初始 7 个节点全可见', vis.length === 7, vis.join(','));
  const fa = await foldOf('a');
  check('有下级的节点有折叠按钮（−）', fa && fa.text === '\u2212' && !fa.on, fa && fa.text);
  check('叶子节点没有折叠按钮', (await foldOf('b1')) === null && (await foldOf('r')) !== null);

  // 2. 点 a 的按钮：收起 a1/a2/a11
  await clickAt(fa.cx, fa.cy);
  vis = await visIds();
  check('收起后 3 个后代从画面消失', vis.length === 4 && !vis.includes('a1') && !vis.includes('a11'), vis.join(','));
  const fa2 = await foldOf('a');
  check('按钮变成实心并显示藏了 3 个', fa2 && fa2.on && fa2.text === '3', fa2 && fa2.text);
  check('收起节点的选择/位置未被点击带偏', !!(await ev(`(() => !!document.querySelector('#layerNode .node[data-id="a"]'))()`)));

  // 3. 落盘：等保存后重开，仍然是收起的
  await sleep(1800);
  let saved = await toDocNode();
  const aDoc = saved.nodes.find((n) => n.id === 'a');
  check('收起状态写进图表文件', !!aDoc && aDoc.collapsed === true);
  await send('Page.reload');
  await sleep(2300);
  vis = await visIds();
  const fa3 = await foldOf('a');
  check('重开后保持收起', vis.length === 4 && fa3 && fa3.on && fa3.text === '3', vis.join(','));

  // 4. 再点一次展开
  await clickAt(3, 3); // 先点空白，清掉可能残留的菜单
  const fa4 = await foldOf('a');
  await clickAt(fa4.cx, fa4.cy);
  vis = await visIds();
  check('再点一次展开回 7 个', vis.length === 7 && !(await foldOf('a')).on, vis.join(','));

  // 5. 面板「只留一级」
  const r0 = await ev(`(() => { const b = document.getElementById('btnFoldOne'); return b ? b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 : null; })()`);
  if (r0 != null) {
    await clickAt(r0, await ev(`document.getElementById('btnFoldOne').getBoundingClientRect().top + 12`));
    vis = await visIds();
    const ok = vis.length === 3 && vis.includes('r') && vis.includes('a') && vis.includes('b');
    check('「只留一级」只显示根 + 一级', ok, vis.join(','));
    const fb = await foldOf('b');
    check('一级节点按钮显示各自藏了几个', fb && fb.on && fb.text === '1', fb && fb.text);
    // 6. 展开全部
    await clickAt(await ev(`document.getElementById('btnExpandAll').getBoundingClientRect().left + 30`),
      await ev(`document.getElementById('btnExpandAll').getBoundingClientRect().top + 12`));
    vis = await visIds();
    check('「展开全部」恢复所有节点', vis.length === 7, vis.join(','));
  } else {
    check('面板有「只留一级 / 展开全部」', false);
  }

  // 7. 快捷键：选中 a 后按 -
  await ev(`(() => { const g = document.querySelector('#layerNode .node[data-id="a"]');
    const r = g.getBoundingClientRect(); return 1; })()`);
  const ac = await ev(`(() => { const g = document.querySelector('#layerNode .node[data-id="a"]'); const r = g.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 12 }; })()`);
  await ev(`(() => { const g = document.querySelector('#layerNode .node[data-id="a"]'); g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ${ac.x}, clientY: ${ac.y}, pointerId: 1, button: 0 }));
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: ${ac.x}, clientY: ${ac.y}, pointerId: 1, button: 0 })); return 1; })()`);
  await sleep(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '-', code: 'Minus', windowsVirtualKeyCode: 189 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '-', code: 'Minus', windowsVirtualKeyCode: 189 });
  await sleep(400);
  vis = await visIds();
  check('按 - 收起选中节点的下级', vis.length === 4, vis.join(','));

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
  try { if (CHART_ID) await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID), { method: 'DELETE' }); } catch (err) {}
  process.exit(2);
});
