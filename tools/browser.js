/* 找一个可用的 Chromium 内核浏览器（Edge / Chrome / Chromium），测试与截图脚本共用
 *
 * 用法：
 *   const { findBrowser } = require('./browser');
 *   spawn(findBrowser(), ['--headless=new', ...])
 *
 * 顺序：环境变量 CHART_TOOL_BROWSER → 各平台常见安装路径 → PATH 里的命令名
 * 换机器 / 装的是 Chrome 而不是 Edge 时，只要设一下环境变量即可，不用改脚本。
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const CANDIDATES = {
  win32: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/snap/bin/chromium',
  ],
};

const NAMES = ['msedge', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

function expand(p) {
  return p.replace(/%([A-Za-z_]+)%/g, (_, k) => process.env[k] || '');
}

function fromPath() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  for (const name of NAMES) {
    try {
      const out = execFileSync(which, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const hit = out.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s));
      if (hit) return hit;
    } catch (e) {
      /* 没这个命令，继续找下一个 */
    }
  }
  return null;
}

let cached = null;

function findBrowser() {
  if (cached) return cached;
  const custom = process.env.CHART_TOOL_BROWSER;
  if (custom && fs.existsSync(custom)) return (cached = custom);
  for (const p of CANDIDATES[process.platform] || []) {
    const f = expand(p);
    if (f && fs.existsSync(f)) return (cached = f);
  }
  const hit = fromPath();
  if (hit) return (cached = hit);
  throw new Error(
    '没找到 Edge / Chrome / Chromium。请先装一个，或设置环境变量 CHART_TOOL_BROWSER 指向浏览器可执行文件，' +
      '例如：CHART_TOOL_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
  );
}

module.exports = { findBrowser };
