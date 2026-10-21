// 預覽方向 B 的動態：只在 ?look=motion 時載入。三道閘門：prefers-reduced-motion、桌面懸停（hover+fine）、使用者的「暫停動態」開關。
(() => {
  const root = document.documentElement, host = document.getElementById('cards');
  if (!root.classList.contains('look-motion') || !host) return;
  const KEY = 'cardscope-motion-paused', STAGGER = 30, MAX_STAGGER = 11, FADE = 260;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)'), hoverMQ = matchMedia('(hover: hover) and (pointer: fine)');
  let paused = false;
  try { paused = localStorage.getItem(KEY) === '1'; } catch {}
  const animating = () => !paused && !reduceMQ.matches;

  // ---- 卡片格依序淡入 ----
  // seen：目前這批結果已出現過的卡 id，載入更多／換篩選／換顯示模式時重繪整個格子，已出現的卡不再動畫。
  const seen = new Set();
  const idOf = card => card.querySelector('[data-card-open]')?.dataset.cardOpen || card.getAttribute('onclick') || '';
  const strip = card => { card.classList.remove('cs-pre', 'cs-in'); card.style.removeProperty('--cs-d'); };
  const io = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => (a.target.compareDocumentPosition(b.target) & 4 ? -1 : 1));
    visible.forEach((entry, i) => {
      const card = entry.target, delay = Math.min(i, MAX_STAGGER) * STAGGER;
      io.unobserve(card);
      if (!card.isConnected || !card.classList.contains('cs-pre')) return;
      card.style.setProperty('--cs-d', delay + 'ms');
      card.classList.replace('cs-pre', 'cs-in');
      // 動畫結束後拿掉類名，will-change 與延遲不殘留
      setTimeout(() => strip(card), delay + FADE + 60);
    });
  }, { rootMargin: '0px 0px 60px 0px' });
  new MutationObserver(records => {
    // 格子被清空（換系列／新搜尋會先換成載入狀態）就視為新的一批。不聽 cardscope:browse／search：browse 事件在卡已渲染之後才發，會誤清。
    if (!host.querySelector('.card')) seen.clear();
    if (!animating()) return;
    const fresh = [];
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      if (node.matches('.card')) fresh.push(node);
      else node.querySelectorAll('.card').forEach(card => fresh.push(card));
    }));
    fresh.forEach(card => {
      const id = idOf(card);
      if (!card.isConnected || (id && seen.has(id))) return;
      if (id) seen.add(id);
      card.classList.add('cs-pre'); // 微任務內、首次繪製之前，不會閃一下
      io.observe(card);
    });
  }).observe(host, { childList: true, subtree: true });

  // ---- 桌面懸停傾斜：只更新變數，傾斜與光澤由 CSS 的 :hover 畫（幅度約為詳細頁 tilt-card 的 7 成） ----
  let current = null, rect = null, frame = 0, px = 0, py = 0;
  const clamp = v => Math.max(0, Math.min(1, v));
  const resetCard = card => { card.style.removeProperty('--tilt-x'); card.style.removeProperty('--tilt-y'); };
  const leave = () => { if (current) resetCard(current); current = rect = null; };
  const paint = () => {
    frame = 0;
    if (!current || !rect) return;
    const x = clamp((px - rect.left) / rect.width), y = clamp((py - rect.top) / rect.height);
    current.style.setProperty('--tilt-x', ((.5 - y) * 8).toFixed(2) + 'deg');
    current.style.setProperty('--tilt-y', ((x - .5) * 10).toFixed(2) + 'deg');
    current.style.setProperty('--shine-x', (x * 100).toFixed(1) + '%');
    current.style.setProperty('--shine-y', (y * 100).toFixed(1) + '%');
  };
  host.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !animating() || !hoverMQ.matches) return;
    const card = event.target.closest?.('.card');
    if (!card || card.classList.contains('card-list')) return leave();
    if (card !== current) { leave(); current = card; rect = card.getBoundingClientRect(); }
    px = event.clientX; py = event.clientY;
    if (!frame) frame = requestAnimationFrame(paint);
  });
  host.addEventListener('pointerleave', leave);
  addEventListener('scroll', () => { if (current) leave(); }, { passive: true });

  // ---- 暫停動態開關 ----
  const toggle = document.createElement('button'), state = document.createElement('span');
  toggle.type = 'button'; toggle.className = 'cs-motion-toggle'; toggle.setAttribute('role', 'switch');
  state.className = 'cs-motion-state';
  toggle.append('暫停動態', state);
  const sync = () => {
    const off = reduceMQ.matches, on = paused || off;
    if (on) { io.disconnect(); host.querySelectorAll('.cs-pre, .cs-in').forEach(strip); leave(); }
    if (paused) root.setAttribute('data-cs-paused', ''); else root.removeAttribute('data-cs-paused');
    toggle.setAttribute('aria-checked', String(on));
    toggle.disabled = off;
    toggle.title = off ? '系統已設定減少動態，動態全部關閉' : '';
    state.textContent = off ? '系統' : on ? '開' : '關';
  };
  toggle.addEventListener('click', () => {
    paused = !paused;
    try { paused ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch {}
    sync();
  });
  reduceMQ.addEventListener?.('change', sync);
  document.body.append(toggle);
  sync();
})();
