/* 项目介绍视频 · 素材录制
   真浏览器操作一遍，每步截一张 1280×720 关键帧，字幕直接画在画面里（后期不用加字）
   产物：tools/demo_frames/NN-名字.png + script.json（镜头表）
   用法： node tools/record_demo.js [端口]   */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { findBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const PORT = process.argv[2] || '8897';
const BASE = `http://127.0.0.1:${PORT}`;
const CDP = 9363;
const OUT = path.join(ROOT, 'tools', 'demo_frames');
const profile = path.join(os.tmpdir(), 'wbdemo-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PY = process.env.PYTHON || process.env.PY || 'python';

/* AI 画的那张图：就是一段普通 JSON */
const DOC = {
  title: '新产品上线计划',
  type: 'mindmap',
  nodes: [
    { id: 'r', text: '新产品上线计划', parent: null, kind: 'head', w: 190, h: 52, x: 0, y: 0, side: 'r' },
    { id: 'a', text: '需求确认', parent: 'r', kind: 'branch', w: 130, h: 40, x: 230, y: -170, side: 'r' },
    { id: 'a1', text: '访谈 20 位用户', parent: 'a', kind: 'leaf', w: 160, h: 40, x: 470, y: -235, side: 'r' },
    { id: 'a2', text: '定范围与验收', parent: 'a', kind: 'leaf', w: 160, h: 40, x: 470, y: -105, side: 'r' },
    { id: 'b', text: '开发与联调', parent: 'r', kind: 'branch', w: 140, h: 40, x: 230, y: 0, side: 'r' },
    { id: 'b1', text: '接口联调', parent: 'b', kind: 'leaf', w: 120, h: 40, x: 470, y: -65, side: 'r' },
    { id: 'b2', text: '压测一轮', parent: 'b', kind: 'leaf', w: 120, h: 40, x: 470, y: 65, side: 'r' },
    { id: 'c', text: '灰度发布', parent: 'r', kind: 'branch', w: 130, h: 40, x: 230, y: 170, side: 'r' },
    { id: 'c1', text: '5% 流量观察一天', parent: 'c', kind: 'leaf', w: 180, h: 40, x: 470, y: 105, side: 'r' },
    { id: 'c2', text: '全量放开', parent: 'c', kind: 'leaf', w: 120, h: 40, x: 470, y: 235, side: 'r' },
  ],
};
/* 一个节点一行，屏幕上看得全 */
const JSON_TEXT = '{\n  "title": ' + JSON.stringify(DOC.title) + ',\n  "type": "mindmap",\n  "nodes": [\n' +
  DOC.nodes.map((n) => '    { "id": ' + JSON.stringify(n.id) + ', "text": ' + JSON.stringify(n.text) +
    ', "parent": ' + (n.parent ? JSON.stringify(n.parent) : 'null') + ' }').join(',\n') +
  '\n  ]\n}';

let browser = null, srv = null, ws = null, idx = 0;
const scenes = [];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png') || f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));

  /* 「AI 写文件」那一幕的演示页 */
  const aiPage = path.join(OUT, 'ai-write.html');
  fs.writeFileSync(aiPage, `<!doctype html><meta charset="utf-8"><title>AI 写文件</title>
<style>
 body{margin:0;height:100vh;display:flex;background:#0f1420;color:#e8ecf6;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
 .chat{width:38%;padding:34px 28px;border-right:1px solid #232a3d}
 .bubble{margin:0 0 18px;padding:14px 18px;border-radius:14px;font-size:22px;line-height:1.6}
 .me{background:#26314d;color:#dfe6f5}
 .ai{background:#1b3a63;color:#fff}
 .who{font-size:16px;opacity:.55;margin:0 0 8px}
 .code{flex:1;padding:26px 30px;overflow:hidden}
 .path{font:600 20px/1.4 Consolas,monospace;color:#8fb4ff;margin-bottom:14px}
 pre{margin:0;font:14.5px/1.5 Consolas,monospace;color:#c9d6ee;white-space:pre}
 .ok{margin-top:18px;font-size:20px;color:#4ade80}
</style>
<div class="chat">
  <p class="who">我</p>
  <div class="bubble me">帮我画一张新产品上线的计划图，需求确认、开发、灰度发布三段。</div>
  <p class="who">WorkBuddy</p>
  <div class="bubble ai">好，我直接写 charts/新产品上线计划.chart.json —— 就是一份 JSON。</div>
</div>
<div class="code">
  <div class="path">charts/新产品上线计划.chart.json</div>
  <pre id="code"></pre>
  <div class="ok" id="ok"></div>
</div>
<script>
  document.getElementById('code').textContent = ${JSON.stringify(JSON_TEXT)};
  document.getElementById('ok').textContent = '\\u2713 \\u5df2\\u5199\\u5165';
</script>`);

  srv = spawn(PY, ['-m', 'http.server', PORT, '--directory', SITE], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0, up = false; i < 40 && !up; i++) {
    await sleep(200);
    try { up = (await fetch(BASE + '/index.html', { method: 'HEAD' })).ok; } catch (e) {}
  }

  browser = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) {}
  }
  if (!target) { console.error('CDP 未就绪'); process.exit(1); }

  ws = new WebSocket(target.webSocketDebuggerUrl);
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
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  };
  const clickSel = async (sel, nth) => {
    const p = await ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth || 0}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!p) return false;
    await clickAt(p.x, p.y);
    return true;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

  const injectSub = () => ev(`(() => {
    if (document.getElementById('vsub')) return 1;
    const st = document.createElement('style');
    st.textContent = '#vsub{position:fixed;left:0;right:0;bottom:0;padding:26px 48px 30px;z-index:99999;pointer-events:none;' +
      'background:linear-gradient(transparent,rgba(8,12,22,.88));color:#fff;font:600 30px/1.6 "Microsoft YaHei","PingFang SC",sans-serif;' +
      'text-align:center;text-shadow:0 2px 8px rgba(0,0,0,.5);white-space:pre-line}' +
      '#vcover{position:fixed;inset:0;z-index:99998;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:radial-gradient(900px 520px at 50% 42%,#1d2b52 0%,#101728 55%,#080c15 100%);' +
      'color:#fff;font-family:"Microsoft YaHei","PingFang SC",sans-serif}' +
      '#vcover .t{font-size:82px;font-weight:800;letter-spacing:6px}' +
      '#vcover .s{margin-top:20px;font-size:34px;opacity:.92}' +
      '#vcover .l{margin-top:44px;font-size:25px;opacity:.82}' +
      '#vcover .m{margin-top:12px;font-size:22px;opacity:.7}';
    document.head.appendChild(st);
    const s = document.createElement('div'); s.id = 'vsub'; document.body.appendChild(s);
    return 1;
  })()`);
  const cover = (html) => ev(`(() => {
    let c = document.getElementById('vcover');
    if (!c) { c = document.createElement('div'); c.id = 'vcover'; document.body.appendChild(c); }
    c.innerHTML = ${JSON.stringify(html)};
    return 1;
  })()`);
  const coverOff = () => ev(`(() => { const c = document.getElementById('vcover'); if (c) c.remove(); return 1; })()`);

  async function shot(name, caption, seconds) {
    await ev(`(() => { const s = document.getElementById('vsub'); if (s) s.textContent = ${JSON.stringify(caption || '')}; })()`);
    await sleep(240);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${String(++idx).padStart(2, '0')}-${name}.png`;
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
    scenes.push({ file, caption: caption || '', seconds });
    console.log(`  ${file}  ${seconds}s  ${(caption || '').slice(0, 30)}`);
  }

  /* ---------------------------------------------------------- 开录 */
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(4200);
  await injectSub();

  await cover('<div class="t">一图十二面</div><div class="s">让 AI 直接画出你要的图</div><div class="l">数据就是一份 JSON，AI 能写，你能在界面里接着改</div>');
  await shot('cover', '', 4.0);
  await coverOff();

  await shot('pain', '写方案、做复盘、排计划，图总得自己一张张画。\\n现在这件事可以交给 AI。', 4.6);

  /* AI 写文件那一幕 */
  await send('Page.navigate', { url: 'file:///' + aiPage.replace(/\\/g, '/') });
  await sleep(1200);
  await injectSub();
  await shot('ai-ask', '跟 AI 说一句话，它就把图写成文件。', 3.2);
  await shot('ai-write', '写出来的不是图片，是一份能读、能改、能版本管理的 JSON。', 4.0);

  /* 回到工作台：把这张图放进去（等价于 AI 写进了 charts/） */
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(3800);
  await injectSub();
  await ev(`(() => {
    const KEY = 'chartstudio.demo.v1';
    const db = JSON.parse(localStorage.getItem(KEY) || '{"charts":{},"history":{}}');
    db.charts['ai-video'] = ${JSON.stringify(DOC)};
    localStorage.setItem(KEY, JSON.stringify(db));
    return 1;
  })()`);
  await send('Page.reload');
  await sleep(3800);
  await injectSub();
  const opened = await ev(`(() => {
    const it = Array.from(document.querySelectorAll('#chartList .chart-item')).find(x => x.textContent.includes('新产品上线计划'));
    if (!it) return null;
    const r = it.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (opened) { await clickAt(opened.x, opened.y); await sleep(1400); }
  await clickSel('#toolbar [data-t="fit"]');
  await sleep(800);
  await shot('newchart', '刷新一下，AI 画的图就在工作台里了。', 4.4);

  /* 双击改字 */
  const node = await ev(`(() => {
    const g = Array.from(document.querySelectorAll('#layerNode .node')).find(x => x.getBoundingClientRect().width > 0 && x.textContent.includes('压测'));
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (node) {
    await clickAt(node.x, node.y); await sleep(120);
    await clickAt(node.x, node.y); await sleep(520);
    await send('Input.insertText', { text: '压测两轮' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(900);
  }
  await shot('edit', '哪里不对直接改：双击改字、拖动换层级、按 + / − 折叠。', 4.0);

  /* 折叠 */
  const fold = await ev(`(() => {
    const b = Array.from(document.querySelectorAll('#layerNode [data-fold]')).find(x => x.getBoundingClientRect().width > 0);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (fold) { await clickAt(fold.x, fold.y); await sleep(1000); }
  await shot('collapse', '收起一个分支，小圆钮会告诉你里面藏了几个。', 3.8);

  /* 导出 */
  await clickSel('#toolbar [data-t="export"]');
  await sleep(520);
  await shot('export', '要交出去就导出 PNG / SVG / Markdown / Mermaid。', 3.6);
  await ev(`(() => { document.body.click(); return 1; })()`);

  await cover('<div class="t">一图十二面</div><div class="s">你说一句，AI 画图；你再动手，接着改</div><div class="l">零依赖 · 浏览器打开就能用 · 数据就是 JSON</div><div class="m">在线体验 chart-workbench.app.workbuddy.host　·　代码 github.com/dongyue12/chart-tool</div>');
  await shot('end', '', 4.6);
  await coverOff();

  fs.writeFileSync(path.join(OUT, 'script.json'), JSON.stringify({ fps: 25, w: 1280, h: 720, scenes }, null, 2));
  ws.close(); browser.kill(); srv.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log(`\\n共 ${scenes.length} 镜，约 ${scenes.reduce((a, s) => a + s.seconds, 0).toFixed(1)} 秒 → ${OUT}`);
  process.exit(0);
})().catch((e) => {
  console.error('异常：', e.message);
  try { browser && browser.kill(); srv && srv.kill(); } catch (_) {}
  process.exit(1);
});
