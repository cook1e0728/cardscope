// 兔子嚮導（煤炭）的時間軸：每一格用哪張姿勢圖，以及跳到哪裡。
export const HOP = 0.55; // 跳到新位置要幾秒

// 姿勢優先順序：開場 1.6 秒揮手 → 正在跳（cheer，雙手舉起像騰空）→ 字幕開頭說話（有旁白就說到 c.talk 秒，沒有約 1.8 秒；
// c.talkAs==='wave' 用揮手兩格當說話，一邊揮一邊講）→ 這句字幕之後最近一次跳過去時指定的姿勢 → 字幕指定的姿勢 → idle。
// moves：[{t,pose}]，片尾（zh 為 null 的字幕）之後不再換，疊圖在合成時淡出。
export function guideFrames(caps, end, fps, moves = []) {
  const frames = [], n = Math.ceil(end * fps);
  const flip = (t, a, b, every) => (Math.floor(t / every) % 2 ? b : a);
  const latest = (list, t) => { let cur = null; for (const x of list) if (x.t <= t) cur = x; else break; return cur; };
  for (let k = 0; k < n; k++) {
    const t = k / fps, cur = latest(caps, t), mv = latest(moves, t);
    if (cur && !cur.zh) { frames.push(frames[frames.length - 1] || 'idle'); continue; }
    if (mv && t - mv.t < HOP) { frames.push('cheer'); continue; }
    if (cur) {
      const next = caps[caps.indexOf(cur) + 1], talkFor = cur.talk ?? Math.min(1.8, ((next?.t ?? end) - cur.t) * 0.6);
      if (t - cur.t < talkFor) { frames.push(cur.talkAs === 'wave' ? flip(t - cur.t, 'wave-b', 'wave-a', 0.25) : flip(t - cur.t, 'talk-b', 'talk-a', 0.16)); continue; }
    }
    if (t < 1.6) { frames.push(flip(t, 'wave-a', 'wave-b', 0.3)); continue; }
    frames.push((mv && cur && mv.t >= cur.t && mv.pose) || cur?.pose || 'idle');
  }
  return frames;
}

// 揮手、歡呼的連續區段（秒），合成時在這些區段讓兔子小跳
export function hopRanges(frames, fps) {
  const out = [];
  frames.forEach((p, k) => {
    const hop = /^wave|^cheer/.test(p), last = out[out.length - 1];
    if (hop && last && last[1] === k / fps) last[1] = (k + 1) / fps;
    else if (hop) out.push([k / fps, (k + 1) / fps]);
  });
  return out;
}

// 位置的 ffmpeg 運算式（變數 t）：每次移動 HOP 秒內等速移過去，y 另外加一段拋物線弧（arc 像素高）
export function pathExpr(start, moves, key, arc = 0) {
  let expr = String(start[key]), prev = start[key];
  for (const m of moves) {
    const p = `clip((t-${m.t.toFixed(3)})/${HOP},0,1)`;
    const seg = `${prev}+(${m[key] - prev})*${p}` + (arc ? `-sin(PI*${p})*${arc}` : '');
    expr = `if(lt(t,${m.t.toFixed(3)}),${expr},${seg})`;
    prev = m[key];
  }
  return expr;
}
