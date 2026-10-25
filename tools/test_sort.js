/* 拖动上下排序 + 自动布局：顺序要保住（以前一点自动布局就回到拖之前） */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9345;
const profile = path.join(os.tmpdir(), 'wbsort-test-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TITLE = '测试：排序-' + Date.now().toString(36);
let CHART_ID = null;

(async () => {
  const N = (id, text, parent) => ({ id, text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
  const doc = {
    nodes: [N('r', '中心主题'), N('a', '甲', 'r'), N('b', '乙', 'r'), N('c', '丙', 'r'), N('a1', '甲-1', 'a')],
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
    if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  await send('Page.enable');

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };
  const info = (id) => ev(`(() => {
    const g = document.querySelector('#layerNode .node[data-id="${id}"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  })()`);
  const order = async () => {
    const j = await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json();
    return j.nodes.map((n) => n.id);
  };
  const pinnedOf = async (id) => {
    const j = await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json();
    const n = j.nodes.find((x) => x.id === id);
    return !!(n && n.pinned);
  };
  /** 把 fromId 拖到屏幕坐标 (x,y) 松手，等自动保存落盘 */
  async function dragNode(fromId, x, y) {
    const s = await info(fromId);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.cx, y: s.cy, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(70);
    const STEPS = 10;
    for (let i = 1; i <= STEPS; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1, pointerType: 'mouse',
        x: Math.round(s.cx + (x - s.cx) * i / STEPS), y: Math.round(s.cy + (y - s.cy) * i / STEPS),
      });
      await sleep(38);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(1900);
  }

  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2400);

  const before = await order();
  check('初始顺序', before.join(',') === 'r,a,b,c,a1', before.join(','));

  // 把「丙」拖到「甲」上方
  const aPos = await info('a');
  await dragNode('c', aPos.cx, aPos.cy - 62);

  const after = await order();
  check('拖到最上面后数组顺序跟着变', after.indexOf('c') < after.indexOf('a'), after.join(','));
  check('松手后自动归位（不再留手动位置）', !(await pinnedOf('c')), 'pinned=' + (await pinnedOf('c')));

  // 关键：点「自动布局」不能把顺序改回去
  await ev(`document.querySelector('[data-t="layout"]').click()`);
  await sleep(400);
  const menu = await ev(`(() => {
    const b = [...document.querySelectorAll('#menu .menu-item')].find(x => x.textContent.includes('清除手动位置'));
    if (!b) return 'no-menu';
    b.click();
    return 'clicked';
  })()`);
  await sleep(1900);
  const afterRelayout = await order();
  check('自动布局后顺序保持不变', afterRelayout.indexOf('c') < afterRelayout.indexOf('a'),
    menu + ' → ' + afterRelayout.join(','));
  check('自动布局没有弄乱兄弟层级', afterRelayout.filter((id) => id === 'a1').length === 1 && afterRelayout.indexOf('a1') > afterRelayout.indexOf('a'));

  // 重新打开仍是新顺序
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2300);
  const afterReload = await order();
  check('重开后顺序仍是拖出来的', afterReload.join(',') === afterRelayout.join(','), afterReload.join(','));

  // 再拖一次改顺序，撤销要退回上一个顺序
  const bPos = await info('b');
  await dragNode('c', bPos.cx, bPos.cy + 66);
  const afterSecond = await order();
  check('再次拖动可以换成另一个顺序', afterSecond.indexOf('c') > afterSecond.indexOf('b'), afterSecond.join(','));

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(1900);
  const undone = await order();
  check('撤销退回拖动前的顺序', undone.join(',') === afterReload.join(','), undone.join(','));

  await cleanup();
  console.log(`\n通过 ${8 - fail} / 8`);
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
