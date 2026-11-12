// Delegated handlers for what used to be inline onclick/onerror attributes. The page's CSP has script-src-attr 'none',
// so markup carries data attributes instead: data-do="<action>" data-arg="<id>" for clicks, data-img-error="<kind>" for a failed <img>.
// (Card images use data-img-error="card"; that handler lives in ui-enhancements.js next to resilientImage.)
(function(){
  // Whitelist, looked up on window at click time so navigation-state.js wrappers of choose/openCard are the ones that run.
  const ACTIONS=['choose','openCard','openProduct','chooseProductCategory'];
  document.addEventListener('click',event=>{
    const el=event.target.closest?.('[data-do]');
    if(el&&ACTIONS.includes(el.dataset.do)&&typeof window[el.dataset.do]==='function')window[el.dataset.do](el.dataset.arg);
  });
  // ⓘ：解釋規則的句子收在這裡，點開才看。用 <details>，Enter／Space 開關；Esc、點外面或再按一次都能關。
  // label 與 body 由呼叫端跳脫（body 是 HTML）。內容用絕對定位浮在原處，不推動版面；太靠邊時往內推，不超出視窗。
  window.infoTip=(label,body,cls='')=>`<details class="info-tip${cls?' '+cls:''}"><summary aria-label="說明：${String(label).replace(/[&<>"']/g,ch=>'&#'+ch.charCodeAt(0)+';')}"><span aria-hidden="true">ⓘ</span></summary><div class="info-body">${body}</div></details>`;
  document.addEventListener('toggle',event=>{
    const tip=event.target;if(!tip.matches?.('details.info-tip')||!tip.open)return;
    const body=tip.querySelector('.info-body');body.style.left='';const box=body.getBoundingClientRect();
    body.style.left=Math.max(8-box.left,Math.min(0,innerWidth-8-box.right))+'px';
  },true);
  document.addEventListener('click',event=>{for(const tip of document.querySelectorAll('details.info-tip[open]'))if(!tip.contains(event.target))tip.open=false});
  // 捕獲階段先處理：開著說明時第一次 Esc 只關說明（不連帶關掉後面的詳細視窗），焦點回到 ⓘ。
  document.addEventListener('keydown',event=>{
    const tip=event.key==='Escape'&&document.querySelector('details.info-tip[open]');if(!tip)return;
    tip.open=false;tip.querySelector('summary').focus();event.stopPropagation();
  },true);
  const FAILED={
    remove:img=>img.remove(),
    'swap-display':img=>{img.style.display='none';img.nextElementSibling.style.display='grid'},
    'swap-hidden':img=>{img.hidden=true;img.nextElementSibling.hidden=false},
    // 官方站偶爾單次載入失敗：先隔 1.5 秒重試一次，仍失敗才改成代碼磚。
    'retry-type':img=>{
      if(!img.dataset.retried){img.dataset.retried='1';const src=img.src;setTimeout(()=>{img.src=src+(src.includes('?')?'&':'?')+'retry=1'},1500);return}
      img.parentElement.classList.add('is-type');img.remove();
    }
  };
  // error does not bubble, but a capture listener on document still sees it.
  document.addEventListener('error',event=>{const kind=event.target?.dataset?.imgError;if(Object.hasOwn(FAILED,kind??''))FAILED[kind](event.target)},true);
})();
