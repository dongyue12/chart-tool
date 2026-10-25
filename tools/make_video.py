# -*- coding: utf-8 -*-
"""把 record_demo.js 截的关键帧合成介绍视频。

每个镜头做轻微的推近（Ken Burns），镜头之间 0.35s 交叉淡入，字幕已经在画面里。
输入：tools/demo_frames/script.json + 同名 png
输出：docs/项目介绍.mp4   （1280×720 / 25fps / H.264）

用法： python tools/make_video.py [输出路径]
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / "tools" / "demo_frames"
TMP = FRAMES / "_seq"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "项目介绍.mp4"
XFADE = 0.35          # 镜头之间的交叉淡入秒数


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    fixed = Path(r"C:\Users\Legion\AppData\Local\Microsoft\WinGet\Packages"
                 r"\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
                 r"\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe")
    return str(fixed) if fixed.exists() else None


def ken(img, t, w, h):
    """t∈[0,1] → 从 1.00 推近到 1.05，并把镜头往右下带一点"""
    z = 1.0 + 0.05 * t
    nw, nh = int(w * z) + 1, int(h * z) + 1
    big = img.resize((nw, nh), Image.LANCZOS)
    ox = int((nw - w) * (0.35 + 0.3 * t))
    oy = int((nh - h) * (0.4 + 0.25 * t))
    return big.crop((ox, oy, ox + w, oy + h))


def main():
    script = json.loads((FRAMES / "script.json").read_text(encoding="utf-8"))
    fps, W, H = script["fps"], script["w"], script["h"]
    scenes = script["scenes"]

    if TMP.exists():
        shutil.rmtree(TMP)
    TMP.mkdir(parents=True)

    imgs = [Image.open(FRAMES / s["file"]).convert("RGB").resize((W, H), Image.LANCZOS)
            for s in scenes]

    n = 0
    prev_tail = None
    for i, s in enumerate(scenes):
        total = max(1, int(round(s["seconds"] * fps)))
        img = imgs[i]
        frames = []
        for k in range(total):
            frames.append(ken(img, k / max(1, total - 1), W, H))
        # 与上一镜的尾巴交叉淡入
        if prev_tail:
            for j, a in enumerate(prev_tail):
                frames[j] = Image.blend(a, frames[j], (j + 1) / (len(prev_tail) + 1))
        prev_tail = frames[-max(1, int(XFADE * fps)):]
        for f in frames:
            f.save(TMP / f"{n:06d}.jpg", quality=90)
            n += 1
        print(f"  {s['file']}  {total} 帧")

    exe = find_ffmpeg()
    if not exe:
        print("找不到 ffmpeg，帧已生成在：", TMP)
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    cmd = [exe, "-y", "-framerate", str(fps), "-i", str(TMP / "%06d.jpg"),
           "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT)]
    print("合成中…")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-800:])
        sys.exit(1)
    shutil.rmtree(TMP, ignore_errors=True)
    dur = sum(s["seconds"] for s in scenes) - XFADE * (len(scenes) - 1)
    print(f"完成：{OUT}  （{len(scenes)} 镜 · 约 {dur:.1f} 秒 · {W}×{H} · {OUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
