/* 思维导图布局回归：切换 → 保存 → 重开 → 工具栏菜单切换 → 清理
 * 用法：node tools/test_layouts.js [port]
 */
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9346;
const ID = 'tmp-layout-test';
const profile = path.join(os.tmpdir(), 'wb-lay-test-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  const n = (text, parent) => ({ id: 'n' + Math.random().toString(36).slice(2, 8), text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
  const root = n('中心主题');
  const b1 = n('分支一', root.id), b2 = n('分支二', root.id), b3 = n('分支三', root.id);
  const c1 = n('要点 A', b1.id), c2 = n('要点 B', b1.id), c3 = n('要点 C', b2.id), c4 = n('要点 D', b3.id);
  const nodes = [root, b1, b2, b3, c1, c2, c3, c4];
  await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ID, title: '布局测试图', type: 'mindmap', doc: { nodes, links: [], meta: { layout: 'balanced' } } }),
  });

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
  const open = async () => { await send('Page.navigate', { url: BASE + '/studio/?id=' + ID }); await sleep(2400); };

  await send('Page.enable');
  await open();

  const chips = await ev(`[...document.querySelectorAll('[data-layout]')].map(b => b.dataset.layout)`);
  ok('属性面板列出 5 种布局', Array.isArray(chips) && chips.length === 5, JSON.stringify(chips));
  ok('默认选中「双向发散」', await ev(`!!document.querySelector('[data-layout="balanced"].on')`));

  const posOf = () => ev(`[...document.querySelectorAll('#layerNode > g')].map(g => g.getAttribute('transform')).join('|')`);
  const before = await posOf();
  await ev(`document.querySelector('[data-layout="radial"]').click()`);
  await sleep(600);
  const after = await posOf();
  ok('切到环形后节点位置改变', before !== after);
  ok('环形按钮高亮', await ev(`!!document.querySelector('[data-layout="radial"].on')`));
  const radialGeom = await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g')];
    const box = gs.map(g => {
      const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform'));
      const r = g.querySelector('rect');
      return { x: +m[1], y: +m[2], w: +r.getAttribute('width'), h: +r.getAttribute('height') };
    });
    const root = box[0];
    const rx = root.x + root.w / 2, ry = root.y + root.h / 2;
    // 环形布局：非根节点应环绕根节点分布（角度跨度大），而不是都堆在左右两侧
    const angs = box.slice(1).map(b => (Math.atan2(b.y + b.h / 2 - ry, b.x + b.w / 2 - rx) * 180 / Math.PI + 360) % 360).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 0; i < angs.length; i++) {
      const next = i + 1 < angs.length ? angs[i + 1] : angs[0] + 360;
      maxGap = Math.max(maxGap, next - angs[i]);
    }
    return { span: Math.round(360 - maxGap), angles: angs.map(a => Math.round(a)) };
  })()`);
  ok('节点环绕根节点放射分布（角度跨度 > 180°）', radialGeom.span > 180, JSON.stringify(radialGeom));

  await sleep(2200);   // 等自动保存
  const saved = await (await fetch(BASE + '/api/charts/' + ID)).json();
  ok('布局写入文件 meta.layout', saved.meta && saved.meta.layout === 'radial', String(saved.meta && saved.meta.layout));

  await open();
  ok('重开后仍是环形布局', await ev(`!!document.querySelector('[data-layout="radial"].on')`));
  ok('重开后坐标仍是放射分布', await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g')];
    const box = gs.map(g => { const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); const r = g.querySelector('rect'); return { x: +m[1], y: +m[2], w: +r.getAttribute('width'), h: +r.getAttribute('height') }; });
    const cx0 = box.reduce((s, b) => s + b.x + b.w / 2, 0) / box.length, cy0 = box.reduce((s, b) => s + b.y + b.h / 2, 0) / box.length;
    return box.filter(b => Math.abs(b.x + b.w / 2 - cx0) > 100 || Math.abs(b.y + b.h / 2 - cy0) > 100).length > 3;
  })()`));

  // 工具栏「布局」菜单
  await ev(`document.querySelector('[data-t="layout"]').click()`);
  await sleep(300);
  const menu = await ev(`[...document.querySelectorAll('#menu .menu-item')].map(b => b.dataset.i)`);
  ok('工具栏布局菜单含 5 种布局 + 重排', menu.length === 6, JSON.stringify(menu));
  await ev(`(() => { const b = [...document.querySelectorAll('#menu .menu-item')].find(x => x.dataset.i.includes('向右展开')); b && b.click(); })()`);
  await sleep(600);
  ok('从工具栏菜单切到向右展开', await ev(`!!document.querySelector('[data-layout="right"].on')`));
  const rightGeom = await ev(`(() => {
    const gs = [...document.querySelectorAll('#layerNode > g')];
    const box = gs.map(g => { const m = /translate\\(([-\\d.]+),([-\\d.]+)\\)/.exec(g.getAttribute('transform')); return { x: +m[1], y: +m[2] }; });
    const minX = Math.min(...box.map(b => b.x));
    const rootG = box[0];   // 模板里根节点是第一个
    return { rootIsLeftMost: Math.abs(rootG.x - minX) < 2, spread: Math.max(...box.map(b => b.x)) - minX };
  })()`);
  ok('向右展开：根在最左且整体向右延伸', rightGeom.rootIsLeftMost && rightGeom.spread > 200, JSON.stringify(rightGeom));

  ws.close();
  browser.kill();
  await fetch(BASE + '/api/charts/' + ID, { method: 'DELETE' }).catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`\n布局回归：通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
})();
