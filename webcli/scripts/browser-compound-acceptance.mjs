import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyBrowserCompounds({cli,root,record,passed}) {
  const session='example-compounds';
  const server=http.createServer((req,res)=>{
    const child=req.url.startsWith('/child');res.setHeader('content-type','text/html');
    res.end(`<!doctype html><title>Example compound controls</title><style>label{display:block;padding:3px}iframe{width:500px;height:180px}</style><main id="form">
      <label>Example date<input id="date" type="date" value="2026-11-20" min="2026-01-01" max="2026-12-31" step="2" required></label>
      <label>Example time<input id="time" type="time" value="12:34:56.125" step="0.001"></label>
      <label>Example date time<input id="local" type="datetime-local" value="2026-11-20T12:34:56" step="1"></label>
      <label>Example month<input id="month" type="month" value="2026-11"></label>
      <label>Example week<input id="week" type="week" value="2026-W47"></label>
      <label>Example long select<select id="long" multiple>${Array.from({length:65},(_,i)=>`<option value="v${i}" ${i===60||i===62?'selected':''}>Example ${i}</option>`).join('')}</select></label>
      <label>Example duplicate select<select id="ambiguous"><option value="one" selected>Repeated</option><option value="two">Repeated</option><option value="Repeated">Distinct</option><option value="alias" label="Example label attribute">Different display text</option><optgroup label="Example disabled group" disabled><option value="blocked">Disabled option</option></optgroup></select></label>
      <label>Example controlled select<select id="controlled" onchange="this.value='one'"><option value="one">One</option><option value="two">Two</option></select></label>
      <label>Example secret<input type="password" value="placeholder-secret"></label>
      <input type="file" id="file" accept=".txt" multiple style="display:none"><div id="open-host"></div><div id="closed-host"></div>
      <div id="tree" onclick="window.exampleUnsafe=true"><span>Example tree text</span><section><p>Example nested text</p></section><script>window.exampleScriptSecret='placeholder-script-secret'</script></div>
      ${child?'':`<iframe src="http://localhost:${server.address().port}/child"></iframe>`}</main>
      <script>
      const open=document.querySelector('#open-host').attachShadow({mode:'open'});open.innerHTML='<label>Example shadow date<input type="date" value="2026-12-01"></label>';
      const closed=document.querySelector('#closed-host').attachShadow({mode:'closed'});closed.innerHTML='<input type="date" aria-label="Example closed date" value="2026-12-02">';
      window.exampleSelectEvents=0;document.querySelector('#ambiguous').onchange=()=>window.exampleSelectEvents++;
      </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=(command,args={},ok=true)=>cli(`browser.${command}`,{session,...args},ok);
  const inspect=async(selector,extra={})=>(await call('get',{selector,property:'compound',...extra})).data.value;
  try{
    await call('open',{url:`http://127.0.0.1:${server.address().port}/`});
    const state=(await call('state',{compound:true})).data;
    const date=state.elements.find(row=>row.id==='date').compound;
    assert.equal(date.control,'date');assert.equal(date.current,'2026-11-20');assert.equal(date.min,'2026-01-01');assert.equal(date.step,'2');assert.equal(date.required,true);
    assert.equal((await inspect('#time')).current,'12:34:56.125');assert.ok((await inspect('#time')).format.includes('ss'));
    assert.equal((await inspect('#local')).current,'2026-11-20T12:34:56');assert.equal((await inspect('#month')).current,'2026-11');assert.equal((await inspect('#week')).current,'2026-W47');
    await call('fill',{selector:'#date',value:'2027-01-01'});assert.equal((await inspect('#date')).validity.rangeOverflow,true);
    await call('fill',{selector:'#date',value:'2026-11-20'});assert.equal((await inspect('#date')).current,'2026-11-20');
    const long=(await call('find',{selector:'#long'})).data.elements[0].compound;
    assert.equal(long.options.length,50);assert.equal(long.options_total,65);assert.deepEqual(long.currentValues,['v60','v62']);assert.deepEqual(long.current,['Example 60','Example 62']);assert.equal(long.truncated.options,true);
    await call('select',{selector:'#long',value:['Example 64'],by:'label'});assert.deepEqual((await inspect('#long')).currentValues,['v64']);
    await call('select',{selector:'#long',value:[],by:'value'});assert.deepEqual((await inspect('#long')).currentValues,[]);
    assert.equal((await call('select',{selector:'#ambiguous',value:'Repeated'},false)).error.code,'AMBIGUOUS_OPTION');
    assert.equal((await call('eval',{expression:'window.exampleSelectEvents'})).data.value,0);
    await call('select',{selector:'#ambiguous',value:'Repeated',by:'value'});assert.equal((await inspect('#ambiguous')).current,'Distinct');
    await call('select',{selector:'#ambiguous',value:'Example label attribute',by:'label'});assert.equal((await inspect('#ambiguous')).currentValues,'alias');
    const blocked=(await inspect('#ambiguous')).options.find(row=>row.value==='blocked');assert.equal(blocked.disabled,true);assert.equal(blocked.group,'Example disabled group');
    assert.equal((await call('select',{selector:'#ambiguous',value:'blocked',by:'value'},false)).error.code,'OPTION_NOT_FOUND');
    assert.equal((await call('select',{selector:'#controlled',value:'two',by:'value'},false)).error.code,'SELECTION_REJECTED');
    assert.equal((await inspect('#controlled')).currentValues,'one');
    const file=path.join(root,'example-compound.txt');await fs.writeFile(file,'Example file fixture\n');
    assert.deepEqual((await inspect('#file')).current,[]);await call('upload',{selector:'#file',paths:[file]});
    const uploaded=await inspect('#file');assert.deepEqual(uploaded.current,['example-compound.txt']);assert.equal(uploaded.filesTotal,1);assert.equal(uploaded.accept,'.txt');assert.equal(JSON.stringify(uploaded).includes(root),false);
    const tree=(await call('get',{property:'html',as:'json',depth:10})).data;
    assert.equal(tree.value.tag,'html');
    const serialized=JSON.stringify(tree);assert.equal(serialized.includes('placeholder-secret'),false);assert.equal(serialized.includes('placeholder-script-secret'),false);assert.equal(serialized.includes('exampleUnsafe'),false);assert.equal(tree.truncated.omittedContent,true);
    assert.ok(serialized.includes('"control":"date"'));assert.ok(serialized.includes('"redacted":true'));
    assert.equal((await call('get',{selector:'#tree',property:'html',as:'json',depth:1})).data.truncated.depth,true);
    const rootOnly=(await call('get',{selector:'#tree',property:'html',as:'json',depth:0})).data;assert.equal(rootOnly.nodes,1);assert.equal(rootOnly.truncated.depth,true);
    assert.equal((await call('get',{selector:'#tree',property:'html',as:'json',childrenMax:1})).data.truncated.children,true);
    assert.equal((await call('get',{selector:'#tree',property:'html',as:'json',maxNodes:1})).data.truncated.nodes,true);
    assert.equal((await call('get',{selector:'#tree',property:'html',as:'json',textMax:3})).data.truncated.text,true);
    assert.equal((await call('get',{selector:'#date',property:'text',as:'json'},false)).error.code,'INVALID_ARGUMENT');
    assert.equal((await call('find',{selector:'#date',compound:false})).data.elements[0].compound,undefined);
    assert.equal((await inspect('input[type=date]',{shadow:true,role:'textbox',name:'Example shadow date'})).current,'2026-12-01');
    const ax=(await call('state',{source:'ax',frameId:0,limit:200})).data;
    const closed=ax.elements.find(row=>row.name==='Example closed date');assert.ok(closed);
    const closedInfo=(await call('get',{ref:closed.ref,property:'compound'})).data.value;assert.equal(closedInfo.current,'2026-12-02');
    const child=(await call('frames')).data.frames.find(row=>row.url.endsWith('/child'));assert.ok(child);
    assert.equal((await inspect('#date',{frameId:child.frameId,documentId:child.documentId})).current,'2026-11-20');
    await record('compound-report',{passed:true,dateTypes:5,optionCount:long.options_total,selectedBeyondCap:long.currentValues.length,uploadedFiles:uploaded.filesTotal,crossOrigin:true,closedAx:true});
    passed('compound date/select/file metadata, long dropdown selection, ambiguity/disabled/controlled guards, real hidden input upload, bounded redacted HTML trees and shadow/AX/frame inspection');
  }finally{try{await call('close');}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
