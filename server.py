# -*- coding: utf-8 -*-
"""
WorkBuddy 图表工作台 —— 本地服务
  * 静态托管 studio/ 前端（12 种图表：思维导图 / 流程图 / 架构图 / 时序图 ...）
  * REST API 读写 charts/*.chart.json（WorkBuddy 可以直接读写同一批文件）
  * 每次保存自动留一份历史快照到 charts/.history/
  * 旧版单页（/classic/、/diagram/）已下线，访问会跳到工作台

启动：  python server.py            默认 http://127.0.0.1:8712
        python server.py --port 9000 --open
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
CST = timezone(timedelta(hours=8))


def now_iso():
    """本地时间（东八区）ISO 字符串"""
    return datetime.now(CST).isoformat(timespec="seconds")


def uid(prefix="c"):
    return prefix + uuid.uuid4().hex[:8]

STUDIO_STATIC = ROOT / "studio"          # 统一图表工作台（唯一前端）
CHARTS_DIR = ROOT / "charts"             # 统一图表（12 种）存储目录
CHARTS_HISTORY = CHARTS_DIR / ".history"
CHARTS_SAMPLES = CHARTS_DIR / ".samples"     # 示例图表的初始底稿（用于一键重置）
MAX_HISTORY = 30
CHART_SUFFIX = ".chart.json"
STAMP_RE = re.compile(r"^\d{8}-\d{6}(-\d{3})?$")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def safe_id(raw):
    """把用户给的 id 收敛成安全文件名"""
    name = unquote(raw or "").strip()
    bad = '<>:"/\\|?*'
    for ch in bad:
        name = name.replace(ch, "_")
    name = name.strip(" .")
    return name[:120]


# ---------------------------------------------------------------- 统一图表(charts)
# 12 种图表共用一套文档格式：{id,type,title,theme,nodes:[],links:[],meta:{}}
# 类型差异全部在前端 studio/kinds.js 里解释，后端只做存储 + 历史快照。

def chart_path(cid):
    return CHARTS_DIR / f"{cid}{CHART_SUFFIX}"


def sample_path(cid):
    return CHARTS_SAMPLES / f"{cid}{CHART_SUFFIX}"


def is_example_doc(doc, cid=""):
    """是否示例图表：meta.example 为真，或 id 以「示例」开头（兼容旧数据）"""
    if isinstance(doc, dict) and (doc.get("meta") or {}).get("example"):
        return True
    return (cid or (doc or {}).get("id") or "").startswith("示例")


def maybe_seed_sample(cid, doc):
    """示例图表首次保存时留一份底稿；之后用户再怎么改都不覆盖，供「重置」用"""
    if not is_example_doc(doc, cid):
        return
    CHARTS_SAMPLES.mkdir(parents=True, exist_ok=True)
    p = sample_path(cid)
    if not p.exists():
        p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def read_chart(p):
    return json.loads(p.read_text(encoding="utf-8"))


def write_chart(cid, doc):
    """原子写入：先写临时文件再替换，避免列表接口读到写了一半的 JSON"""
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    p = chart_path(cid)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)
    return p


def list_charts():
    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    # 按 mtime 倒序；stat 失败（文件正好被删/占用）就当 0，不要因为一个文件把整个列表打挂
    def mtime(f):
        try:
            return f.stat().st_mtime
        except OSError:
            return 0
    for p in sorted(CHARTS_DIR.glob(f"*{CHART_SUFFIX}"), key=mtime, reverse=True):
        try:
            d = read_chart(p)
        except Exception:
            continue
        items.append({
            "id": d.get("id") or p.name[: -len(CHART_SUFFIX)],
            "title": d.get("title") or "未命名图表",
            "type": d.get("type") or "mindmap",
            "theme": d.get("theme"),
            "updatedAt": d.get("updatedAt"),
            "nodeCount": len(d.get("nodes") or []),
            "linkCount": len(d.get("links") or []),
            # 示例标记：优先读 meta.example，兼容按文件名前缀判断
            "example": bool((d.get("meta") or {}).get("example"))
                or (d.get("id") or p.name[: -len(CHART_SUFFIX)]).startswith("示例"),
        })
    return items


def chart_snapshots(cid):
    d = CHARTS_HISTORY / safe_id(cid)
    if not d.exists():
        return []
    out = []
    for p in d.iterdir():
        stamp = p.stem
        if p.suffix == ".json" and STAMP_RE.match(stamp):
            out.append((stamp, p))
    out.sort()
    return out


def chart_backup(cid):
    """保存前留一份快照；内容与上一份完全相同则跳过。"""
    src = chart_path(cid)
    if not src.exists():
        return
    d = CHARTS_HISTORY / safe_id(cid)
    d.mkdir(parents=True, exist_ok=True)
    raw = src.read_bytes()
    snaps = chart_snapshots(cid)
    if snaps and snaps[-1][1].read_bytes() == raw:
        return
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dst = d / f"{stamp}.json"
    k = 1
    while dst.exists():
        dst = d / f"{stamp}-{k:03d}.json"
        k += 1
    dst.write_bytes(raw)
    for _, p in chart_snapshots(cid)[:-MAX_HISTORY]:
        try:
            p.unlink()
        except Exception:
            pass


def chart_stamp_item(stamp, path):
    try:
        d = read_chart(path)
    except Exception:
        return None
    return {
        "stamp": stamp,
        "title": d.get("title"),
        "type": d.get("type"),
        "updatedAt": d.get("updatedAt"),
        "nodeCount": len(d.get("nodes") or []),
    }


def unique_chart_id(title, ctype):
    base = safe_id(title) or uid("c")
    cid, p, n = base, chart_path(base), 1
    while p.exists():
        cid = f"{base}-{n}"
        p = chart_path(cid)
        n += 1
    return cid


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def handle_one_request(self):
        """兜底：接口里出任何异常都回 500 JSON，而不是直接关掉连接（客户端只会看到 socket closed）"""
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001
            try:
                traceback.print_exc()
                self._send(500, {"error": "服务器内部错误：" + str(exc)})
            except Exception:
                self.close_connection = True

    # ------------------------------------------------------------ utils
    def _send(self, code, payload=None, ctype="application/json; charset=utf-8"):
        if payload is None:
            body = b""
        elif isinstance(payload, (bytes, bytearray)):
            body = bytes(payload)
        else:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def handle_one_request(self):
        # 浏览器/客户端断开 keep-alive 连接时不打印堆栈
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def log_message(self, fmt, *args):  # 静音默认日志，只留关键行
        if os.environ.get("MM_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        path = u.path

        if path == "/api/health":
            return self._send(200, {"ok": True, "mode": "server", "root": str(ROOT)})

        # ---------------- 统一图表（12 种）
        if path == "/api/charts":
            return self._send(200, {"charts": list_charts()})

        if path.startswith("/api/charts/"):
            rest = path[len("/api/charts/"):]
            if "/history" in rest:
                cid, _, tail = rest.partition("/history")
                cid = safe_id(cid)
                stamp = tail.strip("/")
                if not stamp:
                    items = [it for it in (chart_stamp_item(s, p) for s, p in chart_snapshots(cid)) if it]
                    items.reverse()
                    return self._send(200, {"chartId": cid, "history": items})
                if not STAMP_RE.match(stamp):
                    return self._send(400, {"error": "非法的版本号"})
                for s, p in chart_snapshots(cid):
                    if s == stamp:
                        return self._send(200, {"stamp": s, "doc": read_chart(p)})
                return self._send(404, {"error": "未找到该版本"})
            cid = safe_id(rest)
            p = chart_path(cid)
            if not p.exists():
                return self._send(404, {"error": "未找到该图表"})
            return self._send(200, read_chart(p))

        # 静态资源
        rel = path.lstrip("/")
        if rel in ("", "index.html", "studio", "classic", "classic/", "diagram", "diagram/"):
            # 必须带尾斜杠跳转，否则页面内的相对资源会落到旧目录上
            self.send_response(302)
            self.send_header("Location", "/studio/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if rel in ("studio/",):
            target = STUDIO_STATIC / "index.html"      # 默认主页：统一图表工作台
        else:
            target = ROOT / rel
            if not target.exists():
                return self._send(404, {"error": "not found"})
            target = target.resolve()
            if not str(target).startswith(str(ROOT)):
                return self._send(403, {"error": "forbidden"})
        if not target.exists():
            return self._send(404, {"error": "not found"})
        data = target.read_bytes()
        return self._send(200, data, MIME.get(target.suffix, "application/octet-stream"))

    # ------------------------------------------------------------ POST / PUT
    def do_POST(self):
        u = urlparse(self.path)
        path = u.path
        body = self._body()

        # ---------------- 统一图表：新建 / 恢复版本
        if path == "/api/charts":
            title = (body.get("title") or "未命名图表").strip()
            ctype = str(body.get("type") or "mindmap")
            doc = body.get("doc")
            cid = safe_id(body.get("id") or "") or unique_chart_id(title, ctype)
            if not isinstance(doc, dict):
                # 兼容把 nodes/links 直接放在请求顶层的调用方
                doc = {k: body[k] for k in ("nodes", "links", "meta") if isinstance(body.get(k), (list, dict))}
                if not doc:
                    doc = {"nodes": [], "links": [], "meta": {}}
            doc["id"] = cid
            doc["title"] = title
            doc["type"] = ctype
            doc["schema"] = doc.get("schema") or "workbuddy-chart/v1"
            doc["theme"] = doc.get("theme") or "classic"
            doc["createdAt"] = doc.get("createdAt") or now_iso()
            doc["updatedAt"] = now_iso()
            doc["nodes"] = doc.get("nodes") or []
            doc["links"] = doc.get("links") or []
            doc["meta"] = doc.get("meta") or {}
            CHARTS_DIR.mkdir(parents=True, exist_ok=True)
            write_chart(cid, doc)
            maybe_seed_sample(cid, doc)
            return self._send(200, {"id": cid, "chart": doc})

        # ---------------- 统一图表：重置示例到底稿（当前版本先留历史，可反悔）
        if path.startswith("/api/charts/") and path.endswith("/reset"):
            cid = safe_id(path[len("/api/charts/"):-len("/reset")])
            sp = sample_path(cid)
            if not sp.exists():
                return self._send(404, {"error": "该图表没有示例底稿，无法重置"})
            chart_backup(cid)
            doc = read_chart(sp)
            doc["id"] = cid
            doc["updatedAt"] = now_iso()
            write_chart(cid, doc)
            return self._send(200, {"ok": True, "id": cid, "chart": doc})

        if path.startswith("/api/charts/") and path.endswith("/restore"):
            cid = safe_id(path[len("/api/charts/"):-len("/restore")])
            stamp = str(body.get("stamp") or "")
            if not STAMP_RE.match(stamp):
                return self._send(400, {"error": "非法的版本号"})
            hit = None
            for s, p in chart_snapshots(cid):
                if s == stamp:
                    hit = p
                    break
            if hit is None:
                return self._send(404, {"error": "未找到该版本"})
            doc = read_chart(hit)
            chart_backup(cid)
            doc["id"] = cid
            doc["updatedAt"] = now_iso()
            write_chart(cid, doc)
            return self._send(200, {"ok": True, "id": cid, "chart": doc})

        return self._send(404, {"error": "not found"})

    def do_PUT(self):
        u = urlparse(self.path)
        path = u.path
        body = self._body()

        # ---------------- 统一图表：保存（自动留快照）
        if path.startswith("/api/charts/"):
            cid = safe_id(path[len("/api/charts/"):])
            if not cid:
                return self._send(400, {"error": "id 不能为空"})
            doc = body.get("chart") if isinstance(body.get("chart"), dict) else body
            if not isinstance(doc, dict) or "nodes" not in doc:
                return self._send(400, {"error": "缺少 chart 内容"})
            chart_backup(cid)
            doc["id"] = cid
            doc["title"] = (doc.get("title") or cid).strip() or cid
            doc["type"] = doc.get("type") or "mindmap"
            doc["schema"] = "workbuddy-chart/v1"
            doc["updatedAt"] = now_iso()
            CHARTS_DIR.mkdir(parents=True, exist_ok=True)
            write_chart(cid, doc)
            maybe_seed_sample(cid, doc)
            return self._send(200, {"ok": True, "id": cid, "chart": doc, "updatedAt": doc["updatedAt"]})

        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/charts/"):
            cid = safe_id(path[len("/api/charts/"):])
            p = chart_path(cid)
            if not p.exists():
                return self._send(404, {"error": "未找到该图表"})
            try:
                if is_example_doc(read_chart(p), cid):
                    return self._send(403, {"error": "示例图表不可删除；如改过想还原，请用「重置」"})
            except Exception:
                pass
            chart_backup(cid)
            p.unlink()
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser(description="WorkBuddy 思维导图本地服务")
    ap.add_argument("--port", type=int, default=int(os.environ.get("MM_PORT", 8712)))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = ap.parse_args()

    CHARTS_DIR.mkdir(parents=True, exist_ok=True)
    url = f"http://{args.host}:{args.port}/"
    print("=" * 56)
    print("  WorkBuddy 图表工作台（12 种图表）")
    print(f"  打开: {url}")
    print(f"  数据目录: {CHARTS_DIR}")
    print("  退出: Ctrl+C")
    print("=" * 56)
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已停止")
