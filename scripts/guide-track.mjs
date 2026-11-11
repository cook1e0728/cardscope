// 兔子嚮導（煤炭）的時間軸：每一格用哪張姿勢圖、跳到哪裡、面向哪邊。

// 從 a 跳到 b：像真兔子一樣沿地面一蹬一蹬（每跳約 step 像素、hopDur 秒）
export function travel(a, b, { step = 220, hopDur = 0.28 } = {}) {
  const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return { n, dur: +(n * hopDur).toFixed(3) };
}

// 一跳四格：蹲 → 後腳蹬 → 騰空 → 落地
export function hopFrame(frac) {
  return frac < 0.15 ? 'hop-1' : frac < 0.35 ? 'hop-2' : frac < 0.75 ? 'hop-3' : 'hop-4';
}

const latest = (list, t) => { let cur = null; for (const x of list) if (x.t <= t) cur = x; else break; return cur; };

// 姿勢優先順序：片尾停住 → 正在跳（四格循環）→ 字幕開頭說話（有旁白就說到 c.talk 秒，沒有約 1.8 秒；
// c.talkAs==='wave' 用揮手兩格當說話）→ 開場 1.6 秒揮手 → 這句字幕之後最近一次跳過去時指定的姿勢 → 字幕指定的姿勢 → idle。
// moves：[{t,dur,n,pose}]
export function guideFrames(caps, end, fps, moves = []) {
  const frames = [], count = Math.ceil(end * fps);
  const flip = (t, a, b, every) => (Math.floor(t / every) % 2 ? b : a);
  for (let k = 0; k < count; k++) {
    const t = k / fps, cur = latest(caps, t), mv = latest(moves, t);
    if (cur && !cur.zh) { frames.push(frames[frames.length - 1] || 'idle'); continue; }
    if (mv && t - mv.t < mv.dur) { frames.push(hopFrame(((t - mv.t) / mv.dur * mv.n) % 1)); continue; }
    if (cur) {
      const next = caps[caps.indexOf(cur) + 1], talkFor = cur.talk ?? Math.min(1.8, ((next?.t ?? end) - cur.t) * 0.6);
      if (t - cur.t < talkFor) { frames.push(cur.talkAs === 'wave' ? flip(t - cur.t, 'wave-b', 'wave-a', 0.25) : flip(t - cur.t, 'talk-b', 'talk-a', 0.16)); continue; }
    }
    if (t < 1.6) { frames.push(flip(t, 'wave-a', 'wave-b', 0.3)); continue; }
    frames.push((mv && cur && mv.t >= cur.t && mv.pose) || cur?.pose || 'idle');
  }
  return frames;
}

// 每格面向：跳的途中朝前進方向，落地後用該次指定的 face（1 右、-1 左）
export function guideFacing(moves, start, end, fps) {
  const out = [], count = Math.ceil(end * fps);
  for (let k = 0; k < count; k++) {
    const t = k / fps, i = moves.findLastIndex(m => m.t <= t), mv = moves[i];
    if (!mv) { out.push(start.face); continue; }
    const from = i ? moves[i - 1] : start;
    out.push(t - mv.t < mv.dur && mv.x !== from.x ? Math.sign(mv.x - from.x) : mv.face);
  }
  return out;
}

// 揮手、歡呼的連續區段（秒），合成時在這些區段讓兔子原地小跳
export function hopRanges(frames, fps) {
  const out = [];
  frames.forEach((p, k) => {
    const hop = /^wave|^cheer/.test(p), last = out[out.length - 1];
    if (hop && last && last[1] === k / fps) last[1] = (k + 1) / fps;
    else if (hop) out.push([k / fps, (k + 1) / fps]);
  });
  return out;
}

// 位置的 ffmpeg 運算式（變數 t）：每次移動在 dur 秒內等速移過去；y 另外加 n 段小弧（每跳 arc 像素高）
export function pathExpr(start, moves, key, arc = 0) {
  let expr = String(start[key]), prev = start[key];
  for (const m of moves) {
    const p = `clip((t-${m.t.toFixed(3)})/${m.dur},0,1)`;
    const seg = `${prev}+(${m[key] - prev})*${p}` + (arc ? `-abs(sin(PI*${p}*${m.n}))*${arc}` : '');
    expr = `if(lt(t,${m.t.toFixed(3)}),${expr},${seg})`;
    prev = m[key];
  }
  return expr;
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// 落點：試幾個靠近目標的位置，選第一個不擋到「目標、字幕、游標」的；都會擋到就選擋最少的。
// target、avoid 都是輸出畫面座標 {x,y,w,h}；回傳 {x,y,face}（兔子正方形圖的左上角，face 面向目標）
export function placeGuide(target, size, { side = 'left', frame, avoid = [] }) {
  const T = target, S = size, pad = 16, feet = T.y + T.h - S * 0.97, topY = T.y - S * 0.05;
  const L = T.x - S * 0.85 - pad, R = T.x + T.w - S * 0.15 + pad;
  const sides = side === 'right' ? [R, L] : [L, R];
  const cands = [[sides[0], feet], [sides[1], feet], [sides[0], topY], [sides[1], topY], [T.x, T.y + T.h + pad - S * 0.05], [T.x, T.y - S * 0.97 - pad]];
  const blocks = [{ x: T.x - pad, y: T.y - pad, w: T.w + 2 * pad, h: T.h + 2 * pad }, ...avoid];
  let best = null;
  for (const [cx, cy] of cands) {
    const x = Math.round(Math.max(frame.x, Math.min(frame.x + frame.w - S, cx))), y = Math.round(Math.max(frame.y, Math.min(frame.y + frame.h - S, cy)));
    const body = { x: x + S * 0.15, y: y + S * 0.05, w: S * 0.7, h: S * 0.92 }; // 圖的四周有留白，只算身體
    const hit = blocks.reduce((s, b) => s + overlap(body, b), 0);
    if (!best || hit < best.hit) best = { x, y, hit };
    if (!hit) break;
  }
  return { x: best.x, y: best.y, face: best.x + S / 2 < T.x + T.w / 2 ? 1 : -1 };
}
