import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {runBrowserPageCommand} from '../background/browser-page.js';

function fixture(overrides={}){
  const attrs={...overrides.attrs};
  const node={tagName:'INPUT',type:'date',value:'2026-11-20',children:[],childNodes:[],textContent:'',isConnected:true,
    getClientRects:()=>[{}],getAttribute:name=>attrs[name]??null,getRootNode:()=>document,matches:()=>false,scrollIntoView(){},focus(){},dispatchEvent(){},
    ...overrides};
  Object.defineProperty(node,'attributes',{get:()=>Object.entries(attrs).map(([name,value])=>({name,value}))});
  const document={title:'Example',body:node,documentElement:node,querySelectorAll:()=>[node],getElementById:()=>null};node.ownerDocument=document;
  const context=vm.createContext({document,location:{href:'https://example.com/'},ShadowRoot:class {},getComputedStyle:()=>({visibility:'visible'}),crypto:globalThis.crypto,Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}}});
  const fn=vm.runInContext(`(${runBrowserPageCommand.toString()})`,context);
  return{node,attrs,run:async(command,args)=>JSON.parse(JSON.stringify(await fn(command,args)))};
}
const option=(value,label,selected=false,extra={})=>({value,label,textContent:label,selected,matches:()=>false,getAttribute:()=>null,...extra});

test('date metadata preserves native values, constraints and validity without guessing locale formats',async()=>{
  for(const type of ['date','time','datetime-local','month','week']){
    const f=fixture({type,attrs:{min:'example-min',max:'example-max',step:'0.001'},required:true,validity:{valid:false,stepMismatch:true}});
    const result=(await f.run('get',{selector:'input',property:'compound'})).data.value;
    assert.equal(result.control,type);assert.ok(result.format);assert.equal(result.current,'2026-11-20');assert.equal(result.step,'0.001');assert.equal(result.required,true);assert.equal(result.validity.stepMismatch,true);
  }
  assert.equal((await fixture({type:'password',value:'placeholder-secret'}).run('get',{selector:'input',property:'compound'})).error.code,'SENSITIVE_FIELD');
});

test('select current state includes selections beyond the option cap, with explicit per-field truncation',async()=>{
  const options=Array.from({length:75},(_,i)=>option(String(i),'Example '+i,i===70||i===72));
  const f=fixture({tagName:'SELECT',type:'select-multiple',multiple:true,options});
  const info=(await f.run('get',{selector:'select',property:'compound'})).data.value;
  assert.equal(info.options.length,50);assert.equal(info.options_total,75);assert.equal(info.truncated.options,true);
  assert.deepEqual(info.current,['Example 70','Example 72']);assert.deepEqual(info.currentValues,['70','72']);assert.equal(info.selectedTotal,2);
  options[70].label='x'.repeat(201);assert.equal((await f.run('get',{selector:'select',property:'compound'})).data.value.truncated.current,true);
});

test('explicit file metadata reports only names and constraints, including hidden native inputs',async()=>{
  const f=fixture({type:'file',multiple:true,accept:'.txt',files:[{name:'example.txt',path:'/private/example.txt'}],getClientRects:()=>[]});
  const result=await f.run('get',{selector:'input',property:'compound'});
  assert.deepEqual(result.data.value.current,['example.txt']);assert.equal(result.data.value.accept,'.txt');assert.equal(JSON.stringify(result).includes('/private/'),false);
});

test('selection resolves label attributes, rejects collisions/disabled options before mutation and verifies page retention',async()=>{
  const options=[option('first','Example',true),option('second','Example'),option('Example','Distinct')];
  let events=0;const f=fixture({tagName:'SELECT',options,multiple:false,dispatchEvent:()=>{events++;}});
  assert.equal((await f.run('select',{selector:'select',value:'Example'})).error.code,'AMBIGUOUS_OPTION');assert.equal(events,0);assert.equal(options[0].selected,true);
  assert.equal((await f.run('select',{selector:'select',value:'Example',by:'value'})).ok,true);assert.equal(options[2].selected,true);
  options[1].matches=()=>true;
  assert.equal((await f.run('select',{selector:'select',value:'second',by:'value'})).error.code,'OPTION_NOT_FOUND');
  options[0].label='Example label attribute';options[0].textContent='Different text';
  assert.equal((await f.run('select',{selector:'select',value:'Example label attribute',by:'label'})).ok,true);
  f.node.dispatchEvent=()=>{options[0].selected=false;options[2].selected=true;};
  assert.equal((await f.run('select',{selector:'select',value:'first',by:'value'})).error.code,'SELECTION_REJECTED');
});

