# -*- coding: utf-8 -*-
"""
build_site.py —— 把工作台打包成「纯静态、可直接发布」的站点

做的事：
  1. 复制 studio/ 的 5 个前端文件到 site/
  2. 把 index.html 里的绝对路径 /studio/xxx 改成相对路径 xxx
  3. 注入两个脚本：data/samples.js（12 张示例） + api-shim.js（用 localStorage 顶替后端）
  4. 只带 id 以「示例」开头的图，个人图表、历史快照、图片数据一律不带

用法：
  python tools/build_site.py           # 生成到 site/
  python tools/build_site.py --out dist

之后用任意静态服务器打开 site/index.html 即可，或用 WorkBuddy「发布为网站」。
"""
import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STUDIO = ROOT / "studio"
CHARTS = ROOT / "charts"
WEB = ROOT / "web"

# 前端需要的文件（index.html 单独处理）
ASSETS = ["styles.css", "kinds.js", "app.js", "favicon.svg", "favicon.png",
          "favicon.ico", "favicon-180.png"]


def collect_samples():
    """只要示例图：文件名以「示例」开头，或 meta.example 为真"""
    out = []
    for p in sorted(CHARTS.glob("*.chart.json")):
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            print(f"  跳过（读不出来）{p.name}: {exc}")
            continue
        cid = doc.get("id") or p.name[: -len(".chart.json")]
        if not (str(cid).startswith("示例") or (doc.get("meta") or {}).get("example")):
            continue
        doc["id"] = cid
        doc.setdefault("title", cid)
        doc.setdefault("type", "mindmap")
        doc.setdefault("nodes", [])
        doc.setdefault("links", [])
        meta = doc.get("meta")
        doc["meta"] = dict(meta) if isinstance(meta, dict) else {}
        doc["meta"]["example"] = True
        out.append(doc)
    return out


def render_html(sample_count):
    src = (STUDIO / "index.html").read_text(encoding="utf-8")

    # /studio/xxx -> ./xxx （发布后可能挂在子路径，必须用相对引用）
    html = src.replace('"/studio/', '"./')

    html = html.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="description" content="图表工作台：一份内容，12 种画法。'
        '思维导图 / 流程图 / 架构图 / 时序图 / 状态图 / 类图 / ER 图 / 鱼骨图 / 时间线 / '
        '组织结构图 / 甘特图 / 概念图，任意两种一键互转。">',
    )

    # 顺序要紧：示例数据 -> 适配层 -> 类型库 -> 编辑引擎
    inject = (
        '<script src="./data/samples.js"></script>\n'
        '<script src="./api-shim.js"></script>\n'
        '<script src="./kinds.js"></script>'
    )
    if '<script src="./kinds.js"></script>' not in html:
        raise SystemExit("index.html 结构和预期不一致：找不到 kinds.js 的 script 标签")
    html = html.replace('<script src="./kinds.js"></script>', inject, 1)

    if sample_count == 0:
        raise SystemExit("没有找到任何示例图，打包中止")

    return html


def main():
    ap = argparse.ArgumentParser(description="打包静态演示版")
    ap.add_argument("--out", default="site", help="输出目录（默认 site/）")
    args = ap.parse_args()

    out = (ROOT / args.out).resolve()

    # 守卫：只清理我们自己生成的目录，避免手滑删掉别的东西
    if out.exists():
        if not (out / ".built.json").exists():
            raise SystemExit(
                f"输出目录已存在且不是本脚本生成的：{out}\n"
                f"确认可以覆盖后，手动删掉它再重跑。"
            )
        shutil.rmtree(out)

    samples = collect_samples()
    (out / "data").mkdir(parents=True, exist_ok=True)

    # 1) 前端资源
    missing = []
    for name in ASSETS:
        s = STUDIO / name
        if s.exists():
            shutil.copy2(s, out / name)
        else:
            missing.append(name)

    # 2) 首页
    (out / "index.html").write_text(render_html(len(samples)), encoding="utf-8")

    # 3) 适配层
    shutil.copy2(WEB / "api-shim.js", out / "api-shim.js")

    # 4) 示例数据（一行一个，方便 diff；体积很小）
    lines = [json.dumps(d, ensure_ascii=False, separators=(",", ":")) for d in samples]
    js = "window.__CHART_SAMPLES__ = [\n" + ",\n".join(lines) + "\n];\n"
    (out / "data" / "samples.js").write_text(js, encoding="utf-8")

    # 5) 标记 + 清单
    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    (out / ".built.json").write_text(json.dumps({
        "builtAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "samples": [d["id"] for d in samples],
        "files": sum(1 for f in out.rglob("*") if f.is_file()),
        "bytes": total,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"输出目录 : {out}")
    print(f"示例图表 : {len(samples)} 张")
    for d in samples:
        print(f"   - {d['type']:<9} {d['id']}")
    print(f"文件数   : {sum(1 for f in out.rglob('*') if f.is_file())}")
    print(f"总体积   : {total / 1024:.0f} KB")
    if missing:
        print("缺资源   : " + ", ".join(missing))
    if not re.search(r'id="chartList"', (out / "index.html").read_text(encoding="utf-8")):
        print("警告     : 打包后的 index.html 里找不到 chartList，可能页面结构不对")
    print("\n本地预览： python -m http.server 8899 --directory site")


if __name__ == "__main__":
    sys.exit(main())
