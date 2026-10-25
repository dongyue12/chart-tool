# -*- coding: utf-8 -*-
"""无头浏览器逐个截图 studio 中每种类型的示例，并用 Pillow 拼成一张大图

用法: python tools/shot_studio.py [宽] [高]     （端口用环境变量 CHART_TOOL_PORT 改，默认 8712）
依赖: pip install pillow
"""
import json, os, subprocess, sys, urllib.parse, urllib.request
from PIL import Image, ImageDraw
from browser import find_browser

BASE = f"http://127.0.0.1:{os.environ.get('CHART_TOOL_PORT', '8712')}"
EDGE = find_browser()
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".shots")
os.makedirs(OUT, exist_ok=True)

width = int(sys.argv[1]) if len(sys.argv) > 1 else 1440
height = int(sys.argv[2]) if len(sys.argv) > 2 else 860

charts = json.load(urllib.request.urlopen(BASE + "/api/charts"))["charts"]
order = ["mindmap", "flow", "arch", "sequence", "state", "class", "er", "fishbone", "timeline", "org", "gantt", "concept"]
charts.sort(key=lambda c: order.index(c["type"]) if c["type"] in order else 99)

shots = []
for c in charts:
    url = BASE + "/studio/?id=" + urllib.parse.quote(c["id"], safe="")
    png = os.path.join(OUT, c["type"] + ".png")
    cmd = [EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
           f"--window-size={width},{height}", f"--screenshot={png}",
           "--virtual-time-budget=6000", url]
    subprocess.run(cmd, capture_output=True, timeout=90)
    if os.path.exists(png):
        shots.append((c["type"], c["title"], png))
        print("shot", c["type"], os.path.getsize(png))
    else:
        print("MISS", c["type"])

# 拼图：3 列 x 4 行
if not shots:
    sys.exit(1)
cols = 3
tw, th = width // 2, height // 2
rows = (len(shots) + cols - 1) // cols
LBL = 26
big = Image.new("RGB", (cols * tw, rows * (th + LBL)), (245, 247, 251))
dr = ImageDraw.Draw(big)
for i, (t, title, p) in enumerate(shots):
    im = Image.open(p).convert("RGB").resize((tw, th))
    x, y = (i % cols) * tw, (i // cols) * (th + LBL)
    big.paste(im, (x, y + LBL))
    dr.rectangle([x, y, x + tw, y + LBL], fill=(30, 41, 59))
    dr.text((x + 8, y + 6), f"{t}  {title}", fill=(255, 255, 255))
big_path = os.path.join(OUT, f"all_{width}.png")
big.save(big_path)
print("BIG", big_path, big.size)
