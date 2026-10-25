/* ============================================================================
 * studio/kinds.js —— 统一图表类型库
 *
 * 所有图表共用一份文档模型：
 *   doc = { id, type, title, theme, createdAt, updatedAt,
 *           nodes:[ {id,text,x,y,w,h,...} ], links:[ {id,from,to,label,...} ],
 *           meta:{} }
 *
 * 每种图表实现下面这些钩子（缺哪个就走默认行为）：
 *   template(title)      初始示例数据
 *   layout(doc)          计算节点 x/y/w/h（尊重 node.pinned 手动坐标）
 *   size(node)           计算单个节点尺寸，结果写入 node.w/node.h/node._m
 *   edges(doc)           返回要画的连线（树类图由 parent 虚拟生成）
 *   drawBack(doc)        背景装饰（生命线 / 时间轴 / 鱼骨主脊 / 甘特刻度）
 *   drawNode(node)       节点 SVG 片段（相对自身 0,0 ~ w,h）
 *   drawLink(link,a,b)   连线 SVG 片段
 *   nodeFields(node)     属性面板字段
 *   linkFields(link)
 *   createNode(doc,sel)  新建节点的默认值 {text, kind, ...}
 *   outline(doc) / fromOutline(items,title)   大纲互转（用于任意类型间转换）
 *   mermaid(doc)         导出 Mermaid（可选）
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* --------------------------------------------------------------- 基础工具 */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let _seq = 0;
  function uid(p) { return (p || 'n') + (Date.now().toString(36).slice(-4)) + (_seq++).toString(36) + Math.random().toString(36).slice(2, 5); }

  let _cc = null;
  function c2d() {
    if (_cc !== null) return _cc;
    try { _cc = document.createElement('canvas').getContext('2d'); } catch (e) { _cc = false; }
    return _cc;
  }
  const CJK = /[\u3000-\u9fff\uff00-\uffef]/;
  function textW(s, fs, bold) {
    s = String(s || '');
    const c = c2d();
    if (c) {
      c.font = (bold ? '600 ' : '') + fs + 'px "Microsoft YaHei","PingFang SC",system-ui,sans-serif';
      return c.measureText(s).width;
    }
    let w = 0;
    for (const ch of s) w += CJK.test(ch) ? fs : fs * 0.55;
    return w;
  }
  function wrap(s, maxW, fs, bold) {
    const out = [];
    String(s || '').split(/\r?\n/).forEach((para) => {
      if (!para) { out.push(''); return; }
      let line = '';
      for (const ch of para) {
        if (line && textW(line + ch, fs, bold) > maxW) { out.push(line); line = ch; }
        else line += ch;
      }
      out.push(line);
    });
    return out.length ? out : [''];
  }
  /** 通用盒子：计算尺寸 + 折行，结果写入 node */
  function boxOf(node, o) {
    o = o || {};
    const fs = o.fs || 14, bold = !!o.bold;
    const maxW = o.maxW || 190, padX = o.padX || 14, padY = o.padY || 10;
    const lineH = o.lineH || Math.round(fs * 1.5);
    const lay = o.img === false ? null : imgLayout(node);
    const lines = wrap(o.text != null ? o.text : node.text, maxW, fs, bold);
    const textW0 = Math.max(o.minW || 64, ...lines.map((l) => textW(l, fs, bold)));
    // 纯图片节点（没写字）：图片就是节点主体，不再留文字区
    if (lay && noText(node)) {
      const pad = 5;
      const m = { lines: [], fs, bold, padX: pad, padY: pad, lineH, maxW, imgH: 0, big: true, pad, lay };
      node._m = m;
      node.w = Math.round(lay.w + pad * 2);
      node.h = Math.round(lay.h + pad * 2);
      return m;
    }
    let w = textW0 + padX * 2;
    let imgH = 0;
    if (lay) { w = Math.max(w, lay.w + 16); imgH = lay.h + 12; }   // 图片在上，文字在下
    const h = lines.length * lineH + padY * 2 + (o.extra || 0) + imgH;
    const m = { lines, fs, bold, padX, padY, lineH, maxW, imgH, lay };
    node._m = m; node.w = Math.round(w); node.h = Math.round(h);
    return m;
  }
  /** 通用文本 SVG */
  function textSvg(node, o) {
    o = o || {};
    const m = node._m || boxOf(node, o);
    const lines = m.lines.length ? m.lines : [''];
    const cx = o.center ? node.w / 2 : (o.x != null ? o.x : m.padX);
    const anchor = o.center ? 'middle' : (o.anchor || 'start');
    const imgH = m.imgH || 0;
    // 有图片时文字在图片下方的剩余区域垂直居中
    const top = o.top != null ? o.top : imgH + (node.h - imgH - lines.length * m.lineH) / 2;
    return lines.map((l, i) =>
      `<text class="nd-text${o.cls ? ' ' + o.cls : ''}" x="${cx}" y="${(top + i * m.lineH + m.lineH * 0.76).toFixed(1)}"` +
      ` text-anchor="${anchor}" style="font-size:${m.fs}px${m.bold ? ';font-weight:600' : ''}">${esc(l)}</text>`
    ).join('');
  }

  /* ------------------------------------------------------------ 节点图片 */
  const IMG_MAX_W = 168;        // 有文字时：顶部缩略图的最大边长
  const IMG_MAX_BIG = 260;      // 没文字时：图片铺满节点，可以更大
  const IMG_GAP = 6;            // 多图网格的间距
  /** 节点没有写字（纯图片节点） */
  const noText = (node) => !String(node && node.text != null ? node.text : '').trim();

  /** 节点的图片列表（兼容旧的单图字段 image / imgW / imgH） */
  function nodeImages(node) {
    if (!node) return [];
    if (Array.isArray(node.images) && node.images.length) {
      return node.images.filter((x) => x && (x.data || x.url))
        .map((x) => ({ data: x.data || x.url, w: Math.max(1, x.w || 168), h: Math.max(1, x.h || 104) }));
    }
    if (node.image) return [{ data: node.image, w: Math.max(1, node.imgW || 168), h: Math.max(1, node.imgH || 104) }];
    return [];
  }

  /** 单张的显示尺寸：等比缩放；big 允许放大到上限，最多 3 倍 */
  function fitImg(it, cap, allowUp) {
    let s = cap / Math.max(it.w, it.h);
    if (s > 1) s = allowUp ? Math.min(s, 3) : 1;
    return { w: Math.max(24, Math.round(it.w * s)), h: Math.max(24, Math.round(it.h * s)) };
  }

  /**
   * 图片排版（相对节点内容区左上角）：
   * 1 张 → 单图；多张 → 2 列网格（>4 张用 3 列），批量拖入/粘贴的图都装进同一个节点。
   */
  function imgLayout(node) {
    const list = nodeImages(node);
    if (!list.length) return null;
    const big = noText(node);
    if (list.length === 1) {
      const s = fitImg(list[0], big ? IMG_MAX_BIG : IMG_MAX_W, big);
      return { w: s.w, h: s.h, items: [{ x: 0, y: 0, w: s.w, h: s.h }] };
    }
    const cols = list.length <= 4 ? 2 : 3;
    const cellW = big ? (cols === 2 ? 128 : 86) : (cols === 2 ? 84 : 60);
    const cellH = Math.round(cellW * 1.15);                // 竖图限高，别把节点拉太长
    const sized = list.map((it) => {
      let s = cellW / it.w;
      if (it.h * s > cellH) s = cellH / it.h;
      return { w: Math.max(20, Math.round(it.w * s)), h: Math.max(20, Math.round(it.h * s)) };
    });
    const rows = Math.ceil(list.length / cols);
    const rowH = [];
    sized.forEach((s, i) => { const r = Math.floor(i / cols); rowH[r] = Math.max(rowH[r] || 0, s.h); });
    const items = sized.map((s, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      let y0 = 0;
      for (let k = 0; k < r; k++) y0 += rowH[k] + IMG_GAP;
      return {
        x: c * (cellW + IMG_GAP) + Math.round((cellW - s.w) / 2),
        y: y0 + Math.round((rowH[r] - s.h) / 2),
        w: s.w, h: s.h,
      };
    });
    return {
      w: cols * cellW + (cols - 1) * IMG_GAP,
      h: rowH.reduce((a, b) => a + b, 0) + (rows - 1) * IMG_GAP,
      items,
    };
  }

  /** 图片 SVG：单图铺满 / 多图网格，位置由 boxOf 记在 node._m.lay 里 */
  function imageSvg(node) {
    const m = node._m;
    const lay = (m && m.lay) || imgLayout(node);
    if (!lay) return '';
    const list = nodeImages(node);
    if (!list.length) return '';
    const big = m ? !!m.big : noText(node);
    const pad = (m && m.pad) || 5;
    const ox = big ? pad : Math.round((node.w - lay.w) / 2);
    const oy = big ? pad : 6;
    const r = big ? 10 : 8;
    return lay.items.map((it, i) => {
      const src = list[i];
      if (!src) return '';
      return `<image href="${esc(src.data)}" x="${ox + it.x}" y="${oy + it.y}" width="${it.w}" height="${it.h}"` +
        ` preserveAspectRatio="xMidYMid meet" style="clip-path:inset(0 round ${r}px)"/>`;
    }).join('');
  }
  const cx = (n) => n.x + n.w / 2;
  const cy = (n) => n.y + n.h / 2;

  /** 矩形边框上朝向 (px,py) 的那个点（连线贴边用，比连中心好看），附带该边的外法线 */
  function rectEdge(n, px, py) {
    const acx = n.x + n.w / 2, acy = n.y + n.h / 2;
    const dx = px - acx, dy = py - acy;
    if (!dx && !dy) return { x: acx, y: acy, nx: 0, ny: 0 };
    const sx = dx ? (n.w / 2) / Math.abs(dx) : Infinity;
    const sy = dy ? (n.h / 2) / Math.abs(dy) : Infinity;
    if (sx <= sy) return { x: acx + dx * sx, y: acy + dy * sy, nx: dx > 0 ? 1 : -1, ny: 0 };
    return { x: acx + dx * sy, y: acy + dy * sy, nx: 0, ny: dy > 0 ? 1 : -1 };
  }

  /** 正交折线（默认连线）：上下有空隙就走「底部出 → 顶部进」，否则走左右 */
  function orth(a, b) {
    const ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b);
    const gapY = Math.abs(by - ay) - (a.h + b.h) / 2;
    const gapX = Math.abs(bx - ax) - (a.w + b.w) / 2;
    if (gapY > 4 || gapY > gapX) {
      if (by < ay - (a.h + b.h) / 2) {
        // 向上 = 回边：从右侧绕行，别从中间节点身上穿过去
        const sx = a.x + a.w, ex = b.x + b.w;
        const ox = Math.max(sx, ex) + 30;
        return `M${sx},${ay} H${ox} V${by} H${ex}`;
      }
      const y1 = by > ay ? a.y + a.h : a.y;
      const y2 = by > ay ? b.y : b.y + b.h;
      const my = (y1 + y2) / 2;
      return `M${ax},${y1} V${my} H${bx} V${y2}`;
    }
    const x1 = bx > ax ? a.x + a.w : a.x;
    const x2 = bx > ax ? b.x : b.x + b.w;
    const mx = (x1 + x2) / 2;
    return `M${x1},${ay} H${mx} V${by} H${x2}`;
  }
  function linkLabel(link, x, y, cls) {
    if (!link.label) return '';
    const t = String(link.label);
    const w = textW(t, 12) + 10;
    return `<rect class="lk-label-bg" x="${x - w / 2}" y="${y - 9}" width="${w}" height="18" rx="9"/>` +
      `<text class="lk-label" x="${x}" y="${y + 4}" text-anchor="middle">${esc(t)}</text>`;
  }

  /** 分层：先用 DFS 找出回边（环），再用剩余边做最长路径分层。
   *  否则「提示重新输入 → 验证身份」这种回边会把节点一路推到画布最底下。 */
  function layerize(nodes, links) {
    const ids = new Set(nodes.map((n) => n.id));
    const adj = new Map(nodes.map((n) => [n.id, []]));
    links.forEach((l) => { if (ids.has(l.from) && ids.has(l.to)) adj.get(l.from).push(l); });
    const color = new Map(), back = new Set();
    nodes.forEach((root) => {
      if (color.get(root.id)) return;
      const st = [{ id: root.id, i: 0 }];
      color.set(root.id, 1);
      while (st.length) {
        const top = st[st.length - 1];
        const list = adj.get(top.id) || [];
        if (top.i < list.length) {
          const l = list[top.i++];
          const c = color.get(l.to) || 0;
          if (c === 1) back.add(l.id);
          else if (c === 0) { color.set(l.to, 1); st.push({ id: l.to, i: 0 }); }
        } else { color.set(top.id, 2); st.pop(); }
      }
    });
    const layer = new Map(nodes.map((n) => [n.id, 0]));
    const es = links.filter((l) => !back.has(l.id) && ids.has(l.from) && ids.has(l.to));
    for (let k = 0; k < nodes.length + 1; k++) {
      let ch = false;
      es.forEach((l) => {
        const a = layer.get(l.from) || 0;
        if (a + 1 > (layer.get(l.to) || 0)) { layer.set(l.to, a + 1); ch = true; }
      });
      if (!ch) break;
    }
    return { layer, back };
  }

  const KINDS = {};
  function def(type, obj) { obj.type = type; KINDS[type] = obj; return obj; }

  /* =============================================================== 思维导图 */
  const MM_HG = 62;     // 左右布局：父子水平间距
  const MM_VG = 14;     // 同侧兄弟垂直间距
  const MM_WG = 20;     // 上下布局：兄弟水平间距
  const MM_VG2 = 76;    // 上下布局：父子上下行距

  def('mindmap', {
    name: '思维导图', group: '结构', icon: 'mind', desc: '中心主题放射发散，适合梳理想法',
    tree: true, img: true, collapsible: true,
    layouts: [
      { key: 'balanced', label: '双向发散' },
      { key: 'right', label: '向右展开' },
      { key: 'down', label: '向下树' },
      { key: 'up', label: '向上树' },
      { key: 'radial', label: '环形放射' },
    ],
    template() {
      const n = (text, parent) => ({ id: uid('n'), text, parent: parent || null, note: '', color: null, done: false, collapsed: false });
      const root = n('中心主题');
      const a = n('分支一', root.id), b = n('分支二', root.id), c = n('分支三', root.id);
      return {
        nodes: [root, a, b, c,
          n('要点', a.id), n('要点', a.id), n('要点', b.id), n('要点', c.id)],
        links: [], meta: { layout: 'balanced' },
      };
    },
    size(node) {
      const root = !node.parent;
      return boxOf(node, { fs: root ? 17 : 14, bold: root, maxW: root ? 240 : 190, minW: root ? 110 : 76, padX: root ? 18 : 13, padY: root ? 13 : 9 });
    },
    /** 布局共用上下文：节点索引、可见子节点、子树宽高 */
    _ctx(doc) {
      const nodes = doc.nodes;
      const by = new Map(nodes.map((n) => [n.id, n]));
      nodes.forEach((n) => this.size(n));
      const kids = (id) => nodes.filter((n) => n.parent === id);
      const vis = (id) => { const p = by.get(id); return p && p.collapsed ? [] : kids(id); };
      const mH = new Map(), mW = new Map();
      const subH = (id) => {
        if (mH.has(id)) return mH.get(id);
        const n = by.get(id);
        if (!n) return 0;
        let v = n.h + MM_VG;
        mH.set(id, v);
        const ks = vis(id);
        if (ks.length) v = Math.max(v, ks.reduce((s, k) => s + subH(k.id) + MM_VG, 0) - MM_VG);
        mH.set(id, v); return v;
      };
      const subW = (id) => {
        if (mW.has(id)) return mW.get(id);
        const n = by.get(id);
        if (!n) return 0;
        let v = n.w + MM_WG;
        mW.set(id, v);
        const ks = vis(id);
        if (ks.length) v = Math.max(v, ks.reduce((s, k) => s + subW(k.id) + MM_WG, 0) - MM_WG);
        mW.set(id, v); return v;
      };
      const root = nodes.find((n) => !n.parent) || nodes[0] || null;
      if (root) root.parent = null;
      // 折叠后真正能看见的节点（从根往下，遇到 collapsed 就不再深入）
      const reach = new Set();
      if (root) {
        (function mark(id) { reach.add(id); vis(id).forEach((k) => mark(k.id)); })(root.id);
      }
      return { doc, nodes, by, vis, subH, subW, root, reach };
    },
    /** 双向发散：一级分支前半在右、后半在左，各自垂直居中于根节点 */
    _layBalanced(c) {
      const { by, vis, subH, root } = c;
      if (!root) return;
      const place = (id, side, x, yTop) => {
        const n = by.get(id); if (!n) return;
        n.side = side; n.x = side === 'r' ? x : x - n.w;
        const sh = subH(id);
        n.y = yTop + (sh - n.h) / 2;
        let y0 = yTop;
        vis(id).forEach((k) => {
          const kh = subH(k.id);
          place(k.id, side, side === 'r' ? n.x + n.w + MM_HG : n.x - MM_HG, y0);
          y0 += kh + MM_VG;
        });
      };
      root.side = 'r'; root.x = 0; root.y = 0;
      const ks = vis(root.id);
      const groups = { r: [], l: [] };
      ks.forEach((k, i) => groups[i < Math.ceil(ks.length / 2) ? 'r' : 'l'].push(k));
      ['r', 'l'].forEach((sd) => {
        const g = groups[sd];
        if (!g.length) return;
        const total = g.reduce((s, k) => s + subH(k.id) + MM_VG, 0) - MM_VG;
        let y0 = root.h / 2 - total / 2;
        g.forEach((k) => {
          const kh = subH(k.id);
          place(k.id, sd, sd === 'r' ? root.w + MM_HG : -MM_HG, y0);
          y0 += kh + MM_VG;
        });
      });
    },
    /** 向右展开：只往右长，经典树形目录 */
    _layRight(c) {
      const { by, vis, subH, root } = c;
      if (!root) return;
      const place = (id, x, yTop) => {
        const n = by.get(id); if (!n) return;
        n.side = 'r'; n.x = x;
        n.y = yTop + (subH(id) - n.h) / 2;
        let y0 = yTop;
        vis(id).forEach((k) => {
          place(k.id, n.x + n.w + MM_HG, y0);
          y0 += subH(k.id) + MM_VG;
        });
      };
      place(root.id, 0, 0);
    },
    /** 向下 / 向上树：同级横向铺开，s=1 向下、s=-1 向上 */
    _layV(c, s) {
      const { by, vis, subW, root } = c;
      if (!root) return;
      const place = (id, midX, yEdge) => {
        const n = by.get(id); if (!n) return;
        n.side = s > 0 ? 'd' : 'u';
        n.x = midX - n.w / 2;
        n.y = s > 0 ? yEdge : yEdge - n.h;
        const ks = vis(id);
        if (!ks.length) return;
        const total = ks.reduce((a, k) => a + subW(k.id) + MM_WG, 0) - MM_WG;
        const cyEdge = s > 0 ? n.y + n.h + MM_VG2 : n.y - MM_VG2;
        let x0 = midX - total / 2;
        ks.forEach((k) => {
          const kw = subW(k.id);
          place(k.id, x0 + kw / 2, cyEdge);
          x0 += kw + MM_WG;
        });
      };
      place(root.id, 0, 0);
    },
    /** 环形放射：叶子等角分布在圆周，父节点取子节点角度中点 */
    _layRadial(c) {
      const { nodes, vis, root, reach } = c;
      if (!root) return;
      const leaves = [];
      (function walk(id) {
        const ks = vis(id);
        if (!ks.length) { leaves.push(id); return; }
        ks.forEach((k) => walk(k.id));
      })(root.id);
      const span = new Map();
      (function calc(id) {
        const ks = vis(id);
        if (!ks.length) {
          const i = leaves.indexOf(id);
          const r = [i < 0 ? 0 : i, i < 0 ? 0 : i];
          span.set(id, r); return r;
        }
        let a = Infinity, b = -Infinity;
        ks.forEach((k) => { const r = calc(k.id); a = Math.min(a, r[0]); b = Math.max(b, r[1]); });
        span.set(id, [a, b]); return [a, b];
      })(root.id);
      const depth = new Map([[root.id, 0]]);
      (function dep(id, d) {
        vis(id).forEach((k) => { depth.set(k.id, d + 1); dep(k.id, d + 1); });
      })(root.id, 0);

      const N = Math.max(1, leaves.length);
      const spread = Math.PI * 2 - 0.2;               // 首尾留一点缝，别贴着
      const step = spread / N;
      const start = -Math.PI / 2 - spread / 2 + step / 2;
      // 每层半径按「这一层有多少节点、节点多宽」自适应：
      // 相邻两个节点在半径 r 上的弦长 2r·sin(π/k) 必须容得下它们的宽度，否则会挤在一起
      const levelStat = new Map();
      nodes.forEach((n) => {
        if (!reach.has(n.id)) return;                 // 收起的分支不占圆周
        const d = Math.max(1, depth.get(n.id) || 1);
        const s = levelStat.get(d) || { k: 0, w: 0 };
        s.k++; s.w = Math.max(s.w, Math.min(n.w, 200));
        levelStat.set(d, s);
      });
      const radii = [0];
      const maxD = Math.max(1, ...levelStat.keys());
      for (let d = 1; d <= maxD; d++) {
        const s = levelStat.get(d) || { k: 0, w: 0 };
        const prevW = d === 1 ? (root.w || 140) : ((levelStat.get(d - 1) || {}).w || 140);
        // 环间距离：同一角度上父子两个矩形要能并排放下（横向分支最吃宽度）
        const gap = Math.max(168, (s.w + prevW) / 2 + 34);
        const chord = s.k > 1 ? (s.w + 36) / (2 * Math.sin(spread / (2 * s.k))) : 0;
        radii[d] = Math.max(d === 1 ? 215 : radii[d - 1] + gap, Math.round(chord));
      }
      root.side = 'radial';
      root.x = -root.w / 2; root.y = -root.h / 2;      // 根节点中心落在原点
      let orphan = 0;
      nodes.forEach((n) => {
        if (n === root || !reach.has(n.id)) return;
        const sp = span.get(n.id);
        const a = sp ? start + ((sp[0] + sp[1]) / 2 + 0.5) * step : start + (++orphan) * step;
        const d = Math.min(maxD, Math.max(1, depth.get(n.id) || 1));
        const r = radii[d];
        n.side = 'radial';
        n.x = Math.round(r * Math.cos(a) - n.w / 2);
        n.y = Math.round(r * Math.sin(a) - n.h / 2);
      });
    },
    layout(doc) {
      const c = this._ctx(doc);
      const L = (doc.meta && doc.meta.layout) || 'balanced';
      if (L === 'right') this._layRight(c);
      else if (L === 'down') this._layV(c, 1);
      else if (L === 'up') this._layV(c, -1);
      else if (L === 'radial') this._layRadial(c);
      else this._layBalanced(c);
    },
    edges(doc) {
      return doc.nodes.filter((n) => n.parent).map((n) => ({
        id: 'e' + n.id, from: n.parent, to: n.id, kind: n.side || 'r', virtual: true,
      }));
    },
    drawLink(link, a, b) {
      const kind = link.kind || 'r';
      if (kind === 'radial') {
        const p = rectEdge(a, cx(b), cy(b));
        const q = rectEdge(b, cx(a), cy(a));
        // 从边框垂直出线，再弯向目标，看起来像从节点里"长"出来
        const k = 0.42;
        const c1 = { x: p.x + p.nx * 22 + (q.x - p.x) * k, y: p.y + p.ny * 22 + (q.y - p.y) * k };
        const c2 = { x: q.x + q.nx * 22 + (p.x - q.x) * k, y: q.y + q.ny * 22 + (p.y - q.y) * k };
        return `<path class="lk ln-branch" d="M${p.x.toFixed(1)},${p.y.toFixed(1)} C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}"/>`;
      }
      if (kind === 'd' || kind === 'u') {
        const s = kind === 'd' ? 1 : -1;
        const x1 = cx(a), y1 = s > 0 ? a.y + a.h : a.y;
        const x2 = cx(b), y2 = s > 0 ? b.y : b.y + b.h;
        const dy = Math.max(16, Math.abs(y2 - y1) * 0.5);
        return `<path class="lk ln-branch" d="M${x1},${y1} C${x1},${y1 + s * dy} ${x2},${y2 - s * dy} ${x2},${y2}"/>`;
      }
      const right = kind !== 'l';
      const x1 = right ? a.x + a.w : a.x, y1 = cy(a);
      const x2 = right ? b.x : b.x + b.w, y2 = cy(b);
      const dx = Math.abs(x2 - x1) * 0.55;
      return `<path class="lk ln-branch" d="M${x1},${y1} C${x1 + (right ? dx : -dx)},${y1} ${x2 - (right ? dx : -dx)},${y2} ${x2},${y2}"/>`;
    },
    drawNode(node) {
      const root = !node.parent;
      const cls = root ? 'nd-root' : 'nd-branch';
      const fill = node.color ? ` fill="${esc(node.color)}"` : '';
      return `<rect class="nd ${cls}" x="0" y="0" width="${node.w}" height="${node.h}" rx="${root ? 14 : 10}"${fill}/>` +
        imageSvg(node) +
        textSvg(node, { center: true, cls: root ? 'on-accent' : '' });
    },
    nodeFields() {
      return [
        { key: 'text', label: '文字', type: 'text' },
        { key: 'note', label: '备注', type: 'textarea' },
        { key: 'color', label: '颜色', type: 'color' },
        { key: 'done', label: '已完成', type: 'check' },
      ];
    },
    createNode() { return { text: '新节点' }; },
    outline(doc) {
      const by = new Map(doc.nodes.map((n) => [n.id, n]));
      const root = doc.nodes.find((n) => !n.parent) || doc.nodes[0];
      const out = [];
      (function walk(id, lv) {
        const n = by.get(id); if (!n) return;
        out.push({ level: lv, text: n.text, note: n.note });
        doc.nodes.filter((x) => x.parent === id).forEach((k) => walk(k.id, lv + 1));
      })(root ? root.id : '', 0);
      return out;
    },
    fromOutline(items) {
      const nodes = []; const stack = [];
      items.forEach((it) => {
        const lv = Math.max(0, Math.min(it.level, 8));
        const parent = lv === 0 ? null : (stack[lv - 1] || stack[0] || null);
        const n = { id: uid('n'), text: it.text, parent: parent ? parent.id : null, note: it.note || '', color: null, done: false, collapsed: false };
        if (!parent && nodes.length) n.parent = nodes[0].id;
        nodes.push(n); stack[lv] = n;
      });
      return { nodes, links: [], meta: {} };
    },
    mermaid(doc) {
      const by = new Map(doc.nodes.map((n) => [n.id, n]));
      const root = doc.nodes.find((n) => !n.parent) || doc.nodes[0];
      const lines = ['mindmap', '  root((' + (root ? root.text : '主题') + '))'];
      const pad = (lv) => '  ' + '  '.repeat(lv);
      (function walk(id, lv) {
        doc.nodes.filter((x) => x.parent === id).forEach((k) => {
          lines.push(pad(lv) + esc(k.text).replace(/[()]/g, ''));
          walk(k.id, lv + 1);
        });
      })(root ? root.id : '', 1);
      return lines.join('\n');
    },
  });

  /* ================================================================= 流程图 */
  const SHAPES = [
    ['process', '处理步骤'], ['decision', '判断'], ['terminal', '起止'], ['io', '输入输出'],
  ];
  def('flow', {
    name: '流程图', group: '流程', icon: 'flow', desc: '步骤与判断，支持是/否分支',
    img: true,
    template() {
      const n = (text, shape) => ({ id: uid('n'), text, shape, note: '', x: null, y: null });
      const a = n('开始', 'terminal'), b = n('验证身份', 'process'), c = n('信息正确?', 'decision');
      const d = n('进入系统', 'process'), e = n('提示重新输入', 'io'), f = n('结束', 'terminal');
      const l = (x, y, label) => ({ id: uid('l'), from: x.id, to: y.id, label: label || '', kind: 'flow' });
      return {
        nodes: [a, b, c, d, e, f],
        links: [l(a, b), l(b, c), l(c, d, '是'), l(c, e, '否'), l(e, b), l(d, f)],
        meta: {},
      };
    },
    size(node) {
      const s = node.shape || 'process';
      // 判断菱形不挂图片（内部空间本来就窄）
      if (s === 'decision') return boxOf(node, { fs: 13, maxW: 130, minW: 110, padX: 26, padY: 20, extra: 6, img: false });
      return boxOf(node, { fs: 13.5, maxW: 170, minW: 96, padX: 15, padY: 11 });
    },
    layout(doc) {
      const nodes = doc.nodes, links = doc.links || [], by = new Map(nodes.map((n) => [n.id, n]));
      nodes.forEach((n) => this.size(n));
      const { layer } = layerize(nodes, links);
      const groups = new Map();
      nodes.forEach((n) => {
        const lv = layer.get(n.id) || 0;
        if (!groups.has(lv)) groups.set(lv, []);
        groups.get(lv).push(n);
      });
      const order = new Map();
      [...groups.keys()].sort((a, b) => a - b).forEach((lv) => {
        const g = groups.get(lv);
        if (lv > 0) {
          const prev = groups.get(lv - 1) || [];
          const pos = new Map(prev.map((n, i) => [n.id, i]));
          g.forEach((n) => {
            const ins = links.filter((l) => l.to === n.id && pos.has(l.from));
            n._bc = ins.length ? ins.reduce((s, l) => s + pos.get(l.from), 0) / ins.length : 999;
          });
          g.sort((a, b) => (a._bc - b._bc) || (a.text || '').localeCompare(b.text || ''));
        }
        g.forEach((n, i) => order.set(n.id, i));
      });
      const HG = 46, VG = 62;
      let y = 0;
      [...groups.keys()].sort((a, b) => a - b).forEach((lv) => {
        const g = groups.get(lv);
        const maxH = Math.max(...g.map((n) => n.h));
        let total = g.reduce((s, n) => s + n.w + HG, 0) - HG;
        let x = -total / 2;
        g.forEach((n) => { n.x = Math.round(x); n.y = Math.round(y + (maxH - n.h) / 2); x += n.w + HG; });
        y += maxH + VG;
      });
    },
    drawNode(node) {
      const w = node.w, h = node.h, s = node.shape || 'process';
      let shape;
      if (s === 'decision') shape = `<polygon class="nd nd-dec" points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}"/>`;
      else if (s === 'terminal') shape = `<rect class="nd nd-term" x="0" y="0" width="${w}" height="${h}" rx="${h / 2}"/>`;
      else if (s === 'io') shape = `<polygon class="nd nd-io" points="${w * 0.12},0 ${w},0 ${w * 0.88},${h} 0,${h}"/>`;
      else shape = `<rect class="nd nd-proc" x="0" y="0" width="${w}" height="${h}" rx="9"/>`;
      return shape + (s === 'decision' ? '' : imageSvg(node)) + textSvg(node, { center: true });
    },
    drawLink(link, a, b) {
      const d = orth(a, b);
      const mx = (cx(a) + cx(b)) / 2, my = (cy(a) + cy(b)) / 2;
      const lx = Math.abs(cx(b) - cx(a)) > Math.abs(cy(b) - cy(a)) ? mx : Math.min(cx(a), cx(b)) + 24;
      const ly = Math.abs(cy(b) - cy(a)) >= Math.abs(cx(b) - cx(a)) ? my : Math.min(cy(a), cy(b)) + 14;
      return `<path class="lk ln-flow" d="${d}" marker-end="url(#ar)"/>` + linkLabel(link, lx, ly);
    },
    nodeFields() {
      return [
        { key: 'text', label: '文字', type: 'text' },
        { key: 'shape', label: '形状', type: 'select', options: SHAPES },
        { key: 'note', label: '备注', type: 'textarea' },
      ];
    },
    linkFields() { return [{ key: 'label', label: '条件/说明', type: 'text' }]; },
    createNode() { return { text: '新步骤', shape: 'process' }; },
    outline(doc) {
      const by = new Map(doc.nodes.map((n) => [n.id, n]));
      const roots = doc.nodes.filter((n) => !(doc.links || []).some((l) => l.to === n.id));
      const start = roots[0] || doc.nodes[0];
      const out = []; const seen = new Set();
      (function walk(id, lv) {
        if (!id || seen.has(id) || lv > 12) return;
        const n = by.get(id); if (!n) return;
        seen.add(id);
        out.push({ level: lv, text: n.text, note: (n.shape && n.shape !== 'process' ? '[' + n.shape + '] ' : '') + (n.note || '') });
        doc.links.filter((l) => l.from === id).forEach((l) => walk(l.to, lv + 1));
      })(start ? start.id : null, 0);
      return out;
    },
    fromOutline(items) {
      // 按层级栈重建父子关系：大纲里的 level 就是「谁属于谁」，
      // 只连 parent→child。同层兄弟之间不再互连（那样会横穿一大片），
      // 顶层（level 0）之间才按顺序串起来，保证线性流程不散。
      const nodes = [], links = [];
      const stack = [];
      let lastRoot = null;
      items.forEach((it) => {
        const lv = Math.max(0, Math.min(it.level, 8));
        const n = { id: uid('n'), text: it.text, shape: guessShape(it.text), note: '', x: null, y: null };
        nodes.push(n);
        if (stack.length > lv) stack.length = lv;
        const parent = lv > 0 ? stack[lv - 1] : lastRoot;
        if (parent) links.push({ id: uid('l'), from: parent.id, to: n.id, label: '', kind: 'flow' });
        if (lv === 0) lastRoot = n;
        stack[lv] = n;
      });
      return { nodes, links, meta: {} };
    },
    mermaid(doc) {
      const lines = ['flowchart TD'];
      const sy = (n) => {
        const t = esc(n.text).replace(/["\[\]]/g, '');
        if (n.shape === 'decision') return n.id + '{' + t + '}';
        if (n.shape === 'terminal') return n.id + '([' + t + '])';
        if (n.shape === 'io') return n.id + '[/' + t + '/]';
        return n.id + '[' + t + ']';
      };
      doc.nodes.forEach((n) => lines.push('  ' + sy(n)));
      doc.links.forEach((l) => {
        const arrow = l.label ? '-->|"' + esc(l.label) + '"|' : '-->';
        lines.push(`  ${l.from}${arrow}${l.to}`);
      });
      return lines.join('\n');
    },
  });
  function guessShape(t) {
    t = String(t || '');
    if (/开始|启动|结束|完成|终止|停止|start|end/i.test(t)) return 'terminal';
    if (/\?|？|是否|如果|判断|选择/.test(t)) return 'decision';
    if (/^(输入|输出|读取|写入|显示|打印|上传|下载)/.test(t)) return 'io';
    return 'process';
  }

  /* =============================================================== 架构/模块图 */
  const ARCH_KINDS = [['client', '终端/用户'], ['service', '服务'], ['module', '模块'], ['data', '数据存储'], ['ext', '外部系统']];
  def('arch', {
    name: '架构图', group: '流程', icon: 'arch', desc: '分层模块与外部系统，一眼看清依赖',
    img: true,
    template() {
      const n = (text, tier, kind) => ({ id: uid('n'), text, tier, kind, note: '', x: null, y: null });
      const c = n('Web / App 客户端', 0, 'client');
      const g = n('API 网关', 1, 'service'), a = n('鉴权服务', 2, 'service'), b = n('业务服务', 2, 'module');
      const d = n('数据库', 3, 'data'), e = n('对象存储', 3, 'data');
      const l = (x, y, label) => ({ id: uid('l'), from: x.id, to: y.id, label: label || '', kind: 'arch' });
      return {
        nodes: [c, g, a, b, d, e],
        links: [l(c, g, 'HTTPS'), l(g, a), l(g, b), l(b, d), l(b, e)],
        meta: { tiers: ['接入层', '网关层', '服务层', '数据层'] },
      };
    },
    size(node) { return boxOf(node, { fs: 13.5, maxW: 160, minW: 128, padX: 15, padY: 12, extra: 8 }); },
    layout(doc) {
      const nodes = doc.nodes;
      nodes.forEach((n) => this.size(n));
      const tiers = (doc.meta && doc.meta.tiers) || [];
      const groups = new Map();
      nodes.forEach((n) => {
        const t = n.tier || 0;
        if (!groups.has(t)) groups.set(t, []);
        groups.get(t).push(n);
      });
      const HG = 34, VG = 86;
      let y = 0;
      [...groups.keys()].sort((a, b) => a - b).forEach((t) => {
        const g = groups.get(t);
        const maxH = Math.max(...g.map((n) => n.h));
        let total = g.reduce((s, n) => s + n.w + HG, 0) - HG;
        let x = -total / 2;
        g.forEach((n) => { n.x = Math.round(x); n.y = Math.round(y + 12); x += n.w + HG; });
        y += maxH + VG;
      });
      doc._tierBoxes = [...groups.keys()].sort((a, b) => a - b).map((t) => {
        const g = groups.get(t);
        const x0 = Math.min(...g.map((n) => n.x)) - 26, x1 = Math.max(...g.map((n) => n.x + n.w)) + 26;
        const y0 = Math.min(...g.map((n) => n.y)) - 26, y1 = Math.max(...g.map((n) => n.y + n.h)) + 14;
        return { tier: t, name: tiers[t] || ('第 ' + (t + 1) + ' 层'), x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      });
    },
    drawBack(doc) {
      return (doc._tierBoxes || []).map((b) =>
        `<rect class="arch-tier" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="16"/>` +
        `<text class="arch-tier-name" x="${b.x + 12}" y="${b.y + 20}">${esc(b.name)}</text>`
      ).join('');
    },
    drawNode(node) {
      const k = node.kind || 'module';
      return `<rect class="nd nd-arch k-${k}" x="0" y="0" width="${node.w}" height="${node.h}" rx="10"/>` +
        `<rect class="arch-bar k-${k}" x="0" y="0" width="5" height="${node.h}" rx="2.5"/>` +
        imageSvg(node) +
        textSvg(node, { center: true, x: node.w / 2 + 2 });
    },
    drawLink(link, a, b) {
      return `<path class="lk ln-arch" d="${orth(a, b)}" marker-end="url(#ar)"/>` +
        linkLabel(link, (cx(a) + cx(b)) / 2, (cy(a) + cy(b)) / 2 - 8);
    },
    nodeFields() {
      return [
        { key: 'text', label: '名称', type: 'text' },
        { key: 'kind', label: '类型', type: 'select', options: ARCH_KINDS },
        { key: 'tier', label: '所在层', type: 'number' },
        { key: 'note', label: '备注', type: 'textarea' },
      ];
    },
    linkFields() { return [{ key: 'label', label: '说明', type: 'text' }]; },
    createNode(doc, sel) {
      return { text: '新模块', kind: 'module', tier: sel && sel.tier != null ? sel.tier : 0 };
    },
    outline(doc) {
      const out = [];
      const tiers = new Set(doc.nodes.map((n) => n.tier || 0));
      [...tiers].sort((a, b) => a - b).forEach((t) => {
        out.push({ level: 0, text: (doc.meta && doc.meta.tiers && doc.meta.tiers[t]) || ('第 ' + (t + 1) + ' 层') });
        doc.nodes.filter((n) => (n.tier || 0) === t).forEach((n) => out.push({ level: 1, text: n.text, note: n.note }));
      });
      return out;
    },
    fromOutline(items) {
      const nodes = [], links = [];
      // 扁平大纲（如时间线/甘特）没有层级：每个条目算一个模块，三层一组
      if (!items.some((i) => i.level > 0)) {
        items.forEach((it, i) => nodes.push({
          id: uid('n'), text: it.text, tier: Math.floor(i / 3), kind: 'module', note: it.note || '', x: null, y: null,
        }));
        return { nodes, links, meta: { tiers: ['模块'] } };
      }
      let tier = -1, prevTop = null, prev = null;
      items.forEach((it) => {
        if (it.level === 0) { tier++; prevTop = null; return; }
        const n = { id: uid('n'), text: it.text, tier: Math.max(0, tier), kind: 'module', note: it.note || '', x: null, y: null };
        nodes.push(n);
        if (prevTop) links.push({ id: uid('l'), from: prevTop.id, to: n.id, label: '', kind: 'arch' });
        else prevTop = n;
        prev = n;
      });
      return { nodes, links, meta: {} };
    },
    mermaid(doc) {
      const lines = ['flowchart TB'];
      doc.nodes.forEach((n) => lines.push(`  ${n.id}["${esc(n.text)}"]`));
      doc.links.forEach((l) => lines.push(`  ${l.from}-->|"${esc(l.label || '')}"|${l.to}`));
      return lines.join('\n');
    },
  });

  /* ================================================================= 时序图 */
  def('sequence', {
    name: '时序图', group: '流程', icon: 'seq', desc: '对象之间的消息往来顺序',
    template() {
      const n = (text) => ({ id: uid('n'), text, kind: 'actor', note: '' });
      const u = n('用户'), s = n('前端'), a = n('服务端'), d = n('数据库');
      const m = (f, t, label, kind) => ({ id: uid('l'), from: f.id, to: t.id, label, kind: kind || 'sync' });
      return {
        nodes: [u, s, a, d],
        links: [
          m(u, s, '点击登录', 'sync'), m(s, a, 'POST /login', 'sync'),
          m(a, d, '查询用户', 'sync'), m(d, a, '返回记录', 'reply'),
          m(a, s, '返回 token', 'reply'), m(s, u, '登录成功', 'reply'),
        ],
        meta: {},
      };
    },
    size(node) { return boxOf(node, { fs: 13.5, maxW: 130, minW: 96, padX: 12, padY: 10 }); },
    layout(doc) {
      const CW = 172, TOP = 30, STEP = 46;
      doc.nodes.forEach((n, i) => {
        this.size(n);
        n.w = Math.max(n.w, 108); n.h = 42;
        n.x = i * CW; n.y = TOP;
      });
      const bottom = TOP + 90 + doc.links.length * STEP + 30;
      doc.nodes.forEach((n) => { n._life = bottom; });
      doc.links.forEach((l, i) => { l._y = TOP + 96 + i * STEP; });
      doc._seqBox = { x: -60, y: 0, w: doc.nodes.length * CW + 40, h: bottom + 30 };
    },
    drawBack(doc) {
      let s = '';
      doc.nodes.forEach((n) => {
        const x = cx(n);
        s += `<line class="seq-life" x1="${x}" y1="${n.y + n.h + 4}" x2="${x}" y2="${n._life}"/>`;
        s += `<rect class="seq-act" x="${x - 18}" y="${n.y + n.h + 4}" width="36" height="8" rx="4"/>`;
      });
      return s;
    },
    drawNode(node) { return `<rect class="nd nd-actor" x="0" y="0" width="${node.w}" height="${node.h}" rx="8"/>` + textSvg(node, { center: true }); },
    drawLink(link, a, b) {
      const y = link._y || cy(a);
      if (!b || link.from === link.to || !b) {
        const x = cx(a) + 34;
        return `<path class="lk ln-seq self" d="M${x - 30},${y} h30 v18 h-30" marker-end="url(#ar)"/>` +
          `<text class="lk-label" x="${x + 6}" y="${y + 14}">${esc(link.label)}</text>`;
      }
      const x1 = cx(a), x2 = cx(b);
      const dash = link.kind === 'reply' ? ' ln-dash' : '';
      return `<path class="lk ln-seq${dash}" d="M${x1},${y} L${x2},${y}" marker-end="url(#ar)"/>` +
        linkLabel(link, (x1 + x2) / 2, y - 10);
    },
    nodeFields() { return [{ key: 'text', label: '参与者', type: 'text' }, { key: 'note', label: '备注', type: 'textarea' }]; },
    linkFields() {
      return [
        { key: 'label', label: '消息', type: 'text' },
        { key: 'kind', label: '类型', type: 'select', options: [['sync', '请求'], ['reply', '返回'], ['async', '异步']] },
      ];
    },
    createNode() { return { text: '新参与者', kind: 'actor' }; },
    addLinkLabel: '新消息',
    outline(doc) {
      const by = new Map(doc.nodes.map((n) => [n.id, n]));
      const out = [{ level: 0, text: '参与者' }];
      doc.nodes.forEach((n) => out.push({ level: 1, text: n.text }));
      out.push({ level: 0, text: '消息' });
      doc.links.forEach((l) => {
        const a = by.get(l.from), b = by.get(l.to);
        out.push({ level: 1, text: `${a ? a.text : '?'} → ${b ? b.text : '?'}：${l.label}` });
      });
      return out;
    },
    fromOutline(items) {
      const actors = [], msgs = [];
      // 扁平大纲：直接当成参与者列表
      if (!items.some((i) => /参与者|消息/.test(i.text) && i.level === 0)) {
        const flat = items.filter((i) => i.level <= 1);
        if (flat.length) {
          flat.forEach((it) => actors.push({ id: uid('n'), text: it.text.replace(/^\d{4}-\d{2}(-\d{2})?\s*/, ''), kind: 'actor' }));
          for (let i = 1; i < actors.length; i++) {
            msgs.push({ id: uid('l'), from: actors[0].id, to: actors[i].id, label: '', kind: 'sync' });
          }
          return { nodes: actors, links: msgs, meta: {} };
        }
      }
      let mode = null;
      items.forEach((it) => {
        if (it.level === 0) { mode = /消息|步骤/.test(it.text) ? 'm' : 'a'; return; }
        if (mode === 'm') {
          const mm = String(it.text).match(/^(.+?)\s*(?:→|->|>|：)\s*(.+?)[：:]\s*(.*)$/);
          if (mm) {
            const f = actors.find((a) => a.text === mm[1].trim()) || { id: uid('n'), text: mm[1].trim(), kind: 'actor' };
            const t = actors.find((a) => a.text === mm[2].trim()) || { id: uid('n'), text: mm[2].trim(), kind: 'actor' };
            if (!actors.includes(f)) actors.push(f);
            if (!actors.includes(t)) actors.push(t);
            msgs.push({ id: uid('l'), from: f.id, to: t.id, label: mm[3] || '', kind: /返回|响应|结果/.test(mm[3] || '') ? 'reply' : 'sync' });
          }
        } else actors.push({ id: uid('n'), text: it.text, kind: 'actor' });
      });
      return { nodes: actors, links: msgs, meta: {} };
    },
    mermaid(doc) {
      const lines = ['sequenceDiagram'];
      doc.nodes.forEach((n) => lines.push('  participant ' + n.id + ' as ' + esc(n.text)));
      doc.links.forEach((l) => {
        const arrow = l.kind === 'reply' ? '-->>' : '->>';
        lines.push(`  ${l.from}${arrow}${l.to}: ${esc(l.label)}`);
      });
      return lines.join('\n');
    },
  });

  /* ================================================================= 状态图 */
  def('state', {
    name: '状态图', group: '流程', icon: 'state', desc: '状态与迁移条件',
    template() {
      const n = (text, kind) => ({ id: uid('n'), text, kind: kind || 'state', note: '' });
      const s = n('开始', 'start'), a = n('待支付'), b = n('已支付'), c = n('已完成'), e = n('结束', 'end');
      const l = (x, y, label) => ({ id: uid('l'), from: x.id, to: y.id, label, kind: 'trans' });
      return { nodes: [s, a, b, c, e], links: [l(s, a), l(a, b, '支付成功'), l(b, c, '发货'), l(a, e, '超时取消')], meta: {} };
    },
    size(node) {
      if (node.kind === 'start' || node.kind === 'end') { node.w = 32; node.h = 32; node._m = { lines: [''], fs: 12, padX: 0, padY: 0, lineH: 16 }; return node._m; }
      return boxOf(node, { fs: 13.5, maxW: 150, minW: 92, padX: 15, padY: 11 });
    },
    layout(doc) {
      const nodes = doc.nodes;
      nodes.forEach((n) => this.size(n));
      const { layer } = layerize(nodes, doc.links || []);
      const groups = new Map();
      nodes.forEach((n) => {
        const lv = layer.get(n.id) || 0;
        if (!groups.has(lv)) groups.set(lv, []);
        groups.get(lv).push(n);
      });
      const HG = 48, VG = 58;
      let y = 0;
      [...groups.keys()].sort((a, b) => a - b).forEach((lv) => {
        const g = groups.get(lv);
        const maxH = Math.max(...g.map((n) => n.h));
        let total = g.reduce((s, n) => s + n.w + HG, 0) - HG;
        let x = -total / 2;
        g.forEach((n) => { n.x = Math.round(x); n.y = Math.round(y + (maxH - n.h) / 2); x += n.w + HG; });
        y += maxH + VG;
      });
    },
    drawNode(node) {
      if (node.kind === 'start') return `<circle class="nd nd-start" cx="16" cy="16" r="15"/>`;
      if (node.kind === 'end') return `<circle class="nd nd-end" cx="16" cy="16" r="15"/><circle class="nd nd-end2" cx="16" cy="16" r="10"/>`;
      return `<rect class="nd nd-state" x="0" y="0" width="${node.w}" height="${node.h}" rx="16"/>` + textSvg(node, { center: true });
    },
    drawLink(link, a, b) {
      const d = orth(a, b);
      return `<path class="lk ln-state" d="${d}" marker-end="url(#ar)"/>` +
        linkLabel(link, (cx(a) + cx(b)) / 2, (cy(a) + cy(b)) / 2 - 10);
    },
    nodeFields() {
      return [
        { key: 'text', label: '状态', type: 'text' },
        { key: 'kind', label: '类型', type: 'select', options: [['state', '状态'], ['start', '开始'], ['end', '结束']] },
        { key: 'note', label: '备注', type: 'textarea' },
      ];
    },
    linkFields() { return [{ key: 'label', label: '迁移条件', type: 'text' }]; },
    createNode() { return { text: '新状态', kind: 'state' }; },
    outline(doc) { return KINDS.flow.outline(doc); },
    fromOutline(items) {
      const r = KINDS.flow.fromOutline(items);
      r.nodes.forEach((n) => { delete n.shape; n.kind = 'state'; });
      if (r.nodes.length) r.nodes[0].kind = 'start';
      if (r.nodes.length > 1) r.nodes[r.nodes.length - 1].kind = 'end';
      r.links.forEach((l) => { l.kind = 'trans'; });
      return r;
    },
    mermaid(doc) {
      const lines = ['stateDiagram-v2'];
      doc.nodes.forEach((n) => {
        if (n.kind === 'start') lines.push('  [*] --> ' + n.id);
        else if (n.kind === 'end') lines.push('  ' + n.id + ' --> [*]');
        else lines.push('  ' + n.id + ' : ' + esc(n.text));
      });
      doc.links.forEach((l) => lines.push(`  ${l.from} --> ${l.to}${l.label ? ' : ' + esc(l.label) : ''}`));
      return lines.join('\n');
    },
  });

  /* =================================================================== 类图 */
  const REL = [['assoc', '关联'], ['inherit', '继承'], ['impl', '实现'], ['compose', '组合'], ['aggreg', '聚合']];
  def('class', {
    name: '类图', group: '建模', icon: 'class', desc: '类、属性方法与关系',
    template() {
      const n = (text, members, kind) => ({ id: uid('n'), text, kind: kind || 'class', members: members || [], note: '' });
      const u = n('User', [{ text: 'id: Long', kind: 'attr' }, { text: 'name: String', kind: 'attr' }, { text: 'login()', kind: 'method' }]);
      const o = n('Order', [{ text: 'id: Long', kind: 'attr' }, { text: 'amount: Decimal', kind: 'attr' }, { text: 'pay()', kind: 'method' }]);
      const p = n('Payment', [{ text: 'pay(amount)', kind: 'method' }], 'class');
      const i = n('Payable', [{ text: 'pay(amount)', kind: 'method' }], 'interface');
      const l = (x, y, label, kind) => ({ id: uid('l'), from: x.id, to: y.id, label, kind: kind || 'assoc' });
      return { nodes: [u, o, p, i], links: [l(u, o, '1..*', 'assoc'), l(o, p, '1', 'compose'), l(p, i, '', 'impl')], meta: {} };
    },
    size(node) {
      const head = 30, rowH = 19, pad = 8;
      const ms = node.members || [];
      const badge = node.kind === 'interface' ? textW('«interface»', 11) + 6 : 0;   // 前缀要算进宽度，否则标题溢出
      const w = Math.max(120, textW(node.text, 14, true) + 28 + badge, ...ms.map((m) => textW(m.text, 12) + 26));
      node.w = Math.round(w); node.h = head + Math.max(1, ms.length) * rowH + pad * 2;
      node._m = { lines: [node.text], fs: 14, bold: true, padX: 12, padY: 0, lineH: rowH, head, rowH, members: ms };
      return node._m;
    },
    layout(doc) {
      const nodes = doc.nodes, by = new Map(nodes.map((n) => [n.id, n]));
      nodes.forEach((n) => this.size(n));
      const groups = new Map();
      const { layer } = layerize(nodes, doc.links || []);
      nodes.forEach((n) => {
        const lv = layer.get(n.id) || 0;
        if (!groups.has(lv)) groups.set(lv, []);
        groups.get(lv).push(n);
      });
      const HG = 54, VG = 62;
      let y = 0;
      [...groups.keys()].sort((a, b) => a - b).forEach((lv) => {
        const g = groups.get(lv);
        let total = g.reduce((s, n) => s + n.w + HG, 0) - HG;
        let x = -total / 2;
        g.forEach((n) => { n.x = Math.round(x); n.y = Math.round(y); x += n.w + HG; });
        y += Math.max(...g.map((n) => n.h)) + VG;
      });
    },
    drawNode(node) {
      const m = node._m || this.size(node);
      const head = m.head, rowH = m.rowH;
      let s = `<rect class="nd nd-class" x="0" y="0" width="${node.w}" height="${node.h}" rx="8"/>`;
      s += `<path class="nd-class-line" d="M0,${head} H${node.w}"/>`;
      s += `<text class="nd-text nd-class-title" x="${node.w / 2}" y="${head * 0.68}" text-anchor="middle" style="font-size:14px;font-weight:600">` +
        `${node.kind === 'interface' ? '<tspan style="font-size:11px;font-weight:400">«interface» </tspan>' : ''}${esc(node.text)}</text>`;
      (m.members || []).forEach((mb, i) => {
        const y = head + 15 + i * rowH;
        s += `<text class="nd-text nd-member" x="12" y="${y}" style="font-size:12px">${esc(mb.text)}</text>`;
      });
      return s;
    },
    drawLink(link, a, b) {
      const k = link.kind || 'assoc';
      const d = orth(a, b);
      const dash = (k === 'impl') ? ' ln-dash' : '';
      const marker = k === 'inherit' || k === 'impl' ? '' : ' marker-end="url(#ar)"';
      return `<path class="lk ln-class${dash}" d="${d}"${marker}/>` +
        linkLabel(link, (cx(a) + cx(b)) / 2, (cy(a) + cy(b)) / 2 - 8);
    },
    nodeFields() {
      return [
        { key: 'text', label: '类名', type: 'text' },
        { key: 'kind', label: '类型', type: 'select', options: [['class', '类'], ['interface', '接口'], ['abstract', '抽象类']] },
        { key: 'members', label: '成员（每行一条）', type: 'members' },
      ];
    },
    linkFields() { return [{ key: 'label', label: '基数', type: 'text' }, { key: 'kind', label: '关系', type: 'select', options: REL }]; },
    createNode() { return { text: 'NewClass', kind: 'class', members: [{ text: 'field: String', kind: 'attr' }] }; },
    outline(doc) {
      const out = [];
      doc.nodes.forEach((n) => {
        out.push({ level: 0, text: n.text });
        (n.members || []).forEach((m) => out.push({ level: 1, text: m.text }));
      });
      return out;
    },
    fromOutline(items) {
      const nodes = [], links = [];
      let cur = null;
      items.forEach((it) => {
        if (it.level === 0) { cur = { id: uid('n'), text: it.text, kind: 'class', members: [], note: '' }; nodes.push(cur); }
        else if (cur) cur.members.push({ text: it.text, kind: /\(\)/.test(it.text) ? 'method' : 'attr' });
      });
      for (let i = 1; i < nodes.length; i++) links.push({ id: uid('l'), from: nodes[0].id, to: nodes[i].id, label: '', kind: 'assoc' });
      return { nodes, links, meta: {} };
    },
    mermaid(doc) {
      const lines = ['classDiagram'];
      doc.nodes.forEach((n) => {
        lines.push(`  class ${n.id}["${esc(n.text)}"]`);
        (n.members || []).forEach((m) => lines.push(`  ${n.id} : ${esc(m.text)}`));
      });
      doc.links.forEach((l) => {
        const arrow = { inherit: '<|--', impl: '<|..', compose: '*--', aggreg: 'o--', assoc: '--' }[l.kind] || '--';
        lines.push(`  ${l.from} ${arrow} ${l.to}${l.label ? ' : ' + esc(l.label) : ''}`);
      });
      return lines.join('\n');
    },
  });

  /* =================================================================== ER 图 */
  def('er', {
    name: 'ER 图', group: '建模', icon: 'er', desc: '实体、属性与关系（1:N 等基数）',
    template() {
      const e = (text, attrs) => ({ id: uid('n'), text, kind: 'entity', attrs: (attrs || []).map((a) => ({ text: a.replace(/^\*/, ''), pk: a.startsWith('*') })), note: '' });
      const r = (text) => ({ id: uid('n'), text, kind: 'relation', attrs: [], note: '' });
      const u = e('用户', ['*id', 'name', 'phone']);
      const o = e('订单', ['*id', 'amount', 'created_at']);
      const rel = r('下单');
      const l = (x, y, label) => ({ id: uid('l'), from: x.id, to: y.id, label, kind: 'er' });
      return { nodes: [u, rel, o], links: [l(u, rel, '1'), l(rel, o, 'N')], meta: {} };
    },
    size(node) {
      if (node.kind === 'relation') {
        const w = Math.max(90, textW(node.text, 13, true) + 34);
        node.w = Math.round(w); node.h = 74;
        node._m = { lines: [node.text], fs: 13, bold: true, padX: 10, padY: 6, lineH: 18 };
        return node._m;
      }
      const head = 28, rowH = 19;
      const as = node.attrs || [];
      const w = Math.max(118, textW(node.text, 14, true) + 26, ...as.map((a) => textW((a.pk ? '🔑 ' : '') + a.text, 12) + 26));
      node.w = Math.round(w); node.h = head + Math.max(1, as.length) * rowH + 12;
      node._m = { lines: [node.text], fs: 14, bold: true, padX: 11, padY: 0, lineH: rowH, head, rowH, attrs: as };
      return node._m;
    },
    layout(doc) {
      const nodes = doc.nodes;
      nodes.forEach((n) => this.size(n));
      const { layer } = layerize(nodes, doc.links || []);
      const groups = new Map();
      nodes.forEach((n) => {
        const lv = layer.get(n.id) || 0;
        if (!groups.has(lv)) groups.set(lv, []);
        groups.get(lv).push(n);
      });
      const HG = 52, VG = 66;
      let y = 0;
      [...groups.keys()].sort((a, b) => a - b).forEach((lv) => {
        const g = groups.get(lv);
        let total = g.reduce((s, n) => s + n.w + HG, 0) - HG;
        let x = -total / 2;
        g.forEach((n) => { n.x = Math.round(x); n.y = Math.round(y); x += n.w + HG; });
        y += Math.max(...g.map((n) => n.h)) + VG;
      });
    },
    drawNode(node) {
      if (node.kind === 'relation') {
        const w = node.w, h = node.h;
        return `<polygon class="nd nd-rel" points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}"/>` +
          `<text class="nd-text" x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" style="font-size:13px;font-weight:600">${esc(node.text)}</text>`;
      }
      const m = node._m || this.size(node);
      let s = `<rect class="nd nd-entity" x="0" y="0" width="${node.w}" height="${node.h}" rx="8"/>`;
      s += `<path class="nd-class-line" d="M0,${m.head} H${node.w}"/>`;
      s += `<text class="nd-text nd-class-title" x="${node.w / 2}" y="${m.head * 0.68}" text-anchor="middle" style="font-size:14px;font-weight:600">${esc(node.text)}</text>`;
      (m.attrs || []).forEach((a, i) => {
        const y = m.head + 15 + i * m.rowH;
        s += `<text class="nd-text nd-member" x="12" y="${y}" style="font-size:12px">${a.pk ? '#\u2003' : ''}${esc(a.text)}</text>`;
      });
      return s;
    },
    drawLink(link, a, b) {
      return `<path class="lk ln-er" d="${orth(a, b)}" marker-end="url(#ar)"/>` +
        linkLabel(link, (cx(a) + cx(b)) / 2, (cy(a) + cy(b)) / 2 - 8);
    },
    nodeFields() {
      return [
        { key: 'text', label: '名称', type: 'text' },
        { key: 'kind', label: '类型', type: 'select', options: [['entity', '实体'], ['relation', '关系']] },
        { key: 'attrs', label: '属性（* 开头为主键）', type: 'attrs' },
      ];
    },
    linkFields() { return [{ key: 'label', label: '基数', type: 'text' }]; },
    createNode() { return { text: '新实体', kind: 'entity', attrs: [{ text: 'id', pk: true }] }; },
    outline(doc) {
      const out = [];
      doc.nodes.forEach((n) => {
        out.push({ level: 0, text: n.text });
        (n.attrs || []).forEach((a) => out.push({ level: 1, text: (a.pk ? '*' : '') + a.text }));
      });
      return out;
    },
    fromOutline(items) {
      const nodes = []; let cur = null;
      items.forEach((it) => {
        if (it.level === 0) { cur = { id: uid('n'), text: it.text, kind: /关系|关联/.test(it.text) ? 'relation' : 'entity', attrs: [], note: '' }; nodes.push(cur); }
        else if (cur) cur.attrs.push({ text: it.text.replace(/^\*/, ''), pk: it.text.startsWith('*') });
      });
      const links = [];
      const rels = nodes.filter((n) => n.kind === 'relation');
      const ents = nodes.filter((n) => n.kind === 'entity');
      rels.forEach((r) => ents.slice(0, 2).forEach((e) => links.push({ id: uid('l'), from: e.id, to: r.id, label: 'N', kind: 'er' })));
      if (!rels.length) for (let i = 1; i < ents.length; i++) links.push({ id: uid('l'), from: ents[0].id, to: ents[i].id, label: '1:N', kind: 'er' });
      return { nodes, links, meta: {} };
    },
    mermaid(doc) {
      const lines = ['erDiagram'];
      doc.links.forEach((l) => {
        const a = doc.nodes.find((n) => n.id === l.from), b = doc.nodes.find((n) => n.id === l.to);
        if (a && b) lines.push(`  ${esc(a.text)} ||--o{ ${esc(b.text)} : "${esc(l.label || '')}"`);
      });
      return lines.join('\n');
    },
  });

  /* ================================================================= 鱼骨图 */
  def('fishbone', {
    name: '鱼骨图', group: '分析', icon: 'fish', desc: '要因分析：问题 → 大类 → 具体原因',
    tree: true,
    template() {
      const n = (text, kind, parent) => ({ id: uid('n'), text, kind, parent: parent || null, note: '' });
      const head = n('交付延期', 'head');
      const b1 = n('人员', 'branch', head.id), b2 = n('流程', 'branch', head.id);
      const b3 = n('工具', 'branch', head.id), b4 = n('环境', 'branch', head.id);
      const c = (t, p) => n(t, 'cause', p.id);
      return {
        nodes: [head, b1, b2, b3, b4,
          c('人手不足', b1), c('技能不齐', b1),
          c('评审缺失', b2), c('需求变更频繁', b2),
          c('构建慢', b3), c('缺少自动化', b3),
          c('会议过多', b4)],
        links: [], meta: {},
      };
    },
    size(node) {
      if (node.kind === 'head') return boxOf(node, { fs: 15, bold: true, maxW: 190, minW: 120, padX: 16, padY: 12 });
      if (node.kind === 'branch') return boxOf(node, { fs: 13, bold: true, maxW: 110, minW: 62, padX: 11, padY: 7 });
      return boxOf(node, { fs: 12.5, maxW: 150, minW: 56, padX: 9, padY: 6 });
    },
    layout(doc) {
      const nodes = doc.nodes;
      nodes.forEach((n) => this.size(n));
      const head = nodes.find((n) => n.kind === 'head') || nodes[0];
      if (!head) return;
      const branches = nodes.filter((n) => n.parent === head.id);
      const SPINE = 660;                       // 主脊右端（鱼头左边缘）
      head.x = SPINE; head.y = -head.h / 2;    // 鱼头骑在主脊上，垂直居中
      const step = Math.max(190, Math.round((SPINE - 150) / Math.max(1, branches.length)));
      branches.forEach((b, i) => {
        const up = i % 2 === 0;
        const sx = SPINE - 100 - i * step;      // 斜刺在主脊上的挂点
        const len = 200 + b.h;                  // 斜刺长度（上下）
        const ex = sx - 130, ey = up ? -len : len;
        b._sx = sx; b._ex = ex; b._ey = ey; b._up = up;
        b.x = ex - b.w - 8; b.y = ey - b.h / 2;  // 大类标签挂在斜刺末端外侧
        const causes = nodes.filter((n) => n.parent === b.id);
        const n = Math.max(1, causes.length);
        causes.forEach((c, j) => {
          const t = (j + 1) / (n + 1);
          c._px = sx + (ex - sx) * t;            // 原因在斜刺上的投影点
          c._py = ey * t;
          c.x = c._px - 80 - c.w; c.y = c._py - c.h / 2;
          c._up = up;
        });
      });
      // 兜底：超过三层的节点（如从深层大纲转来）挂到父节点下方，避免坐标缺失
      for (let pass = 0; pass < 5; pass++) {
        nodes.forEach((n) => {
          if (isFinite(n.x) && isFinite(n.y)) return;
          const p = nodes.find((m) => m.id === n.parent);
          if (p && isFinite(p.x)) { n.x = p.x; n.y = p.y + p.h + 10; }
        });
      }
    },
    drawBack(doc) {
      const head = doc.nodes.find((n) => n.kind === 'head');
      if (!head) return '';
      const brs = doc.nodes.filter((n) => n.parent === head.id && n._sx != null);
      const x0 = brs.length ? Math.min(...brs.map((b) => b._sx)) - 40 : head.x - 400;
      return `<path class="fish-spine" d="M${x0},0 H${head.x - 2}" marker-end="url(#ar)"/>`;
    },
    drawNode(node) {
      if (node.kind === 'head') return `<rect class="nd nd-fish-head" x="0" y="0" width="${node.w}" height="${node.h}" rx="14"/>` + textSvg(node, { center: true });
      if (node.kind === 'branch') return `<rect class="nd nd-fish-branch" x="0" y="0" width="${node.w}" height="${node.h}" rx="8"/>` + textSvg(node, { center: true });
      return `<text class="nd-text nd-fish-cause" x="${node.w}" y="${node.h / 2 + 4}" text-anchor="end" style="font-size:12.5px">${esc(node.text)}</text>`;
    },
    drawLink(link, a, b) {
      if (a.kind === 'head' && b.kind === 'branch' && b._sx != null) {
        return `<path class="lk ln-fish" d="M${b._sx},0 L${b._ex},${b._ey}"/>`;
      }
      if (a.kind === 'branch' && b.kind === 'cause' && b._px != null) {
        return `<path class="lk ln-fish" d="M${b._px},${b._py} H${b._px - 72}"/>`;
      }
      return '';
    },
    nodeFields() {
      return [
        { key: 'text', label: '文字', type: 'text' },
        { key: 'kind', label: '层级', type: 'select', options: [['head', '问题'], ['branch', '大类'], ['cause', '原因']] },
        { key: 'note', label: '备注', type: 'textarea' },
      ];
    },
    createNode(doc, sel) {
      if (!sel) return { text: '新问题', kind: 'head' };
      if (sel.kind === 'head') return { text: '新大类', kind: 'branch' };
      return { text: '新原因', kind: 'cause' };
    },
    outline(doc) { return KINDS.mindmap.outline(doc); },
    fromOutline(items) {
      const r = KINDS.mindmap.fromOutline(items);
      r.nodes.forEach((n, i) => { n.kind = i === 0 ? 'head' : (n.parent === r.nodes[0].id ? 'branch' : 'cause'); });
      return r;
    },
  });

  /* ================================================================= 时间线 */
  def('timeline', {
    name: '时间线', group: '分析', icon: 'time', desc: '按时间顺序展示里程碑',
    template() {
      const n = (date, text) => ({ id: uid('n'), date, text, note: '' });
      return {
        nodes: [
          n('2026-01', '项目立项'), n('2026-03', '完成原型'),
          n('2026-06', '内测上线'), n('2026-09', '正式发布'),
        ],
        links: [], meta: { title: '项目里程碑' },
      };
    },
    size(node) {
      const m = boxOf(node, { fs: 13.5, maxW: 200, minW: 130, padX: 14, padY: 10, extra: 16 });
      node.h = Math.max(node.h, 52);
      return m;
    },
    layout(doc) {
      const nodes = doc.nodes.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      nodes.forEach((n) => this.size(n));
      let y = 30;
      nodes.forEach((n, i) => {
        const side = n.side || (i % 2 === 0 ? 'l' : 'r');
        n.side = side;
        n.x = side === 'l' ? -n.w - 46 : 46;
        n.y = y;
        y += n.h + 34;
      });
      doc._axis = { x: 0, y0: 10, y1: y + 10 };
    },
    drawBack(doc) {
      if (!doc._axis) return '';
      const a = doc._axis;
      return `<line class="tl-axis" x1="${a.x}" y1="${a.y0}" x2="${a.x}" y2="${a.y1}"/>`;
    },
    drawNode(node) {
      const dotX = node.side === 'l' ? node.w + 46 : -46;
      let s = `<rect class="nd nd-tl" x="0" y="0" width="${node.w}" height="${node.h}" rx="10"/>`;
      s += `<text class="nd-text nd-tl-date" x="14" y="21" style="font-size:12px">${esc(node.date || '')}</text>`;
      const m = node._m || { padX: 14, lineH: 20, fs: 13.5, lines: [node.text] };
      s += (m.lines || [node.text]).map((l, i) =>
        `<text class="nd-text" x="14" y="${41 + i * 20}" style="font-size:13.5px;font-weight:600">${esc(l)}</text>`).join('');
      s += `<line class="tl-link" x1="${node.side === 'l' ? node.w : 0}" y1="${node.h / 2}" x2="${dotX}" y2="${node.h / 2}"/>`;
      s += `<circle class="tl-dot" cx="${dotX}" cy="${node.h / 2}" r="7"/>`;
      if (node.note) s += `<text class="nd-text nd-note" x="14" y="${node.h - 8}" style="font-size:11px">${esc(node.note)}</text>`;
      return s;
    },
    drawLink() { return ''; },
    nodeFields() {
      return [
        { key: 'date', label: '时间', type: 'text' },
        { key: 'text', label: '事件', type: 'text' },
        { key: 'side', label: '位置', type: 'select', options: [['l', '左侧'], ['r', '右侧']] },
        { key: 'note', label: '备注', type: 'text' },
      ];
    },
    createNode() { return { text: '新事件', date: new Date().toISOString().slice(0, 7) }; },
    outline(doc) {
      return doc.nodes.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        .map((n) => ({ level: 0, text: `${n.date || ''} ${n.text}`, note: n.note }));
    },
    fromOutline(items) {
      // 首段只有「确实长得像日期」时才当成日期拆出来；
      // 否则「访谈 20 位用户」会被拆成 date=访谈 / text=20 位用户。
      const DATE_RE = /^(\d{4}-\d{1,2}(?:-\d{1,2})?|\d{4}年\d{1,2}月(?:\d{1,2}日)?|\d{1,2}月\d{1,2}日)\s+(.*)$/;
      const d0 = new Date(), p2 = (x) => String(x).padStart(2, '0');
      let cursor = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}`;
      return {
        nodes: items.map((it) => {
          const m = String(it.text).match(DATE_RE);
          // 没有日期的时间线没有意义，按每 3 天一件的顺序给个默认排期，改起来比空白方便
          const date = m ? m[1] : cursor;
          const end = addDays(date, 3);
          cursor = dayDiff(cursor, end) > 0 ? end : cursor;
          return { id: uid('n'), date, text: m ? m[2] : it.text, note: it.note || '' };
        }),
        links: [], meta: {},
      };
    },
    mermaid(doc) {
      const lines = ['timeline', '  title ' + esc((doc.meta && doc.meta.title) || doc.title || '时间线')];
      doc.nodes.forEach((n) => lines.push(`  ${esc(n.date || '')} : ${esc(n.text)}`));
      return lines.join('\n');
    },
  });

  /* =========================================================== 组织结构图 */
  def('org', {
    name: '组织结构图', group: '结构', icon: 'org', desc: '部门与汇报关系，自上而下',
    tree: true,
    template() {
      const n = (text, role, parent) => ({ id: uid('n'), text, role: role || '', parent: parent || null, note: '' });
      const c = n('张伟', 'CEO');
      const a = n('李娜', '技术总监', c.id), b = n('王强', '市场总监', c.id);
      return {
        nodes: [c, a, b, n('前端组', '组长', a.id), n('后端组', '组长', a.id), n('品牌组', '组长', b.id)],
        links: [], meta: {},
      };
    },
    size(node) {
      const m = boxOf(node, { fs: 14, bold: true, maxW: 150, minW: 104, padX: 12, padY: 9, extra: node.role ? 20 : 0 });
      node.w = Math.max(node.w, 112);
      return m;
    },
    layout(doc) {
      const nodes = doc.nodes, by = new Map(nodes.map((n) => [n.id, n]));
      nodes.forEach((n) => this.size(n));
      const kids = (id) => nodes.filter((n) => n.parent === id);
      const HG = 26, VG = 62;
      const memo = new Map();
      const subW = (id) => {
        if (memo.has(id)) return memo.get(id);
        const n = by.get(id); if (!n) return 0;
        const ks = kids(id);
        let v = n.w;
        if (ks.length) v = Math.max(v, ks.reduce((s, k) => s + subW(k.id) + HG, 0) - HG);
        memo.set(id, v); return v;
      };
      const place = (id, x0, y) => {
        const n = by.get(id); if (!n) return;
        const w = subW(id);
        n.x = Math.round(x0 + (w - n.w) / 2); n.y = Math.round(y);
        let cx2 = x0;
        kids(id).forEach((k) => { const kw = subW(k.id); place(k.id, cx2, y + n.h + VG); cx2 += kw + HG; });
      };
      const root = nodes.find((n) => !n.parent) || nodes[0];
      if (root) place(root.id, -subW(root.id) / 2, 0);
    },
    drawNode(node) {
      let s = `<rect class="nd nd-org" x="0" y="0" width="${node.w}" height="${node.h}" rx="10"/>`;
      s += `<text class="nd-text" x="${node.w / 2}" y="${node.role ? 24 : node.h / 2 + 5}" text-anchor="middle" style="font-size:14px;font-weight:600">${esc(node.text)}</text>`;
      if (node.role) s += `<text class="nd-text nd-role" x="${node.w / 2}" y="${node.h - 12}" text-anchor="middle" style="font-size:11.5px">${esc(node.role)}</text>`;
      return s;
    },
    drawLink(link, a, b) {
      const x1 = cx(a), y1 = a.y + a.h, x2 = cx(b), y2 = b.y;
      const my = y1 + (y2 - y1) / 2;
      return `<path class="lk ln-org" d="M${x1},${y1} V${my} H${x2} V${y2}"/>`;
    },
    nodeFields() {
      return [
        { key: 'text', label: '姓名/部门', type: 'text' },
        { key: 'role', label: '职位', type: 'text' },
        { key: 'note', label: '备注', type: 'textarea' },
      ];
    },
    createNode() { return { text: '新成员', role: '' }; },
    outline(doc) { return KINDS.mindmap.outline(doc); },
    fromOutline(items) {
      const r = KINDS.mindmap.fromOutline(items);
      r.nodes.forEach((n) => { n.role = ''; });
      return r;
    },
  });

  /* ================================================================= 甘特图 */
  def('gantt', {
    name: '甘特图', group: '计划', icon: 'gantt', desc: '任务排期与进度',
    template() {
      const n = (text, start, days, progress) => ({ id: uid('n'), text, start, days: days || 3, progress: progress == null ? 0 : progress, owner: '', note: '' });
      return {
        nodes: [
          n('需求梳理', '2026-10-01', 5, 100), n('方案设计', '2026-10-06', 4, 80),
          n('开发实现', '2026-10-10', 10, 35), n('联调测试', '2026-10-20', 5, 0),
          n('发布上线', '2026-10-25', 2, 0),
        ],
        links: [], meta: { start: '2026-10-01', end: '2026-10-31' },
      };
    },
    size(node) { node.w = 220; node.h = 34; node._m = { lines: [node.text], fs: 13, padX: 8, padY: 8, lineH: 18 }; return node._m; },
    layout(doc) {
      const meta = doc.meta || {};
      const s = meta.start || '2026-10-01';
      const dates = doc.nodes.map((n) => n.start).filter(Boolean);
      const start = dates.length && (!meta.start) ? dates.slice().sort()[0] : s;
      const end = meta.end || (function () {
        const last = doc.nodes.map((n) => addDays(n.start || start, (n.days || 1))).sort();
        return last.length ? last[last.length - 1] : addDays(start, 30);
      })();
      const total = Math.max(1, dayDiff(start, end) + 1);
      const DAY = 26;
      doc._gantt = { start, end, total, day: DAY, w: total * DAY, h: doc.nodes.length * 44 + 46 };
      doc.nodes.forEach((n, i) => {
        this.size(n);
        n.x = -n.w - 16;
        n.y = 46 + i * 44;
        const off = Math.max(0, dayDiff(start, n.start || start));
        // 条形用本地坐标绘制，需要把文档 x=0 换算到节点原点（节点 x 为负的任务名列）
        n._barX = -n.x + off * DAY;
        n._barW = Math.max(DAY * 0.6, (n.days || 1) * DAY);
      });
    },
    drawBack(doc) {
      const g = doc._gantt; if (!g) return '';
      let s = `<rect class="gantt-bg" x="0" y="30" width="${g.w}" height="${g.h - 30}" rx="8"/>`;
      for (let i = 0; i <= g.total; i++) {
        const x = i * g.day;
        s += `<line class="gantt-grid${i % 7 === 0 ? ' major' : ''}" x1="${x}" y1="30" x2="${x}" y2="${g.h}"/>`;
      }
      // 表头日期（每周一个）
      for (let i = 0; i < g.total; i += 7) {
        s += `<text class="gantt-date" x="${i * g.day + 4}" y="20" style="font-size:11px">${esc(addDays(g.start, i).slice(5))}</text>`;
      }
      return s;
    },
    drawNode(node) {
      const g = node._ganttRef;
      let s = `<text class="nd-text nd-task" x="0" y="${node.h / 2 + 4}" style="font-size:13px">${esc(node.text)}</text>`;
      if (node.owner) s += `<text class="nd-text nd-role" x="0" y="${node.h - 2}" style="font-size:11px">${esc(node.owner)}</text>`;
      s += `<rect class="gantt-bar" x="${node._barX}" y="4" width="${node._barW}" height="${node.h - 10}" rx="7"/>`;
      const pw = Math.max(0, Math.min(100, node.progress || 0)) / 100 * node._barW;
      if (pw > 1) s += `<rect class="gantt-prog" x="${node._barX}" y="4" width="${pw}" height="${node.h - 10}" rx="7"/>`;
      s += `<text class="gantt-pct" x="${node._barX + node._barW + 8}" y="${node.h / 2 + 4}" style="font-size:11px">${node.progress || 0}%</text>`;
      return s;
    },
    drawLink() { return ''; },
    nodeFields() {
      return [
        { key: 'text', label: '任务', type: 'text' },
        { key: 'start', label: '开始日期', type: 'text' },
        { key: 'days', label: '天数', type: 'number' },
        { key: 'progress', label: '进度 %', type: 'number' },
        { key: 'owner', label: '负责人', type: 'text' },
      ];
    },
    createNode(doc) {
      const last = doc.nodes[doc.nodes.length - 1];
      const start = last ? addDays(last.start || (doc.meta && doc.meta.start) || '2026-10-01', last.days || 1) : (doc.meta && doc.meta.start) || '2026-10-01';
      return { text: '新任务', start, days: 3, progress: 0, owner: '' };
    },
    outline(doc) {
      return doc.nodes.map((n) => ({ level: 0, text: `${n.start || ''} → ${addDays(n.start || '', n.days || 1)}　${n.text}（${n.progress || 0}%）` }));
    },
    fromOutline(items) {
      // 大纲里通常没有日期（导图/流程图转过来时），此时按顺序自动排期：
      // 每件事 3 天，前一件结束的第二天开始，形成一条能直接看的排期，而不是全部堆在第一天。
      const DATE = /(\d{4}-\d{2}-\d{2})/;
      const pct = /(\d+)\s*%/;
      const today = (function () {
        const d = new Date(), p = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      })();
      let cursor = today;
      const nodes = items.map((it) => {
        const raw = String(it.text);
        const dm = raw.match(DATE);
        const pm = raw.match(pct);
        const text = raw
          .replace(/^\S+\s*→\s*\S+\s*/, '')
          .replace(/（\d+\s*%）/, '')
          .replace(DATE, '')
          .trim();
        const days = 3;
        const start = dm ? dm[1] : cursor;
        const end = addDays(start, days);
        // 有明确日期时按它走，但游标只往前推，避免时间倒流
        cursor = dayDiff(cursor, end) > 0 ? end : cursor;
        return { id: uid('n'), text: text || raw, start, days, progress: pm ? +pm[1] : 0, owner: '', note: '' };
      });
      return { nodes, links: [], meta: { start: today } };
    },
    mermaid(doc) {
      const lines = ['gantt', '  dateFormat YYYY-MM-DD', '  title ' + esc(doc.title || '甘特图')];
      doc.nodes.forEach((n) => {
        lines.push(`  section ${esc(n.owner || '任务')}`);
        lines.push(`  ${esc(n.text)} :${n.id}, ${n.start || ''}, ${Math.max(1, n.days || 1)}d`);
      });
      return lines.join('\n');
    },
  });
  function dayDiff(a, b) {
    const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.round((d2 - d1) / 86400000);
  }
  function addDays(a, n) {
    const d = new Date(String(a || '2026-10-01') + 'T00:00:00');
    if (isNaN(d)) return a;
    d.setDate(d.getDate() + (+n || 0));
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;   // 不能用 toISOString：会按 UTC 偏移一天
  }

  /* =============================================================== 概念图 */
  def('concept', {
    name: '概念图', group: '结构', icon: 'concept', desc: '自由节点与连线，想到哪画到哪',
    img: true,
    template() {
      const n = (text) => ({ id: uid('n'), text, note: '', x: null, y: null });
      const a = n('核心概念'), b = n('特征 A'), c = n('特征 B'), d = n('应用场景');
      const l = (x, y, label) => ({ id: uid('l'), from: x.id, to: y.id, label, kind: 'rel' });
      return { nodes: [a, b, c, d], links: [l(a, b, '包含'), l(a, c, '包含'), l(a, d, '应用于')], meta: {} };
    },
    size(node) { return boxOf(node, { fs: 13.5, maxW: 160, minW: 92, padX: 14, padY: 11 }); },
    layout(doc) {
      const HG = 56, VG = 46, COLS = 3;
      doc.nodes.forEach((n, i) => {
        this.size(n);
        if (n.x == null) {
          const r = Math.floor(i / COLS), c = i % COLS;
          n.x = c * 210 + (r % 2) * 40;
          n.y = r * 120;
        }
      });
    },
    drawNode(node) {
      return `<rect class="nd nd-concept" x="0" y="0" width="${node.w}" height="${node.h}" rx="18"/>` +
        imageSvg(node) + textSvg(node, { center: true });
    },
    drawLink(link, a, b) {
      const ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b);
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const p1 = { x: ax + ux * (a.w / 2 + 4), y: ay + uy * (a.h / 2 + 4) };
      const p2 = { x: bx - ux * (b.w / 2 + 6), y: by - uy * (b.h / 2 + 6) };
      return `<line class="lk ln-concept" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" marker-end="url(#ar)"/>` +
        linkLabel(link, (ax + bx) / 2, (ay + by) / 2 - 8);
    },
    nodeFields() { return [{ key: 'text', label: '文字', type: 'text' }, { key: 'note', label: '备注', type: 'textarea' }]; },
    linkFields() { return [{ key: 'label', label: '关系', type: 'text' }]; },
    createNode() { return { text: '新概念' }; },
    outline(doc) { return KINDS.flow.outline(doc); },
    fromOutline(items) { return KINDS.flow.fromOutline(items); },
    mermaid(doc) {
      const lines = ['graph LR'];
      doc.nodes.forEach((n) => lines.push(`  ${n.id}["${esc(n.text)}"]`));
      doc.links.forEach((l) => lines.push(`  ${l.from}-->|"${esc(l.label || '')}"|${l.to}`));
      return lines.join('\n');
    },
  });

  /* --------------------------------------------------------------- 类型清单 */
  // 树形家族共用同一套「parent → 虚拟连线」逻辑
  KINDS.fishbone.edges = KINDS.org.edges = KINDS.mindmap.edges;

  const ORDER = ['mindmap', 'flow', 'arch', 'sequence', 'state', 'class', 'er', 'fishbone', 'timeline', 'org', 'gantt', 'concept'];
  const ICONS = {
    mind: 'M4 7h7M4 12h5M11 4v11M11 9h6M11 9l4-4M11 9l4 4',
    flow: 'M4 5h7v5H4zM13 14h7v5h-7zM7.5 10v4M7.5 14h5.5M13 14v0',
    arch: 'M3 5h6v4H3zM15 5h6v4h-6zM9 17h6v3H9zM6 9v4h12V9M12 13v4',
    seq: 'M5 4v16M12 4v16M19 4v16M5 9h7M12 14h7',
    state: 'M6 5h12v6H6zM17 16a3 3 0 10 0 .01M6 16h6M12 16l-2-2M12 16l-2 2',
    class: 'M4 5h16v5H4zM4 10h16v9H4zM6 13h8M6 16h5',
    er: 'M4 5h7v5H4zM13 6h7v4h-7zM6 16h4v4H6zM15 16h4v4h-4zM11 7.5h2M9 10v3M17 10v3',
    fish: 'M3 12h18M20 12l-4-4M20 12l-4 4M8 12V6M12 12v6M16 12V6',
    time: 'M12 3v18M6 8h-3M21 8h-3M6 16h-3M21 16h-3',
    org: 'M9 4h6v4H9zM3 16h6v4H3zM15 16h6v4h-6zM12 8v4M6 12v4M18 12v4M6 12h12',
    gantt: 'M3 5h18M3 10h10M3 15h14M3 20h7',
    concept: 'M6 8a4 3 0 100 6 4 3 0 100-6zM16 6a4 3 0 100 6 4 3 0 100-6zM10 9h4M13 15v3',
  };
  KINDS.__order = ORDER;
  KINDS.__icon = (t) => ICONS[KINDS[t] && KINDS[t].icon] || ICONS.concept;
  KINDS.__list = function () {
    return ORDER.filter((t) => KINDS[t]).map((t) => ({
      type: t, name: KINDS[t].name, group: KINDS[t].group, desc: KINDS[t].desc, icon: KINDS[t].icon,
    }));
  };

  global.KINDS = KINDS;
  global.KindUtil = { esc, uid, textW, wrap, boxOf, textSvg, orth, cx, cy, linkLabel, guessShape, dayDiff, addDays, nodeImages, imgLayout, imageSvg };
})(window);
