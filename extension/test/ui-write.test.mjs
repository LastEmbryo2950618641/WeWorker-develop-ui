import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { pageUiSubmit, uiWriteRequest } from '../background/ui-write.js';
import { executePageRequest } from '../background/page-write.js';

const origin='https://example.com';
const ui={version:1,url:origin+'/items/example',method:'POST',form:'#form',inputMode:'native-setter-no-events',inputs:[{selector:'#title',name:'title',parameter:'title'}],submit:{selector:'#submit',text:'Save'},confirmation:{selector:'#receipt',attribute:'data-title',parameter:'title'}};
function fixture(mode) {
  let submissions=0, events=0;
  class Element {
    constructor(){this.isConnected=true;this.attrs={};this.name='';this.value='';this.validity={valid:true};}
    querySelectorAll(selector){return this.children?.[selector]||[];}
    matches(){return this.disabled===true;}
    getBoundingClientRect(){return {width:100,height:20};}
    closest(){return null;}
    hasAttribute(k){return Object.hasOwn(this.attrs,k);}
    getAttribute(k){return this.attrs[k]??null;}
    dispatchEvent(){events++;}
  }
  class Input extends Element {get value(){return this._value;}set value(v){this._value=v; if(mode==='replaced' && v==='After')this.isConnected=false;}}
  class Textarea extends Input {}
  class Button extends Element {}
  class Form extends Element {requestSubmit(){submissions++; if(mode==='lost')return; receipt.attrs['data-title']=input.value;}}
  const form=new Form(),input=new Input(),button=new Button(),receipt=new Element();
  Object.assign(form,{action:ui.url,method:'post',target:'',enctype:'application/x-www-form-urlencoded'});
  Object.assign(input,{type:'text',name:'title',form,willValidate:true});Object.assign(button,{type:'submit',textContent:'Save',form});
  form.children={'#title':[input],'#submit':[button]};form.elements=[input,button];
  const document={querySelectorAll:selector=>({'#form':[form],'#receipt':[receipt]}[selector]||[])};
  if(mode==='disabled')button.disabled=true;
  if(mode==='extra')form.elements.push(Object.assign(new Input(),{name:'extra'}));
  if(mode==='override')button.attrs.formaction=origin+'/other';
  if(mode==='ambiguous')form.children['#title'].push(new Input());
  if(mode==='stale')receipt.attrs['data-title']='After';
  if(mode==='invalid')input.validity.valid=false;
  if(mode==='password')input.type='password';
  const context=vm.createContext({location:{href:origin+'/editor'},__weworkerWriteDocumentToken:'example',document,
    HTMLFormElement:Form,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,HTMLButtonElement:Button,
    getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),setTimeout});
  const run=patch=>vm.runInContext(`(${pageUiSubmit.toString()})(${JSON.stringify({ui,documentUrl:origin+'/editor',documentToken:'example',request:{url:ui.url,method:'POST',body:{title:'After'}},deadline:Date.now()+150,...patch})})`,context);
  return {run,count:()=>({submissions,events}),input};
}
test('uses native setters without events and exactly one native submit with correlated acknowledgement',async()=>{
  const f=fixture();const reply=await f.run();assert.equal(reply.ok,true);assert.equal(reply.value.confirmationMatched,true);assert.deepEqual(f.count(),{submissions:1,events:0});assert.equal(f.input.value,'After');
});
test('preflight rejects unsupported, replaced, ambiguous or stale nodes and invalid data without submission',async()=>{
  for(const mode of ['disabled','extra','override','ambiguous','stale','invalid','password','replaced']){
    const f=fixture(mode);assert.equal((await f.run()).ok,false,mode);assert.equal(f.count().submissions,0,mode);
  }
  for(const patch of [{documentToken:'wrong'},{deadline:Date.now()-1},{documentUrl:origin+'/other'}]){
    const f=fixture();assert.equal((await f.run(patch)).ok,false);assert.equal(f.count().submissions,0);
  }
});
test('missing acknowledgement times out after one submit without replay',async()=>{
  const f=fixture('lost'),reply=await f.run({deadline:Date.now()+30});assert.equal(reply.error.code,'UI_WRITE_TIMEOUT');assert.equal(reply.submitted,true);assert.equal(f.count().submissions,1);
});
test('UI dispatch shares exact document/confirmation and cancellation guards without injecting an idempotency fetch',async()=>{
  const calls=[];let changed=false;
  const chrome={tabs:{get:async()=>({url:origin+'/editor'})},debugger:{sendCommand:async(_target,method,params)=>{
    calls.push({method,params});if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main',loaderId:changed?'new':'old',url:origin+'/editor'}}};
    if(method==='Page.createIsolatedWorld')return {executionContextId:1};
    if(method==='Runtime.evaluate'&&params.expression.includes('async function pageUiSubmit'))return {result:{value:{ok:true,value:{ok:true,submitted:true,confirmationMatched:true}}}};
  }}};
  const payload={route:{origin,pathname:'/editor'},ui,request:{url:ui.url,method:'POST',body:{title:'After'}},confirmed:true,deadline:Date.now()+1000};
  const execute=patch=>executePageRequest({chrome,ensureCdpAttached:async()=>{},tabId:7,payload:{...payload,...patch}});
  assert.equal((await execute()).ok,true);
  assert.equal(calls.filter(v=>v.params?.expression?.includes('async function pageUiSubmit')).length,1);
  assert.equal(calls.some(v=>v.params?.expression?.includes('async function pageJsonRequest')),false);
  assert.equal((await execute({confirmed:false})).dispatched,false);
  changed=true;assert.equal((await execute({expectedDocument:{frameId:'main',loaderId:'old',url:origin+'/editor'}})).dispatched,false);
  const cancelled=await executePageRequest({chrome,tabId:7,ensureCdpAttached:async()=>{},payload,assertRunning:()=>{throw new Error('Example cancel');}});assert.equal(cancelled.dispatched,false);
});
test('ordinary UI arguments require exact booleans and strings',()=>{
  const command={runtime:'extension',safety:'write',uiWrite:ui};
  assert.equal(uiWriteRequest(command,{title:'007 示例',__confirmed:true}).body.title,'007 示例');
  for(const args of [{title:'After'},{title:'After',__confirmed:'true'},{title:1,__confirmed:true},{title:'After',extra:'x',__confirmed:true},{title:'\n',__confirmed:true}])assert.throws(()=>uiWriteRequest(command,args));
});
