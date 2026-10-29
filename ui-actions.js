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
