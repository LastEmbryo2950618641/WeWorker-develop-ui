#!/usr/bin/env node
// Foundation probe only: does not claim generated frame workflow support.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const playwrightPath=process.argv.find(x=>x.startsWith('--playwright='))?.slice(13);
const executablePath=process.argv.find(x=>x.startsWith('--chromium='))?.slice(11);
const {chromium}=await import(playwrightPath?pathToFileURL(playwrightPath).href:'playwright');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'weworker-frame-identity-'));
console.log(root);
async function bounded(operation, milliseconds, message) {
 let timer;
 try { return await Promise.race([operation, new Promise((_, reject) => { timer=setTimeout(()=>reject(Error(message)),milliseconds); })]); }
 finally { clearTimeout(timer); }
}
const extension=path.join(root,'extension');
await fs.cp(path.join(repo,'weworker/build/extension-dist'),extension,{recursive:true});
for(const name of ['page-frame-context.js','page-workflow-frames.js']) await fs.copyFile(path.join(repo,'extension/background',name),path.join(extension,'background',name));
const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
const workerFile=path.join(extension,'background/service-worker.js');await fs.writeFile(workerFile,"import { withBrowserFrameContext, beginBrowserFrames, executeFrameScript } from './browser-frames.js'; import {resolvePageFrame} from './page-frame-context.js'; globalThis.__frameProbe={withBrowserFrameContext,beginBrowserFrames,ensureCdpAttached,executeFrameScript,resolvePageFrame};\n"+(await fs.readFile(workerFile,'utf8')).replaceAll('3711',String(reserve.address().port)));
let browser, worker;
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');const origin='http://localhost:'+server.address().port;
 res.end(req.url==='/entry'?`<!doctype html><iframe id="chosen" src="${origin}/child"></iframe><iframe id="other" src="${origin}/child"></iframe>`:req.url==='/child'?`<!doctype html><h1>Child</h1><iframe id="nested" src="http://127.0.0.1:${server.address().port}/leaf"></iframe>`:'<!doctype html><h1>Leaf</h1>');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 browser=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/entry');
 worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker',{timeout:10000});
 const output=await bounded(worker.evaluate(async()=>{
  const stage=value=>{globalThis.__frameProbeStage=value;};
  stage('map owner identities');
  const {withBrowserFrameContext,beginBrowserFrames,ensureCdpAttached,executeFrameScript,resolvePageFrame}=globalThis.__frameProbe;
  const tab=(await chrome.tabs.query({})).find(t=>t.url?.endsWith('/entry'));
  await ensureCdpAttached(tab.id);await beginBrowserFrames(chrome,tab.id);
  const frames=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:()=>({url:location.href})});
  const rows=[];
  for(const f of frames)await withBrowserFrameContext(chrome,tab.id,f,async()=>{},async({isolated,context})=>{
   const row={frameId:f.frameId,documentId:f.documentId,cdpFrameId:isolated.auxData.frameId,session:isolated.source.sessionId||'',url:f.result.url,owners:[]};
   for(const selector of ['#chosen','#other','#nested']){
    const object=await chrome.debugger.sendCommand(isolated.source,'Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(selector)})`,uniqueContextId:isolated.uniqueId});
    if(!object.result?.objectId)continue;
    const {node}=await chrome.debugger.sendCommand(isolated.source,'DOM.describeNode',{objectId:object.result.objectId});
    row.owners.push({selector,nodeName:node.nodeName,frameId:node.frameId,contentFrameId:node.contentDocument?.frameId,backendNodeId:node.backendNodeId});
    await chrome.debugger.sendCommand(isolated.source,'Runtime.releaseObject',{objectId:object.result.objectId});
   }rows.push(row);
  });
  const origin=new URL(tab.url).origin,cross=origin.replace('127.0.0.1','localhost');
  const path=[{selector:'#chosen',origin:cross,pathname:'/child'},{selector:'#nested',origin,pathname:'/leaf'}];
  stage('resolve selected frame');
  const pinned=await resolvePageFrame({chrome,tabId:tab.id,frames:path,ensureCdpAttached});
  await pinned.assertCurrent();
  const leaf=await executeFrameScript(chrome,tab.id,pinned.selected,()=>document.querySelector('h1').textContent,[]);
  if(leaf.result!=='Leaf')throw Error('Wrong leaf');
  let ambiguous;try{await resolvePageFrame({chrome,tabId:tab.id,frames:[{selector:'iframe',origin:cross,pathname:'/child'}],ensureCdpAttached});}catch(e){ambiguous=e.code;}
  if(ambiguous!=='PAGE_FRAME_TARGET_CHANGED')throw Error('Ambiguous owner was not refused');
  await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:()=>{const other=document.querySelector('#other');other.replaceWith(other.cloneNode());}});
  await new Promise(r=>setTimeout(r,150));await pinned.assertCurrent();
  await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:()=>{const chosen=document.querySelector('#chosen');chosen.replaceWith(chosen.cloneNode());}});
  await new Promise(r=>setTimeout(r,150));
  let replaced;try{await pinned.assertCurrent();}catch(e){replaced=e.code;}
  await pinned.release();
  if(!['PAGE_FRAME_DOCUMENT_CHANGED','PAGE_FRAME_TARGET_CHANGED','FRAME_UNAVAILABLE'].includes(replaced))throw Error('Same URL replacement was not refused: '+replaced);
  stage('resolve after selected replacement');
  const fresh=await resolvePageFrame({chrome,tabId:tab.id,frames:path,ensureCdpAttached});
  stage('reload parent');
  await chrome.tabs.reload(tab.id);
  await new Promise(r=>setTimeout(r,300));
  stage('reject replaced parent');
  let parentReplaced;try{await fresh.assertCurrent();}catch(e){parentReplaced=e.code;}await fresh.release();
  if(!['PAGE_FRAME_DOCUMENT_CHANGED','FRAME_UNAVAILABLE'].includes(parentReplaced))throw Error('Parent replacement not refused: '+parentReplaced);
  stage('resolve after parent replacement');
  let cancelled=false;
  const active=await resolvePageFrame({chrome,tabId:tab.id,frames:path,ensureCdpAttached,assertRunning:()=>{if(cancelled)throw Object.assign(Error('Cancelled'),{code:'PAGE_WORKFLOW_CANCELLED'});}});
  cancelled=true;let cancelCode;try{await active.assertCurrent();}catch(e){cancelCode=e.code;}await active.release();
  if(cancelCode!=='PAGE_WORKFLOW_CANCELLED')throw Error('Cancellation was not retained');
  return {rows,checks:{read:leaf.result,ambiguous,replaced,parentReplaced,cancelCode}};
 }),45000,'Frame foundation probe exceeded its 45 second budget.');
 const main=output.rows.find(r=>r.frameId===0);assert.equal(main.owners.length,2);
 for(const owner of output.rows.flatMap(r=>r.owners))assert.equal(output.rows.filter(r=>r.cdpFrameId===owner.frameId).length,1,JSON.stringify(owner));
 assert.notEqual(main.owners[0].frameId,main.owners[1].frameId);
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,...output},null,2));
 console.log('PASS owner identities for duplicate URLs and nested cross-origin frames; ambiguity, unrelated replacement, selected/parent same-URL replacement and cancellation',output.rows.length);
}catch(error){
 let stage;try{stage=await bounded(worker?.evaluate(()=>globalThis.__frameProbeStage),1000,'Stage read timeout');}catch{}
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify({passed:false,stage,error:String(error)},null,2));
 throw error;
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>reserve.close(r));}
