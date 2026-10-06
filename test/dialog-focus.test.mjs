import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const [source,ui,html]=await Promise.all([
  readFile(new URL('../dialog-focus.js',import.meta.url),'utf8'),
  readFile(new URL('../ui-enhancements.js',import.meta.url),'utf8'),
  readFile(new URL('../index.html',import.meta.url),'utf8')
]);

function harness(){
  const listeners=[],doc={activeElement:null,addEventListener(type,handler){if(type==='keydown')listeners.push(handler)}};
  const node=name=>({name,hidden:false,isConnected:true,dataset:{},getClientRects:()=>[1],focus(){doc.activeElement=this}});
  doc.body=node('body');doc.activeElement=doc.body;
  const close=node('close'),link=node('link'),last=node('last'),opener=node('opener'),zoomButton=node('zoom'),inside=new Set([close,link,last]),classes=new Set();
  const modal={dataset:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},contains:item=>inside.has(item),querySelectorAll:()=>[close,link,last]};
  const context=vm.createContext({window:{},document:doc});
  vm.runInContext(source,context);
  const tab=(shiftKey=false)=>{const event={key:'Tab',shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true}};listeners.forEach(handler=>handler(event));return event};
  const setOpen=open=>{open?classes.add('open'):classes.delete('open');modal.syncDialogFocus()};
  return {context,doc,modal,close,link,last,opener,zoomButton,tab,setOpen};
}

test('card detail dialog moves focus in, traps Tab, and returns focus on close',()=>{
  const h=harness();
  h.context.window.installDialogFocus(h.modal,{doc:h.doc,initialFocus:()=>h.close});
  h.opener.focus();
  h.setOpen(true);
  assert.equal(h.doc.activeElement,h.close,'focus moves to the close button');
  h.last.focus();
  assert.equal(h.tab().defaultPrevented,true);
  assert.equal(h.doc.activeElement,h.close,'Tab from the last control wraps to the first');
  assert.equal(h.tab(true).defaultPrevented,true);
  assert.equal(h.doc.activeElement,h.last,'Shift+Tab from the first control wraps to the last');
  h.doc.activeElement=h.doc.body;
  h.tab();
  assert.equal(h.doc.activeElement,h.close,'focus lost to the page after a re-render is pulled back in');
  h.zoomButton.focus();
  assert.equal(h.tab().defaultPrevented,false,'a dialog stacked on top keeps its own focus');
  h.setOpen(false);
  assert.equal(h.doc.activeElement,h.opener,'closing returns focus to the opener');
});

test('closing prefers the tile of the card last shown',()=>{
  const h=harness(),tile={isConnected:true,focus(){h.doc.activeElement=this}};
  h.context.window.installDialogFocus(h.modal,{doc:h.doc,initialFocus:()=>h.close,returnTarget:()=>tile});
  h.opener.focus();h.setOpen(true);h.setOpen(false);
  assert.equal(h.doc.activeElement,tile);
});

test('card detail markup is a labelled modal dialog wired to the focus helper',()=>{
  assert.match(html,/class="dialog" role="dialog" aria-modal="true" aria-label="卡片詳細資料"/);
  assert.match(html,/id="close" aria-label="關閉卡片詳細資料"/);
  assert.ok(html.indexOf('/dialog-focus.js')<html.indexOf('/ui-enhancements.js'),'helper loads before the UI script that installs it');
  assert.match(ui,/installDialogFocus\?\.\(\$\('modal'\)/);
});

test('Escape handled by the zoom view does not also close the detail dialog',()=>{
  const listener=ui.slice(ui.lastIndexOf("document.addEventListener('keydown'"));
  assert.match(listener,/^document\.addEventListener\('keydown',event=>\{if\(event\.key==='Escape'&&event\.defaultPrevented\)return;/);
});
