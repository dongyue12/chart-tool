# -*- coding: utf-8 -*-
"""生成工作台图标（浏览器标签 / Windows 标题栏 / iOS 主屏）

用法: python tools/make_favicon.py      需要 pip install pillow

产出（全部进仓库，日常改界面不用重跑；只有改配色或换图形时才需要重跑）：
  studio/favicon.png      64   常规标签页（透明圆角；支持 SVG 的浏览器优先用 SVG）
  studio/favicon-180.png  180  iOS 主屏图标（**不透明、不留圆角**，圆角交给系统切，
                              否则透明处会被 iOS 填成黑色）
  studio/favicon.ico      16/32/48/64  Windows 标签页与标题栏

两个要点：
1. **8 倍超采样再缩**，细线不糊；圆角也用同尺寸 mask，边缘不发毛。
2. 16px 用**简化版**（少一条分支、线更粗、间距更大）。全细节版缩到 16px 时，
   分支之间的白缝不到 1px，会糊成一团 —— 小尺寸不能等比硬缩，要单独调。
改配色时只动下面三个颜色，SVG 版本（studio/favicon.svg）记得同步。
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "studio")

BG_TOP = (75, 123, 246)      # #4b7bf6，与界面 --accent 同色系
BG_BOTTOM = (47, 87, 204)    # #2f57cc
INK = (255, 255, 255)
SS = 8                       # 超采样倍数

# Pillow 9.1 起 LANCZOS 挪到 Image.Resampling，10 起旧名字会去掉
LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS", 1)

# 完整版：基于 32 视图（= favicon.svg 的 viewBox），主干 + 三条分支 + 左侧中心主题
FULL = dict(
    grid=32,
    lines=[
        [(13, 7.5), (13, 24.5)],
        [(13, 11.5), (21, 11.5)],
        [(13, 16), (24, 16)],
        [(13, 20.5), (22, 20.5)],
        [(8, 16), (13, 16)],
    ],
    stroke=2.75,
    radius=7,
)

# 简化版：基于 16 视图（16px 标签页专用）。两条分支、间距 5、线宽 2.2，
# 缩到 16px 后白缝仍有约 2.8px，不会糊。
SMALL = dict(
    grid=16,
    lines=[
        [(6, 3.5), (6, 12.5)],
        [(6, 5.5), (12, 5.5)],
        [(6, 10.5), (13, 10.5)],
    ],
    stroke=2.2,
    radius=3.5,
)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size, spec=FULL, rounded=True):
    """按 32（或 16）视图画，超采样到 size*SS 再缩；rounded=False 得到满幅方形图标"""
    k = size * SS / spec["grid"]                     # 视图单位 -> 超采样像素
    S = size * SS
    img = Image.new("RGB", (S, S), BG_TOP)
    d = ImageDraw.Draw(img)
    for y in range(S):                               # 竖向渐变
        d.line([(0, y), (S, y)], fill=lerp(BG_TOP, BG_BOTTOM, y / (S - 1)))
    for a, b in spec["lines"]:                        # 白色树枝，端点补圆头
        p = (a[0] * k, a[1] * k)
        q = (b[0] * k, b[1] * k)
        w = spec["stroke"] * k
        d.line([p, q], fill=INK, width=round(w))
        for x, y in (p, q):
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=INK)

    img = img.resize((size, size), LANCZOS)
    if not rounded:
        return img
    mask = Image.new("L", (S, S), 0)                  # 圆角 mask 同尺寸超采样
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=spec["radius"] * k, fill=255)
    img = img.convert("RGBA")
    img.putalpha(mask.resize((size, size), LANCZOS))
    return img


def main():
    render(64).save(os.path.join(OUT, "favicon.png"))                       # 标签页
    render(180, rounded=False).save(os.path.join(OUT, "favicon-180.png"))   # iOS 主屏
    # ICO 里每个尺寸单独给图：16 用简化版，其余用完整版（Pillow 的 append_images 按尺寸对号入座）
    render(64).save(os.path.join(OUT, "favicon.ico"),
                    sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
                    append_images=[render(16, SMALL), render(32), render(48)])
    print("已生成 studio/favicon.png (64) / favicon-180.png (180) / favicon.ico (16 简化 + 32/48/64)")


if __name__ == "__main__":
    main()
