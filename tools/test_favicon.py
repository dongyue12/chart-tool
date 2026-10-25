# -*- coding: utf-8 -*-
"""图标回归：文件尺寸 / iOS 不透明 / HTML 引用 / HTTP 可访问

用法:
  python tools/test_favicon.py            # 用 8712 上已在跑的服务
  python tools/test_favicon.py 8799       # 指定端口

检查点（前 3 组不需要服务，后 1 组需要）：
  1. 三个图标文件都在，尺寸/模式对：png 64 带透明、180 不透明、ico 16/32/48/64
  2. 16px 用的是简化版（不是把 64 等比缩小），否则小尺寸会糊成一团
  3. index.html 里的 link 标签齐全且指向存在的文件
  4. /studio/favicon.* 各自 200 + 正确 Content-Type，/favicon.ico 302 到 /studio/favicon.ico
"""
import os
import re
import sys
import urllib.error
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STUDIO = os.path.join(ROOT, "studio")
PORT = sys.argv[1] if len(sys.argv) > 1 else "8712"
BASE = "http://127.0.0.1:%s" % PORT

pass_n = fail_n = 0


def ok(name, cond, extra=""):
    global pass_n, fail_n
    if cond:
        pass_n += 1
        print("  PASS  " + name + ("  " + extra if extra else ""))
    else:
        fail_n += 1
        print("  FAIL  " + name + ("  " + extra if extra else ""))


def white_ratio(img):
    """白色笔画占整个图标面积的比例，用来判断「有没有画上去」"""
    px = img.convert("RGBA").load()
    w, h = img.size
    n = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 128 and r > 200 and g > 200 and b > 200:
                n += 1
    return n / float(w * h)


# ---------------------------------------------------------------- 1. 文件与尺寸
print("== 文件与尺寸 ==")
paths = {n: os.path.join(STUDIO, n) for n in
         ("favicon.svg", "favicon.png", "favicon-180.png", "favicon.ico")}
for name, p in paths.items():
    ok(name + " 存在", os.path.exists(p), "%d B" % os.path.getsize(p) if os.path.exists(p) else "缺失")

png64 = Image.open(paths["favicon.png"])
ok("favicon.png 尺寸 64x64", png64.size == (64, 64), str(png64.size))
ok("favicon.png 带透明（圆角）", png64.mode == "RGBA" and png64.getpixel((0, 0))[3] == 0,
   "mode=%s 角落 alpha=%s" % (png64.mode, png64.getpixel((0, 0))[3] if png64.mode == "RGBA" else "n/a"))
ok("favicon.png 有白色笔画", white_ratio(png64) > 0.05, "白占比 %.1f%%" % (white_ratio(png64) * 100))

app = Image.open(paths["favicon-180.png"])
ok("favicon-180 尺寸 180x180", app.size == (180, 180), str(app.size))
ok("favicon-180 不透明（iOS 会自己切圆角）", app.mode == "RGB",
   "mode=%s" % app.mode)

ico = Image.open(paths["favicon.ico"])
sizes = sorted(ico.info.get("sizes", []))
ok("ico 含 16/32/48/64", sizes == [(16, 16), (32, 32), (48, 48), (64, 64)], str(sizes))

# ---------------------------------------------------------------- 2. 16px 简化版
print("== 16px 简化版 ==")
i16 = Image.open(paths["favicon.ico"]).ico.getimage((16, 16))
i32 = Image.open(paths["favicon.ico"]).ico.getimage((32, 32))
ok("16px 不是空白", white_ratio(i16) > 0.10, "白占比 %.1f%%" % (white_ratio(i16) * 100))
# 简化版少一条分支且线更粗 -> 白占比明显高于「全细节等比缩到 16」应有的水平
naive = i32.resize((16, 16), Image.LANCZOS)
ok("16px 比等比缩小更清楚", white_ratio(i16) > white_ratio(naive),
   "简化 %.1f%% vs 等比 %.1f%%" % (white_ratio(i16) * 100, white_ratio(naive) * 100))

# ---------------------------------------------------------------- 3. HTML 引用
print("== index.html 引用 ==")
html = open(os.path.join(STUDIO, "index.html"), encoding="utf-8").read()
for rel, href in (("icon", "/studio/favicon.svg"),
                  ("icon", "/studio/favicon.png"),
                  ("shortcut icon", "/studio/favicon.ico"),
                  ("apple-touch-icon", "/studio/favicon-180.png")):
    pat = r'<link[^>]+rel="%s"[^>]*href="%s"' % (re.escape(rel), re.escape(href))
    ok('%s -> %s' % (rel, os.path.basename(href)), re.search(pat, html) is not None)
ok("theme-color 已设置", '<meta name="theme-color"' in html)
ok("svg 排在 png 前（现代浏览器优先矢量）",
   html.index("favicon.svg") < html.index('href="/studio/favicon.png"'))


# ---------------------------------------------------------------- 4. HTTP
def fetch(path):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    op = urllib.request.build_opener(NoRedirect)
    try:
        r = op.open(BASE + path)
        return r.status, r.headers.get("Content-Type", ""), r.headers.get("Location", "")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.headers.get("Location", "")
    except Exception as e:                                  # 服务没起
        return 0, str(e), ""


print("== HTTP（%s）==" % BASE)
probe, _t, _l = fetch("/api/health")
if probe != 200:
    fail_n += 1
    print("  FAIL  服务未就绪（%s）—— 先跑 python server.py 再测" % BASE)
else:
    for path, want in (("/studio/favicon.svg", "image/svg+xml"),
                       ("/studio/favicon.png", "image/png"),
                       ("/studio/favicon-180.png", "image/png"),
                       ("/studio/favicon.ico", "image/x-icon")):
        code, ctype, _loc = fetch(path)
        ok(path + " 200", code == 200, str(code))
        ok(path + " Content-Type", ctype.split(";")[0].strip() == want, ctype or "空")
    code, _t, loc = fetch("/favicon.ico")
    ok("/favicon.ico 302 到 studio", code == 302 and loc.endswith("/studio/favicon.ico"),
       "%s -> %s" % (code, loc or "无"))

print("\n结果：%d 通过 / %d 失败" % (pass_n, fail_n))
sys.exit(1 if fail_n else 0)
