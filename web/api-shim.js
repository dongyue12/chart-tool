/* ============================================================================
 * api-shim.js —— 静态演示版的「服务端」
 *
 * 线上没有 server.py，这里用 localStorage 顶替 /api/charts 的全部接口。
 * 前端（kinds.js / app.js）完全不知道自己在跑静态版：它们调用 fetch('/api/charts'),
 * 本文件把请求截下来、按 server.py 的响应结构回话。
 *
 * 存储：localStorage['chartstudio.demo.v1'] = { charts: {id: doc}, history: {id: [snap]} }
 * 示例图（window.__CHART_SAMPLES__）是只读底稿，用户改过的才写进 charts。
 * ==========================================================================*/
(function () {
  'use strict';

  var SAMPLES = Array.isArray(window.__CHART_SAMPLES__) ? window.__CHART_SAMPLES__ : [];
  var KEY = 'chartstudio.demo.v1';
  var MAX_HISTORY = 30;
  var API = '/api/charts';

  /* ---------------------------------------------------------- 基础工具 */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function nowIso() {
    var d = new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var oh = pad(Math.floor(Math.abs(off) / 60));
    var om = pad(Math.abs(off) % 60);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + oh + ':' + om;
  }

  function stampOf(d) {
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 收敛成安全 id：和 server.py 的 safe_id 保持一致 */
  function safeId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    '<>:"/\\|?*'.split('').forEach(function (ch) { s = s.split(ch).join('_'); });
    s = s.replace(/^[ .]+/, '').replace(/[ .]+$/, '');
    return s.slice(0, 120);
  }

  function isExample(doc, cid) {
    if (!doc) return false;
    if (doc.meta && doc.meta.example) return true;
    return String(cid || doc.id || '').indexOf('示例') === 0;
  }

  /* ---------------------------------------------------------- 存储 */
  var mem = null;   // localStorage 不可用时的兜底（file:// 或隐私模式）
  function readDb() {
    if (mem) return mem;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.charts) return d;
      }
    } catch (e) { /* 读不出来就当空库 */ }
    return { charts: {}, history: {} };
  }
  function writeDb(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) {
      mem = db;   // 存不下就退回内存，至少本次会话可用
      throw new Error('浏览器本地存储不可用（可能是隐私模式），本次改动只在当前标签页有效');
    }
  }

  var SAMPLE_MAP = {};
  SAMPLES.forEach(function (d) {
    if (d && d.id) SAMPLE_MAP[d.id] = d;
  });

  function effective(cid) {
    var db = readDb();
    if (db.charts[cid]) return db.charts[cid];
    return SAMPLE_MAP[cid] || null;
  }

  function backup(cid) {
    var cur = effective(cid);
    if (!cur) return;
    var db = readDb();
    var list = db.history[cid] || (db.history[cid] = []);
    var raw = JSON.stringify(cur);
    if (list.length && JSON.stringify(list[list.length - 1].doc) === raw) return;
    var stamp = stampOf(new Date());
    var k = 1, base = stamp;
    while (list.some(function (s) { return s.stamp === stamp; })) {
      stamp = base + '-' + ('00' + k).slice(-3);
      k++;
    }
    list.push({ stamp: stamp, doc: clone(cur) });
    while (list.length > MAX_HISTORY) list.shift();
    writeDb(db);
  }

  function normalize(doc, cid, fallbackTitle) {
    doc = doc && typeof doc === 'object' ? doc : {};
    doc.id = cid;
    doc.title = String(doc.title || fallbackTitle || cid).trim() || cid;
    doc.type = doc.type || 'mindmap';
    doc.schema = 'workbuddy-chart/v1';
    doc.theme = doc.theme || 'classic';
    doc.nodes = doc.nodes || [];
    doc.links = doc.links || [];
    doc.meta = doc.meta || {};
    doc.createdAt = doc.createdAt || nowIso();
    doc.updatedAt = nowIso();
    return doc;
  }

  function uniqueId(title) {
    var base = safeId(title) || ('c' + Date.now().toString(36));
    var cid = base, n = 1;
    while (SAMPLE_MAP[cid] || readDb().charts[cid]) {
      cid = base + '-' + n;
      n++;
    }
    return cid;
  }

  function listCharts() {
    var db = readDb();
    var out = [];
    var seen = {};

    Object.keys(db.charts).forEach(function (cid) {
      var d = db.charts[cid];
      seen[cid] = true;
      out.push({
        id: cid,
        title: d.title || '未命名图表',
        type: d.type || 'mindmap',
        theme: d.theme,
        updatedAt: d.updatedAt,
        nodeCount: (d.nodes || []).length,
        linkCount: (d.links || []).length,
        example: isExample(d, cid),
      });
    });

    SAMPLES.forEach(function (d) {
      if (!d || !d.id || seen[d.id]) return;
      out.push({
        id: d.id,
        title: d.title || '未命名图表',
        type: d.type || 'mindmap',
        theme: d.theme,
        updatedAt: d.updatedAt,
        nodeCount: (d.nodes || []).length,
        linkCount: (d.links || []).length,
        example: true,
      });
    });

    // 与 server.py 一致：按更新时间倒序（没有 updatedAt 的示例沉底）
    out.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    return out;
  }

  /* ---------------------------------------------------------- 路由 */
  function reply(status, data) {
    return new Response(JSON.stringify(data), {
      status: status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  function handle(method, rest, body) {
    // rest: '' | '/<id>' | '/<id>/history' | '/<id>/history/<stamp>' | '/<id>/reset' | '/<id>/restore'
    var db = readDb();

    if (rest === '' || rest === '/') {
      if (method === 'GET') return reply(200, { charts: listCharts() });
      if (method === 'POST') {
        var doc = body.doc;
        if (!doc || typeof doc !== 'object') {
          doc = {};
          ['nodes', 'links', 'meta'].forEach(function (k) {
            if (body[k] !== undefined) doc[k] = body[k];
          });
        }
        var title = String(body.title || '未命名图表').trim();
        var cid = safeId(body.id) || uniqueId(title);
        doc.type = String(body.type || 'mindmap');
        doc = normalize(clone(doc), cid, title);
        db = readDb();
        db.charts[cid] = doc;
        writeDb(db);
        return reply(200, { id: cid, chart: doc });
      }
      return reply(405, { error: '方法不支持' });
    }

    var parts = rest.replace(/^\//, '').split('/');
    var cid = safeId(decodeURIComponent(parts[0] || ''));

    // .../history
    if (parts[1] === 'history') {
      if (method !== 'GET') return reply(405, { error: '方法不支持' });
      var stamp = parts[2] ? decodeURIComponent(parts[2]) : '';
      var snaps = (db.history[cid] || []).slice();
      if (!stamp) {
        var items = snaps.map(function (s) {
          return {
            stamp: s.stamp,
            title: s.doc.title,
            type: s.doc.type,
            updatedAt: s.doc.updatedAt,
            nodeCount: (s.doc.nodes || []).length,
          };
        });
        items.reverse();     // 最新的在前
        return reply(200, { chartId: cid, history: items });
      }
      var hit = snaps.filter(function (s) { return s.stamp === stamp; })[0];
      if (!hit) return reply(404, { error: '未找到该版本' });
      return reply(200, { stamp: stamp, doc: clone(hit.doc) });
    }

    // .../reset
    if (parts[1] === 'reset') {
      if (method !== 'POST') return reply(405, { error: '方法不支持' });
      if (!SAMPLE_MAP[cid]) return reply(404, { error: '该图表没有示例底稿，无法重置' });
      backup(cid);
      db = readDb();
      db.charts[cid] = normalize(clone(SAMPLE_MAP[cid]), cid);
      writeDb(db);
      return reply(200, { ok: true, id: cid, chart: db.charts[cid] });
    }

    // .../restore
    if (parts[1] === 'restore') {
      if (method !== 'POST') return reply(405, { error: '方法不支持' });
      var wantStamp = String((body && body.stamp) || '');
      var found = (db.history[cid] || []).filter(function (s) { return s.stamp === wantStamp; })[0];
      if (!found) return reply(404, { error: '未找到该版本' });
      var restored = clone(found.doc);
      backup(cid);                       // 恢复本身也能反悔
      db = readDb();
      restored.id = cid;
      restored.updatedAt = nowIso();
      db.charts[cid] = restored;
      writeDb(db);
      return reply(200, { ok: true, id: cid, chart: restored });
    }

    if (!cid) return reply(400, { error: 'id 不能为空' });

    if (method === 'GET') {
      var d = effective(cid);
      if (!d) return reply(404, { error: '未找到该图表' });
      return reply(200, clone(d));
    }

    if (method === 'PUT') {
      var chart = (body && body.chart && typeof body.chart === 'object') ? body.chart : body;
      if (!chart || typeof chart !== 'object' || !('nodes' in chart)) {
        return reply(400, { error: '缺少 chart 内容' });
      }
      backup(cid);
      db = readDb();
      db.charts[cid] = normalize(clone(chart), cid);
      writeDb(db);
      return reply(200, { ok: true, id: cid, chart: db.charts[cid], updatedAt: db.charts[cid].updatedAt });
    }

    if (method === 'DELETE') {
      var cur = effective(cid);
      if (!cur) return reply(404, { error: '未找到该图表' });
      if (isExample(cur, cid)) {
        return reply(403, { error: '示例图表不可删除；如改过想还原，请用「重置」' });
      }
      backup(cid);
      db = readDb();
      delete db.charts[cid];
      writeDb(db);
      return reply(200, { ok: true });
    }

    return reply(405, { error: '方法不支持' });
  }

  /* ---------------------------------------------------------- 拦截 fetch */
  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var u;
    try { u = new URL(url, location.href); } catch (e) { u = null; }

    if (!u) return origFetch ? origFetch(input, init) : Promise.reject(new Error('bad url'));

    // 兼容发布在子路径下（/xxx/api/charts），不写死根路径
    var idx = u.pathname.indexOf(API);
    if (idx < 0) {
      if (u.pathname.indexOf('/api/health') >= 0) {
        return Promise.resolve(reply(200, { ok: true, mode: 'static-demo' }));
      }
      return origFetch ? origFetch(input, init) : Promise.reject(new Error('no fetch'));
    }

    var rest = u.pathname.slice(idx + API.length);
    var body = {};
    if (init && typeof init.body === 'string' && init.body) {
      try { body = JSON.parse(init.body); } catch (e) { body = {}; }
    }

    try {
      return Promise.resolve(handle(method, rest, body));
    } catch (e) {
      return Promise.resolve(reply(500, { error: '本地存储写入失败：' + (e && e.message) }));
    }
  };

  /* ---------------------------------------------------------- 首次访问的说明 */
  window.__DEMO__ = {
    mode: 'static',
    samples: SAMPLES.length,
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      mem = null;
    },
  };

  function note() {
    // 侧栏底部一行字：说清楚这是演示版、数据存哪
    var foot = document.querySelector('.side-foot');
    if (foot && !document.getElementById('demoNote')) {
      foot.style.flexWrap = 'wrap';     // 让说明换到第二行，不挤「导入 Markdown」
      var n = document.createElement('div');
      n.id = 'demoNote';
      n.style.cssText = [
        'flex:1 1 100%', 'order:1', 'margin-top:2px', 'padding:2px 2px 0',
        'font-size:11px', 'line-height:1.55', 'color:#8a93a6', 'text-align:center',
      ].join(';');
      n.innerHTML = '演示版 · 改动存在本机浏览器<br>换设备打开会看到初始示例';
      foot.appendChild(n);
    }
    // 窄屏提示：手机能看能缩放，但精细拖拽还是桌面端顺手
    if (window.innerWidth <= 820 && !document.getElementById('demoMobile')) {
      var tip = document.createElement('div');
      tip.id = 'demoMobile';
      tip.style.cssText = [
        'position:fixed', 'left:8px', 'right:8px', 'top:52px', 'z-index:80',
        'background:rgba(24,32,48,.94)', 'color:#fff', 'font-size:12px', 'line-height:1.6',
        'padding:8px 34px 8px 12px', 'border-radius:10px', 'box-shadow:0 6px 20px rgba(0,0,0,.2)',
      ].join(';');
      tip.innerHTML = '<b>建议横屏或改用电脑</b>：手机上可以浏览、缩放、改文字，' +
        '拖拽和批量操作在桌面端更顺手。' +
        '<span id="demoMobileX" style="position:absolute;right:10px;top:6px;cursor:pointer;opacity:.7;font-size:14px">✕</span>';
      document.body.appendChild(tip);
      var x = document.getElementById('demoMobileX');
      if (x) x.onclick = function () { tip.remove(); };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(note, 60); });
  } else {
    setTimeout(note, 60);
  }
})();
