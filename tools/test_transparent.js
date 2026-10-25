// 在浅色主题下真实点「导出 → PNG（透明底）」，下载后用 Pillow 检查 alpha
// 用法: node tools/test_transparent.js [port]
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findBrowser } from './browser.js';

const PORT = process.argv[2] || '8712';
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = findBrowser();
const DEBUG_PORT = 9333;

const charts = await (await fetch(`${BASE}/api/charts`)).json();
const flow = charts.charts.find((c) => c.type === 'flow');
const targetUrl = `${BASE}/studio/?id=${encodeURIComponent(flow.id)}`;
console.log('打开:', flow.title);

const dl = path.join(os.tmpdir(), 'wbstudio-trans-' + Date.now());
fs.mkdirSync(dl, { recursive: true });

const edge = spawn(EDGE, [
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,900', '--user-data-dir=' + path.join(os.tmpdir(), 'edge-trans-' + Date.now()),
  targetUrl,
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const list = await new Promise((res, rej) => {
  http.get(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (r) => {
    let d = '';
    r.on('data', (c) => (d += c));
    r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});
const page = list.find((t) => t.type === 'page' && t.url.includes('/studio/'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
  return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => {});

// 强制浅色主题，避免深色导出让用户误以为没透明
await ev(`(() => {
  document.body.classList.remove('dark');
  document.body.className = document.body.className.replace(/theme-\\w+/g,'');
  document.body.classList.add('theme-classic');
  localStorage.setItem('studio-theme','classic');
  localStorage.setItem('studio-dark','0');
  return document.body.className;
})()`);
await ev(`window.dispatchEvent(new Event('resize'))`);
await sleep(400);

// 导出 PNG 透明底
await ev(`(() => { const m=document.getElementById('menu'); if(!m.hidden) m.hidden=true;
  document.querySelector('[data-t="export"]').click(); return true; })()`);
await sleep(300);
const labels = await ev(`[...document.querySelectorAll('#menu .menu-item')].map(b=>b.textContent.trim())`);
console.log('菜单项:', JSON.stringify(labels));
await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b=>b.textContent.trim()==='PNG（透明底）').click()`);
await sleep(2000);

// 同时导一个普通 PNG 对照
await ev(`(() => { const m=document.getElementById('menu'); if(!m.hidden) m.hidden=true;
  document.querySelector('[data-t="export"]').click(); return true; })()`);
await sleep(300);
await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b=>b.textContent.trim()==='PNG 图片').click()`);
await sleep(2000);

console.log('下载目录:', dl);
console.log('文件:', fs.readdirSync(dl).join(', '));

ws.close();
edge.kill();
process.exit(0);
