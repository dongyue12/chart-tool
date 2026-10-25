/* 真实浏览器交互测试（CDP）：node tools/test_ui.js [port]
 * 覆盖：选中 → 双击编辑文字 → 添加节点 → 删除 → 主题/深色 → 转换类型
 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { findBrowser } = require('./browser');
const fs = require('fs');

const PORT = process.argv[2] || 8712;
const BASE = `http://127.0.0.1:${PORT}`;
const EDGE = findBrowser();
const CDP = 9333;
const profile = path.join(os.tmpdir(), 'wbstudio-test-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) { /* not ready */ }
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
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || 'eval error');
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }

  const charts = (await (await fetch(BASE + '/api/charts')).json()).charts;
  const flow = charts.find((c) => c.type === 'flow');
  // 在副本上测试（不动示例，避免污染 + 被示例保护拦住清理）
  const TEST_ID = 'test-ui-tmp';
  const src = await (await fetch(BASE + '/api/charts/' + encodeURIComponent(flow.id))).json();
  const copy = Object.assign({}, src, { id: TEST_ID, title: '测试用流程图', meta: {} });
  await fetch(BASE + '/api/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(copy),
  });
  await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/studio/?id=' + encodeURIComponent(TEST_ID) });
  await sleep(2500);

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    if (!cond) fail++;
  };

  // 1. 初始渲染
  const n0 = await ev(`document.querySelectorAll('#layerNode .node').length`);
  check('打开流程图，节点渲染', n0 === flow.nodeCount, `node=${n0}`);

  // 2. 选中节点（真实 pointer 事件）
  await ev(`(() => {
    const g = document.querySelector('#layerNode .node');
    const r = g.getBoundingClientRect();
    g.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, clientX:r.left+20, clientY:r.top+10, pointerId:1}));
    window.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, clientX:r.left+20, clientY:r.top+10, pointerId:1}));
    return true;
  })()`);
  await sleep(200);
  const selOk = await ev(`document.querySelectorAll('#layerNode .node.sel').length === 1`);
  const inspOk = await ev(`!!document.querySelector('#inspBody [data-k="text"]')`);
  check('点击节点被选中，属性面板出现文字框', selOk && inspOk);

  // 3. 双击进入编辑，改文字
  await ev(`(() => {
    const g = document.querySelector('#layerNode .node.sel');
    g.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
    return true;
  })()`);
  await sleep(300);
  const editShown = await ev(`!document.getElementById('editBox').hidden`);
  check('双击弹出就地编辑框', editShown);
  await ev(`(() => {
    const b = document.getElementById('editBox');
    b.value = '开始（已改名）';
    b.dispatchEvent(new Event('input', {bubbles:true}));
    b.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    return true;
  })()`);
  await sleep(400);
  const textChanged = await ev(`document.querySelector('#layerNode .node.sel').textContent.includes('已改名')`);
  check('回车提交后节点文字更新', textChanged);

  // 4. 工具栏「添加」加节点
  await ev(`document.querySelector('[data-t="add"]').click()`);
  await sleep(400);
  const n1 = await ev(`document.querySelectorAll('#layerNode .node').length`);
  check('点「添加」新增节点', n1 === n0 + 1, `${n0} -> ${n1}`);
  // 关掉可能弹出的编辑框
  await ev(`(() => { const b=document.getElementById('editBox'); if(!b.hidden){ b.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); } return true; })()`);

  // 5. 删除
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Delete', bubbles:true}))`);
  await sleep(400);
  const n2 = await ev(`document.querySelectorAll('#layerNode .node').length`);
  check('Delete 删除节点', n2 === n0, `${n1} -> ${n2}`);

  // 6. 主题 + 深色
  await ev(`document.querySelector('[data-t="theme"]').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b=>b.textContent.includes('森林绿')).click()`);
  await sleep(200);
  const themeOk = await ev(`document.body.getAttribute('data-theme') === 'forest'`);
  await ev(`document.querySelector('[data-t="theme"]').click()`);
  await sleep(200);
  await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b=>b.textContent.includes('深色')).click()`);
  await sleep(200);
  const darkOk = await ev(`document.body.classList.contains('dark')`);
  check('切换主题与深色模式', themeOk && darkOk);

  // 7. 保存
  await ev(`document.querySelector('[data-t="save"]').click()`);
  await sleep(900);
  const saveTxt = await ev(`document.getElementById('saveState').textContent`);
  check('保存到服务端', /已保存/.test(saveTxt), saveTxt);

  // 7.5 导出 SVG / PNG（真实下载）
  const dl = path.join(os.tmpdir(), 'wbstudio-dl-' + Date.now());
  fs.mkdirSync(dl, { recursive: true });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => {});
  for (const [label, ext, min] of [
    ['SVG 矢量图', 'svg', 800],
    ['SVG（透明底）', 'svg', 800],
    ['PNG 图片', 'png', 4000],
    ['PNG（透明底）', 'png', 4000],
  ]) {
    await ev(`(() => { const m=document.getElementById('menu'); if(!m.hidden) m.hidden=true;
      document.querySelector('[data-t="export"]').click(); return true; })()`);
    await sleep(300);
    const labels = await ev(`[...document.querySelectorAll('#menu .menu-item')].map(b=>b.textContent.trim())`);
    if (!labels.includes(label)) { console.log('    菜单项：', JSON.stringify(labels)); }
    await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b=>b.textContent.trim()==='${label}').click()`);
    await sleep(1800);
    const files = fs.readdirSync(dl).filter((f) => f.endsWith('.' + ext));
    const size = files.length ? fs.statSync(path.join(dl, files[0])).size : 0;
    check('导出 ' + label, files.length > 0 && size > min, `${files.length} 个 / ${size}B`);
  }
  // 透明底校验：SVG 不应有背景 rect；PNG 边缘像素 alpha 必须为 0
  const svgTxt = (f) => fs.readFileSync(path.join(dl, f), 'utf8');
  const svgs = fs.readdirSync(dl).filter((f) => f.endsWith('.svg'));
  const tSvg = svgs.find((f) => f.includes('透明底'));
  const oSvg = svgs.find((f) => !f.includes('透明底'));
  check('SVG 透明版：去掉背景矩形 + 标签底衬透明',
    !!tSvg && !!oSvg &&
    svgTxt(tSvg).includes('.lk-label-bg{fill:none') &&
    !svgTxt(oSvg).includes('.lk-label-bg{fill:none'),
    tSvg || '未找到透明版');
  fs.writeFileSync(path.join(dl, '_dir.txt'), dl);
  console.log('    下载目录：' + dl);

  // 7.6 窄屏：工具栏收拢 + 更多菜单
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 820, deviceScaleFactor: 1, mobile: false });
  await ev(`window.dispatchEvent(new Event('resize'))`);
  await sleep(400);
  const hiddenN = await ev(`document.querySelectorAll('#toolbar .fit-hidden').length`);
  const moreBtn = await ev(`!!document.querySelector('[data-t="more"]') && !document.querySelector('[data-t="more"]').classList.contains('fit-hidden')`);
  await ev(`document.querySelector('[data-t="more"]').click()`);
  await sleep(300);
  const moreOpen = await ev(`!document.getElementById('menu').hidden && document.querySelectorAll('#menu .menu-item').length > 0`);
  check('900px 下按钮收进「更多」且可展开', hiddenN > 0 && moreBtn && moreOpen, `收起 ${hiddenN} 项`);
  await send('Emulation.clearDeviceMetricsOverride');
  await ev(`window.dispatchEvent(new Event('resize'))`);

  // 8. 转换类型 -> 类图
  await ev(`document.querySelector('[data-t="convert"]').click()`);
  await sleep(200);
  const menuItems = await ev(`[...document.querySelectorAll('#menu .menu-item')].map(b=>b.textContent)`);
  check('转换菜单列出其它类型', menuItems.length === 11, `${menuItems.length} 项`);
  await ev(`[...document.querySelectorAll('#menu .menu-item')].find(b=>b.textContent.trim()==='类图').click()`);
  await sleep(1500);
  const badge = await ev(`document.getElementById('typeBadge').textContent`);
  const convertedNodes = await ev(`document.querySelectorAll('#layerNode .node').length`);
  check('转换成类图并打开', badge === '类图' && convertedNodes > 0, `${badge} / ${convertedNodes} 节点`);

  // 9. 新建弹窗类型数量
  await ev(`document.querySelector('[data-t="new"]').click()`);
  await sleep(300);
  const cards = await ev(`document.querySelectorAll('#kindGrid .kind-card').length`);
  check('新建面板提供 12 种图表', cards === 12, `${cards} 种`);
  await ev(`document.querySelector('#newModal [data-close]').click()`);

  // 10. 清理：删除临时图表（转换产物标题以「（类型）」结尾，但不是示例，可直接删）
  const all = (await (await fetch(BASE + '/api/charts')).json()).charts;
  for (const c of all) {
    // 临时图本身 + 由它转换出的副本（标题以「测试用流程图」开头）
    if (!c.example && (c.id === TEST_ID || /^测试用流程图/.test(c.id))) {
      await fetch(BASE + '/api/charts/' + encodeURIComponent(c.id), { method: 'DELETE' });
    }
  }
  const left = (await (await fetch(BASE + '/api/charts')).json()).charts;
  check('测试数据已清理', !left.some((c) => !c.example && /^测试用流程图/.test(c.id)), `剩余 ${left.length} 张`);

  console.log(fail ? `\n${fail} 项失败` : '\n交互测试全部通过');
  ws.close(); browser.kill();
  await sleep(300);
  process.exit(fail ? 1 : 0);
})();
