// 預覽切換器：照 prototype skill 的行為約定（1–5、←/→ 切換，R 重播＝清掉導覽紀錄後重新整理）。
// 每一版是整頁的 CSS/JS，所以切換用重新載入，讓進場動畫與導覽教學都重跑。選定後與 previews/ 一起刪除。
(()=>{
  const names=['星圖','打字機','卡冊','霓虹','聚焦'];
  const current=Number([...document.documentElement.classList].find(c=>/^preview-v\d$/.test(c))?.slice(-1)||1)-1;
  const go=i=>{
    if(i<0||i>=names.length)return;
    const url=new URL(location.href);url.searchParams.set('preview',String(i+1));location.href=url.href;
  };
  const replay=()=>{
    try{Object.keys(localStorage).filter(k=>k.startsWith('cs-tour-')).forEach(k=>localStorage.removeItem(k))}catch{}
    location.reload();
  };
  const mount=()=>{
    const picker=document.createElement('nav');
    picker.className='proto-picker';picker.setAttribute('aria-label','首頁預覽版本');picker.dataset.position='top';
    picker.innerHTML='<span class="proto-picker-highlight" aria-hidden="true"></span>'
      +names.map((name,i)=>`<button type="button" class="proto-picker-item"${i===current?' data-active aria-current="true"':''}>${i+1}<span class="proto-picker-label"> ${name}</span></button>`).join('')
      +'<span class="proto-picker-divider" aria-hidden="true"></span><button type="button" class="proto-picker-item proto-picker-replay" aria-label="重播動畫與導覽 (R)">↻</button>';
    document.body.append(picker);
    const highlight=picker.querySelector('.proto-picker-highlight');
    const items=[...picker.querySelectorAll('.proto-picker-item:not(.proto-picker-replay)')];
    const move=()=>{const el=items[current];highlight.style.width=el.offsetWidth+'px';highlight.style.transform=`translateX(${el.offsetLeft}px)`};
    items.forEach((el,i)=>el.addEventListener('click',()=>go(i)));
    picker.querySelector('.proto-picker-replay').addEventListener('click',replay);
    addEventListener('resize',move);
    document.addEventListener('keydown',e=>{
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable)return;
      if(e.metaKey||e.ctrlKey||e.altKey)return;
      const num=parseInt(e.key,10);
      if(num>=1&&num<=names.length)go(num-1);
      else if(e.key==='ArrowRight')go((current+1)%names.length);
      else if(e.key==='ArrowLeft')go((current-1+names.length)%names.length);
      else if(e.key==='r'||e.key==='R')replay();
    });
    move();
    requestAnimationFrame(()=>requestAnimationFrame(()=>picker.setAttribute('data-ready','')));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
