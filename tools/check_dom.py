# -*- coding: utf-8 -*-
"""无头浏览器检查：节点/连线是否真的渲染、工具栏在各宽度下是否收拢"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request
from browser import find_browser

PORT = sys.argv[1] if len(sys.argv) > 1 else "8712"
BASE = f"http://127.0.0.1:{PORT}"
EDGE = find_browser()

charts = json.load(urllib.request.urlopen(BASE + "/api/charts"))["charts"]
by_type = {c["type"]: c for c in charts}

def dump(url, w, h):
    r = subprocess.run([EDGE, "--headless=new", "--disable-gpu", f"--window-size={w},{h}",
                        "--virtual-time-budget=6000", "--dump-dom", url],
                       capture_output=True, timeout=90)
    return r.stdout.decode("utf-8", "ignore")

print("== 渲染断言（1440x860）==")
for t, c in by_type.items():
    url = BASE + "/studio/?id=" + urllib.parse.quote(c["id"], safe="")
    dom = dump(url, 1440, 860)
    nodes = len(re.findall(r'class="node[ "]', dom))
    links = len(re.findall(r'class="link[ "]', dom))
    ok = nodes and (t in ("timeline", "gantt") or links >= 0)
    print(f"  {t:9} node={nodes:2} link={links:2} {'OK' if ok else 'EMPTY'}")
    if not ok:
        print("    !! 渲染为空")

print("== 工具栏收拢 ==")
sample = by_type["mindmap"]
url = BASE + "/studio/?id=" + urllib.parse.quote(sample["id"], safe="")
for w in (1440, 1280, 1180, 1024, 900):
    dom = dump(url, w, 860)
    hidden = len(re.findall(r'fit-hidden', dom))
    print(f"  {w}px  收拢 {hidden} 项")
