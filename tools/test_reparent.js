/* 拖动改父级测试：拖到别的节点上松手就挂过去（含高亮、禁环、撤销、拖空白仍是自由位置） */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9341;
const profile = path.join(os.tmpdir(), 'wbparent-test-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TITLE = '测试：改父级-' + Date.now().toString(36);
let CHART_ID = null;

(async () => {
  const N = (id, text, parent) => ({ id, text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
  const doc = {
    nodes: [
      N('r', '中心主题'), N('a', '分支甲', 'r'), N('b', '分支乙', 'r'),
      N('a1', '甲-一', 'a'), N('a2', '甲-二', 'a'), N('b1', '乙-一', 'b'),
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

  const info = (id) => ev(`(() => {
    const g = document.querySelector('#layerNode .node[data-id="${id}"]');
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const m = /translate\\((-?[\\d.]+),(-?[\\d.]+)\\)/.exec(g.getAttribute('transform') || '');
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, tx: m ? +m[1] : null, ty: m ? +m[2] : null,
             cls: g.getAttribute('class') || '', hasFold: !!g.querySelector('[data-fold]') };
  })()`);
  const parentOf = async (id) => {
    const j = await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json();
    const n = j.nodes.find((x) => x.id === id);
    return n ? n.parent : undefined;
  };
  const docNode = async (id) => {
    const j = await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json();
    return j.nodes.find((x) => x.id === id) || null;
  };

  /** 按住 fromId 拖到 (toX,toY)，松手；顺便记录过程中目标节点是否高亮 */
  async function dragTo(fromId, toX, toY, watchId, steps) {
    const s = await info(fromId);
    const n = steps || 10;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(s.cx), y: Math.round(s.cy), button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(70);
    for (let i = 1; i <= n; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1, pointerType: 'mouse',
        x: Math.round(s.cx + (toX - s.cx) * i / n), y: Math.round(s.cy + (toY - s.cy) * i / n),
      });
      await sleep(38);
    }
    const watched = watchId ? (await info(watchId)) : null;
    const lit = !!watched && /\bdrop\b/.test(watched.cls);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(toX), y: Math.round(toY), button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(450);
    return { start: s, lit, watched };
  }

  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(CHART_ID) });
  await sleep(2400);

  // 1. 叶子节点拖到另一个分支上
  const b = await info('b');
  const r1 = await dragTo('a1', b.cx, b.cy, 'b');
  check('拖到目标节点上时它会高亮', r1.lit, r1.watched && r1.watched.cls);
  await sleep(1700);
  check('松手后节点挂到目标下面', (await parentOf('a1')) === 'b', 'parent=' + (await parentOf('a1')));
  const a1 = await info('a1');
  check('改父级后重新排版（不再是原位置）', Math.abs(a1.tx - r1.start.tx) > 4 || Math.abs(a1.ty - r1.start.ty) > 4,
    `${r1.start.tx},${r1.start.ty} → ${a1.tx},${a1.ty}`);
  check('高亮在松手后清掉', !/\bdrop\b/.test((await info('b')).cls));

  // 2. 带着子树拖过去：整棵子树跟着换父亲
  const b2 = await info('b');
  await dragTo('a', b2.cx, b2.cy, 'b');
  await sleep(1700);
  check('带子树的节点也能改父级', (await parentOf('a')) === 'b');
  check('原子树关系不变（a2 仍是 a 的下级）', (await parentOf('a2')) === 'a');

  // 3. 改完父级马上撤销：应该一步回到原来的父子关系
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
  await sleep(1700);                                  // 撤销也会走 1.4s 自动保存，等服务端落盘
  check('改父级后撤销一步就回到原处', (await parentOf('a')) === 'r', 'a.parent=' + (await parentOf('a')));

  // 4. 不能拖进自己的后代
  const a2 = await info('a2');
  const r3 = await dragTo('a', a2.cx, a2.cy, 'a2', 6);
  await sleep(1700);
  check('拖到自己的后代上不会形成环', (await parentOf('a')) === 'r' && !r3.lit, 'a.parent=' + (await parentOf('a')));

  // 5. 拖到空白处：仍按自由位置处理，父级不变
  const parentBefore = await parentOf('b1');
  const b1 = await info('b1');
  const stageBox = await ev(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left + 40, y: r.bottom - 40 }; })()`);
  await dragTo('b1', stageBox.x, stageBox.y, null, 8);
  await sleep(1700);
  const b1After = await docNode('b1');
  check('拖到空白处不改父级', b1After && b1After.parent === parentBefore, 'parent=' + (b1After && b1After.parent));
  check('拖到空白处记成手动位置', !!(b1After && b1After.pinned));

  await cleanup();
  console.log(`\n通过 ${10 - fail} / 10`);
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
