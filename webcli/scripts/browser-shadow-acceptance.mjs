import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyBrowserShadow({cli,record,passed}) {
  const session='example-shadow';
  const server=http.createServer((req,res)=>{
    const child=new URL(req.url,'http://127.0.0.1').pathname==='/child';
    res.setHeader('content-type','text/html');
    res.end(`<!doctype html><title>Example shadow queries</title><style>button,input{margin:8px}iframe{width:500px;height:160px}</style>
      <span id="local-label">Wrong document label</span><button id="light" onclick="window.exampleLight=(window.exampleLight||0)+1">Example light action</button><div id="outer"></div><div id="other"></div><div id="closed"></div>
      ${child?'':`<iframe src="http://localhost:${server.address().port}/child"></iframe>`}
      <script>
      const root=document.querySelector('#outer').attachShadow({mode:'open'});
      root.innerHTML='<span id="local-label">Example scoped label</span><button id="named" aria-labelledby="local-label">Wrong button label</button><button class="duplicate">Example duplicate</button><button id="hover">Example hover</button><div id="inner"></div><label>Example field<input id="field"></label><select aria-label="Example selection"><option value="one">One</option><option value="two">Two</option></select>';
      root.querySelector('#named').onclick=e=>{window.exampleNamed=(window.exampleNamed||0)+1;window.exampleTrusted=e.isTrusted};
      const disabled=document.createElement('fieldset');disabled.disabled=true;disabled.innerHTML='<input id="disabled-field" aria-label="Example disabled field">';root.append(disabled);
      const aria=document.createElement('button');aria.id='aria-disabled';aria.setAttribute('aria-disabled','true');aria.textContent='Example disabled action';aria.onclick=()=>window.exampleDisabled=true;root.append(aria);
      root.querySelector('#hover').onpointerover=e=>e.currentTarget.setAttribute('aria-label','Changed hover');
      root.querySelector('#hover').onclick=()=>window.exampleHoverClicked=true;
      root.querySelector('.duplicate').onclick=()=>window.exampleWrong=true;
      const nested=root.querySelector('#inner').attachShadow({mode:'open'});nested.innerHTML='<button id="nested">Example nested action</button>';
      nested.querySelector('button').onclick=e=>window.exampleNested=e.isTrusted;
      nested.querySelector('button').onpointerdown=e=>window.exampleDragStart=e.isTrusted;
      const other=document.querySelector('#other').attachShadow({mode:'open'});other.innerHTML='<button id="drag-end" class="duplicate">Example duplicate</button>';
      other.querySelector('button').onclick=e=>window.exampleSecond=e.isTrusted;
      other.querySelector('button').onpointerup=e=>window.exampleDragDone=window.exampleDragStart&&e.isTrusted;
      document.querySelector('#closed').attachShadow({mode:'closed'}).innerHTML='<button>Example closed action</button>';
      document.querySelector('#outer').addEventListener('input',e=>{window.exampleInputs=(window.exampleInputs||0)+1;window.exampleInputValue=e.composedPath()[0].value});
      </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=(command,args={},ok=true)=>cli(`browser.${command}`,{session,...args},ok);
  const value=async expression=>(await call('eval',{expression})).data.value;
  try {
    await call('open',{url:`http://127.0.0.1:${server.address().port}/`});
    assert.equal((await call('find',{selector:'#nested'})).data.matches,0);
    const deep=(await call('state',{shadow:true})).data;
    // The daily Chrome profile may contain an additional extension-owned root.
    // Assert our three roots and their exact host paths, allowing other roots.
    assert.equal(deep.scope,'open_shadow_roots');assert.ok(deep.shadowRoots>=3);assert.equal(deep.closedShadowIncluded,false);
    assert.equal(deep.elements.some(item=>item.name==='Example closed action'),false);
    const nested=deep.elements.find(item=>item.name==='Example nested action');assert.match(nested.ref,/^shadow:/);assert.deepEqual(nested.shadowHosts.map(x=>x.id),['outer','inner']);
    const named=deep.elements.find(item=>item.name==='Example scoped label');assert.ok(named);
    assert.equal(deep.elements.find(item=>item.name==='Example disabled field').disabled,true);
    assert.equal(deep.elements.find(item=>item.name==='Example disabled action').disabled,true);
    await call('click',{ref:named.ref});await call('click',{ref:nested.ref});
    assert.deepEqual(await value('({named:window.exampleNamed,trusted:window.exampleTrusted,nested:window.exampleNested})'),{named:1,trusted:true,nested:true});
    await call('drag',{shadow:true,selector:'#nested',toSelector:'#drag-end'});assert.equal(await value('window.exampleDragDone'),true);
    await call('fill',{shadow:true,role:'textbox',name:'Example field',value:'Example composed input'});
    await call('type',{shadow:true,selector:'#field',value:' suffix'});
    assert.equal(await value('window.exampleInputValue'),'Example composed input suffix');assert.equal(await value('window.exampleInputs'),2);
    await call('select',{shadow:true,role:'combobox',name:'Example selection',value:'Two'});
    assert.equal((await call('get',{shadow:true,selector:'select',property:'value'})).data.value,'two');
    assert.equal(await value('window.exampleInputs'),3);
    assert.equal((await call('fill',{shadow:true,selector:'#disabled-field',value:'Example rejected'},false)).error.code,'ELEMENT_DISABLED');
    assert.equal((await call('click',{shadow:true,selector:'#aria-disabled'},false)).error.code,'ELEMENT_DISABLED');
    assert.equal(await value('window.exampleDisabled||false'),false);
    assert.equal((await call('click',{shadow:true,selector:'.duplicate'},false)).error.code,'AMBIGUOUS_TARGET');
    assert.equal(await value('window.exampleWrong||false'),false);
    const duplicates=(await call('find',{shadow:true,role:'button',name:'Example duplicate'})).data;
    assert.equal(duplicates.matches,2);const second=duplicates.elements.find(x=>x.shadowHosts[0].id==='other');
    await call('click',{ref:second.ref});assert.equal(await value('window.exampleSecond'),true);
    const refreshed=(await call('find',{ref:second.ref})).data.elements[0];assert.match(refreshed.ref,/^shadow:/);
    await call('click',{ref:refreshed.ref});
    assert.equal((await call('find',{shadow:true,selector:'#outer #nested'})).data.matches,0,'CSS combinators must not invent cross-root ancestry');
    assert.equal((await call('find',{shadow:'yes',selector:'button'},false)).error.code,'INVALID_ARGUMENT');
    assert.equal((await call('state',{shadow:true,source:'ax'},false)).error.code,'INVALID_ARGUMENT');
    assert.equal((await call('wait',{shadow:true,kind:'download'},false)).error.code,'INVALID_ARGUMENT');
    const hover=(await call('find',{shadow:true,selector:'#hover'})).data.elements[0];
    assert.equal((await call('click',{ref:hover.ref},false)).error.code,'STALE_REF');assert.equal(await value('window.exampleHoverClicked||false'),false);
    const stale=(await call('find',{shadow:true,selector:'#named'})).data.elements[0];
    await value('const old=document.querySelector("#outer").shadowRoot.querySelector("#named");old.replaceWith(old.cloneNode(true));true');
    assert.equal((await call('click',{ref:stale.ref},false)).error.code,'STALE_REF');
    await value('const cover=document.createElement("div");cover.id="cover";cover.style="position:fixed;inset:0;z-index:2147483647";document.body.append(cover);true');
    assert.equal((await call('click',{shadow:true,selector:'#nested'},false)).error.code,'ELEMENT_OBSCURED');
    await value('document.querySelector("#cover").remove();setTimeout(()=>{const button=document.createElement("button");button.id="delayed";button.textContent="Example delayed";document.querySelector("#outer").shadowRoot.append(button)},100);true');
    assert.equal((await call('wait',{shadow:true,kind:'selector',value:'#delayed',timeoutMs:3000})).data.matched,true);
    const child=(await call('frames')).data.frames.find(row=>row.url.endsWith('/child'));assert.ok(child);
    const frame={frameId:child.frameId,documentId:child.documentId};
    await call('click',{...frame,shadow:true,selector:'#nested'});
    assert.equal((await call('eval',{...frame,expression:'window.exampleNested'})).data.value,true);
    const limited=(await call('state',{shadow:true,limit:1})).data;assert.equal(limited.truncated,true);assert.equal(limited.elements.length,1);
    await value('for(let i=0;i<101;i++){const host=document.createElement("div");host.attachShadow({mode:"open"});document.body.append(host)}true');
    assert.equal((await call('click',{shadow:true,selector:'#light'},false)).error.code,'SHADOW_QUERY_LIMIT');assert.equal(await value('window.exampleLight||0'),0);
    await record('shadow-report',{passed:true,roots:deep.shadowRoots,duplicateMatches:duplicates.matches,crossOriginFrame:true});
    passed('open-shadow DOM queries and refs: scoped labels, nested native actions, composed form events, ambiguity/closed-root/hover/replacement/overlay guards, selector waits and cross-origin frames');
  } finally {try{await call('close');}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
