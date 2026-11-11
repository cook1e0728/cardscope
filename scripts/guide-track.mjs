// 兔子嚮導的姿勢時間軸：每一格（fps）要用哪張圖。
// 開場揮手 1.6 秒；每句字幕開頭「說話」（嘴巴一開一合，0.16 秒換一次）約 1.8 秒，之後換成該句指定的姿勢（預設 idle）；
// 揮手兩格 0.3 秒換一次。字幕 zh 為 null（片尾）之後不再換，疊圖在合成時淡出。
export function guideFrames(caps, end, fps) {
  const frames = [], n = Math.ceil(end * fps);
  const flip = (t, a, b, every) => (Math.floor(t / every) % 2 ? b : a);
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    let cur = null;
    for (const c of caps) if (c.t <= t) cur = c; else break;
    if (t < 1.6) frames.push(flip(t, 'wave-a', 'wave-b', 0.3));
    else if (!cur || !cur.zh) frames.push(cur ? frames[frames.length - 1] || 'idle' : 'idle');
    else {
      const next = caps[caps.indexOf(cur) + 1], talkFor = Math.min(1.8, ((next?.t ?? end) - cur.t) * 0.6);
      frames.push(t - cur.t < talkFor ? flip(t - cur.t, 'talk-b', 'talk-a', 0.16) : cur.pose || 'idle');
    }
  }
  return frames;
}
