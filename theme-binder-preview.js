// Preview only (?band=art): puts a blurred copy of the first loaded card image behind the game band.
// Card images already shown on the page are reused; nothing new is fetched from a different source.
(function(){
  if(document.body?.dataset.band!=='art')return;
  let current='';
  const update=()=>{
    const band=document.getElementById('gameContext');if(!band||document.body.dataset.view!=='game')return;
    // Lazy images below the fold may not have loaded yet; their src is enough for a background.
    const img=[...document.querySelectorAll('#cards .card .art img')].find(item=>item.getAttribute('src')&&!item.closest('[hidden]'));
    const src=img?.currentSrc||img?.src||'';if(!src||src===current)return;current=src;
    let layer=band.querySelector('.band-art');if(!layer){layer=document.createElement('div');layer.className='band-art';layer.setAttribute('aria-hidden','true');band.prepend(layer)}
    layer.style.backgroundImage=`url("${src.replace(/"/g,'%22')}")`;
  };
  setInterval(update,1200);update();
})();
