/* 12 x 12 互转矩阵测试：outline -> fromOutline -> layout 全链路
 * 用法： node tools/test_convert.js
 */
const fs = require('fs');
const path = require('path');

global.window = global;
global.document = { createElement: () => null };
eval(fs.readFileSync(path.join(__dirname, '..', 'studio', 'kinds.js'), 'utf8'));
const K = global.KINDS;

const types = K.__order;
let fail = 0, total = 0;

for (const src of types) {
  const sdoc = K[src].template('源：' + src);
  sdoc.nodes = sdoc.nodes || [];
  sdoc.links = sdoc.links || [];
  K[src].layout(sdoc);
  let items;
  try {
    items = K[src].outline(sdoc);
    if (!items || !items.length) throw new Error('大纲为空');
  } catch (e) {
    console.log(`[FAIL] ${src}.outline: ${e.message}`); fail++; continue;
  }
  for (const dst of types) {
    total++;
    try {
      const r = K[dst].fromOutline(items.map((x) => ({ ...x })), '转：' + dst);
      const doc = { nodes: r.nodes || [], links: r.links || [], meta: r.meta || {} };
      if (!doc.nodes.length) throw new Error('节点为空');
      K[dst].layout(doc);
      const bad = doc.nodes.filter((n) => !isFinite(n.x) || !isFinite(n.y));
      if (bad.length) throw new Error('坐标异常 ' + bad.length);
      const es = K[dst].edges ? K[dst].edges(doc) : doc.links;
      doc.nodes.forEach((n) => K[dst].drawNode(n));
      es.forEach((e) => {
        const a = doc.nodes.find((n) => n.id === e.from), b = doc.nodes.find((n) => n.id === e.to);
        K[dst].drawLink && K[dst].drawLink(e, a, b || a);
      });
      K[dst].drawBack && K[dst].drawBack(doc);
    } catch (e) {
      console.log(`[FAIL] ${src} -> ${dst}: ${e.message}`);
      fail++;
    }
  }
}
console.log(`\n互转矩阵：${total - fail}/${total} 通过${fail ? '，' + fail + ' 失败' : ''}`);
process.exit(fail ? 1 : 0);
