import React from 'react';
import { Composition } from 'remotion';
import { IntroVideo, SCENES, XF } from './Video';

export const RemotionRoot: React.FC = () => {
  const fps = 25;
  const total =
    Math.round(SCENES.reduce((a, s) => a + s.seconds, 0) * fps) -
    Math.round(XF * fps) * (SCENES.length - 1);
  return (
    <Composition
      id="intro"
      component={IntroVideo}
      durationInFrames={total}
      fps={fps}
      width={1280}
      height={720}
    />
  );
};
