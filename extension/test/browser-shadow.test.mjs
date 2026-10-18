import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {runBrowserPageCommand} from '../background/browser-page.js';

// Minimal tree fixture for lookup budgets and reference guards. CSS, composed
// events, hit testing and cross-frame execution are covered by real Chromium.
function fixture(){
  const descendants=root=>{const nodes=[];const visit=node=>{for(const child of node.children){nodes.push(child);visit(child);}};visit(root);return nodes;};
  class Tree {
    children=[];
    querySelectorAll(selector){if(selector==='[')throw Error('Invalid selector');return descendants(this).filter(node=>selector==='*'||selector==='button'&&node.tagName==='BUTTON');}
    getElementById(id){return descendants(this).find(node=>node.id===id);}
  }
  class Shadow extends Tree {constructor(host){super();this.host=host;}}
  const doc=new Tree();doc.title='Example';doc.body={innerText:'Example light text'};
  doc.createTreeWalker=root=>{const rows=descendants(root);let i=0;return{nextNode:()=>rows[i++]};};
  function node(tree,tag='BUTTON',attrs={}){
    const n={children:[],tagName:tag,id:attrs.id||'',textContent:attrs.text||'',isConnected:true,ownerDocument:doc,
      getRootNode:()=>tree,getAttribute:name=>attrs[name]??null,getClientRects:()=>[{}],matches:()=>false};
    tree.children.push(n);return n;
  }
  const context=vm.createContext({document:doc,ShadowRoot:Shadow,NodeFilter:{SHOW_ELEMENT:1},location:{href:'https://example.com/'},crypto:globalThis.crypto,getComputedStyle:()=>({visibility:'visible'})});
  const run=vm.runInContext(`(${runBrowserPageCommand.toString()})`,context);
  return{doc,node,Shadow,run};
}

test('open-root lookup is explicit, labels are tree-scoped, duplicates remain distinct and refs reject role changes',async()=>{
  const f=fixture();f.node(f.doc,'SPAN',{id:'label',text:'Wrong document label'});
  const host=f.node(f.doc,'DIV',{id:'example-host'});host.shadowRoot=new f.Shadow(host);
  f.node(host.shadowRoot,'SPAN',{id:'label',text:'Example local name'});
  const attrs={'aria-labelledby':'label'},button=f.node(host.shadowRoot,'BUTTON',attrs);
  f.node(host.shadowRoot,'BUTTON',{text:'Example duplicate'});f.node(host.shadowRoot,'BUTTON',{text:'Example duplicate'});
  assert.equal((await f.run('find',{selector:'button'})).data.matches,0);
  const found=await f.run('find',{shadow:true,selector:'button'});
  assert.equal(found.data.matches,3);assert.equal(found.data.shadowRoots,1);
  assert.equal(found.data.elements[0].name,'Example local name');assert.equal(found.data.elements[0].shadowHosts[0].id,'example-host');
  assert.notEqual(found.data.elements[1].ref,found.data.elements[2].ref);
  const ref=found.data.elements[0].ref;assert.match(ref,/^shadow:/);
  attrs.role='link';assert.equal((await f.run('get',{ref})).error.code,'STALE_REF');
  attrs.role=undefined;button.isConnected=false;assert.equal((await f.run('get',{ref})).error.code,'STALE_REF');
});

test('lookup budgets fail closed before returning an apparently unique target',async()=>{
  for(const kind of ['roots','depth','nodes']){
    const f=fixture();f.node(f.doc,'BUTTON',{id:'example-action'});
    if(kind==='nodes'){for(let i=0;i<20001;i++)f.node(f.doc,'DIV');}
    else {let tree=f.doc;for(let i=0;i<(kind==='roots'?101:33);i++){
      const host=f.node(tree,'DIV');host.shadowRoot=new f.Shadow(host);if(kind==='depth')tree=host.shadowRoot;
    }}
    const result=await f.run('find',{shadow:true,selector:'button'});
    assert.equal(result.ok,false);assert.equal(result.error.code,'SHADOW_QUERY_LIMIT');
  }
});

test('malformed selectors, invalid opt-in and untargeted shadow extraction fail explicitly',async()=>{
  const f=fixture();
  for(const shadow of ['yes',1,{},[]])assert.equal((await f.run('find',{shadow})).error.code,'INVALID_ARGUMENT');
  assert.equal((await f.run('find',{shadow:true,selector:'['})).error.code,'INVALID_SELECTOR');
  assert.equal((await f.run('extract',{shadow:true})).error.code,'INVALID_ARGUMENT');
});

test('state describes inherited and ARIA disabled controls consistently with operation rejection',async()=>{
  const f=fixture();const inherited=f.node(f.doc,'BUTTON',{text:'Example inherited'});inherited.matches=()=>true;
  f.node(f.doc,'BUTTON',{'aria-disabled':'true',text:'Example ARIA'});
  const result=await f.run('find',{selector:'button',shadow:true});
  assert.equal(result.data.elements.length,2);assert.ok(result.data.elements.every(item=>item.disabled));
  for(const item of result.data.elements)assert.equal((await f.run('focus',{ref:item.ref})).error.code,'ELEMENT_DISABLED');
});
