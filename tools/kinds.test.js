/* kinds.js 单元测试：布局/尺寸/转义/形状推断/图片/Mermaid 往返
 * 用法： node --test tools/kinds.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.window = global;
global.document = { createElement: () => null };
eval(fs.readFileSync(path.join(__dirname, '..', 'studio', 'kinds.js'), 'utf8'));
const K = global.KINDS;
const U = global.KindUtil;

const types = K.__order;

test('12 种类型都有必需的接口与模板', () => {
  assert.strictEqual(types.length, 12);
  for (const t of types) {
    const d = K[t];
    assert.ok(d, t + ' 未注册');
    for (const fn of ['template', 'layout', 'size', 'drawNode']) {
      assert.strictEqual(typeof d[fn], 'function', `${t}.${fn} 缺失`);
    }
    const doc = d.template('测试');
    assert.ok(Array.isArray(doc.nodes) && doc.nodes.length > 0, t + ' 模板没有节点');
  }
});

test('每种类型布局后坐标与尺寸均为有限正数', () => {
  for (const t of types) {
    const d = K[t];
    const doc = d.template('布局测试');
    doc.nodes.forEach((n) => d.size(n));
    d.layout(doc);
    for (const n of doc.nodes) {
      assert.ok(Number.isFinite(n.x), `${t}/${n.id} x 非有限`);
      assert.ok(Number.isFinite(n.y), `${t}/${n.id} y 非有限`);
      assert.ok(n.w > 0 && n.h > 0, `${t}/${n.id} 尺寸非正`);
      assert.ok(n.w < 4000 && n.h < 4000, `${t}/${n.id} 尺寸异常大`);
    }
  }
});

test('布局结果不含 NaN 坐标（空文档不崩）', () => {
  for (const t of types) {
    const d = K[t];
    const empty = { nodes: [], links: [], meta: {} };
    assert.doesNotThrow(() => d.layout(empty), t + ' 空文档布局抛错');
    assert.doesNotThrow(() => d.drawNode({ id: 'x', text: 'a', w: 10, h: 10 }), t + ' drawNode 抛错');
  }
});

test('文本转义：特殊字符不会破坏 SVG', () => {
  const bad = '<script>"&\'';
  const s = U.esc(bad);
  assert.ok(!s.includes('<'), '"<" 未转义');
  assert.ok(!s.includes('>'), '">" 未转义');
  assert.ok(s.includes('&amp;'), '"&" 未转义');
  assert.ok(s.includes('&quot;'), '" 未转义');
});

test('折行：超长中文会拆成多行且不超宽', () => {
  const lines = U.wrap('这是一段很长的中文文本用来测试自动折行是否正常工作', 120, 14, false);
  assert.ok(lines.length > 1, '未折行');
  for (const l of lines) assert.ok(U.textW(l, 14, false) <= 130, '行宽超出限制：' + l);
});

test('形状推断：判断句识别为 decision，动词开头为 process', () => {
  assert.strictEqual(U.guessShape('是否通过?'), 'decision');
  assert.strictEqual(U.guessShape('信息正确吗？'), 'decision');
  assert.strictEqual(U.guessShape('提交订单'), 'process');
  assert.strictEqual(U.guessShape('开始'), 'terminal');
  assert.strictEqual(U.guessShape('结束'), 'terminal');
});

test('图片：boxOf 为图片预留高度，空图片不预留', () => {
  const plain = { id: 'a', text: '文字', w: 0, h: 0 };
  U.boxOf(plain, { fs: 14, maxW: 160 });
  const h0 = plain.h;

  const withImg = { id: 'b', text: '文字', w: 0, h: 0, image: 'data:image/png;base64,AA', imgW: 300, imgH: 160 };
  U.boxOf(withImg, { fs: 14, maxW: 160 });
  assert.ok(withImg.h > h0 + 40, `有图节点应显著变高：${h0} → ${withImg.h}`);
  assert.ok(withImg.w >= 168, '宽度至少容纳图片：' + withImg.w);

  const decision = { id: 'c', text: '文字', w: 0, h: 0, image: 'data:image/png;base64,AA', imgW: 300, imgH: 160 };
  U.boxOf(decision, { fs: 13, maxW: 130, img: false });
  assert.ok(decision.h < withImg.h, 'img:false 时不应预留图片高度');
});

test('图片：imageSvg 只在有图时输出，且居中', () => {
  const n = { id: 'a', text: 'x', w: 200, h: 120, image: 'data:image/png;base64,AA', imgW: 300, imgH: 160 };
  const s = U.imageSvg(n);
  assert.ok(s.includes('<image'), '未输出 image 元素');
  const m = s.match(/x="(\d+)"/);
  assert.ok(m, '缺少 x 属性');
  assert.ok(Math.abs(+m[1] - (200 - 168) / 2) <= 1, '图片未水平居中：x=' + m[1]);
  assert.strictEqual(U.imageSvg({ id: 'b', text: 'x', w: 10, h: 10 }), '', '无图时不应输出');
});

test('正交连线：向下走时从底出顶进，不穿过节点', () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const b = { x: 0, y: 200, w: 100, h: 40 };
  const d = U.orth(a, b);
  assert.ok(d.startsWith('M50,40'), '应从 a 底边中点出发：' + d);
  assert.ok(d.endsWith('V200'), '应到达 b 顶边：' + d);
});

test('正交连线：向上回边从右侧绕行', () => {
  const a = { x: 0, y: 300, w: 100, h: 40 };
  const b = { x: 0, y: 0, w: 100, h: 40 };
  const d = U.orth(a, b);
  assert.ok(d.includes('H'), '回边应有横向绕行段');
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  const maxX = Math.max(...nums);
  assert.ok(maxX >= 130, '回边应绕到节点右侧：' + d);
});

test('12 x 12 互转矩阵全部成功且不产生空文档', () => {
  for (const src of types) {
    const sdoc = K[src].template('源');
    K[src].layout(sdoc);
    const items = K[src].outline(sdoc);
    assert.ok(items.length > 0, src + ' 大纲为空');
    for (const dst of types) {
      const r = K[dst].fromOutline(items.map((x) => Object.assign({}, x)), '目标');
      assert.ok(r && Array.isArray(r.nodes) && r.nodes.length > 0, `${src} → ${dst} 得到空文档`);
      const doc = { nodes: r.nodes, links: r.links || [], meta: r.meta || {} };
      assert.doesNotThrow(() => K[dst].layout(doc), `${src} → ${dst} 布局抛错`);
      for (const n of doc.nodes) {
        assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${src} → ${dst} 坐标非有限`);
      }
    }
  }
});

test('Mermaid 导出：有正确头部与节点形状', () => {
  const src = {
    nodes: [
      { id: 'a', text: '开始', shape: 'terminal', x: 0, y: 0 },
      { id: 'b', text: '处理数据', shape: 'process', x: 0, y: 80 },
      { id: 'c', text: '成功?', shape: 'decision', x: 0, y: 160 },
    ],
    links: [{ id: 'l1', from: 'a', to: 'b' }, { id: 'l2', from: 'b', to: 'c' }],
    meta: {},
  };
  const mmd = K.flow.mermaid(src);
  assert.ok(/^(graph|flowchart)\s+(TD|LR)/m.test(mmd), '未输出 Mermaid 头：' + mmd.slice(0, 40));
  assert.ok(mmd.includes('([开始])'), '终结点应为圆角形状');
  assert.ok(mmd.includes('{成功?}'), '判断节点应为菱形');
  assert.ok(mmd.includes('-->'), '缺少连线');
});

/* ---------------------------------------------------------------- 思维导图布局 */
function mmDoc() {
  const n = (text, parent) => ({ id: 'n' + Math.random().toString(36).slice(2, 8), text, parent: parent || null, collapsed: false });
  const root = n('中心主题');
  const a = n('产品方向', root.id), b = n('技术方案', root.id), c = n('团队协作', root.id);
  const a1 = n('用户访谈', a.id), a2 = n('竞品分析', a.id), a3 = n('需求池', a.id);
  const b1 = n('前端', b.id), b2 = n('后端', b.id), b3 = n('数据', b.id);
  const c1 = n('周会', c.id), c2 = n('文档沉淀', c.id);
  const g1 = n('访谈提纲', a1.id), g2 = n('样本招募', a1.id), g3 = n('接口设计', b2.id);
  return { nodes: [root, a, b, c, a1, a2, a3, b1, b2, b3, c1, c2, g1, g2, g3], links: [], meta: {} };
}