test('structured HTML has node/depth/text/child limits and omits passwords, event code and script bodies',async()=>{
  const f=fixture({tagName:'DIV',type:undefined,attrs:{id:'example-root',onclick:'placeholder-script'},childNodes:[{nodeType:3,textContent:'Example long text'}]});
  const child=(tag,extra={})=>({tagName:tag,attributes:[],children:[],childNodes:[],...extra});
  f.node.children=[child('INPUT',{type:'password',attributes:[{name:'type',value:'password'},{name:'value',value:'placeholder-secret'}]}),child('SCRIPT',{textContent:'placeholder-script'}),child('DIV',{children:[child('BUTTON',{children:[child('SPAN')]})]})];
  const result=(await f.run('get',{property:'html',as:'json',depth:1,textMax:4})).data;
  assert.equal(result.value.text,'Exam');assert.equal(result.truncated.text,true);assert.equal(result.truncated.depth,true);assert.equal(result.truncated.omittedContent,true);assert.equal(result.value.children[0].redacted,true);
  assert.equal(JSON.stringify(result).includes('placeholder-'),false);
  assert.equal((await f.run('get',{property:'html',as:'json',maxNodes:1})).data.truncated.nodes,true);
  assert.equal((await f.run('get',{property:'html',as:'json',childrenMax:1})).data.truncated.children,true);
  const rootOnly=(await f.run('get',{property:'html',as:'json',depth:0})).data;assert.equal(rootOnly.nodes,1);assert.equal(rootOnly.truncated.depth,true);
  for(const args of [{property:'text',as:'json'},{property:'html',depth:1},{property:'html',as:'json',maxNodes:0}])assert.equal((await f.run('get',{selector:'div',...args})).error.code,'INVALID_ARGUMENT');
});

test('compound output can be omitted and resource limits never masquerade as complete options',async()=>{
  const f=fixture({tagName:'SELECT',options:Array.from({length:20001},()=>option('x','Example'))});
  assert.equal((await f.run('get',{selector:'select',property:'compound'})).data.value.omitted,'option_scan_limit');
  assert.equal((await f.run('find',{selector:'select',compound:false})).data.elements[0].compound,undefined);
  assert.equal((await f.run('select',{selector:'select',value:'x'})).error.code,'SELECTION_LIMIT');
});

test('aggregate compound budget marks omitted controls without exceeding the response budget',async()=>{
  const f=fixture({tagName:'DIV',type:undefined});
  f.node.children=Array.from({length:20},()=>({tagName:'SELECT',attributes:[],children:[],childNodes:[],options:Array.from({length:50},()=>option('v'.repeat(500),'L'.repeat(200)))}));
  const result=(await f.run('get',{property:'html',as:'json'})).data;
  assert.equal(result.truncated.compounds,true);assert.ok(result.value.children.some(row=>row.compound.omitted==='response_budget'));assert.ok(JSON.stringify(result).length<110000);
});

test('structured tree bounds custom tag and data attribute names as well as values',async()=>{
  const f=fixture({tagName:'EXAMPLE-'+ 'X'.repeat(1000),type:undefined,attrs:{['data-'+ 'a'.repeat(1000)]:'example',title:'Example title'}});
  const result=(await f.run('get',{property:'html',as:'json'})).data;
  assert.equal(result.value.tag.length,200);assert.equal(result.value.attrs.title,'Example title');assert.equal(Object.keys(result.value.attrs).length,1);assert.equal(result.truncated.attributes,true);assert.equal(result.truncated.tags,true);
});
