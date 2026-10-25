#!/usr/bin/env bash
# 图表工作台 启动脚本（macOS / Linux）
# 用法: ./start.sh [端口]      默认 8712
set -e
cd "$(dirname "$0")"

PORT="${1:-8712}"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "没找到 Python 3。请先安装：https://www.python.org/downloads/"
  exit 1
fi

echo "使用 $("$PY" --version 2>&1) 启动，端口 $PORT"
echo "如果浏览器没自动打开，手动访问 http://127.0.0.1:$PORT/"

exec "$PY" server.py --port "$PORT" --open
