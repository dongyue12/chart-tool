# 介绍视频（Remotion 版）

用 [Remotion](https://www.remotion.dev) 把 `tools/demo_frames/` 里的关键帧合成为项目介绍视频。

分镜：封面 → 痛点 → AI 对话 → AI 写 JSON → 刷新出图 → 编辑 → 折叠 → 导出 → 结尾。
每个镜头做 Ken Burns 推近（1.00→1.05，右下漂移），镜头间 0.35s 交叉溶解。

## 使用

```bash
cd tools/video-remotion
npm install

# 素材：把截图关键帧放进 public/（帧由 tools/record_demo.js 生成）
cp ../demo_frames/0*.png public/

# 渲染（输出到 docs/项目介绍.mp4）
npx remotion render src/index.ts intro ../../docs/项目介绍.mp4
```

## 说明

- `remotion.config.ts` 指定用本机 Edge 渲染，无需下载 Chrome Headless Shell。
- 改分镜时长/顺序：编辑 `src/scenes.json`。
- 交叉溶解时长：`src/Video.tsx` 里的 `XF`。
