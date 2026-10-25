/* 图片插入功能测试：上传 → 渲染 → 保存 → 重新打开 → 导出 → 移除
 * 用临时图表测试，结束后删除，不污染示例 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9336;
const profile = path.join(os.tmpdir(), 'wb-img-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 临时图表
  const doc = {
    id: 'tmp-image-test', type: 'mindmap', title: '图片测试图',
    nodes: [{ id: 'r', text: '中心主题', parent: null, note: '', color: null, done: false, collapsed: false },
            { id: 'c1', text: '带图的分支', parent: 'r', note: '', color: null, done: false, collapsed: false }],
    links: [], meta: { example: false },
  };
  await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
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

  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/studio/?id=tmp-image-test' });
  await sleep(2500);

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };

  // 选中带图分支
  await ev(`(() => {
    const g = [...document.querySelectorAll('#layerNode > g.node')].find(x => x.dataset.id === 'c1');
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`).then(async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
  });
  await sleep(400);

  const hasPicker = await ev(`!!document.getElementById('imgPick')`);
  check('属性面板出现「上传图片」', hasPicker);

  const h0 = await ev(`(() => {
    const g = document.querySelector('#layerNode > g.node[data-id="c1"]');
    return Math.round(g.getBoundingClientRect().height);
  })()`);

  // 构造一张 300x160 的测试图并走 change 事件
  await ev(`(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 160;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 300, 160);
    grd.addColorStop(0, '#2f6fed'); grd.addColorStop(1, '#7c4dff');
    g.fillStyle = grd; g.fillRect(0, 0, 300, 160);
    g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif'; g.fillText('IMG', 110, 95);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'test.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('imgFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
  await sleep(1200);

  const r1 = await ev(`(() => {
    const g = document.querySelector('#layerNode > g.node[data-id="c1"]');
    const img = g.querySelector('image');
    return { hasImg: !!img, href: img ? img.getAttribute('href').slice(0, 22) : null, h: Math.round(g.getBoundingClientRect().height) };
  })()`);
  check('节点内渲染出图片', r1.hasImg && /^data:image\//.test(r1.href || ''), r1.href);
  check('节点高度为图片让出空间', r1.h > h0 + 40, `${h0} → ${r1.h}`);

  // 保存并重新打开
  await ev(`document.querySelector('[data-t="save"]').click()`);
  await sleep(1000);
  const saved = await (await fetch(BASE + '/api/charts/tmp-image-test')).json();
  const sn = saved.nodes.find((n) => n.id === 'c1');
  const snImg = (sn.images && sn.images[0]) || { data: sn.image };
  check('图片已存进 JSON', !!snImg.data && snImg.data.startsWith('data:image/'), snImg.data ? (snImg.data.length + 'B') : '无');

  await send('Page.navigate', { url: BASE + '/studio/?id=tmp-image-test' });
  await sleep(2200);
  const r2 = await ev(`(() => {
    const g = document.querySelector('#layerNode > g.node[data-id="c1"]');
    return !!g && !!g.querySelector('image');
  })()`);
  check('重新打开后图片仍在', r2);

  // 没有文字 + 有图片 → 图片放大铺满整个节点
  const geo = () => ev(`(() => {
    const g = document.querySelector('#layerNode > g.node[data-id="c1"]');
    const r = g.querySelector('rect');
    const im = g.querySelector('image');
    return { w: +r.getAttribute('width'), h: +r.getAttribute('height'),
             iw: im ? +im.getAttribute('width') : 0, ih: im ? +im.getAttribute('height') : 0 };
  })()`);
  const beforeBig = await geo();
  const c1pos = await ev(`(() => { const g = document.querySelector('#layerNode > g.node[data-id="c1"]');
    const r = g.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  for (let i = 0; i < 2; i++) {           // 两次点击 = 手动判定的双击
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c1pos.x, y: c1pos.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c1pos.x, y: c1pos.y, button: 'left', clickCount: 1 });
    await sleep(110);
  }
  await sleep(350);
  await ev(`(() => { const b = document.getElementById('editBox'); b.value = '';
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1; })()`);
  await sleep(700);
  const afterBig = await geo();
  check('清空文字后图片放大铺满节点', afterBig.iw > beforeBig.iw + 40 && Math.abs(afterBig.iw - (afterBig.w - 10)) <= 2,
    `${beforeBig.iw}×${beforeBig.ih} → ${afterBig.iw}×${afterBig.ih}，节点 ${beforeBig.w} → ${afterBig.w}`);
  check('铺满时图片比例不变', Math.abs(afterBig.iw / afterBig.ih - beforeBig.iw / beforeBig.ih) < 0.06,
    (afterBig.iw / afterBig.ih).toFixed(3));

  // 导出 SVG / PNG 是否带图
  const dl = path.join(os.tmpdir(), 'wb-img-dl-' + Date.now());
  require('fs').mkdirSync(dl, { recursive: true });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  for (const label of ['SVG 矢量图', 'PNG 图片']) {
    await ev(`document.querySelector('[data-t="export"]').click()`);
    await sleep(200);
    await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b => b.textContent.trim() === '${label}').click()`);
    await sleep(1800);
  }
  const files = require('fs').readdirSync(dl);
  const svg = files.find((f) => f.endsWith('.svg'));
  const png = files.find((f) => f.endsWith('.png'));
  const svgTxt = svg ? require('fs').readFileSync(path.join(dl, svg), 'utf8') : '';
  check('导出的 SVG 内嵌图片', /<image[^>]+href="data:image\//.test(svgTxt));
  check('导出的 PNG 生成成功', !!png, png ? require('fs').statSync(path.join(dl, png)).size + 'B' : '无');

  // 移除图片
  await ev(`(() => {
    const g = [...document.querySelectorAll('#layerNode > g.node')].find(x => x.dataset.id === 'c1');
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`).then(async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 });
  });
  await sleep(400);
  const removed = await ev(`(() => {
    const b = document.getElementById('imgDel');
    if (!b) return 'no-btn';
    b.click();
    return 'clicked';
  })()`);
  await sleep(600);
  const r3 = await ev(`(() => {
    const g = document.querySelector('#layerNode > g.node[data-id="c1"]');
    return { hasImg: !!g.querySelector('image'), h: Math.round(g.getBoundingClientRect().height) };
  })()`);
  check('移除图片后恢复原状', removed === 'clicked' && !r3.hasImg && r3.h <= h0 + 4, `${removed} / h=${r3.h}`);

  // 清理临时图表
  await fetch(BASE + '/api/charts/tmp-image-test', { method: 'DELETE' });
  console.log(`    导出目录：${dl}`);
  console.log(fail ? `\n失败 ${fail} 项` : '\n图片功能测试全部通过');
  browser.kill();
  try { ws.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e && e.message); process.exit(2); });
