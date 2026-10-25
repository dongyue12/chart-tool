/* 真实鼠标双击测试：两次独立 CDP click 模拟用户操作（合成 dblclick 事件测不出重建类 bug）
   在临时图上跑，并校验改动确实落盘，跑完自动清理 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');
const fs = require('fs');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9334;
const profile = path.join(os.tmpdir(), 'wbdbl-test-' + Date.now());
const TITLE = '测试：双击编辑-' + Date.now().toString(36);
let CHART_ID = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---------- 临时图（不碰示例）
  const mk = await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: TITLE, type: 'flow',
      doc: {
        nodes: [{ id: 'f1', text: '开始', shape: 'terminal' }, { id: 'f2', text: '处理', shape: 'process' }],
        links: [{ id: 'l1', from: 'f1', to: 'f2' }], meta: {},
      },
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
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
    } catch (e) { /* not ready */ }
  }
  if (!target) { console.error('CDP 未就绪'); await cleanup(); process.exit(1); }

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
    if (r.result && r.result.exceptionDetails) throw new Error('eval error: ' + expr.slice(0, 40));
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

  const pos = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => x.getBoundingClientRect().width > 0);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, id: g.dataset.id, text: (g.textContent||'').trim().slice(0,24) };
  })()`);
  if (!pos) {
    check('找到可见节点', false);
    await cleanup(); process.exit(1);
  }
  check('找到可见节点', true, `${pos.id} "${pos.text}"`);

  // 模拟真实用户双击：两次独立 click（间隔 130ms，clickCount=1）
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  };
  await click(Math.round(pos.x), Math.round(pos.y));
  await sleep(130);
  await click(Math.round(pos.x), Math.round(pos.y));
  await sleep(400);

  const st1 = await ev(`(() => { const b = document.getElementById('editBox');
    return { hidden: b.hidden, id: b.dataset.id, focused: document.activeElement === b }; })()`);
  check('双击弹出就地编辑框', !st1.hidden && st1.id === pos.id, JSON.stringify(st1));
  check('编辑框获得焦点', !!st1.focused);

  // 全选 → 输入新字 → Enter 提交
  await ev(`document.getElementById('editBox').select(); 1`);
  await send('Input.insertText', { text: '双击修复验证' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(600);

  const after = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => x.dataset.id === ${JSON.stringify(pos.id)});
    const b = document.getElementById('editBox');
    return { text: g ? g.textContent.trim() : null, boxClosed: b.hidden };
  })()`);
  check('文字已修改并提交', after.text === '双击修复验证' && after.boxClosed, JSON.stringify(after));

  // 自动保存（1.4s 防抖）之后，服务端文件里也应改过来
  await sleep(2200);
  const saved = await (await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID))).json();
  const hit = (saved.nodes || []).find((n) => n.id === pos.id);
  check('改动已落盘（服务端能看到）', !!hit && hit.text === '双击修复验证', hit && hit.text);

  await cleanup();
  console.log(`\n通过 ${5 - fail} / 5`);
  process.exit(fail ? 1 : 0);

  async function cleanup() {
    try { if (CHART_ID) await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID), { method: 'DELETE' }); } catch (e) {}
    try { browser.kill(); } catch (e) {}
    try { ws.close(); } catch (e) {}
    await sleep(200);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(async (e) => {
  console.error('ERROR', e && e.message);
  try { if (CHART_ID) await fetch(BASE + '/api/charts/' + encodeURIComponent(CHART_ID), { method: 'DELETE' }); } catch (err) {}
  process.exit(2);
});
