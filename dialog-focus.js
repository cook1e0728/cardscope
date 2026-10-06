// Keyboard focus for the card detail dialog (PRODUCT_PLAN section 4): move focus in when it opens,
// keep Tab inside while open, and return focus to the opener when it closes. Open/close is tracked
// through the `open` class so every existing close path (button, backdrop, Escape, Back) is covered.
(function(){
  const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function installDialogFocus(modal,{doc=document,initialFocus,returnTarget}={}){
    if(!modal||modal.dataset.dialogFocus)return;
    modal.dataset.dialogFocus='1';
    let opener=null,wasOpen=modal.classList.contains('open');
    const focusables=()=>[...modal.querySelectorAll(FOCUSABLE)].filter(item=>!item.hidden&&item.getClientRects().length>0);
    const sync=()=>{
      const open=modal.classList.contains('open');
      if(open===wasOpen)return;
      wasOpen=open;
      if(open){
        const active=doc.activeElement;
        if(active&&active!==doc.body&&!modal.contains(active))opener=active;
        (initialFocus?.()||focusables()[0])?.focus();
        return;
      }
      const target=returnTarget?.()||opener;opener=null;
      if(target&&target.isConnected!==false&&typeof target.focus==='function')target.focus();
    };
    modal.syncDialogFocus=sync;
    if(typeof MutationObserver==='function')new MutationObserver(sync).observe(modal,{attributes:true,attributeFilter:['class']});
    doc.addEventListener('keydown',event=>{
      if(event.key!=='Tab'||!modal.classList.contains('open'))return;
      const active=doc.activeElement,inside=active&&modal.contains(active);
      // Another dialog (card zoom) manages its own focus while it is on top.
      if(!inside&&active&&active!==doc.body)return;
      const items=focusables();
      if(!items.length){event.preventDefault();return}
      const first=items[0],last=items.at(-1);
      if(!inside){event.preventDefault();(event.shiftKey?last:first).focus()}
      else if(event.shiftKey&&active===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&active===last){event.preventDefault();first.focus()}
    });
  }
  window.installDialogFocus=installDialogFocus;
})();
