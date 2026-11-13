// 互動動效：全息閃光、收藏迸發、價格圖畫入、捲動進場、開卡轉場、手機傾斜。樣式在 look-effects.css。
// 全部從外面掛：事件委派＋一個 MutationObserver，不改既有渲染程式。動效三道閘門與全站一致：
// prefers-reduced-motion、(hover:hover) and (pointer:fine)（桌面懸停）、html[data-cs-paused]（使用者的暫停開關）。
(() => {
  const doc = document, root = doc.documentElement;
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)'), fineMQ = matchMedia('(hover: hover) and (pointer: fine)');
  const coarseMQ = matchMedia('(pointer: coarse)'), touchMQ = matchMedia('(hover: none)');
  const motionOK = () => !reduceMQ.matches && !root.hasAttribute('data-cs-paused');
  const make = (tag, cls) => { const n = doc.createElement(tag); n.className = cls; n.setAttribute('aria-hidden', 'true'); return n; };
  const find = (node, sel) => [...(node.matches(sel) ? [node] : []), ...node.querySelectorAll(sel)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const EASE = 'cubic-bezier(.23,1,.32,1)';

  // ---- 1. 高稀有度卡的全息閃光 ----
  // 只疊在 .art 上的一層；桌面游標位置、觸控的一次斜掃都只動 CSS 變數與 transform／opacity。
  const sweepIO = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    sweepIO.unobserve(entry.target);
    if (motionOK()) entry.target.classList.add('fx-sweep');
  }), { threshold: .6 }) : null;
  function holo(card) {
    if (card.classList.contains('card-list') || card.querySelector('.fx-holo-layer')) return;
    const art = card.querySelector('.art');
    if (!art || card.querySelector('.card-rarity')?.dataset.tier !== 'top') return;
    art.append(make('span', 'fx-holo-layer'));
    card.classList.add('fx-holo');
    if (touchMQ.matches) sweepIO?.observe(card);
  }
  let hovered = null, artRect = null, holoFrame = 0, px = 0, py = 0;
  const paintHolo = () => {
    holoFrame = 0;
    if (!hovered) return;
    artRect ||= hovered.querySelector('.art').getBoundingClientRect();
    hovered.style.setProperty('--fx-x', clamp((px - artRect.left) / artRect.width * 100, 0, 100).toFixed(1) + '%');
    hovered.style.setProperty('--fx-y', clamp((py - artRect.top) / artRect.height * 100, 0, 100).toFixed(1) + '%');
  };
  doc.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !fineMQ.matches || !motionOK()) return;
    const card = event.target.closest?.('.fx-holo') || null;
    if (card !== hovered) { hovered = card; artRect = null; }
    if (!hovered) return;
    px = event.clientX; py = event.clientY;
    holoFrame ||= requestAnimationFrame(paintHolo);
  }, { passive: true });
  addEventListener('scroll', () => { artRect = null; }, { passive: true });

  // ---- 2. 收藏迸發 ----
  // 用 capture 聽 click：既有按鈕會 stopPropagation，冒泡階段到不了 document。此時狀態還沒變，所以 aria-pressed="true" 代表這下是移除，不放煙火。
  const FAV = '[data-action="favorite"],[data-watch-increment],[data-collect-act="toggle"],[data-collect-act="inc"]';
  function burst(button) {
    const rect = button.getBoundingClientRect(), wrap = make('div', 'fx-burst'), star = make('span', 'fx-burst-star');
    wrap.style.left = rect.left + rect.width / 2 + 'px'; wrap.style.top = rect.top + rect.height / 2 + 'px';
    star.textContent = '★'; wrap.append(star);
    star.animate([{ transform: 'scale(.6)', opacity: .9 }, { transform: 'scale(1.9)', opacity: 0 }], { duration: 480, easing: EASE, fill: 'forwards' }); // forwards: 不然 480ms 播完到 650ms 移除前，星星會彈回不透明閃一下
    for (let i = 0; i < 8; i++) {
      const dot = make('span', 'fx-burst-dot'), angle = (i / 8) * Math.PI * 2 + Math.random() * .4, dist = 22 + Math.random() * 14;
      wrap.append(dot);
      dot.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${(Math.cos(angle) * dist).toFixed(1)}px,${(Math.sin(angle) * dist).toFixed(1)}px) scale(.3)`, opacity: 0 }], { duration: 500, easing: EASE, fill: 'forwards' });
    }
    doc.body.append(wrap);
    // 按鈕本身若沒被重繪，也一起彈一下
    button.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    setTimeout(() => wrap.remove(), 650);
  }

  // ---- 5. 開卡轉場（View Transitions）----
  // 點卡時記下卡圖；openCard 被呼叫的當下（同一個 click 內）若有記錄，就把轉場包在 openCard 外面。
  let pendingImage = null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const popupImage = () => doc.querySelector('#detail .detail-art img') || doc.querySelector('#detail .detail-visual img');
  function wrapOpenCard() {
    const original = window.openCard;
    if (typeof original !== 'function' || original.__fx) return;
    const wrapped = function (...args) {
      const source = pendingImage; pendingImage = null;
      if (!source || !source.isConnected || typeof doc.startViewTransition !== 'function' || !motionOK() || doc.hidden) return original.apply(this, args);
      let result, target = null, started = false;
      source.style.viewTransitionName = 'fx-card';
      let transition;
      try {
        transition = doc.startViewTransition(async () => {
          started = true;
          source.style.viewTransitionName = ''; // 舊畫面已拍好；名字必須唯一，不能和彈窗主圖同時存在
          result = original.apply(this, args);
          // openCard 先用卡牆已有的資料同步畫出卡圖；最多再等 0.5 秒（網址直開、搜尋建議沒有卡牆資料時卡圖要等 API），網路慢就放棄飛行，詳細資料照常晚點出現
          const until = Date.now() + 500;
          while (!popupImage() && Date.now() < until) await sleep(30);
          target = popupImage();
          if (target) { target.style.viewTransitionName = 'fx-card'; await Promise.race([target.decode?.().catch(() => {}), sleep(200)]); }
        });
      } catch { source.style.viewTransitionName = ''; return original.apply(this, args); }
      // 畫面沒在渲染（背景分頁、被遮住）時轉場的回呼不會跑：0.3 秒後放棄轉場，直接開卡
      setTimeout(() => { if (!started) transition.skipTransition(); }, 300);
      transition.finished.catch(() => {}).finally(() => { source.style.viewTransitionName = ''; if (target) target.style.viewTransitionName = ''; });
      return transition.updateCallbackDone.then(() => result);
    };
    wrapped.__fx = true;
    window.openCard = wrapped;
  }

  doc.addEventListener('click', event => {
    const target = event.target;
    if (!target.closest) return;
    // 5. 記卡圖（只有卡牆的開卡鈕與漲跌榜卡片）
    const hit = target.closest('[data-card-open],[data-do="openCard"]');
    if (hit && typeof doc.startViewTransition === 'function') {
      const image = (hit.closest('.card,.trend-card') || hit).querySelector('.art img,.trend-image img'), rect = image?.getBoundingClientRect();
      if (rect && rect.width && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) { pendingImage = image; wrapOpenCard(); setTimeout(() => { pendingImage = null; }, 0); }
    }
    // 2. 收藏
    const button = target.closest(FAV);
    if (button && !button.disabled && button.getAttribute('aria-pressed') !== 'true' && motionOK()) burst(button);
  }, true);

  // ---- 3. 價格圖畫入 ----
  // 圖還沒捲進視窗時不演（等它真的看得到），每張圖只演一次；hover、換範圍重畫都不會再演。
  const charts = new WeakSet();
  const chartIO = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    chartIO.unobserve(entry.target);
    // 圖一出現 price-timeline 的 ResizeObserver 會重畫一次路徑；等兩個畫面再取路徑，才不會畫在即將被換掉的節點上
    requestAnimationFrame(() => requestAnimationFrame(() => drawIn(entry.target)));
  }), { threshold: .3 }) : null;
  function drawIn(chart) {
    if (!chart.isConnected || !motionOK()) return;
    chart.querySelectorAll('.ptl-line,.ptl-past').forEach(path => {
      const len = path.getTotalLength?.();
      if (len) path.animate([{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }], { duration: 700, easing: 'cubic-bezier(.4,0,.2,1)' });
    });
    chart.querySelector('.ptl-area')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-out' });
    const big = (chart.closest('[data-price-trend]') || chart.closest('[data-price-body]') || doc).querySelector('.ptl-big');
    if (big) countUp(big);
  }
  // 數字 0 → 原值；結尾還原成當初渲染的原字串。中途 price-timeline 自己改了字（使用者開始拖動）就讓位。
  function countUp(big) {
    const text = big.textContent, match = /^(\D*)(\d[\d,]*)(\D*)$/.exec(text), total = match && Number(match[2].replace(/,/g, ''));
    if (!match || !(total > 0)) return;
    let written = text; const t0 = performance.now();
    const step = now => {
      if (!big.isConnected || big.textContent !== written) return;
      const k = Math.min((now - t0) / 600, 1);
      written = k < 1 ? match[1] + Math.round(total * (1 - (1 - k) ** 3)).toLocaleString('en-US') + match[3] : text;
      big.textContent = written;
      if (k < 1) requestAnimationFrame(step);
    };
    big.textContent = written = match[1] + '0' + match[3];
    requestAnimationFrame(step);
  }

  // ---- 4. 捲動進場 ----
  // 卡牆的卡已由 look-motion.js 處理（html.look-motion），這裡只在沒有它時才接手，避免兩套動畫疊在一起。
  const REVEAL = '.band-tile,.trend-card,#eventsSection li' + (root.classList.contains('look-motion') ? '' : ',#cards .card');
  const seen = new Set(), keyOf = n => n.dataset?.id ? 'b:' + n.dataset.kind + n.dataset.id + n.dataset.game : n.dataset?.arg ? 't:' + n.dataset.arg : n.textContent.trim().slice(0, 80);
  const strip = n => { n.classList.remove('fx-pre', 'fx-in'); n.style.removeProperty('--fx-d'); };
  const revealIO = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).sort((a, b) => a.target.compareDocumentPosition(b.target) & 4 ? -1 : 1).forEach((entry, i) => {
      const n = entry.target, delay = Math.min(i, 12) * 40;
      revealIO.unobserve(n);
      if (!n.isConnected || !n.classList.contains('fx-pre')) return;
      n.style.setProperty('--fx-d', delay + 'ms');
      n.classList.replace('fx-pre', 'fx-in');
      setTimeout(() => strip(n), delay + 420);
    });
  }, { rootMargin: '0px 0px 40px 0px' }) : null;
  function reveal(n) {
    const key = keyOf(n);
    if (!key || seen.has(key)) return;
    seen.add(key);
    n.classList.add('fx-pre'); // 在 MutationObserver 的微任務裡、首次繪製之前加上，不會閃一下
    revealIO.observe(n);
  }

  // ---- 6. 手機陀螺儀傾斜 ----
  // 沿用詳細頁桌面 tilt 的變數（.tilt-card-surface 的 --tilt-x／--tilt-y／--shine-*），所以光澤也會跟著動。
  const MAX = 12;
  let gyro = null;
  const surface = () => doc.querySelector('#detail .tilt-card-surface');
  const syncTiltButtons = () => doc.querySelectorAll('.fx-tilt-btn').forEach(b => b.setAttribute('aria-pressed', String(!!gyro)));
  function gyroStop() {
    if (!gyro) return;
    removeEventListener('deviceorientation', gyro.onMove);
    cancelAnimationFrame(gyro.frame);
    const s = surface();
    if (s) ['--tilt-x', '--tilt-y', '--shine-x', '--shine-y', '--shine-opacity'].forEach(name => s.style.removeProperty(name));
    gyro = null; syncTiltButtons();
  }
  function gyroStart() {
    const g = gyro = { b0: null, g0: null, tx: 0, ty: 0, cx: 0, cy: 0, frame: 0 };
    // 第一筆讀數當作「正對」；基準線慢慢跟著手的姿勢走，所以換個握法也不會卡在最大角度
    g.onMove = event => {
      if (event.beta == null || event.gamma == null) return;
      if (g.b0 == null) { g.b0 = event.beta; g.g0 = event.gamma; }
      g.b0 += (event.beta - g.b0) * .005; g.g0 += (event.gamma - g.g0) * .005;
      g.tx = clamp((event.beta - g.b0) * .5, -MAX, MAX); g.ty = clamp((event.gamma - g.g0) * .5, -MAX, MAX);
    };
    const tick = () => {
      if (gyro !== g) return;
      g.frame = requestAnimationFrame(tick);
      if (!motionOK()) return gyroStop();
      g.cx += (g.tx - g.cx) * .12; g.cy += (g.ty - g.cy) * .12;
      const s = surface();
      if (!s) return;
      s.style.setProperty('--tilt-x', g.cx.toFixed(2) + 'deg'); s.style.setProperty('--tilt-y', g.cy.toFixed(2) + 'deg');
      s.style.setProperty('--shine-x', (50 + g.cy / MAX * 50).toFixed(1) + '%'); s.style.setProperty('--shine-y', (50 - g.cx / MAX * 50).toFixed(1) + '%');
      s.style.setProperty('--shine-opacity', '.38');
    };
    addEventListener('deviceorientation', g.onMove);
    g.frame = requestAnimationFrame(tick);
    syncTiltButtons();
  }
  function addTiltButton() {
    if (!coarseMQ.matches || typeof DeviceOrientationEvent === 'undefined' || doc.querySelector('#detail .fx-tilt-btn')) return;
    const art = doc.querySelector('#detail .detail-art');
    if (!art) return;
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'fx-tilt-btn'; button.textContent = '傾斜卡片'; button.setAttribute('aria-pressed', String(!!gyro));
    // requestPermission（iOS）必須在使用者點擊的同一次事件裡呼叫，所以只出現在這個 click 處理器內
    button.addEventListener('click', async () => {
      if (gyro) return gyroStop();
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        let answer = 'denied';
        try { answer = await DeviceOrientationEvent.requestPermission(); } catch {}
        if (answer !== 'granted') { button.textContent = '未取得傾斜權限'; return; }
      }
      gyroStart();
    });
    (art.closest('.detail-visual-stage') || art).after(button);
  }
  const modal = doc.getElementById('modal');
  if (modal) new MutationObserver(() => { if (!modal.classList.contains('open')) gyroStop(); }).observe(modal, { attributes: true, attributeFilter: ['class'] });

  // ---- 掃描新插入的節點（卡牆、系列帶、漲跌榜、時事、價格圖、彈窗都是 JS 後來才畫的）----
  new MutationObserver(records => {
    let inDetail = false;
    for (const record of records) {
      if (!inDetail && record.target.closest?.('#detail')) inDetail = true;
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        find(node, '.card').forEach(card => { if (card.closest('#cards')) holo(card); });
        if (revealIO && motionOK()) find(node, REVEAL).forEach(reveal);
        if (chartIO) find(node, '.ptl-chart').forEach(chart => { if (!charts.has(chart)) { charts.add(chart); chartIO.observe(chart); } });
      }
    }
    if (inDetail) addTiltButton();
  }).observe(doc.body, { childList: true, subtree: true });

  // 頁面載入時已經在的節點
  doc.querySelectorAll('#cards .card').forEach(holo);
  if (revealIO && motionOK()) doc.querySelectorAll(REVEAL).forEach(reveal);
})();
