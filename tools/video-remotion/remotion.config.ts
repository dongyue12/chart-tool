import { Config } from '@remotion/cli/config';

// 用本机 Edge 渲染，免去 Chrome Headless Shell 下载（网络受限）
Config.setBrowserExecutable('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(90);
Config.setConcurrency(4);
