import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import scenes from './scenes.json';

export const SCENES = scenes as { file: string; seconds: number }[];

/** 镜头之间的交叉淡入时长（秒），与旧版 make_video.py 一致 */
export const XF = 0.35;

/** 单个镜头：Ken Burns 推近（1.00 → 1.05，带右下漂移），入场淡入 */
const Scene: React.FC<{ file: string; durFrames: number; fadeIn: boolean }> = ({
  file,
  durFrames,
  fadeIn,
}) => {
  const frame = useCurrentFrame();
  const t = Math.min(1, frame / Math.max(1, durFrames - 1));
  const zoom = 1 + 0.05 * t;
  const ox = 35 + 30 * t; // 漂移的 transform-origin（%）
  const oy = 40 + 25 * t;
  const opacity = fadeIn
    ? interpolate(frame, [0, XF * 25], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={staticFile(file)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${zoom})`,
          transformOrigin: `${ox}% ${oy}%`,
        }}
      />
    </AbsoluteFill>
  );
};

export const IntroVideo: React.FC = () => {
  const fps = 25;
  const xf = Math.round(XF * fps);
  // 第 i 个镜头提前 i 个交叉时长入场，后面的镜头盖在上面淡入 → 交叉溶解
  let acc = 0;
  const starts: number[] = SCENES.map((s) => {
    const st = acc;
    acc += Math.round(s.seconds * fps) - xf;
    return st;
  });
  const durFrames = SCENES.map((s) => Math.round(s.seconds * fps));
  return (
    <AbsoluteFill style={{ backgroundColor: '#080c15' }}>
      {SCENES.map((s, i) => (
        <Sequence
          key={s.file}
          from={starts[i]}
          durationInFrames={durFrames[i]}
        >
          <Scene file={s.file} durFrames={durFrames[i]} fadeIn={i > 0} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