test('思维导图 5 种布局：坐标合法、互不重叠、连线无 NaN', () => {
  const d = K.mindmap;
  assert.deepStrictEqual(d.layouts.map((l) => l.key), ['balanced', 'right', 'down', 'up', 'radial']);
  for (const l of d.layouts) {
    const doc = mmDoc();
    doc.meta.layout = l.key;
    d.layout(doc);
    for (const n of doc.nodes) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${l.key}/${n.text} 坐标非有限`);
      assert.ok(n.w > 0 && n.h > 0, `${l.key}/${n.text} 尺寸非正`);
    }
    for (let i = 0; i < doc.nodes.length; i++) {
      for (let j = i + 1; j < doc.nodes.length; j++) {
        const a = doc.nodes[i], b = doc.nodes[j];
        const overlap = a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;
        assert.ok(!overlap, `${l.key}: 「${a.text}」与「${b.text}」重叠`);
      }
    }
    const es = d.edges(doc);
    assert.strictEqual(es.length, doc.nodes.length - 1, l.key + ' 连线数与节点数不匹配');
    for (const e of es) {
      const a = doc.nodes.find((n) => n.id === e.from), b = doc.nodes.find((n) => n.id === e.to);
      const svg = d.drawLink(e, a, b);
      assert.ok(/^<path/.test(svg), l.key + ' 连线不是 path');
      assert.ok(!/NaN|Infinity/.test(svg), l.key + ' 连线含 NaN：' + svg);
    }
  }
});

test('思维导图布局互切不会残留旧坐标（无节点被漏排）', () => {
  const d = K.mindmap;
  const doc = mmDoc();
  d.layout(doc);                     // balanced
  doc.meta.layout = 'down';
  d.layout(doc);
  const before = doc.nodes.map((n) => n.x + ',' + n.y).join('|');
  doc.meta.layout = 'balanced';
  d.layout(doc);
  const after = doc.nodes.map((n) => n.x + ',' + n.y).join('|');
  assert.notStrictEqual(before, after, '切回双向布局后坐标没变，说明有节点被漏排');
});

/* -------------------------------------------------------- 纯图片节点（无文字） */
test('没有文字时图片铺满节点（大图缩放、长边为准、比例不变）', () => {
  const d = K.mindmap;
  const base = { id: 'p1', parent: null, image: 'data:image/png;base64,AAA', imgW: 720, imgH: 480 };
  const big = Object.assign({}, base, { text: '' });
  d.size(big);
  // 长边压到 260（IMG_MAX_BIG），四周各留 5px
  assert.strictEqual(big.w, 270, 'w=' + big.w);
  assert.strictEqual(big.h, 183, 'h=' + big.h);
  assert.ok(Math.abs(big.w / big.h - 720 / 480) < 0.05, '比例应保持 3:2，实际 ' + (big.w / big.h).toFixed(3));
  const svg = d.drawNode(big);
  const m = /<image[^>]*width="(\d+)" height="(\d+)"/.exec(svg);
  assert.ok(m, '应画图片');
  assert.strictEqual(+m[1], 260, 'image width');
  assert.strictEqual(+m[2], 173, 'image height');
  // 图片位置在节点内居中
  const x = /<image[^>]*x="(\d+)"/.exec(svg);
  assert.strictEqual(+x[1], 5, 'image x');

  // 有文字时回到顶部缩略图，节点不会撑到 260 宽
  const small = Object.assign({}, base, { text: '说明' });
  d.size(small);
  assert.ok(small.w < 270 && small.h < 183, `有文字 ${small.w}x${small.h}`);
  const m2 = /<image[^>]*width="(\d+)"/.exec(d.drawNode(small));
  assert.ok(+m2[1] <= 168, '缩略图宽度上限 168，实际 ' + m2[1]);

  // 小图标允许放大，但最多 3 倍，不会糊成一片
  const icon = Object.assign({}, base, { text: '', imgW: 48, imgH: 48 });
  d.size(icon);
  assert.strictEqual(icon.w, 48 * 3 + 10, 'w=' + icon.w);

  // 没有图片时按普通空节点处理，不会变成 0 尺寸
  const plain = { id: 'p2', parent: null, text: '' };
  d.size(plain);
  assert.ok(plain.w > 0 && plain.h > 0, `${plain.w}x${plain.h}`);
});

/* ---------------------------------------------------- 一个节点装多张图（批量） */
test('多张图片放进同一个节点：2 列网格，全部画出来', () => {
  const d = K.mindmap;
  const img = (w, h) => ({ data: 'data:image/png;base64,AA', w, h });
  const n = { id: 'g1', parent: null, text: '', images: [img(300, 160), img(300, 160), img(300, 160)] };
  d.size(n);
  const lay = n._m.lay;
  assert.strictEqual(lay.items.length, 3, '应排 3 张');
  assert.strictEqual(lay.w, 128 * 2 + 6, '两列宽度：' + lay.w);
  assert.strictEqual(lay.h, 68 * 2 + 6, '两行高度：' + lay.h);
  assert.strictEqual(n.w, lay.w + 10);
  assert.strictEqual(n.h, lay.h + 10);
  const svg = d.drawNode(n);
  const imgs = svg.match(/<image /g) || [];
  assert.strictEqual(imgs.length, 3, '画了 ' + imgs.length + ' 张');
  // 第一张在左上，第二张在右上（同一行），第三张换行
  const xs = [...svg.matchAll(/<image[^>]*x="(\d+)" y="(\d+)"/g)].map((m) => [+m[1], +m[2]]);
  assert.strictEqual(xs[0][0], 5, 'x0=' + xs[0][0]);
  assert.ok(xs[1][0] > xs[0][0] + 100, '第二张应在右侧：' + xs[1][0]);
  assert.strictEqual(xs[0][1], xs[1][1], '前两张同一行');
  assert.ok(xs[2][1] > xs[0][1] + 50, '第三张应换行：' + xs[2][1]);

  // 5 张换 3 列
  const n5 = { id: 'g2', parent: null, text: '', images: [1, 2, 3, 4, 5].map(() => img(300, 160)) };
  d.size(n5);
  assert.strictEqual(n5._m.lay.w, 86 * 3 + 12, '三列宽度：' + n5._m.lay.w);

  // 有文字时图片网格在上、文字在下，且不会撑得比纯图更宽
  const t = { id: 'g3', parent: null, text: '参考图', images: [img(300, 160), img(300, 160)] };
  d.size(t);
  assert.ok(t._m.imgH > 0, '应为图片预留高度');
  assert.ok(t.h > t._m.imgH, '文字应在图片下方还有空间');
  assert.ok(t.w >= 174, '宽度至少容下两列：' + t.w);

  // 兼容旧的单图字段
  const old = { id: 'g4', parent: null, text: '', image: 'data:image/png;base64,AA', imgW: 300, imgH: 160 };
  assert.deepStrictEqual(U.nodeImages(old).map((x) => [x.w, x.h]), [[300, 160]]);
  d.size(old);
  assert.strictEqual(old.w, 270, '旧字段也按纯图片节点铺满');
  // 空节点三字段都没有时不受影响
  assert.deepStrictEqual(U.nodeImages({ id: 'g5', text: 'x' }), []);
});
