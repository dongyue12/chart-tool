/* 生成 12 种图表的示例文件 -> POST /api/charts
 * 用法： node tools/seed_charts.js [port]
 * 作用：① 验证 kinds.js 的模板 + 布局在服务端视角可跑通
 *      ② 给统一工作台准备一批可直接打开的示例
 */
const fs = require('fs');
const path = require('path');

global.window = global;
global.document = { createElement: () => null };   // 走文本宽度估算分支

const KINDS_FILE = path.join(__dirname, '..', 'studio', 'kinds.js');
eval(fs.readFileSync(KINDS_FILE, 'utf8'));
const K = global.KINDS;

const PORT = process.argv[2] || 8712;
const BASE = `http://127.0.0.1:${PORT}`;

const TITLES = {
  mindmap: '示例：如何与 WorkBuddy 协作',
  flow: '示例：用户登录流程',
  arch: '示例：系统架构分层',
  sequence: '示例：登录时序',
  state: '示例：订单状态流转',
  class: '示例：订单领域模型',
  er: '示例：用户订单 ER',
  fishbone: '示例：交付延期要因分析',
  timeline: '示例：项目里程碑',
  org: '示例：团队组织结构',
  gantt: '示例：版本排期',
  concept: '示例：概念关系',
};

(async () => {
  const out = [];
  const existing = (await (await fetch(BASE + '/api/charts')).json()).charts || [];
  const byType = new Map();
  existing.forEach((c) => { if (!byType.has(c.type)) byType.set(c.type, c.id); });
  for (const t of K.__list()) {
    const kd = K[t.type];
    const title = TITLES[t.type] || ('示例：' + t.name);
    const tpl = kd.template(title);
    const doc = {
      nodes: (tpl.nodes || []).map((n) => Object.assign({}, n)),
      links: (tpl.links || []).map((l) => Object.assign({}, l)),
      meta: Object.assign({}, tpl.meta || {}, { example: true }),   // 标记为示例，侧栏沉底分组
    };
    try {
      kd.layout(doc);
      const bad = doc.nodes.filter((n) => !isFinite(n.x) || !isFinite(n.y) || !isFinite(n.w));
      if (bad.length) throw new Error(bad.length + ' 个节点坐标异常');
      const es = kd.edges ? kd.edges(doc) : doc.links;
      kd.drawBack && kd.drawBack(doc);
      doc.nodes.forEach((n) => kd.drawNode(n));
      es.forEach((e) => {
        const a = doc.nodes.find((n) => n.id === e.from), b = doc.nodes.find((n) => n.id === e.to);
        kd.drawLink && kd.drawLink(e, a, b || a);
      });
      const md = kd.mermaid ? kd.mermaid(doc) : '';
      console.log(`[ok] ${t.type.padEnd(9)} 节点 ${String(doc.nodes.length).padStart(2)} 连线 ${String(es.length).padStart(2)}` +
        (md ? '  mermaid ' + md.split('\n').length + ' 行' : ''));
    } catch (e) {
      console.log(`[FAIL] ${t.type}: ${e.message}`);
      continue;
    }
    const keep = byType.get(t.type);
    let r;
    if (keep) {
      doc.title = title; doc.type = t.type;
      r = await fetch(BASE + '/api/charts/' + encodeURIComponent(keep), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart: doc }),
      });
      const j = await r.json();
      out.push({ type: t.type, id: j.id || keep, title });
    } else {
      r = await fetch(BASE + '/api/charts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: title, title, type: t.type, doc }),
      });
      const j = await r.json();
      out.push({ type: t.type, id: j.id, title });
    }
  }
  console.log('\n已写入 ' + out.length + ' 个示例：');
  out.forEach((o) => console.log(`  ${o.type.padEnd(9)} ${o.id}`));
  fs.writeFileSync(path.join(__dirname, '..', 'charts', '.seed.json'), JSON.stringify(out, null, 2), 'utf8');
})();
