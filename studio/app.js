/* ============================================================================
 * studio/app.js —— 图表工作台
 * 一个页面搞定 12 种图表：左侧文件、中间画布、右侧属性，互不切换
 * ==========================================================================*/
(function () {
  'use strict';
  const K = window.KINDS, U = window.KindUtil;
  const $ = (s) => document.querySelector(s);
  const el = (id) => document.getElementById(id);

  const ICON = {
    new: 'M12 5v14M5 12h14', add: 'M12 5v14M5 12h14',
    save: 'M5 4h11l3 3v13H5zM9 4v5h6V4M8 20v-5h8v5',
    undo: 'M9 15L4 10l5-5M4 10h9a5 5 0 010 10h-4',
    redo: 'M15 15l5-5-5-5M20 10h-9a5 5 0 000 10h4',
    layout: 'M4 6h16M4 12h10M4 18h13',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    export: 'M12 16V4M8 8l4-4 4 4M4 18v2h16v-2',
    convert: 'M4 8h10l4 4v4H4zM18 12h2',
    history: 'M12 8v4l3 2M4 12a8 8 0 1016 0 8 8 0 00-16 0',
    theme: 'M12 3a9 9 0 100 18 4.5 4.5 0 010-9A5 5 0 0112 3z',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  };
  function svgIcon(name, size) {
    return `<svg viewBox="0 0 24 24" width="${size || 15}" height="${size || 15}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name] || ''}"/></svg>`;
  }

  /* ------------------------------------------------------------- 状态 */
  const S = {
    doc: null, id: null, kind: null,
    sel: null, selLink: null,
    zoom: 1, pan: { x: 0, y: 0 },
    undoStack: [], redoStack: [],
    dirty: false, saveTimer: null, charts: [],
    theme: localStorage.getItem('wb.theme') || 'classic',
    dark: localStorage.getItem('wb.dark') === '1',
    spaceDown: false,
  };
  const kindDef = () => (S.doc ? K[S.doc.type] : null);
  const nodeById = (id) => S.doc ? S.doc.nodes.find((n) => n.id === id) : null;
  const linkById = (id) => S.doc ? (S.doc.links || []).find((l) => l.id === id) : null;

  /** 拖动时鼠标下方的落点节点（拖过去就改父级，见 reparent）；null 表示没有 */
  let dropId = null;
  function setDrop(id) {
    if (dropId === id) return;
    const layer = el('layerNode');
    const pick = (x) => (x ? Array.from(layer.children).find((g) => g.getAttribute('data-id') === x) : null);
    const old = pick(dropId); if (old) old.classList.remove('drop');
    dropId = id;
    const now = pick(id); if (now) now.classList.add('drop');
  }

  /* ------------------------------------------------------------- 网络 */
  async function api(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(path, opt);
    const txt = await r.text();
    let data; try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { raw: txt }; }
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  /* --------------------------------------------------------------- 提示 */
  let toastTimer = null;
  function toast(msg, bad) {
    const t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.background = bad ? 'rgba(180,45,35,.94)' : 'rgba(24,32,48,.93)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ------------------------------------------------------------- 主题 */
  function applyTheme() {
    document.body.setAttribute('data-theme', S.theme);
    document.body.classList.toggle('dark', S.dark);
    localStorage.setItem('wb.theme', S.theme);
    localStorage.setItem('wb.dark', S.dark ? '1' : '0');
  }

  /* ============================================================ 文档加载 */
  async function loadList() {
    try {
      const r = await api('GET', '/api/charts');
      S.charts = r.charts || [];
    } catch (e) { S.charts = []; }
    renderList();
  }

  function renderList() {
    const box = el('chartList');
    const kw = (el('searchInput').value || '').trim().toLowerCase();
    const list = S.charts.filter((c) => !kw || (c.title || '').toLowerCase().includes(kw) || (c.type || '').includes(kw));
    if (!list.length) {
      box.innerHTML = `<div class="insp-empty" style="padding:14px 10px">${S.charts.length ? '没有匹配的图表' : '还没有图表，点「＋」新建'}</div>`;
      return;
    }
    // 先按「我的图表 / 示例」分两个大区，示例沉底
    const mine = list.filter((c) => !c.example);
    const samples = list.filter((c) => c.example);

    const itemHtml = (c) => {
      const kd = K[c.type] || {};
      const btn = c.example
        ? `<button class="ci-del ci-reset" data-reset="${U.esc(c.id)}" title="示例不可删除；点击恢复初始内容">↺</button>`
        : `<button class="ci-del" data-del="${U.esc(c.id)}" title="删除">✕</button>`;
      return `<div class="chart-item${c.id === S.id ? ' active' : ''}" data-id="${U.esc(c.id)}">` +
        `<span class="ci-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="${K.__icon(c.type)}"/></svg></span>` +
        `<span class="ci-txt"><div class="ci-name">${U.esc(c.title)}</div>` +
        `<div class="ci-meta">${U.esc(kd.name || c.type)} · ${c.nodeCount || 0} 节点</div></span>` +
        btn + `</div>`;
    };
    const groupHtml = (items) => {
      const groups = new Map();
      items.forEach((c) => {
        const g = (K[c.type] && K[c.type].group) || '其他';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(c);
      });
      let html = '';
      groups.forEach((its, g) => { html += `<div class="side-group">${g}</div>` + its.map(itemHtml).join(''); });
      return html;
    };

    let html = '';
    if (mine.length) {
      html += `<div class="side-section">我的图表<span class="sec-count">${mine.length}</span></div>` + groupHtml(mine);
    } else if (!samples.length) {
      html += `<div class="insp-empty" style="padding:14px 10px">还没有图表，点「＋」新建</div>`;
    }
    if (samples.length) {
      const open = localStorage.getItem('wb.samplesOpen') !== '0';
      html += `<div class="side-section sec-sample" id="sampleSec"><span class="sec-arrow${open ? ' open' : ''}">▸</span>示例<span class="sec-count">${samples.length}</span></div>` +
        `<div class="sample-wrap${open ? '' : ' collapsed'}" id="sampleWrap">${groupHtml(samples)}</div>`;
    }
    box.innerHTML = html;
    const sec = box.querySelector('#sampleSec');
    if (sec) {
      sec.onclick = () => {
        const wrap = box.querySelector('#sampleWrap');
        const open = wrap.classList.toggle('collapsed') === false;
        sec.querySelector('.sec-arrow').classList.toggle('open', open);
        localStorage.setItem('wb.samplesOpen', open ? '1' : '0');
      };
    }
  }

  async function openDoc(id) {
    if (!id) { S.doc = null; S.id = null; el('emptyState').hidden = false; renderInspector(); return; }
    const r = await api('GET', '/api/charts/' + encodeURIComponent(id));
    S.doc = r; S.id = r.id; S.kind = r.type;
    S.undoStack = []; S.redoStack = [];
    el('emptyState').hidden = true;
    el('titleInput').value = r.title || '';
    el('typeBadge').textContent = (K[r.type] && K[r.type].name) || r.type;
    S.theme = r.theme || S.theme; applyTheme();
    localStorage.setItem('wb.lastChart', id);
    if (location.search.indexOf('id=') < 0) history.replaceState(null, '', '?id=' + encodeURIComponent(id));
    layoutDoc(); render(); fitView(); renderInspector(); renderList();
    setHint();
    if (window.innerWidth <= 1000) el('side').classList.add('collapsed');
  }

  async function newDoc(type, title) {
    const kd = K[type];
    const tpl = kd.template(title || '');
    const body = { title: title || ('未命名' + kd.name), type, doc: { nodes: tpl.nodes || [], links: tpl.links || [], meta: tpl.meta || {}, theme: S.theme } };
    const r = await api('POST', '/api/charts', body);
    await loadList();
    await openDoc(r.id);
    toast('已创建' + kd.name);
  }

  function markDirty() {
    S.dirty = true;
    el('saveState').textContent = '未保存…';
    el('saveState').classList.add('dirty');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => saveDoc(true), 1400);
  }

  async function saveDoc(silent) {
    if (!S.doc || !S.id) return;
    S.doc.title = el('titleInput').value || S.doc.title;
    S.doc.theme = S.theme;
    try {
      // 布局/渲染过程中挂在节点上的临时字段（_m 折行缓存、_x0/_y0 拖动起点）不写进文件
      const chart = JSON.parse(JSON.stringify(S.doc));
      (chart.nodes || []).forEach((n) => { delete n._m; delete n._x0; delete n._y0; });
      const r = await api('PUT', '/api/charts/' + encodeURIComponent(S.id), { chart });
      S.doc.updatedAt = r.updatedAt;
      S.dirty = false;
      el('saveState').textContent = '已保存 ' + String(r.updatedAt || '').slice(11, 19);
      el('saveState').classList.remove('dirty');
      await loadList();
      if (!silent) toast('已保存');
    } catch (e) { toast('保存失败：' + e.message, true); }
  }

  /* ---------------------------------------------------- 撤销 / 重做 */
  function snapshot() {
    if (!S.doc) return;
    S.undoStack.push(JSON.stringify({ nodes: S.doc.nodes, links: S.doc.links, meta: S.doc.meta }));
    if (S.undoStack.length > 80) S.undoStack.shift();
    S.redoStack.length = 0;
  }
  function restore(json) {
    const d = JSON.parse(json);
    S.doc.nodes = d.nodes; S.doc.links = d.links; S.doc.meta = d.meta;
    S.sel = null; S.selLink = null;
    layoutDoc(); render(); renderInspector();
  }
  function undo() {
    if (!S.undoStack.length) return toast('没有可撤销的操作');
    S.redoStack.push(JSON.stringify({ nodes: S.doc.nodes, links: S.doc.links, meta: S.doc.meta }));
    restore(S.undoStack.pop()); markDirty();
  }
  function redo() {
    if (!S.redoStack.length) return toast('没有可重做的操作');
    S.undoStack.push(JSON.stringify({ nodes: S.doc.nodes, links: S.doc.links, meta: S.doc.meta }));
    restore(S.redoStack.pop()); markDirty();
  }

  /* ============================================================== 布局渲染 */
  function layoutDoc() {
    const kd = kindDef(); if (!kd || !S.doc) return;
    const saved = new Map();
    S.doc.nodes.forEach((n) => { if (n.pinned) saved.set(n.id, { x: n.x, y: n.y }); });
    try { kd.layout(S.doc); } catch (e) { console.warn('layout failed', e); }
    S.doc.nodes.forEach((n) => {
      const s = saved.get(n.id);
      if (s) { n.x = s.x; n.y = s.y; }
      if (!isFinite(n.x)) n.x = 0;
      if (!isFinite(n.y)) n.y = 0;
      if (!isFinite(n.w) || n.w == null) n.w = 120;
      if (!isFinite(n.h) || n.h == null) n.h = 40;
    });
  }

  function edges() {
    const kd = kindDef(); if (!kd) return [];
    return (kd.edges ? kd.edges(S.doc) : (S.doc.links || [])).filter((e) => e && e.from && e.to);
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * 渲染：连线整体重建（几何每次都变），节点层**按 id 复用 <g>**。
   * 只有内容签名变化时才重写 innerHTML，位置变化只改 transform。
   * 这样拖动时不再重建 DOM，避免焦点/双击/动画被破坏。
   */
  /** 位置对齐到屏幕像素格：拖动/摆放后不落在半像素上，避免文字和细线发虚 */
  function snapDoc(v) {
    const z = S.zoom || 1;
    return Math.round(Math.round(v * z) / z * 1000) / 1000;
  }

  /**
   * 拖动中的轻量刷新：只改被移动节点的 transform，重绘与它们相连的线。
   * 不走完整 render()——每帧重建背景与全部连线既掉帧又会让画面反复重绘，
   * 看起来就是「抖 + 糊」。
   */
  function moveOnly(ids) {
    for (const g of el('layerNode').children) {
      const id = g.getAttribute('data-id');
      if (!ids.has(id)) continue;
      const n = nodeById(id); if (!n) continue;
      const tf = `translate(${n.x},${n.y})`;
      if (g.getAttribute('transform') !== tf) g.setAttribute('transform', tf);
    }
    const kd = kindDef();
    if (!kd || !kd.drawLink) return;
    for (const g of el('layerLink').children) {
      const e = g.__e;
      if (!e || (!ids.has(e.from) && !ids.has(e.to))) continue;
      const a = nodeById(e.from), b = nodeById(e.to);
      if (!a || !b) continue;
      let inner = '';
      try { inner = kd.drawLink(e, a, b); } catch (err) { inner = ''; }
      if (g.innerHTML !== inner) g.innerHTML = inner;
    }
  }

  /* ------------------------------------------------------ 折叠（收起下级） */
  const canFold = () => !!(kindDef() && kindDef().collapsible);

  /** 父子索引：parent id → 直接子节点数组 */
  function kidIndex() {
    const m = new Map();
    if (!S.doc) return m;
    S.doc.nodes.forEach((n) => {
      if (n.parent == null) return;
      const a = m.get(n.parent);
      if (a) a.push(n); else m.set(n.parent, [n]);
    });
    return m;
  }

  /** 可见节点集合：被收起的节点，整棵子树都不进画面（null = 该类型不支持折叠） */
  function visibleSet(kids) {
    if (!S.doc || !canFold()) return null;
    const idx = kids || kidIndex();
    const ids = new Set(S.doc.nodes.map((n) => n.id));
    const out = new Set();
    const walk = (n) => {
      out.add(n.id);
      if (n.collapsed) return;
      (idx.get(n.id) || []).forEach(walk);
    };
    // 根 = 没有 parent，或 parent 指向了不存在的节点（容错）
    S.doc.nodes.forEach((n) => { if (n.parent == null || !ids.has(n.parent)) walk(n); });
    return out;
  }

  /** 节点下面的后代总数（收起后按钮上显示这个数） */
  function childTotal(id, kids) {
    const idx = kids || kidIndex();
    let c = 0;
    const walk = (pid) => (idx.get(pid) || []).forEach((k) => { c++; walk(k.id); });
    walk(id);
    return c;
  }

  function toggleFold(id, force) {
    const n = nodeById(id); if (!n || !canFold()) return;
    snapshot();
    const before = !!n.collapsed;
    n.collapsed = force === undefined ? !before : !!force;
    if (n.collapsed && S.sel && S.sel !== id && subtreeIds(id).includes(S.sel)) S.sel = id;
    layoutDoc(); render(); renderInspector(); markDirty();
  }

  /** 全部展开 / 只留一级（depth=1 表示根 + 一级可见） */
  function foldAll(depth) {
    if (!canFold() || !S.doc) return;
    snapshot();
    const kids = kidIndex();
    const ids = new Set(S.doc.nodes.map((n) => n.id));
    const walk = (n, d) => {
      const ks = kids.get(n.id) || [];
      n.collapsed = depth > 0 && d >= depth && ks.length > 0;
      ks.forEach((k) => walk(k, d + 1));
    };
    S.doc.nodes.forEach((n) => { if (n.parent == null || !ids.has(n.parent)) walk(n, 0); });
    if (S.sel && !visibleSet(kids).has(S.sel)) S.sel = null;
    layoutDoc(); render(); renderInspector(); markDirty();
    toast(depth ? '已收起到一级' : '已展开全部');
  }

  /** 节点上的收起/展开小圆钮：展开时显示「−」，收起后用数字显示藏了多少个后代 */
  function foldBtn(n, kids) {
    const ks = kids.get(n.id);
    if (!ks || !ks.length) return '';
    const side = n.side || 'r';
    let bx = n.w + 10, by = n.h / 2;
    if (side === 'l') { bx = -10; }
    else if (side === 'd') { bx = n.w / 2; by = n.h + 10; }
    else if (side === 'u') { bx = n.w / 2; by = -10; }
    const on = !!n.collapsed;
    const total = on ? childTotal(n.id, kids) : 0;
    const label = on ? (total > 99 ? '99' : String(total)) : '\u2212';
    const r = label.length > 1 ? 10 : 8.5;
    const tip = on ? `展开 ${total} 个下级` : `收起 ${ks.length} 个下级`;
    return `<g class="fold${on ? ' on' : ''}" data-fold="${U.esc(n.id)}" transform="translate(${bx},${by})">` +
      `<circle r="${r}"/><text text-anchor="middle" dominant-baseline="central">${label}</text>` +
      `<title>${tip}</title></g>`;
  }

  function render() {
    const kd = kindDef();
    if (!kd || !S.doc) {
      el('layerBack').innerHTML = ''; el('layerLink').innerHTML = ''; el('layerNode').innerHTML = '';
      return;
    }
    // 背景装饰
    el('layerBack').innerHTML = kd.drawBack ? kd.drawBack(S.doc) : '';
    // 折叠：被收起的子树既不画节点也不画连线
    const kids = canFold() ? kidIndex() : null;
    const visSet = kids ? visibleSet(kids) : null;
    const shown = (n) => !visSet || visSet.has(n.id);
    // 连线
    const es = edges().filter((e) => nodeById(e.from) && shown(nodeById(e.from)) && (!nodeById(e.to) || shown(nodeById(e.to))));
    el('layerLink').innerHTML = es.map((e) => {
      const a = nodeById(e.from), b = nodeById(e.to);
      let inner = '';
      try { inner = kd.drawLink ? kd.drawLink(e, a, b || a) : ''; } catch (err) { inner = ''; }
      const sel = S.selLink === e.id ? ' sel' : '';
      const click = e.virtual ? '' : ` data-link="${U.esc(e.id)}"`;
      return `<g class="link${sel}"${click}>${inner}</g>`;
    }).join('');
    Array.from(el('layerLink').children).forEach((g, i) => { g.__e = es[i]; });
    // 节点（增量）
    const layer = el('layerNode');
    const tree = !!kd.tree;
    const keep = new Map();
    Array.from(layer.children).forEach((g) => {
      const id = g.getAttribute && g.getAttribute('data-id');
      if (id != null) keep.set(id, g);
    });
    const desired = [];
    S.doc.nodes.forEach((n) => {
      if (!shown(n)) return;
      let inner = '';
      try { inner = kd.drawNode(n); } catch (err) { inner = `<rect class="nd" width="${n.w}" height="${n.h}" rx="8"/>`; }
      const ports = tree ? '' : [[n.w, n.h / 2, 'r'], [n.w / 2, n.h, 'b'], [0, n.h / 2, 'l'], [n.w / 2, 0, 't']]
        .map((p) => `<circle class="port" data-port="${p[2]}" cx="${p[0]}" cy="${p[1]}" r="5.5" fill="var(--accent)"/>`).join('');
      const fold = kids ? foldBtn(n, kids) : '';
      const cls = 'node' + (S.sel === n.id ? ' sel' : '') + (dropId === n.id ? ' drop' : '');
      const sig = cls + '\u0001' + inner + '\u0001' + ports + '\u0001' + fold;
      let g = keep.get(n.id);
      if (!g) {
        g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('data-id', n.id);
        g.__sig = '';
      }
      if (g.__sig !== sig) { g.innerHTML = inner + ports + fold; g.__sig = sig; }
      if (g.getAttribute('class') !== cls) g.setAttribute('class', cls);
      const tf = `translate(${n.x},${n.y})`;
      if (g.getAttribute('transform') !== tf) g.setAttribute('transform', tf);
      desired.push(g);
    });
    // 顺序与增删：仅当节点列表真的变了才重排（appendChild 会移动而非重建）
    const cur = Array.from(layer.children);
    const sameOrder = cur.length === desired.length && cur.every((g, i) => g === desired[i]);
    if (!sameOrder) {
      layer.textContent = '';
      desired.forEach((g) => layer.appendChild(g));
    }
    applyViewport();
  }

  function applyViewport() {
    // 平移量落在整数像素上，整层文字/细线才不会被抗锯齿糊掉
    el('viewport').setAttribute('transform', `translate(${Math.round(S.pan.x)},${Math.round(S.pan.y)}) scale(${S.zoom})`);
    el('zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
  }

  function contentBox() {
    if (!S.doc || !S.doc.nodes.length) return { x: -300, y: -200, w: 600, h: 400 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const vs = visibleSet();                      // 收起的节点不参与「适应画布」，否则画面会莫名缩很小
    S.doc.nodes.forEach((n) => {
      if (vs && !vs.has(n.id)) return;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + (n.w || 0)); y1 = Math.max(y1, n.y + (n.h || 0));
    });
    const g = S.doc._gantt;
    if (g) { x0 = Math.min(x0, 0); y0 = Math.min(y0, 0); x1 = Math.max(x1, g.w); y1 = Math.max(y1, g.h); }
    const sb = S.doc._seqBox;
    if (sb) { x0 = Math.min(x0, sb.x); x1 = Math.max(x1, sb.x + sb.w); y1 = Math.max(y1, sb.h); }
    return { x: x0 - 30, y: y0 - 30, w: (x1 - x0) + 60, h: (y1 - y0) + 60 };
  }

  function fitView() {
    const b = contentBox();
    const rect = el('canvas').getBoundingClientRect();
    const pad = 46;
    const z = Math.min(1.6, Math.max(0.2, Math.min((rect.width - pad * 2) / b.w, (rect.height - pad * 2) / b.h)));
    S.zoom = Math.round(z * 1000) / 1000;
    S.pan.x = (rect.width - b.w * S.zoom) / 2 - b.x * S.zoom;
    S.pan.y = (rect.height - b.h * S.zoom) / 2 - b.y * S.zoom;
    applyViewport();
  }

  function setHint() {
    const kd = kindDef();
    if (!kd) { el('hintBar').textContent = ''; return; }
    const base = '双击改文字 · 拖动可移动 · 滚轮缩放 · 右键更多';
    const extra = kd.tree ? ' · Enter 加下级 · Tab 加同级' : ' · 拖圆点连线 · Enter 加节点';
    el('hintBar').textContent = base + extra;
  }

  /* ============================================================== 编辑操作 */
  function selectNode(id) {
    S.sel = id; S.selLink = null;
    if (window.innerWidth <= 1180) el('inspector').classList.remove('collapsed');
    render(); renderInspector();
  }
  function selectLink(id) { S.selLink = id; S.sel = null; render(); renderInspector(); }
  function clearSel() { S.sel = null; S.selLink = null; render(); renderInspector(); }

  function addNode(sibling) {
    const kd = kindDef(); if (!kd) return;
    snapshot();
    const cur = S.sel ? nodeById(S.sel) : null;
    let meta = kd.createNode ? kd.createNode(S.doc, cur) : { text: '新节点' };
    const n = Object.assign({ id: U.uid('n') }, meta);
    if (kd.tree) {
      if (cur) {
        if (sibling && cur.parent) n.parent = cur.parent;
        else n.parent = cur.id;
      } else n.parent = null;
    } else if (cur && !sibling) {
      // 非树图：新节点放在选中节点下方，并自动连线
      n.x = cur.x; n.y = cur.y + (cur.h || 40) + 70; n.pinned = true;
    } else if (cur) {
      n.x = cur.x + (cur.w || 120) + 70; n.y = cur.y; n.pinned = true;
    }
    S.doc.nodes.push(n);
    if (!kd.tree && cur && !sibling) {
      S.doc.links = S.doc.links || [];
      S.doc.links.push({ id: U.uid('l'), from: cur.id, to: n.id, label: '', kind: 'rel' });
    }
    S.sel = n.id;
    layoutDoc(); render(); renderInspector(); markDirty();
    setTimeout(() => editNode(n.id), 40);
  }

  function delSel() {
    const kd = kindDef(); if (!kd) return;
    if (S.selLink) {
      snapshot();
      S.doc.links = (S.doc.links || []).filter((l) => l.id !== S.selLink);
      S.selLink = null;
    } else if (S.sel) {
      snapshot();
      if (kd.tree) {
        const kill = new Set([S.sel]);
        let more = true;
        while (more) {
          more = false;
          S.doc.nodes.forEach((n) => { if (n.parent && kill.has(n.parent) && !kill.has(n.id)) { kill.add(n.id); more = true; } });
        }
        if (kill.size >= S.doc.nodes.length) { toast('至少保留一个节点'); return; }
        S.doc.nodes = S.doc.nodes.filter((n) => !kill.has(n.id));
      } else {
        S.doc.nodes = S.doc.nodes.filter((n) => n.id !== S.sel);
        S.doc.links = (S.doc.links || []).filter((l) => l.from !== S.sel && l.to !== S.sel);
      }
      S.sel = null;
    } else return;
    layoutDoc(); render(); renderInspector(); markDirty();
  }

  /* -------------------------------------------------------- 文本就地编辑 */
  function editNode(id) {
    const box = el('editBox');
    if (!box.hidden && box.dataset.id === id) return;   // 已在编辑同一节点（原生 dblclick 补发）
    const n = nodeById(id); if (!n) return;
    const kd = kindDef();
    const rect = nodeScreenRect(n);
    box.hidden = false;
    box.value = n.text || '';
    box.style.left = rect.x + 'px';
    box.style.top = rect.y + 'px';
    box.style.width = Math.max(120, rect.w) + 'px';
    box.style.height = Math.max(32, rect.h) + 'px';
    box.style.fontSize = (n._m && n._m.fs ? n._m.fs : 14) + 'px';
    box.dataset.id = id;
    const grow = () => { box.style.height = 'auto'; box.style.height = Math.max(32, box.scrollHeight) + 'px'; };
    grow();
    setTimeout(() => { box.focus(); box.select(); }, 10);
    box.oninput = grow;
    box.onkeydown = (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitEdit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); box.hidden = true; box.dataset.id = ''; }
      ev.stopPropagation();
    };
    box.onblur = () => { if (!box.hidden) commitEdit(); };
  }
  function commitEdit() {
    const box = el('editBox');
    const id = box.dataset.id;
    box.hidden = true; box.dataset.id = '';
    const n = nodeById(id); if (!n) return;
    const v = box.value;
    if (v === (n.text || '')) return;
    snapshot();
    n.text = v;
    if (n.shape === undefined && kindDef() && kindDef().type === 'flow') n.shape = U.guessShape(v);
    layoutDoc(); render(); renderInspector(); markDirty();
  }
  function nodeScreenRect(n) {
    const r = el('stage').getBoundingClientRect();
    return { x: r.left + S.pan.x + n.x * S.zoom, y: r.top + S.pan.y + n.y * S.zoom, w: n.w * S.zoom, h: n.h * S.zoom };
  }
  function toDoc(clientX, clientY) {
    const r = el('stage').getBoundingClientRect();
    return { x: (clientX - r.left - S.pan.x) / S.zoom, y: (clientY - r.top - S.pan.y) / S.zoom };
  }

  /* ============================================================== 属性面板 */
  function renderInspector() {
    const body = el('inspBody');
    const kd = kindDef();
    if (!kd || !S.doc) { body.innerHTML = '<div class="insp-empty">新建或打开一个图表</div>'; el('inspTitle').textContent = '属性'; return; }
    if (S.selLink) {
      const l = linkById(S.selLink);
      if (!l) { S.selLink = null; return renderInspector(); }
      el('inspTitle').textContent = '连线';
      const fields = (kd.linkFields ? kd.linkFields(l) : []) || [];
      body.innerHTML = fieldHtml(fields, l) +
        `<div class="insp-sec">操作</div><button class="ghost-btn" id="btnDelLink" style="width:100%">删除这条连线</button>`;
      bindFields(fields, l);
      el('btnDelLink').onclick = delSel;
      return;
    }
    if (S.sel) {
      const n = nodeById(S.sel);
      if (!n) { S.sel = null; return renderInspector(); }
      el('inspTitle').textContent = (kd.name || '') + ' · 节点';
      const fields = (kd.nodeFields ? kd.nodeFields(n) : []) || [];
      let html = fieldHtml(fields, n);
      if (kd.img) html += imgFieldHtml(n);
      const nKids = kd.collapsible ? S.doc.nodes.filter((x) => x.parent === n.id).length : 0;
      if (nKids) {
        html += `<div class="insp-sec">下级（${nKids} 个）</div>
          <div class="chip-row">
            <button class="chip" data-act="fold">${n.collapsed ? '展开下级' : '收起下级'}</button>
            <button class="chip" data-act="foldall">全部展开</button>
          </div>
          <div class="insp-hint">拖到别的节点上松手，就挂到它下面</div>`;
      }
      html += `<div class="insp-sec">操作</div>
        <div class="chip-row">
          <button class="chip" data-act="child">加下级</button>
          ${kd.tree ? '<button class="chip" data-act="sib">加同级</button>' : '<button class="chip" data-act="sib">加相邻</button>'}
          <button class="chip" data-act="del">删除</button>
        </div>`;
      if (n.pinned) html += `<div class="insp-sec">位置</div><div class="chip-row"><button class="chip" data-act="unpin">恢复自动布局</button></div>`;
      body.innerHTML = html;
      bindFields(fields, n);
      body.querySelectorAll('.chip').forEach((b) => {
        b.onclick = () => {
          const a = b.dataset.act;
          if (a === 'child') addNode(false);
          else if (a === 'sib') addNode(true);
          else if (a === 'del') delSel();
          else if (a === 'fold') toggleFold(n.id);
          else if (a === 'foldall') foldAll(0);
          else if (a === 'unpin') { delete n.pinned; layoutDoc(); render(); renderInspector(); markDirty(); }
        };
      });
      bindImgField(n);
      return;
    }
    // 未选中：图表信息
    el('inspTitle').textContent = '图表';
    const themes = [['classic', '经典蓝'], ['forest', '森林绿'], ['sunset', '落日橙'], ['violet', '紫罗兰']];
    const groups = {};
    K.__list().forEach((x) => { (groups[x.group] = groups[x.group] || []).push(x); });
    const lays = kd.layouts || [];
    const curLay = curLayout();
    body.innerHTML = `
      <div class="field"><label>名称</label><input type="text" id="fTitle" value="${U.esc(S.doc.title || '')}"></div>
      <div class="insp-sec">类型</div>
      <div class="chip-row" id="typeChips"></div>
      ${lays.length ? `<div class="insp-sec">布局</div>
      <div class="chip-row" id="layoutChips">${lays.map((l) => `<button class="chip${l.key === curLay ? ' on' : ''}" data-layout="${U.esc(l.key)}">${U.esc(l.label)}</button>`).join('')}</div>
      <div class="insp-hint">换布局不影响内容，手动拖过的节点点「清除手动位置并重排」即可归位</div>` : ''}
      <div class="insp-sec">主题</div>
      <div class="chip-row">${themes.map((t) => `<button class="chip${S.theme === t[0] ? ' on' : ''}" data-theme="${t[0]}">${t[1]}</button>`).join('')}</div>
      <div class="chip-row" style="margin-top:8px">
        <button class="chip${S.dark ? ' on' : ''}" id="btnDark">深色模式</button>
        <button class="chip" id="btnRelayout">自动布局</button>
      </div>
      ${canFold() ? `<div class="insp-sec">折叠</div>
      <div class="chip-row">
        <button class="chip" id="btnExpandAll">展开全部</button>
        <button class="chip" id="btnFoldOne">只留一级</button>
      </div>
      <div class="insp-hint">节点旁的圆点可直接收起／展开；把节点拖到另一个节点上松手，就挂到它下面</div>` : ''}
      <div class="insp-sec">统计</div>
      <div class="insp-empty">${S.doc.nodes.length} 个节点 · ${(S.doc.links || []).length} 条连线<br>
      更新于 ${U.esc(String(S.doc.updatedAt || '').replace('T', ' '))}</div>
      <div class="insp-sec">说明</div>
      <div class="insp-empty">${U.esc(kd.desc || '')}</div>`;
    el('fTitle').onchange = () => { el('titleInput').value = el('fTitle').value; S.doc.title = el('fTitle').value; markDirty(); };
    body.querySelectorAll('[data-layout]').forEach((b) => {
      b.onclick = () => { if (b.dataset.layout !== curLay) setLayout(b.dataset.layout); };
    });
    body.querySelectorAll('[data-theme]').forEach((b) => {
      b.onclick = () => { S.theme = b.dataset.theme; applyTheme(); renderInspector(); markDirty(); };
    });
    el('btnDark').onclick = () => { S.dark = !S.dark; applyTheme(); renderInspector(); };
    el('btnRelayout').onclick = doRelayout;
    if (el('btnExpandAll')) el('btnExpandAll').onclick = () => foldAll(0);
    if (el('btnFoldOne')) el('btnFoldOne').onclick = () => foldAll(1);
    const tc = el('typeChips');
    tc.innerHTML = `<span class="chip on">${U.esc(kd.name)}</span>`;
  }

  /* ---------------------------------------------------------- 节点图片 */
  function imgFieldHtml(n) {
    const list = U.nodeImages(n);
    if (list.length) {
      const cells = list.map((it, i) =>
        `<div class="img-cell"><img src="${U.esc(it.data)}" alt="">` +
        `<button class="img-x" data-imgdel="${i}" title="移除这张">✕</button></div>`).join('');
      return `<div class="insp-sec">图片${list.length > 1 ? '（' + list.length + ' 张）' : ''}</div>
        <div class="img-grid${list.length === 1 ? ' one' : ''}">${cells}</div>
        <div class="chip-row"><button class="chip" id="imgPick">添加图片</button><button class="chip" id="imgDel">全部移除</button></div>`;
    }
    return `<div class="insp-sec">图片</div>
      <div class="insp-empty" style="padding:0 0 8px">可上传、Ctrl+V 粘贴（支持多张），或直接把图片拖到画布上</div>
      <button class="chip" id="imgPick" style="width:100%">上传图片</button>`;
  }
  function bindImgField(n) {
    const pick = el('imgPick');
    if (pick) pick.onclick = () => el('imgFile').click();
    el('inspBody').querySelectorAll('[data-imgdel]').forEach((b) => {
      b.onclick = () => {
        snapshot();
        const i = +b.dataset.imgdel;
        const list = U.nodeImages(n).slice();
        list.splice(i, 1);
        delete n.image; delete n.imgW; delete n.imgH;
        if (list.length) n.images = list; else delete n.images;
        layoutDoc(); render(); renderInspector(); markDirty();
      };
    });
    const del = el('imgDel');
    if (del) del.onclick = () => {
      snapshot();
      delete n.image; delete n.imgW; delete n.imgH; delete n.images;
      layoutDoc(); render(); renderInspector(); markDirty();
    };
  }

  /** 读图并压缩：长边 ≤ 720px；PNG 保留透明（体积可控时），其余转 JPEG */
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) return reject(new Error('不是图片文件'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读取文件失败'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解析失败'));
        img.onload = () => {
          const MAX = 720;
          const k = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * k));
          const h = Math.max(1, Math.round(img.height * k));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, w, h);
          const keepPng = /png|gif|webp|svg/i.test(file.type || '') && (file.size || 0) <= 320 * 1024;
          const url = keepPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
          resolve({ url, w, h });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /**
   * 批量加图片：拖入 / 粘贴 / 选文件都走这里。
   * 规则：多张图统一装进**同一个节点**（方便折叠、整体拖动）；优先复用选中的空节点，
   * 否则新建一个纯图片节点（树形挂到落点/选中节点下，非树形放在落点并自动连线）。
   */
  async function addImages(files, opts) {
    opts = opts || {};
    if (!S.doc) {
      await newDoc('mindmap', '图片集');            // 空工作台拖图进来，直接开一张导图
      if (!S.doc) return;
    }
    const kd = kindDef();
    if (!kd.img) { toast((kd.name || '该类型') + ' 暂不支持图片', true); return; }
    const list = (files || []).filter((f) => f && /^image\//.test(f.type || ''));
    if (!list.length) { toast('没有识别到图片', true); return; }
    toast('正在处理 ' + list.length + ' 张图片…');

    const imgs = [];
    for (const f of list) {
      try { const r = await readImage(f); imgs.push({ data: r.url, w: r.w, h: r.h }); } catch (e) { /* 跳过坏图 */ }
    }
    if (!imgs.length) { toast('图片读取失败', true); return; }

    let host = opts.hostId ? nodeById(opts.hostId) : null;
    if (!host && S.sel) host = nodeById(S.sel);
    const hostEmpty = !!host && !String(host.text || '').trim() && !U.nodeImages(host).length;
    // 属性面板「上传图片」直接加进当前节点；粘贴/拖放则优先复用空节点，否则新建一个
    const into = !!opts.into && !!host;

    snapshot();
    let target;
    if (host && (into || hostEmpty)) {
      target = host;
      target.images = U.nodeImages(host).concat(imgs);
    } else {
      target = { id: U.uid('n'), text: '', note: '', images: imgs };
      if (kd.tree) {
        const root = S.doc.nodes.find((n) => !n.parent) || S.doc.nodes[0] || null;
        target.parent = host ? host.id : (root ? root.id : null);
        if (host && host.collapsed) host.collapsed = false;   // 挂进去要看得见
      } else {
        const p = opts.point || (host ? { x: host.x + host.w + 40, y: host.y } : { x: 0, y: 0 });
        target.x = Math.round(p.x); target.y = Math.round(p.y); target.pinned = true;
      }
      S.doc.nodes.push(target);
      if (!kd.tree && host) {
        S.doc.links = S.doc.links || [];
        S.doc.links.push({ id: U.uid('l'), from: host.id, to: target.id, label: '', kind: 'rel' });
      }
    }
    delete target.image; delete target.imgW; delete target.imgH;   // 新数据统一用 images
    S.sel = target.id;
    layoutDoc(); render(); renderInspector(); markDirty();
    ensureVisible(target);
    toast(imgs.length > 1 ? ('已添加 ' + imgs.length + ' 张图片，收在同一个节点里') : '图片已添加到节点');
  }

  /** 新加的节点如果落在视口外，顺手适应一下画布 */
  function ensureVisible(n) {
    const r = el('stage').getBoundingClientRect();
    const x = S.pan.x + n.x * S.zoom, y = S.pan.y + n.y * S.zoom;
    if (x < 8 || y < 8 || x + n.w * S.zoom > r.width - 8 || y + n.h * S.zoom > r.height - 8) fitView();
  }

  function applyImage(file) { return addImages([file]); }

  function fieldHtml(fields, obj) {
    return fields.map((f) => {
      const v = obj[f.key];
      if (f.type === 'textarea') return `<div class="field"><label>${U.esc(f.label)}</label><textarea data-k="${f.key}">${U.esc(v == null ? '' : v)}</textarea></div>`;
      if (f.type === 'select') return `<div class="field"><label>${U.esc(f.label)}</label><select data-k="${f.key}">${f.options.map((o) => {
        const val = Array.isArray(o) ? o[0] : o, lb = Array.isArray(o) ? o[1] : o;
        return `<option value="${U.esc(val)}"${v === val ? ' selected' : ''}>${U.esc(lb)}</option>`;
      }).join('')}</select></div>`;
      if (f.type === 'color') return `<div class="field"><label>${U.esc(f.label)}</label><div class="row"><input type="color" data-k="${f.key}" value="${U.esc(v || '#3b6ef6')}"><button class="chip" data-clear="${f.key}">清除</button></div></div>`;
      if (f.type === 'number') return `<div class="field"><label>${U.esc(f.label)}</label><input type="number" data-k="${f.key}" value="${U.esc(v == null ? 0 : v)}"></div>`;
      if (f.type === 'check') return `<div class="field"><label class="row" style="gap:6px"><input type="checkbox" data-k="${f.key}"${v ? ' checked' : ''} style="width:auto"> ${U.esc(f.label)}</label></div>`;
      if (f.type === 'members') return `<div class="field"><label>${U.esc(f.label)}</label><textarea data-k="members">${U.esc((v || []).map((m) => m.text).join('\n'))}</textarea></div>`;
      if (f.type === 'attrs') return `<div class="field"><label>${U.esc(f.label)}</label><textarea data-k="attrs">${U.esc((v || []).map((a) => (a.pk ? '*' : '') + a.text).join('\n'))}</textarea></div>`;
      return `<div class="field"><label>${U.esc(f.label)}</label><input type="text" data-k="${f.key}" value="${U.esc(v == null ? '' : v)}"></div>`;
    }).join('');
  }

  function bindFields(fields, obj) {
    const body = el('inspBody');
    body.querySelectorAll('[data-k]').forEach((ipt) => {
      const f = fields.find((x) => x.key === ipt.dataset.k);
      const apply = () => {
        snapshot();
        const k = ipt.dataset.k;
        if (k === 'members') obj.members = ipt.value.split('\n').filter((s) => s.trim()).map((s) => ({ text: s.trim(), kind: /\(\)/.test(s) ? 'method' : 'attr' }));
        else if (k === 'attrs') obj.attrs = ipt.value.split('\n').filter((s) => s.trim()).map((s) => ({ text: s.replace(/^\*/, '').trim(), pk: s.trim().startsWith('*') }));
        else if (f && f.type === 'number') obj[k] = Number(ipt.value) || 0;
        else if (f && f.type === 'check') obj[k] = !!ipt.checked;
        else obj[k] = ipt.value;
        layoutDoc(); render(); markDirty();
      };
      ipt.onchange = apply;
      if (ipt.tagName === 'TEXTAREA') ipt.oninput = debounce(apply, 500);
    });
    body.querySelectorAll('[data-clear]').forEach((b) => {
      b.onclick = () => { snapshot(); obj[b.dataset.clear] = null; layoutDoc(); render(); renderInspector(); markDirty(); };
    });
  }
  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); };
  }

  function doRelayout() {
    if (!S.doc) return;
    S.doc.nodes.forEach((n) => { delete n.pinned; });
    layoutDoc(); render(); fitView(); markDirty();
    toast('已重新布局');
  }

  /* --------------------------------------------------------- 布局方式切换 */
  const curLayout = () => {
    const kd = kindDef();
    if (!kd || !kd.layouts || !kd.layouts.length) return null;
    return (S.doc.meta && S.doc.meta.layout) || kd.layouts[0].key;
  };
  function setLayout(key) {
    const kd = kindDef();
    if (!kd || !kd.layouts) return;
    const item = kd.layouts.find((l) => l.key === key);
    if (!item) return;
    snapshot();
    S.doc.meta = S.doc.meta || {};
    S.doc.meta.layout = key;
    layoutDoc(); render(); fitView(); renderInspector(); markDirty();
    toast('布局：' + item.label);
  }
  function layoutMenu(btn) {
    const kd = kindDef();
    if (!kd || !kd.layouts || !kd.layouts.length) return doRelayout();
    const cur = curLayout();
    const items = [{ title: '排布方式' }];
    kd.layouts.forEach((l) => items.push({ label: (l.key === cur ? '✓  ' : '') + l.label, act: () => setLayout(l.key) }));
    items.push({ sep: true }, { label: '清除手动位置并重排', act: doRelayout });
    showMenu(btn, items);
  }

  /* ================================================================ 工具栏 */
  const TOOLS = [
    { id: 'new', label: '新建', icon: 'new', fit: 0, act: () => openNew() },
    { id: 'add', label: '添加', icon: 'add', fit: 0, act: () => addNode(false) },
    { id: 'save', label: '保存', icon: 'save', fit: 1, act: () => saveDoc(false) },
    { id: 'undo', label: '撤销', icon: 'undo', fit: 2, act: undo },
    { id: 'redo', label: '重做', icon: 'redo', fit: 3, act: redo },
    { id: 'layout', label: '布局', icon: 'layout', fit: 2, act: (btn) => layoutMenu(btn) },
    { id: 'fit', label: '适应', icon: 'fit', fit: 3, act: fitView },
    { id: 'export', label: '导出', icon: 'export', fit: 1, act: (btn) => exportMenu(btn) },
    { id: 'convert', label: '转换', icon: 'convert', fit: 2, act: (btn) => convertMenu(btn) },
    { id: 'history', label: '历史', icon: 'history', fit: 3, act: openHistory },
    { id: 'theme', label: '主题', icon: 'theme', fit: 2, act: (btn) => themeMenu(btn) },
    { id: 'more', label: '', icon: 'more', fit: 0, act: (btn) => moreMenu(btn) },
  ];
  function buildToolbar() {
    const bar = el('toolbar');
    bar.innerHTML = TOOLS.map((t) =>
      `<button class="tool-btn" data-t="${t.id}" data-fit="${t.fit}" title="${U.esc(t.label || '更多')}">${svgIcon(t.icon)}${t.label ? `<span>${t.label}</span>` : ''}</button>`
    ).join('');
    bar.querySelectorAll('[data-t]').forEach((b) => {
      b.onclick = () => {
        const t = TOOLS.find((x) => x.id === b.dataset.t);
        if (t) t.act(b);
      };
    });
    fitToolbar();
  }
  function fitToolbar() {
    const bar = el('toolbar');
    const top = document.querySelector('.topbar');
    const items = [...bar.querySelectorAll('[data-t]')];
    items.forEach((b) => b.classList.remove('fit-hidden'));
    // 以「顶栏是否横向溢出」为唯一标准：toolbar 不参与压缩，溢出一项就收一项
    if (top.scrollWidth <= top.clientWidth) return;
    const order = items.slice().sort((a, b) => (+b.dataset.fit) - (+a.dataset.fit));
    for (const b of order) {
      if (b.dataset.t === 'more') continue;
      b.classList.add('fit-hidden');
      if (top.scrollWidth <= top.clientWidth) break;
    }
  }

  /** 窄屏：侧栏与属性面板改成抽屉，避免把画布挤没（只在跨断点时重置，别抢用户手动展开） */
  let lastW = 2000;
  function applyResponsive() {
    const w = window.innerWidth;
    const side = el('side'), insp = el('inspector');
    if (w > 1000) side.classList.remove('collapsed');
    else if (lastW > 1000) side.classList.add('collapsed');
    if (w > 1180) insp.classList.remove('collapsed');
    else if (lastW > 1180) insp.classList.add('collapsed');
    lastW = w;
  }

  /* ---------------------------------------------------------------- 菜单 */
  let menuOpen = false;
  function showMenu(anchor, items) {
    const m = el('menu');
    m.innerHTML = items.map((it) => {
      if (it.sep) return '<div class="menu-sep"></div>';
      if (it.title) return `<div class="menu-title">${U.esc(it.title)}</div>`;
      return `<button class="menu-item${it.danger ? ' danger' : ''}" data-i="${U.esc(it.label)}">${it.icon ? svgIcon(it.icon) : ''}<span>${U.esc(it.label)}</span></button>`;
    }).join('');
    m.hidden = false; menuOpen = true;
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - mw - 10);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 10) top = Math.max(10, r.top - mh - 6);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    m.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = () => { hideMenu(); const it = items.find((x) => x.label === b.dataset.i); if (it && it.act) it.act(); };
    });
  }
  function hideMenu() { el('menu').hidden = true; menuOpen = false; }

  function exportMenu(btn) {
    const kd = kindDef();
    const items = [
      { title: '图片' },
      { label: 'PNG 图片', act: () => exportPng(false) },
      { label: 'PNG（透明底）', act: () => exportPng(true) },
      { label: 'SVG 矢量图', act: () => exportSvg(false) },
      { label: 'SVG（透明底）', act: () => exportSvg(true) },
      { title: '数据' },
      { label: 'JSON 文件', act: () => download(S.doc.title + '.json', JSON.stringify(S.doc, null, 2), 'application/json') },
      { label: 'Markdown 大纲', act: () => exportMd() },
    ];
    if (kd && kd.mermaid) items.push({ label: 'Mermaid 代码', act: () => exportMermaid() });
    items.push({ sep: true }, { label: '导入 JSON', act: () => importJson() }, { label: '导入 Markdown', act: () => importMd() });
    showMenu(btn, items);
  }

  function convertMenu(btn) {
    const items = [{ title: '转换成其它图表（新建一份）' }];
    K.__list().forEach((x) => {
      if (x.type === S.doc.type) return;
      items.push({ label: x.name, act: () => doConvert(x.type) });
    });
    showMenu(btn, items);
  }

  function themeMenu(btn) {
    showMenu(btn, [
      { title: '配色' },
      { label: '经典蓝', act: () => setTheme('classic') },
      { label: '森林绿', act: () => setTheme('forest') },
      { label: '落日橙', act: () => setTheme('sunset') },
      { label: '紫罗兰', act: () => setTheme('violet') },
      { sep: true },
      { label: S.dark ? '切换为浅色' : '切换为深色', act: () => { S.dark = !S.dark; applyTheme(); markDirty(); } },
    ]);
  }
  function setTheme(t) { S.theme = t; applyTheme(); markDirty(); }

  function moreMenu(btn) {
    const hidden = [...el('toolbar').querySelectorAll('.fit-hidden')].map((b) => TOOLS.find((x) => x.id === b.dataset.t)).filter(Boolean);
    const items = [];
    hidden.forEach((t) => items.push({ label: t.label || '更多', icon: t.icon, act: t.act }));
    if (items.length) items.push({ sep: true });
    items.push({ title: '其它' });
    items.push({ label: '删除当前图表', icon: 'trash', danger: true, act: delChart });
    showMenu(btn, items);
  }

  /* ============================================================ 导入导出 */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function outlineOf() {
    const kd = kindDef(); if (!kd) return [];
    return kd.outline ? kd.outline(S.doc) : S.doc.nodes.map((n) => ({ level: 0, text: n.text }));
  }
  function outlineToMd(items) {
    return items.map((i) => '  '.repeat(Math.max(0, i.level)) + '- ' + (i.text || '')).join('\n');
  }
  function mdToOutline(md) {
    const out = [];
    String(md || '').split(/\r?\n/).forEach((line) => {
      const h = line.match(/^(#+)\s*(.*)$/);
      if (h) { out.push({ level: h[1].length - 1, text: h[2].trim() }); return; }
      const b = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/);
      if (b) out.push({ level: Math.floor(b[1].length / 2) + (h ? 0 : 0), text: b[2].replace(/^\[[ xX]\]\s*/, '').trim() });
      else if (line.trim() && out.length) out.push({ level: out[out.length - 1].level + 1, text: line.trim() });
    });
    return out;
  }

  function exportMd() {
    const title = '# ' + (S.doc.title || '未命名') + '\n\n';
    openText('Markdown 大纲', title + outlineToMd(outlineOf()) + '\n', [
      { label: '下载 .md', act: () => download(S.doc.title + '.md', title + outlineToMd(outlineOf()) + '\n', 'text/markdown') },
      { label: '复制', act: () => copyText(el('textArea').value) },
    ]);
  }
  function exportMermaid() {
    const kd = kindDef(); if (!kd || !kd.mermaid) return toast('该类型暂不支持 Mermaid');
    const code = kd.mermaid(S.doc);
    openText('Mermaid 代码', code, [
      { label: '下载 .mmd', act: () => download(S.doc.title + '.mmd', code, 'text/plain') },
      { label: '复制', act: () => copyText(code) },
    ]);
  }
  function copyText(t) {
    navigator.clipboard.writeText(t).then(() => toast('已复制'), () => toast('复制失败', true));
  }
  function openText(title, value, buttons) {
    el('textModalTitle').textContent = title;
    el('textArea').value = value;
    el('textModal').hidden = false;
    el('textModalFoot').innerHTML = '';
    (buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'primary-btn'; btn.textContent = b.label;
      btn.onclick = () => { b.act(); };
      el('textModalFoot').appendChild(btn);
    });
  }

  function importMd() {
    openText('导入 Markdown 大纲', '', [{
      label: '导入为大纲并重建', act: () => {
        const md = el('textArea').value;
        applyOutline(mdToOutline(md));
        el('textModal').hidden = true;
      },
    }]);
  }
  function applyOutline(items) {
    const kd = kindDef();
    if (!kd || !S.doc) return toast('请先打开一个图表');
    if (!items.length) return toast('没有解析出内容', true);
    snapshot();
    const r = kd.fromOutline(items, S.doc.title);
    S.doc.nodes = r.nodes || [];
    S.doc.links = r.links || [];
    S.doc.meta = Object.assign(S.doc.meta || {}, r.meta || {});
    S.sel = null; layoutDoc(); render(); fitView(); renderInspector(); markDirty();
    toast('已导入 ' + S.doc.nodes.length + ' 个节点');
  }

  function importJson() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const d = JSON.parse(rd.result);
          if (!d.nodes) throw new Error('缺少 nodes');
          snapshot();
          S.doc.nodes = d.nodes; S.doc.links = d.links || []; S.doc.meta = d.meta || {};
          if (d.type && K[d.type]) S.doc.type = d.type;
          layoutDoc(); render(); fitView(); renderInspector(); markDirty();
          toast('已导入');
        } catch (e) { toast('导入失败：' + e.message, true); }
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  async function doConvert(type) {
    const kd = kindDef(); if (!kd) return;
    const items = outlineOf();
    const t = K[type];
    const r = t.fromOutline(items, S.doc.title);
    const title = S.doc.title + '（' + t.name + '）';
    const res = await api('POST', '/api/charts', { title, type, doc: { nodes: r.nodes || [], links: r.links || [], meta: r.meta || {}, theme: S.theme } });
    await loadList();
    await openDoc(res.id);
    toast('已转换为' + t.name);
  }

  function svgMarkup(opt) {
    const transparent = !!(opt && opt.transparent);
    const b = contentBox();
    const css = exportCss(transparent);
    const kd = kindDef();
    const body = S.doc.nodes.map((n) => {
      let inner = '';
      try { inner = kd.drawNode(n); } catch (e) { inner = `<rect class="nd" width="${n.w}" height="${n.h}" rx="8"/>`; }
      return `<g transform="translate(${n.x},${n.y})">${inner}</g>`;
    }).join('');
    return {
      box: b,
      transparent,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(b.w)}" height="${Math.round(b.h)}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">` +
        `<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${cssVar('--node-line-strong')}"/></marker></defs>` +
        `<style>${css.rules}</style>` +
        (transparent ? '' : `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${css.bg}"/>`) +
        (el('layerBack').innerHTML || '') + (el('layerLink').innerHTML || '') + body +
        `</svg>`,
      bg: css.bg,
    };
  }
  function exportSvg(transparent) {
    const r = svgMarkup({ transparent });
    download(S.doc.title + (transparent ? '-透明底' : '') + '.svg', r.svg, 'image/svg+xml');
  }
  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }
  function exportCss(transparent) {
    const v = (n, d) => cssVar(n) || d;
    const clear = (c) => (transparent ? 'none' : c);
    const accent = v('--accent', '#3b6ef6'), accentSoft = v('--accent-soft', '#e8f0ff');
    const nodeBg = v('--node-bg', '#fff'), line = v('--node-line', '#d7dee9'), lineS = v('--node-line-strong', '#b9c4d4');
    const text = v('--text', '#1f2937'), text2 = v('--text-2', '#64748b'), text3 = v('--text-3', '#94a3b8');
    const bg = clear(v('--bg', '#f4f6fb'));
    const panel = clear(v('--panel', '#fff')), panel2 = clear(v('--panel-2', '#fafbfe'));
    return {
      bg,
      transparent: !!transparent,
      rules: `.nd{fill:${nodeBg};stroke:${line};stroke-width:1.4}
.nd-text{fill:${text};font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.on-accent{fill:#fff}
.nd-root,.nd-fish-head{fill:${accent};stroke:${accent}}
.nd-term,.nd-actor,.nd-concept,.nd-fish-branch{fill:${accentSoft};stroke:${accent}}
.nd-dec{fill:#fff8e6;stroke:#e0a34a}.nd-io{fill:#eef4ff;stroke:#7f9dd6}
.nd-rel{fill:#fdf1e3;stroke:#d9a45c}.nd-start,.nd-end2{fill:${text2}}
.nd-end{fill:${nodeBg};stroke:${text2}}.nd-member{fill:${text2}}
.nd-tl-date,.ln-seq,.ln-branch{stroke:${accent}}.nd-tl-date{fill:${accent};stroke:none}
.tl-dot{fill:${accent};stroke:${nodeBg}}.ln-branch{fill:none;stroke:${accent};stroke-width:2}
.lk{fill:none;stroke:${lineS};stroke-width:1.7}
.ln-seq{fill:none;stroke:${accent};stroke-width:1.8}
.lk-label{fill:${text2};font-size:11.5px;font-family:sans-serif}
.lk-label-bg{fill:${bg};stroke:${transparent ? 'none' : line}}.ar-fill{fill:${lineS}}
.arch-tier{fill:${panel2};stroke:${line}}.arch-tier-name{fill:${text3};font-size:12px}
.seq-life{stroke:${lineS};stroke-dasharray:5 4}.gantt-bar{fill:${accentSoft};stroke:${accent}}
.gantt-prog{fill:${accent}}.gantt-grid{stroke:${line}}.gantt-date,.gantt-pct,.nd-role,.nd-note{fill:${text3}}
.gantt-bg{fill:${panel};stroke:${line}}.tl-axis,.tl-link{stroke:${lineS}}
.fish-spine{fill:none;stroke:${text2};stroke-width:2.4}.fish-tick{stroke:${line}}
.nd-class-line,.nd-class-line{stroke:${line}}`,
    };
  }
  function exportPng(transparent) {
    const r = svgMarkup({ transparent });
    const b = r.box, svg = r.svg;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const c = document.createElement('canvas');
      c.width = Math.round(b.w * scale); c.height = Math.round(b.h * scale);
      const g = c.getContext('2d');
      if (!r.transparent) { g.fillStyle = r.bg; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = S.doc.title + (r.transparent ? '-透明底' : '') + '.png';
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    };
    img.onerror = () => toast('导出 PNG 失败', true);
    img.src = url;
  }

  /* ============================================================ 历史版本 */
  async function openHistory() {
    if (!S.id) return toast('请先打开一个图表');
    el('historyDrawer').hidden = false;
    el('historyBody').innerHTML = '<div class="insp-empty">加载中…</div>';
    try {
      const r = await api('GET', '/api/charts/' + encodeURIComponent(S.id) + '/history');
      const items = r.history || [];
      if (!items.length) { el('historyBody').innerHTML = '<div class="insp-empty">还没有历史版本<br>每次保存会自动留一份快照</div>'; return; }
      el('historyBody').innerHTML = items.map((it) =>
        `<div class="hist-item"><div><div class="hist-time">${U.esc(fmtStamp(it.stamp))}</div>` +
        `<div class="hist-meta">${it.nodeCount || 0} 节点 · ${U.esc(it.title || '')}</div></div>` +
        `<button class="chip" data-stamp="${U.esc(it.stamp)}">恢复</button></div>`).join('');
      el('historyBody').querySelectorAll('[data-stamp]').forEach((b) => {
        b.onclick = async () => {
          const r2 = await api('POST', '/api/charts/' + encodeURIComponent(S.id) + '/restore', { stamp: b.dataset.stamp });
          S.doc = r2.chart; layoutDoc(); render(); fitView(); renderInspector();
          toast('已恢复到 ' + fmtStamp(b.dataset.stamp));
        };
      });
    } catch (e) { el('historyBody').innerHTML = '<div class="insp-empty">加载失败：' + U.esc(e.message) + '</div>'; }
  }
  function fmtStamp(s) {
    const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : s;
  }

  /* ============================================================ 新建弹窗 */
  function openNew() {
    el('newModal').hidden = false;
    el('newTitle').value = '';
    const grid = el('kindGrid');
    grid.innerHTML = K.__list().map((x) =>
      `<button class="kind-card" data-type="${x.type}"><span class="kc-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${K.__icon(x.type)}"/></svg></span>` +
      `<span class="kc-name">${U.esc(x.name)}</span><span class="kc-desc">${U.esc(x.desc)}</span></button>`).join('');
    grid.querySelectorAll('[data-type]').forEach((b) => {
      b.onclick = async () => {
        const t = b.dataset.type;
        const title = el('newTitle').value.trim() || ('未命名' + K[t].name);
        el('newModal').hidden = true;
        await newDoc(t, title);
      };
    });
    setTimeout(() => el('newTitle').focus(), 30);
  }

  async function delChart() {
    if (!S.id) return;
    if (!confirm('删除「' + (S.doc.title || S.id) + '」？可在历史版本中找回最近快照。')) return;
    await api('DELETE', '/api/charts/' + encodeURIComponent(S.id));
    S.doc = null; S.id = null; S.sel = null;
    el('emptyState').hidden = false;
    render(); renderInspector();
    await loadList();
    toast('已删除');
  }

  /* ============================================================ 画布交互 */
  function bindCanvas() {
    const stage = el('stage');
    let drag = null, panning = null, linking = null, lastTap = null;

    stage.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2) return;
      const foldG = ev.target.closest('[data-fold]');
      if (foldG) {
        ev.preventDefault();
        toggleFold(foldG.getAttribute('data-fold'));
        return;
      }
      const port = ev.target.closest('.port');
      const nodeG = ev.target.closest('.node');
      const linkG = ev.target.closest('.link');
      hideMenu();
      if (port && nodeG) {
        linking = { from: nodeG.dataset.id, port: port.dataset.port };
        ev.preventDefault();
        return;
      }
      if (nodeG) {
        const n = nodeById(nodeG.dataset.id);
        if (!n) return;
        // 手动判定双击：selectNode→render 会重建 DOM，浏览器原生 dblclick 会因此失效
        const now = performance.now();
        if (lastTap && lastTap.id === n.id && now - lastTap.t < 420) {
          lastTap = null;
          ev.preventDefault();
          ev.stopPropagation();      // 别让 document 的 pointerdown 把刚打开的编辑框又提交掉
          editNode(n.id);
          return;
        }
        lastTap = { id: n.id, t: now };
        selectNode(n.id);
        setDrop(null);
        const p = toDoc(ev.clientX, ev.clientY);
        drag = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, ax: n.x, ay: n.y, moved: false, kids: null, ids: new Set([n.id]), deny: null };
        if (kindDef().tree) {
          const sub = subtreeIds(n.id);
          drag.deny = new Set(sub);                 // 不能拖进自己或自己的后代，否则成环
          drag.show = visibleSet();
          drag.kids = sub.filter((id) => !drag.show || drag.show.has(id));   // 收起的部分不跟着动，展开时会重排
          drag.kids.forEach((id) => { const k = nodeById(id); if (k) { k._x0 = k.x; k._y0 = k.y; drag.ids.add(id); } });
        }
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (linkG && linkG.dataset.link) { selectLink(linkG.dataset.link); return; }
      // 空白：平移
      panning = { x: ev.clientX, y: ev.clientY, px: S.pan.x, py: S.pan.y };
      clearSel();
      stage.setPointerCapture(ev.pointerId);
    });

    let dragRaf = 0, dragEv = null;

    // 拖动一帧只算一次：pointermove 在高刷屏上会比 rAF 密，逐条处理会排队积压
    function applyDrag(ev) {
      const p = toDoc(ev.clientX, ev.clientY);
      const n = nodeById(drag.id); if (!n) return;
      const nx = snapDoc(p.x - drag.dx), ny = snapDoc(p.y - drag.dy);
      if (!drag.moved && Math.abs(nx - drag.ax) + Math.abs(ny - drag.ay) < 2) return;
      if (!drag.moved) { snapshot(); drag.moved = true; }
      if (drag.kids) {
        // 位移必须相对「拖动起点」算：kids 的 _x0 是起点坐标，
        // 若拿上一帧位置当基准，节点会在起点附近来回振荡（一直抖）。
        const ddx = nx - drag.ax, ddy = ny - drag.ay;
        drag.kids.forEach((id) => {
          const k = nodeById(id); if (!k) return;
          k.x = (k._x0 != null ? k._x0 : k.x) + ddx;
          k.y = (k._y0 != null ? k._y0 : k.y) + ddy;
          k.pinned = true;
        });
      } else {
        n.x = nx; n.y = ny; n.pinned = true;
      }
      moveOnly(drag.ids);
      // 拖到别的节点上 → 高亮它，松手就挂到它下面（见 pointerup / reparent）
      if (drag.deny) setDrop(hitNode(p, drag.deny, n, drag.show));
    }

    stage.addEventListener('pointermove', (ev) => {
      if (linking) {
        const a = nodeById(linking.from); if (!a) return;
        const p = toDoc(ev.clientX, ev.clientY);
        el('layerTmp').innerHTML = `<line class="lk" style="stroke:var(--accent);stroke-width:2" x1="${a.x + a.w / 2}" y1="${a.y + a.h / 2}" x2="${p.x}" y2="${p.y}"/>`;
        return;
      }
      if (drag) {
        dragEv = ev;
        if (!dragRaf) {
          dragRaf = requestAnimationFrame(() => {
            dragRaf = 0;
            if (drag && dragEv) applyDrag(dragEv);
          });
        }
        return;
      }
      if (panning) {
        S.pan.x = panning.px + (ev.clientX - panning.x);
        S.pan.y = panning.py + (ev.clientY - panning.y);
        applyViewport();
      }
    });

    stage.addEventListener('pointerup', (ev) => {
      if (linking) {
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const g = target && target.closest ? target.closest('.node') : null;
        el('layerTmp').innerHTML = '';
        if (g && g.dataset.id && g.dataset.id !== linking.from) {
          snapshot();
          S.doc.links = S.doc.links || [];
          S.doc.links.push({ id: U.uid('l'), from: linking.from, to: g.dataset.id, label: '', kind: 'rel' });
          layoutDoc(); render(); markDirty();
        }
        linking = null;
        return;
      }
      if (drag) {
        // 补上还没渲染的最后一帧，否则松手位置会比鼠标差一帧
        if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; if (dragEv) applyDrag(dragEv); }
        const moved = drag.moved;
        const fromId = drag.id;
        const toId = moved ? dropId : null;
        drag = null; dragEv = null; setDrop(null);
        // 落在别的节点上：改父子关系（而不是记一个手动坐标）
        if (toId && reparent(fromId, toId, moved)) return;
        if (moved) {
          // 顺序真的被拖乱了：把新顺序固化，并让节点归位（否则一点「自动布局」就回到旧顺序）
          const reordered = sortSiblings();
          if (reordered) {
            subtreeIds(fromId).forEach((id) => { const k = nodeById(id); if (k) delete k.pinned; });
            layoutDoc(); render(); markDirty();
            toast('已按新顺序排好');
            return;
          }
          layoutDoc(); render(); markDirty();
        }
        return;
      }
      panning = null;
    });

    stage.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (!el('editBox').hidden) commitEdit();
      const r = stage.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const k = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      const z = Math.min(2.6, Math.max(0.15, S.zoom * k));
      S.pan.x = mx - (mx - S.pan.x) * (z / S.zoom);
      S.pan.y = my - (my - S.pan.y) * (z / S.zoom);
      S.zoom = z;
      applyViewport();
    }, { passive: false });

    stage.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const nodeG = ev.target.closest('.node');
      const items = [];
      if (nodeG) {
        S.sel = nodeG.dataset.id; render();
        const cn = nodeById(S.sel);
        items.push({ title: '节点' },
          { label: '编辑文字', act: () => editNode(S.sel) },
          { label: kindDef().tree ? '加下级节点' : '加后续节点', act: () => addNode(false) },
          { label: '加同级节点', act: () => addNode(true) });
        if (canFold() && cn && S.doc.nodes.some((n) => n.parent === cn.id)) {
          items.push({ label: cn.collapsed ? '展开下级' : '收起下级', act: () => toggleFold(cn.id) });
        }
        items.push({ sep: true }, { label: '删除节点', icon: 'trash', danger: true, act: delSel });
      } else {
        items.push({ label: '添加节点', act: () => addNode(false) },
          { label: '自动布局', act: doRelayout },
          { label: '适应画布', act: fitView });
      }
      showMenu({ getBoundingClientRect: () => ({ left: ev.clientX, top: ev.clientY, bottom: ev.clientY, right: ev.clientX }) }, items);
    });

    stage.addEventListener('dblclick', (ev) => {
      const g = ev.target.closest('.node');
      if (g) { ev.preventDefault(); editNode(g.dataset.id); }
    });

    document.addEventListener('pointerdown', (ev) => {
      if (menuOpen && !ev.target.closest('#menu')) hideMenu();
      if (!el('editBox').hidden && !ev.target.closest('#editBox')) commitEdit();
    });
  }

  /**
   * 把同级节点的先后顺序按画布位置固化进 nodes 数组。
   * 布局（以及「自动布局」）是按数组顺序排兄弟的，不同步的话手动拖出来的上下顺序
   * 一点自动布局就白拖了。左右排列的树按上下（y）比，上下排列的树按左右（x）比。
   */
  function sortSiblings() {
    const kd = kindDef();
    if (!kd || !kd.tree || !S.doc) return false;
    const lay = curLayout();
    const axis = (lay === 'down' || lay === 'up') ? 'x' : 'y';
    const pos = (n) => (axis === 'x' ? n.x + n.w / 2 : n.y + n.h / 2);
    const kids = kidIndex();
    const ids = new Set(S.doc.nodes.map((n) => n.id));
    // 只比较「每个父节点下子节点的先后」；数组被整理成先序不算顺序变化
    const sig = () => {
      const m = new Map();
      S.doc.nodes.forEach((n) => {
        const k = n.parent == null ? '\u0000' : n.parent;
        const a = m.get(k);
        if (a) a.push(n.id); else m.set(k, [n.id]);
      });
      return Array.from(m.keys()).sort().map((k) => k + ':' + m.get(k).join('>')).join('|');
    };
    const before = sig();
    const out = [];
    const seen = new Set();
    const walk = (n) => {
      if (!n || seen.has(n.id)) return;
      seen.add(n.id);
      out.push(n);
      const ks = (kids.get(n.id) || []).slice();
      if (!n.collapsed) {
        // 位置差太小（左右两侧的兄弟本来就上下居中，可能只差零点几像素）就当作没动，
        // 靠 Array.sort 的稳定性保持原顺序，否则会在两侧之间来回翻。
        ks.sort((a, b) => {
          const d = pos(a) - pos(b);
          return Math.abs(d) < 10 ? 0 : d;
        });
      }
      ks.forEach(walk);
    };
    S.doc.nodes.forEach((n) => { if (n.parent == null || !ids.has(n.parent)) walk(n); });
    S.doc.nodes.forEach((n) => { if (!seen.has(n.id)) out.push(n); });   // 环等异常数据兜底
    S.doc.nodes = out;
    return sig() !== before;
  }

  function subtreeIds(id) {
    const out = [id];
    let more = true;
    while (more) {
      more = false;
      S.doc.nodes.forEach((n) => { if (n.parent && out.includes(n.parent) && !out.includes(n.id)) { out.push(n.id); more = true; } });
    }
    return out;
  }

  /**
   * 拖动时的落点命中：鼠标压在某个节点上，或被拖节点大半盖住某个节点，都算「要挂到它下面」。
   * 只认看得见的节点，且排除自己与自己的后代。
   */
  function hitNode(p, deny, dragged, show) {
    let hit = null;
    for (const n of S.doc.nodes) {
      if (deny.has(n.id) || (show && !show.has(n.id))) continue;
      const inside = p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h;
      const dx = Math.abs((dragged.x + dragged.w / 2) - (n.x + n.w / 2));
      const dy = Math.abs((dragged.y + dragged.h / 2) - (n.y + n.h / 2));
      const cover = dx < (dragged.w + n.w) / 2 - 10 && dy < (dragged.h + n.h) / 2 - 10;
      if (inside || cover) hit = n.id;     // 后渲染的在更上层，后者覆盖前者
    }
    return hit;
  }

  /** 把节点（连同整棵子树）挂到另一个节点下面；already = 调用方已经压过撤销栈 */
  function reparent(id, pid, already) {
    const n = nodeById(id), p = nodeById(pid);
    if (!n || !p || id === pid || n.parent === pid) return false;
    if (subtreeIds(id).includes(pid)) return false;       // 不能挂到自己的后代下
    if (!already) snapshot();                             // 拖动流程在拖动开始时已经存过快照，别压两层
    n.parent = pid;
    if (p.collapsed) p.collapsed = false;                 // 挂进去得看得见
    subtreeIds(id).forEach((k) => { const x = nodeById(k); if (x) delete x.pinned; });
    S.sel = id;
    layoutDoc(); render(); renderInspector(); markDirty();
    toast('已挂到「' + String(p.text || '').slice(0, 10) + '」下面');
    return true;
  }

  /* ------------------------------------------------------------ 键盘 */
  function bindKeys() {
    document.addEventListener('keydown', (ev) => {
      const tag = (ev.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || !el('editBox').hidden;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveDoc(false); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
      if (ev.key === 'Escape') { hideMenu(); el('newModal').hidden = true; el('textModal').hidden = true; el('historyDrawer').hidden = true; return; }
      if (typing || !S.doc) return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); delSel(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); addNode(false); }
      else if (ev.key === 'Tab') { ev.preventDefault(); addNode(true); }
      else if (ev.key === 'F2' && S.sel) { ev.preventDefault(); editNode(S.sel); }
      else if ((ev.key === '-' || ev.key === '_') && canFold() && S.sel) { ev.preventDefault(); toggleFold(S.sel, true); }
      else if ((ev.key === '+' || ev.key === '=') && canFold() && S.sel) { ev.preventDefault(); toggleFold(S.sel, false); }
      else if (ev.key.startsWith('Arrow') && kindDef().tree && S.sel) { ev.preventDefault(); navigate(ev.key); }
    });
  }
  function navigate(key) {
    const kd = kindDef();
    const cur = nodeById(S.sel); if (!cur) return;
    const sibs = S.doc.nodes.filter((n) => n.parent === cur.parent);
    const i = sibs.indexOf(cur);
    if (key === 'ArrowUp' && i > 0) S.sel = sibs[i - 1].id;
    else if (key === 'ArrowDown' && i < sibs.length - 1) S.sel = sibs[i + 1].id;
    else if (key === 'ArrowLeft' && cur.parent) S.sel = cur.parent;
    else if (key === 'ArrowRight') {
      const kids = S.doc.nodes.filter((n) => n.parent === cur.id);
      if (!kids.length) return;
      if (cur.collapsed) toggleFold(cur.id, false);   // 收起状态按右键先展开，才看得到下级
      S.sel = kids[0].id;
    }
    render(); renderInspector();
  }

  /* ------------------------------------------------------------ 侧栏等 */
  function bindUi() {
    el('chartList').addEventListener('click', (ev) => {
      const rst = ev.target.closest('[data-reset]');
      if (rst) {
        ev.stopPropagation();
        const id = rst.dataset.reset;
        if (!confirm('把示例「' + id + '」重置回初始内容？\n当前修改会先存入历史版本，可在历史里找回。')) return;
        api('POST', '/api/charts/' + encodeURIComponent(id) + '/reset').then(() => {
          toast('已重置');
          if (S.id === id) openDoc(id).catch(() => {}); else loadList();
        }).catch((e) => toast('重置失败：' + e.message, true));
        return;
      }
      const del = ev.target.closest('[data-del]');
      if (del) {
        ev.stopPropagation();
        const id = del.dataset.del;
        if (!confirm('删除「' + id + '」？')) return;
        api('DELETE', '/api/charts/' + encodeURIComponent(id)).then(loadList).then(() => {
          if (S.id === id) { S.doc = null; S.id = null; el('emptyState').hidden = false; render(); renderInspector(); }
        });
        return;
      }
      const it = ev.target.closest('.chart-item');
      if (it && it.dataset.id && it.dataset.id !== S.id) openDoc(it.dataset.id).catch((e) => toast('打开失败：' + e.message, true));
    });
    el('searchInput').addEventListener('input', renderList);
    // 图片：文件选择 / 粘贴 / 拖放
    el('imgFile').addEventListener('change', (ev) => {
      const files = Array.from(ev.target.files || []).filter((f) => /^image\//.test(f.type || ''));
      if (files.length) addImages(files, { into: !!S.sel });
      ev.target.value = '';
    });
    // 粘贴图片：支持一次多张，统一放进一个节点；正在就地编辑文字时不动
    document.addEventListener('paste', (ev) => {
      if (!el('editBox').hidden) return;
      const dt = ev.clipboardData;
      if (!dt) return;
      const files = Array.from(dt.items || [])
        .filter((x) => x.kind === 'file' && /^image\//.test(x.type || ''))
        .map((x) => x.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      ev.preventDefault();
      addImages(files);
    });
    const stageEl = el('stage');
    stageEl.addEventListener('dragover', (ev) => {
      const types = (ev.dataTransfer && ev.dataTransfer.types) || [];
      if (!Array.from(types).includes('Files')) return;
      ev.preventDefault();
      stageEl.classList.add('drop-hover');
    });
    stageEl.addEventListener('dragleave', () => stageEl.classList.remove('drop-hover'));
    stageEl.addEventListener('drop', (ev) => {
      ev.preventDefault();
      stageEl.classList.remove('drop-hover');
      const files = Array.from((ev.dataTransfer && ev.dataTransfer.files) || [])
        .filter((f) => /^image\//.test(f.type || ''));
      if (!files.length) return;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const g = hit && hit.closest ? hit.closest('.node') : null;
      addImages(files, { hostId: g && g.getAttribute('data-id'), point: toDoc(ev.clientX, ev.clientY) });
    });
    el('btnNewSmall').onclick = openNew;
    el('btnEmptyNew').onclick = openNew;
    el('btnImportMd').onclick = importMd;
    el('titleInput').addEventListener('change', () => { if (S.doc) { S.doc.title = el('titleInput').value; markDirty(); } });
    el('btnZoomIn').onclick = () => { S.zoom = Math.min(2.6, S.zoom * 1.2); applyViewport(); };
    el('btnZoomOut').onclick = () => { S.zoom = Math.max(0.15, S.zoom / 1.2); applyViewport(); };
    el('btnFit').onclick = fitView;
    el('btnInspClose').onclick = () => el('inspector').classList.toggle('collapsed');
    el('btnSideToggle').onclick = () => el('side').classList.toggle('collapsed');
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = () => {
        const m = b.closest('.modal'); if (m) m.hidden = true;
        const d = b.closest('.drawer'); if (d) d.hidden = true;
      };
    });
    window.addEventListener('resize', () => { applyResponsive(); fitToolbar(); });
  }

  /* ------------------------------------------------------------ 启动 */
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    applyTheme();
    applyResponsive();
    buildToolbar();
    bindCanvas(); bindKeys(); bindUi();
    await loadList();
    const q = new URLSearchParams(location.search).get('id');
    const last = localStorage.getItem('wb.lastChart');
    const fallback = (S.charts.find((c) => c.type === 'mindmap') || S.charts[0] || {}).id;
    const target = q || (S.charts.find((c) => c.id === last) ? last : fallback);
    if (target) {
      try { await openDoc(target); } catch (e) { el('emptyState').hidden = false; }
    } else {
      el('emptyState').hidden = false;
      renderInspector();
    }
    fitToolbar();
  }

  window.addEventListener('beforeunload', () => { if (S.dirty && S.doc) saveDoc(true); });
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
