import test from 'node:test';
import assert from 'node:assert/strict';
import { browserStateOptions, browserAxReference, summarizeBrowserAx, readBrowserAxState, validateBrowserAxReference } from '../background/browser-ax.js';
import { clearBrowserFrames, recordBrowserFrameEvent } from '../background/browser-frames.js';

const node=(id,role,name,extra={})=>({nodeId:String(id),backendDOMNodeId:id,role:{value:role},name:{value:name},...extra});
test('AX normalization keeps semantic nodes and repeated controls, omits values and ignored nodes, and reports bounded metrics',()=>{
  const nodes=[node(1,'RootWebArea','Example',{properties:[{name:'focusable',value:{value:true}}]}),node(2,'heading','Example heading',{parentId:'1'}),node(3,'button','Example repeated'),node(4,'button','Example repeated'),
    node(5,'textbox','Example password',{value:{value:'placeholder-password'},properties:[{name:'required',value:{value:true}},{name:'value',value:{value:'placeholder-password'}}]}),node(6,'button','Example hidden',{ignored:true}),node(7,'InlineTextBox','Example text')];
  const result=summarizeBrowserAx(nodes,2);
  assert.deepEqual(result.candidates.map(row=>row.backendDOMNodeId),[3,4]);assert.equal(result.metrics.interactiveNodes,3);
  assert.equal(result.metrics.truncated,true);assert.equal(result.metrics.roles.button,2);assert.equal(result.tree[1].depth,1);
  assert.equal(result.tree.some(row=>row.name==='Example hidden'),false);assert.equal(result.tree.some(row=>row.role==='InlineTextBox'),false);
  assert.equal(JSON.stringify({tree:result.tree,text:result.text,metrics:result.metrics}).includes('placeholder-password'),false);
});
test('snapshot options and opaque references reject malformed or conflicting frame/document identities',()=>{
  assert.deepEqual(browserStateOptions({}),{source:'dom',limit:100,compare:false});assert.equal(browserStateOptions({source:'ax',compareSources:'true',limit:'2'}).compare,true);
  for(const args of [{source:'unknown'},{limit:true},{limit:201},{compareSources:'yes'}])assert.throws(()=>browserStateOptions(args),{code:'INVALID_ARGUMENT'});
  const ref='ax:12:example-document:00000000-0000-4000-8000-000000000001:1';
  assert.deepEqual(browserAxReference({ref}),{ref,frameId:12,documentId:'example-document'});
  for(const args of [{ref,frameId:0},{ref,documentId:'example-other'},{ref:'ax:12:%:invalid:1'},{ref:'ax:0:example:not-a-snapshot:1'}])assert.throws(()=>browserAxReference(args),{code:'STALE_REF'});
});

