# -*- coding: utf-8 -*-
"""找一个可用的 Chromium 内核浏览器（Edge / Chrome / Chromium），Python 脚本共用

用法：
    from browser import find_browser
    exe = find_browser()

顺序：环境变量 CHART_TOOL_BROWSER → 各平台常见安装路径 → PATH 里的命令名
换机器 / 装的是 Chrome 而不是 Edge 时，设一下环境变量即可，不用改脚本。
"""
import os
import shutil
import sys

_CANDIDATES = {
    "win32": [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ],
    "darwin": [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    "linux": [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        "/snap/bin/chromium",
    ],
}

_NAMES = ["msedge", "google-chrome", "google-chrome-stable", "chromium",
          "chromium-browser", "microsoft-edge"]

_cached = None


def find_browser():
    global _cached
    if _cached:
        return _cached

    custom = os.environ.get("CHART_TOOL_BROWSER")
    if custom and os.path.exists(custom):
        _cached = custom
        return _cached

    for path in _CANDIDATES.get(sys.platform, []):
        if path and os.path.exists(path):
            _cached = path
            return _cached

    for name in _NAMES:
        hit = shutil.which(name)
        if hit:
            _cached = hit
            return _cached

    raise SystemExit(
        "没找到 Edge / Chrome / Chromium。请先装一个，或设置环境变量 CHART_TOOL_BROWSER "
        "指向浏览器可执行文件，例如：\n"
        '  export CHART_TOOL_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
    )


if __name__ == "__main__":
    print(find_browser())
