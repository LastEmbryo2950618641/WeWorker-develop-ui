import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyBrowserAx({cli,record,passed}) {
  const session='example-ax';
  const server=http.createServer((req,res)=>{
    const route=new URL(req.url,'http://127.0.0.1').pathname;
    res.setHeader('content-type','text/html');
    if(route==='/ax-child') {
      res.end('<!doctype html><title>Example child AX</title><label>Example child field<input id="child-field"></label><button id="child-button" onclick="window.exampleChildClick=event.isTrusted">Example child action</button>');return;
    }
    res.end(`<!doctype html><title>Example accessible state</title><h1>Example accessible heading</h1>
      <span id="label">Example external name</span><button id="named" aria-labelledby="label" onclick="window.exampleNamed=(window.exampleNamed||0)+1">Local text</button>
      <button id="hidden" aria-hidden="true">Example aria hidden</button>
      <button id="duplicate-first" onclick="window.exampleFirst=(window.exampleFirst||0)+1">Example duplicate</button>
      <button id="duplicate-second" onclick="window.exampleSecond=(window.exampleSecond||0)+1;window.exampleTrusted=event.isTrusted">Example duplicate</button>
      <div role="button" tabindex="0" aria-disabled="true" id="disabled" onclick="window.exampleDisabled=true">Example disabled action</div>
      <button id="hover-name" onpointerover="this.setAttribute('aria-label','Example changed hover name')" onclick="window.exampleHoverClicked=true">Example hover name</button>
      <label>Example secret<input type="password" value="placeholder-password"></label>
      <div id="closed-host"></div><div id="open-host"></div>
      <iframe src="http://localhost:${server.address().port}/ax-child"></iframe><iframe src="http://localhost:${server.address().port}/ax-child"></iframe>
      <script>
        const closed=document.querySelector('#closed-host').attachShadow({mode:'closed'});
        closed.innerHTML='<input aria-label="Example closed input"><button aria-label="Example closed action">Closed action</button><div id="nested"></div>';
        closed.querySelector('button').onclick=e=>{window.exampleClosed=(window.exampleClosed||0)+1;window.exampleClosedTrusted=e.isTrusted};
        const nested=closed.querySelector('#nested').attachShadow({mode:'open'});nested.innerHTML='<button>Example nested shadow action</button>';
        nested.querySelector('button').onclick=e=>window.exampleNested=e.isTrusted;
        const open=document.querySelector('#open-host').attachShadow({mode:'open'});open.innerHTML='<button>Example open action</button>';
        open.querySelector('button').onclick=e=>window.exampleOpen=e.isTrusted;
      </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=(command,args={},ok=true)=>cli(`browser.${command}`,{session,...args},ok);
  const byName=(state,name)=>{const rows=state.elements.filter(item=>item.name===name);assert.equal(rows.length,1,'Expected exactly one AX '+name);return rows[0].ref;};
  try {
    await call('open',{url:`http://127.0.0.1:${server.address().port}/ax`});
    const ax=(await call('state',{source:'ax',limit:100})).data;
    await record('ax-state',ax);
    assert.equal(ax.source,'ax');assert.equal(ax.frameId,0);assert.ok(ax.documentId);
    assert.equal(ax.scope,'accessible_frames');assert.equal(ax.frames.length,3);assert.equal(ax.partial,false);
    const autoChildren=ax.elements.filter(row=>row.name==='Example child action');assert.equal(autoChildren.length,2);
    await call('click',{ref:autoChildren[1].ref});
    assert.equal((await call('eval',{frameId:autoChildren[1].frameId,documentId:autoChildren[1].documentId,expression:'window.exampleChildClick'})).data.value,true);
    await call('eval',{frameId:autoChildren[1].frameId,documentId:autoChildren[1].documentId,expression:'window.exampleChildClick=false;true'});
    assert.ok(ax.tree.some(node=>node.role==='heading'&&node.name==='Example accessible heading'));
    assert.equal(ax.elements.some(node=>node.name==='Example aria hidden'),false);
    assert.equal(JSON.stringify(ax).includes('placeholder-password'),false);
    const duplicates=ax.elements.filter(node=>node.name==='Example duplicate');assert.equal(duplicates.length,2);
    const ids=[];for(const node of duplicates)ids.push((await call('get',{ref:node.ref,property:'attribute',attribute:'id'})).data.value);
    assert.deepEqual(ids,['duplicate-first','duplicate-second']);
    await call('click',{ref:duplicates[1].ref});
    assert.deepEqual((await call('eval',{expression:'({first:window.exampleFirst||0,second:window.exampleSecond,trusted:window.exampleTrusted})'})).data.value,{first:0,second:1,trusted:true});
    const closedInput=byName(ax,'Example closed input'),closedButton=byName(ax,'Example closed action');
    await call('fill',{ref:closedInput,value:'Example AX input'});
    assert.equal((await call('get',{ref:closedInput,property:'value'})).data.value,'Example AX input');
    await call('click',{ref:closedButton});await call('click',{ref:byName(ax,'Example nested shadow action')});await call('click',{ref:byName(ax,'Example open action')});
    assert.deepEqual((await call('eval',{expression:'({closed:window.exampleClosed,trusted:window.exampleClosedTrusted,nested:window.exampleNested,open:window.exampleOpen})'})).data.value,{closed:1,trusted:true,nested:true,open:true});
    const comparison=(await call('state',{compareSources:true})).data;
    assert.equal(comparison.comparison,'snapshot_sources');assert.equal(comparison.sources.ax.ok,true);assert.equal(comparison.sources.dom.ok,true);
    assert.ok(comparison.sources.ax.interactiveNodes>comparison.sources.dom.interactiveNodes);
    assert.equal((await call('get',{ref:closedInput,property:'value'})).data.value,'Example AX input');
    assert.equal((await call('click',{ref:byName(ax,'Example disabled action')},false)).error.code,'ELEMENT_DISABLED');
    assert.equal((await call('eval',{expression:'window.exampleDisabled||false'})).data.value,false);
    assert.equal((await call('click',{ref:byName(ax,'Example hover name')},false)).error.code,'STALE_REF');
    assert.equal((await call('eval',{expression:'window.exampleHoverClicked||false'})).data.value,false);
    await call('eval',{expression:"document.querySelector('#label').textContent='Example changed name';true"});
    assert.equal((await call('click',{ref:byName(ax,'Example external name')},false)).error.code,'STALE_REF');
    await call('eval',{expression:"document.querySelector('#duplicate-second').replaceWith(document.querySelector('#duplicate-second').cloneNode(true));true"});
    assert.equal((await call('click',{ref:duplicates[1].ref},false)).error.code,'STALE_REF');
    // Closed shadow references must still obey an ancestor overlay.
    await call('eval',{expression:"const cover=document.createElement('div');cover.id='example-cover';cover.style='position:fixed;inset:0;z-index:2147483647;background:white';document.body.append(cover);true"});
    assert.equal((await call('click',{ref:closedButton},false)).error.code,'ELEMENT_OBSCURED');
    await call('eval',{expression:"document.querySelector('#example-cover').remove();true"});
    const frames=(await call('frames')).data.frames.filter(frame=>frame.url.endsWith('/ax-child'));assert.equal(frames.length,2);
    const child=(await call('state',{source:'ax',frameId:frames[1].frameId,documentId:frames[1].documentId})).data;
    const childRef=byName(child,'Example child action');
    assert.equal((await call('click',{ref:childRef,frameId:0},false)).error.code,'STALE_REF');
    await call('click',{ref:childRef});
    assert.equal((await call('eval',{frameId:frames[1].frameId,documentId:frames[1].documentId,expression:'window.exampleChildClick'})).data.value,true);
    assert.equal((await call('eval',{frameId:frames[0].frameId,documentId:frames[0].documentId,expression:'window.exampleChildClick||false'})).data.value,false);
    await call('fill',{ref:byName(child,'Example child field'),value:'Example child value'});
    const limited=(await call('state',{source:'ax',limit:2})).data;assert.equal(limited.elements.length,2);assert.equal(limited.truncated,true);
    assert.equal((await call('get',{ref:closedInput},false)).error.code,'STALE_REF');
    await call('state');assert.equal((await call('click',{ref:limited.elements[0].ref},false)).error.code,'STALE_REF');
    await call('eval',{frameId:frames[1].frameId,documentId:frames[1].documentId,expression:"location.href='/ax-child?next=1';true"});
    let changed=false;
    for(let i=0;i<30;i++){const current=(await call('frames')).data.frames.find(frame=>frame.frameId===frames[1].frameId);if(current?.documentId!==frames[1].documentId){changed=true;break;}await new Promise(r=>setTimeout(r,100));}
    assert.equal(changed,true);
    assert.ok(['FRAME_UNAVAILABLE','FRAME_DOCUMENT_CHANGED','STALE_REF'].includes((await call('click',{ref:childRef},false)).error.code));
    await record('ax-comparison',comparison);
    passed('AX snapshots and DOM comparison: computed names, duplicate nodes, closed/nested shadow native actions, password omission, disabled/overlay/stale guards and duplicate-URL child frame identity');
  } finally {try{await call('close');}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