async function fixture() {
  clearBrowserFrames(77);const calls=[],scripts=[];let axFailure=false,disappear=false,partialName='Example action';
  const chrome={scripting:{executeScript:async request=>{scripts.push(request);return[{frameId:12,documentId:'example-child',result:{ok:true,data:{url:'https://example.com/',title:'Example',metrics:{source:'dom',interactiveNodes:1}}}}];}},
    debugger:{sendCommand:async(source,method,params)=>{
      calls.push({source,method,params});
      if(method==='Runtime.evaluate') {
        if(params.expression.startsWith('this['))return{result:{value:true}};
        if(params.expression.startsWith('(()=>'))return{result:{value:{backendNodeId:4,ax:{role:'button',name:'Example action'}}}};
        return{result:{objectId:'example-snapshot'}};
      }
      if(method==='Accessibility.getFullAXTree'){if(axFailure)throw Error('Unsupported');return{nodes:[node(4,'button','Example action')]};}
      if(method==='Accessibility.getPartialAXTree')return{nodes:[node(4,'button',partialName)]};
      if(method==='DOM.resolveNode')return{object:{objectId:'example-node'}};
      if(method==='Runtime.callFunctionOn') {
        if(disappear)await recordBrowserFrameEvent(chrome,source,'Runtime.executionContextsCleared',{});
        return{result:{value:params.objectId==='example-snapshot'?{url:'https://example.com/',title:'Example'}:true}};
      }
      return{};
    }}};
  for(const isDefault of [true,false])await recordBrowserFrameEvent(chrome,{tabId:77,sessionId:'example-child-session'},'Runtime.executionContextCreated',{context:{id:isDefault?1:2,uniqueId:isDefault?'example-main':'example-isolated',auxData:{isDefault,frameId:'example-cdp-child'}}});
  return{chrome,calls,scripts,axFail:()=>{axFailure=true;},disappear:()=>{disappear=true;},rename:()=>{partialName='Example changed';}};
}
test('AX references bind backend nodes only into the selected isolated document, and remote handles are grouped and released',async()=>{
  const f=await fixture();const result=await readBrowserAxState(f.chrome,77,{source:'ax',frameId:12,documentId:'example-child'},async()=>{});
  assert.match(result.elements[0].ref,/^ax:12:example-child:/);assert.equal(result.frameId,12);
  assert.ok(f.calls.filter(call=>call.method.startsWith('Accessibility.')).every(call=>call.source.sessionId==='example-child-session'));
  const resolved=f.calls.find(call=>call.method==='DOM.resolveNode');assert.equal(resolved.params.executionContextId,2);assert.ok(resolved.params.objectGroup);
  assert.ok(f.calls.some(call=>call.method==='Runtime.releaseObjectGroup'&&call.params.objectGroup===resolved.params.objectGroup));
});
test('source comparison reports an AX failure without replacing current page references, and changed accessible names reject actions',async()=>{
  const f=await fixture();f.axFail();
  const comparison=await readBrowserAxState(f.chrome,77,{source:'dom',frameId:12,documentId:'example-child',compareSources:true},async()=>{});
  assert.equal(comparison.sources.ax.error.code,'AX_UNAVAILABLE');assert.equal(comparison.sources.dom.ok,true);
  assert.equal(f.calls.some(call=>call.method==='DOM.resolveNode'||call.method==='Runtime.callFunctionOn'),false);
  assert.ok(f.scripts.some(script=>script.args?.[1]?.metricsOnly));
  f.rename();await assert.rejects(validateBrowserAxReference(f.chrome,77,{frameId:12,documentId:'example-child',ref:'example-ref'},async()=>{},'click'),{code:'STALE_REF'});
});
test('context disappearance while resolving AX nodes prevents snapshot installation and still releases remote handles',async()=>{
  const f=await fixture();f.disappear();
  await assert.rejects(readBrowserAxState(f.chrome,77,{source:'ax',frameId:12,documentId:'example-child'},async()=>{}),{code:'FRAME_DOCUMENT_CHANGED'});
  assert.equal(f.calls.some(call=>call.method==='Runtime.callFunctionOn'&&call.params.objectId==='example-snapshot'),false);
  assert.ok(f.calls.some(call=>call.method==='Runtime.releaseObjectGroup'));
});
test('a blocked AX capture has a bounded deadline and never installs a late snapshot',async t=>{
  const f=await fixture();let ready;const started=new Promise(resolve=>{ready=resolve});const original=f.chrome.debugger.sendCommand;
  f.chrome.debugger.sendCommand=(source,method,params)=>{if(method==='Accessibility.getFullAXTree'){ready();return new Promise(()=>{});}return original(source,method,params);};
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=readBrowserAxState(f.chrome,77,{source:'ax',frameId:12,documentId:'example-child'},async()=>{});
  await started;const rejected=assert.rejects(pending,{code:'AX_SNAPSHOT_TIMEOUT'});t.mock.timers.tick(30001);await rejected;
  assert.equal(f.calls.some(call=>call.method==='Runtime.callFunctionOn'),false);assert.ok(f.calls.some(call=>call.method==='Runtime.releaseObjectGroup'));
});

test('a blocked AX reference validation times out without any input dispatch',async t=>{
  const f=await fixture();let ready;const started=new Promise(resolve=>{ready=resolve});const original=f.chrome.debugger.sendCommand;
  f.chrome.debugger.sendCommand=(source,method,params)=>{if(method==='Accessibility.getPartialAXTree'){ready();return new Promise(()=>{});}return original(source,method,params);};
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=validateBrowserAxReference(f.chrome,77,{frameId:12,documentId:'example-child',ref:'example-ref'},async()=>{},'click');
  await started;const rejected=assert.rejects(pending,{code:'AX_REFERENCE_TIMEOUT'});t.mock.timers.tick(30001);await rejected;
  assert.equal(f.calls.some(call=>call.method.startsWith('Input.')),false);
});
