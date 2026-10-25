/* 「同一份内容，四种画法」对照图：导图 → 流程图 → 时间线 → 甘特图
 * 走的是界面里「转换」按钮同一条路径（outline → fromOutline），不是手写的假数据。
 * 用法：node tools/shot_compare.js [port]      输出 tools/out/cmp-*.png
 */
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { findBrowser } = require('./browser');

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9347;
const OUT = path.join(__dirname, 'out');
const profile = path.join(os.tmpdir(), 'wb-cmp-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一份「新产品上线」方案：三个阶段，各挂 1–2 件事（8 个节点，四种画法都能看清）
const SRC = [
  ['新产品上线', null],
  ['需求确认', '新产品上线'],
  ['访谈 20 位用户', '需求确认'],
  ['范围冻结', '需求确认'],
  ['研发排期', '新产品上线'],
  ['灰度发布', '研发排期'],
  ['上线复盘', '新产品上线'],
  ['数据看板', '上线复盘'],
];

const MODE = process.argv[3] === 'layouts' ? 'layouts' : 'types';

const PLAN_TYPES = [
  { type: 'mindmap', key: 'mind', layout: 'radial' },
  { type: 'flow', key: 'flow' },
  { type: 'timeline', key: 'time' },
  { type: 'gantt', key: 'gantt' },
];

// 5 种排布：同一份导图内容，只换 layout
const PLAN_LAYOUTS = [
  { type: 'mindmap', key: 'lay-balanced', layout: 'balanced' },
  { type: 'mindmap', key: 'lay-right', layout: 'right' },
  { type: 'mindmap', key: 'lay-down', layout: 'down' },
  { type: 'mindmap', key: 'lay-up', layout: 'up' },
  { type: 'mindmap', key: 'lay-radial', layout: 'radial' },
];
const PLAN = MODE === 'layouts' ? PLAN_LAYOUTS : PLAN_TYPES;

// —— 在 Node 里加载 kinds.js，用界面同一条互转路径生成 4 份数据 ——
global.window = global;
global.document = { createElement: () => null };
eval(fs.readFileSync(path.join(__dirname, '..', 'studio', 'kinds.js'), 'utf8'));
const K = global.KINDS;

let seq = 0;
const nid = () => 'n' + (++seq).toString(36) + Math.random().toString(36).slice(2, 5);
const byText = new Map();
const srcNodes = SRC.map(([text, parent]) => {
  const n = { id: nid(), text, parent: parent ? byText.get(parent).id : null, note: '', color: null, done: false };
  byText.set(text, n);
  return n;
});
const srcDoc = { id: 'tmp-cmp-mind', type: 'mindmap', title: '新产品上线', nodes: srcNodes, links: [], meta: { layout: 'radial' } };

const outlines = K.mindmap.outline(srcDoc);
const docs = [];
for (const p of PLAN) {
  let doc;
  if (p.type === 'mindmap') {
    // 每张独立一份，避免互相覆盖 meta.layout
    doc = {
      id: MODE === 'layouts' ? 'tmp-cmp-' + p.key : 'tmp-cmp-mind',
      type: 'mindmap', title: '新产品上线',
      nodes: srcNodes.map((n) => ({ ...n })), links: [],
      meta: { layout: p.layout || 'radial' },
    };
  } else {
    const r = K[p.type].fromOutline(outlines);
    doc = { id: 'tmp-cmp-' + p.key, type: p.type, title: '新产品上线', nodes: r.nodes, links: r.links || [], meta: r.meta || {} };
  }
  docs.push({ ...p, doc, count: doc.nodes.length, links: (doc.links || []).length });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const d of docs) {
    const res = await fetch(BASE + '/api/charts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d.doc),
    });
    if (!res.ok) { console.error('建图失败', d.type, res.status); process.exit(1); }
    console.log(`${d.type.padEnd(9)} ${d.count} 节点 / ${d.links} 连线`);
  }

  const browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1400,900', 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });

  for (const d of docs) {
    await send('Page.navigate', { url: `${BASE}/studio/?id=${encodeURIComponent(d.doc.id)}` });
    await sleep(2400);
    if (d.layout) {
      await ev(`(() => { const b = document.querySelector('[data-layout="${d.layout}"]'); if (b) b.click(); })()`);
      await sleep(800);
    }
    // 统一按一次「适应画布」，避免四张图各自缩放不一致
    await ev(`(() => { const b = document.getElementById('btnFit'); if (b) b.click(); })()`);
    await sleep(700);
    // 截图前藏掉新手提示和缩放条，画面只留图表本身
    await ev(`(() => {
      if (document.getElementById('cmp-hide')) return;
      const s = document.createElement('style');
      s.id = 'cmp-hide';
      s.textContent = '#hintBar,.zoombar{display:none !important}';
      document.head.appendChild(s);
    })()`);
    await sleep(250);
    // 截图只取「实际画出来的内容」的外接框（节点 + 背景图层），四周留一点余量，
    // 避免不同图表因为长宽比不同而出现大片空白
    const box = await ev(`(() => {
      const cv = document.getElementById('canvas').getBoundingClientRect();
      const els = [...document.querySelectorAll('#layerNode .node'), ...document.querySelectorAll('#layerBack > *')];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      }
      if (x0 > x1) return { x: Math.round(cv.x), y: Math.round(cv.y), w: Math.round(cv.width), h: Math.round(cv.height) };
      const pad = 26;
      x0 = Math.max(cv.x, x0 - pad); y0 = Math.max(cv.y, y0 - pad);
      x1 = Math.min(cv.right, x1 + pad); y1 = Math.min(cv.bottom, y1 + pad);
      return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    })()`);
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, `cmp-${d.key}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('saved', `cmp-${d.key}.png`, `${box.w}x${box.h}`);
  }

  ws.close();
  browser.kill();
  for (const d of docs) {
    await fetch(BASE + '/api/charts/' + encodeURIComponent(d.doc.id), { method: 'DELETE' }).catch(() => {});
  }
  fs.rmSync(profile, { recursive: true, force: true });
  console.log('临时图表已清理');
  process.exit(0);
})();
