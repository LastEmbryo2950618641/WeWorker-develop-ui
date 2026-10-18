import { executeFrameScript, withBrowserFrameContext } from './browser-frames.js';
import { runBrowserPageCommand } from './browser-page.js';

const fail = (code, message) => Object.assign(new Error(message), { code });
const roles = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const propertyNames = new Set(['disabled', 'checked', 'expanded', 'selected', 'required', 'readonly', 'focused', 'focusable', 'level', 'multiselectable']);
const roleOf = node => String(node.role?.value || '');
const nameOf = node => String(node.name?.value || '').slice(0, 500);
const propsOf = node => Object.fromEntries((node.properties || []).filter(item => propertyNames.has(item.name) && ['boolean','string','number'].includes(typeof item.value?.value)).map(item => [item.name, item.value.value]));

export function browserStateOptions(args) {
  const source = args.source ?? 'dom';
  if (!['dom', 'ax'].includes(source)) throw fail('INVALID_ARGUMENT', 'source must be dom or ax.');
  if (args.compareSources !== undefined && ![true, false, 'true', 'false'].includes(args.compareSources)) throw fail('INVALID_ARGUMENT', 'compareSources must be true or false.');
  const limit = args.limit === undefined ? 100 : (typeof args.limit === 'number' || (typeof args.limit === 'string' && /^\d+$/.test(args.limit))) ? Number(args.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw fail('INVALID_ARGUMENT', 'limit must be 1–200.');
  return { source, limit, compare: args.compareSources === true || args.compareSources === 'true' };
}

/** The document identity travels with an opaque ref; only the isolated Map can
 * authorize it. A forged token never resolves a replacement element. */
export function browserAxReference(args) {
  if (typeof args.ref !== 'string' || !args.ref.startsWith('ax:')) return args;
  const parts = args.ref.split(':');
  let documentId;
  try { documentId = decodeURIComponent(parts[2]); } catch { throw fail('STALE_REF', 'Malformed AX reference. Read browser.state again.'); }
  if (parts.length !== 5 || !/^(0|[1-9]\d*)$/.test(parts[1]) || !Number.isSafeInteger(Number(parts[1])) || !documentId || documentId.length > 200 || !/^[a-f0-9-]{36}$/.test(parts[3]) || !/^[1-9]\d*$/.test(parts[4])) throw fail('STALE_REF', 'Malformed AX reference. Read browser.state again.');
  if ((args.frameId !== undefined && String(args.frameId) !== parts[1]) || (args.documentId !== undefined && args.documentId !== documentId)) throw fail('STALE_REF', 'AX reference belongs to a different frame/document. Read browser.state again.');
  return { ...args, frameId: Number(parts[1]), documentId };
}

export function summarizeBrowserAx(nodes, limit) {
  const byId = new Map(nodes.map(node => [node.nodeId, node])), depths = new Map();
  const depthOf = (node, seen = new Set()) => {
    if (depths.has(node.nodeId)) return depths.get(node.nodeId);
    if (seen.size > 100 || seen.has(node.nodeId)) return 100;
    seen.add(node.nodeId); const parent = byId.get(node.parentId);
    const depth = parent ? depthOf(parent, seen) + 1 : 0; depths.set(node.nodeId, depth); return depth;
  };
  const exposed = nodes.filter(node => !node.ignored), interactive = exposed.filter(node => roles.has(roleOf(node)) || (propsOf(node).focusable === true && !['RootWebArea','WebArea'].includes(roleOf(node))));
  const semantic = exposed.filter(node => !['none', 'generic', 'InlineTextBox'].includes(roleOf(node)));
  const tree = semantic.slice(0, 1000).map(node => ({ role: roleOf(node), name: nameOf(node), depth: depthOf(node), properties: propsOf(node) }));
  const text = tree.map(node => `${'  '.repeat(Math.min(20, node.depth))}${node.role}${node.name ? ' ' + node.name : ''}`).join('\n');
  return { tree, text: text.slice(0, 12000), candidates: interactive.slice(0, limit),
    metrics: { source: 'ax', totalNodes: nodes.length, ignoredNodes: nodes.length - exposed.length, interactiveNodes: interactive.length,
      namedInteractiveNodes: interactive.filter(node => nameOf(node)).length, textChars: Math.min(text.length,12000),
      roles: Object.fromEntries([...new Set(interactive.map(roleOf))].map(role => [role, interactive.filter(node => roleOf(node) === role).length])),
      truncated: semantic.length > tree.length || text.length > 12000 || interactive.length > limit } };
}

export async function readBrowserAxState(chrome, tabId, args, ensureCdpAttached) {
  const {limit,compare}=browserStateOptions(args);
  if(args.frameId!==undefined||args.documentId!==undefined)return readBrowserAxFrame(chrome,tabId,args,ensureCdpAttached);
  // Source=ax follows the page's accessible frame tree by default. Explicit
  // frame/document selection keeps one-frame scope; refs always retain it.
  const discovered=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:()=>null});
  const frames=discovered.filter(frame=>frame.documentId).sort((a,b)=>a.frameId===0?-1:b.frameId===0?1:a.frameId-b.frameId);
  if(!frames.some(frame=>frame.frameId===0))throw fail('FRAME_UNAVAILABLE','The main document is unavailable.');
  const captured=[],details=[],deadline=Date.now()+30000;let remaining=limit;
  for(const frame of frames.slice(0,50)) {
    if(!compare&&remaining===0){details.push({frameId:frame.frameId,documentId:frame.documentId,ok:false,skipped:'element_limit'});continue;}
    if(Date.now()>=deadline){details.push({frameId:frame.frameId,documentId:frame.documentId,ok:false,skipped:'deadline'});continue;}
    try {
      const result=await readBrowserAxFrame(chrome,tabId,{...args,frameId:frame.frameId,documentId:frame.documentId,limit:compare?limit:remaining,_axDeadline:deadline},ensureCdpAttached);
      captured.push(result);remaining-=result.elements?.length||0;
      details.push({frameId:frame.frameId,documentId:frame.documentId,ok:true,...(compare?{sources:result.sources}:{metrics:result.metrics})});
    }catch(error){if(frame.frameId===0)throw error;details.push({frameId:frame.frameId,documentId:frame.documentId,ok:false,error:{code:error.code||'AX_UNAVAILABLE',message:error.code?error.message:'The frame could not be observed.'}});}
  }
  const partial=frames.length>50||details.some(frame=>!frame.ok||(compare&&(!frame.sources.dom.ok||!frame.sources.ax.ok))),base=captured[0];
  if(!base)throw fail('AX_SNAPSHOT_TIMEOUT','No frame completed within the snapshot deadline.');
  await executeFrameScript(chrome,tabId,{frameId:0,documentId:base.documentId},()=>null,[]);
  const aggregate=source=>{
    const rows=details.filter(frame=>frame.ok).map(frame=>compare?frame.sources[source]:frame.metrics),good=rows.filter(row=>row.ok!==false);
    const roles={};for(const row of good)for(const [role,count]of Object.entries(row.roles||{}))roles[role]=(roles[role]||0)+count;
    return {source,ok:good.length>0,frames:rows.length,failedFrames:rows.length-good.length,roles,interactiveNodes:good.reduce((sum,row)=>sum+row.interactiveNodes,0),textChars:good.reduce((sum,row)=>sum+row.textChars,0),
      namedInteractiveNodes:good.reduce((sum,row)=>sum+row.namedInteractiveNodes,0),elapsedMs:good.reduce((sum,row)=>sum+row.elapsedMs,0),
      truncated:partial||rows.some(row=>row.ok===false||row.truncated)};
  };
  const common={url:base.url,title:base.title,scope:'accessible_frames',frames:details,discoveredFrames:frames.length,frameLimit:50,partial};
  if(compare)return {...common,comparison:'snapshot_sources',sources:{dom:aggregate('dom'),ax:aggregate('ax')}};
  const tree=captured.flatMap(result=>result.tree.map(node=>({...node,frameId:result.frameId,documentId:result.documentId}))),text=captured.map(result=>`frame ${result.frameId}\n${result.text}`).join('\n');
  return {...common,source:'ax',snapshotId:base.snapshotId,frameId:0,documentId:base.documentId,matches:captured.reduce((sum,result)=>sum+result.matches,0),
    elements:captured.flatMap(result=>result.elements.map(node=>({...node,frameId:result.frameId,documentId:result.documentId}))),tree:tree.slice(0,1000),text:text.slice(0,12000),
    metrics:aggregate('ax'),truncated:partial||tree.length>1000||text.length>12000||captured.some(result=>result.truncated)};
}

async function readBrowserAxFrame(chrome, tabId, args, ensureCdpAttached) {
  const { limit, compare } = browserStateOptions(args);
  return withBrowserFrameContext(chrome, tabId, args, ensureCdpAttached, async ({ isolated, selected, state }) => {
    const started = Date.now(), deadline=args._axDeadline??started+30000, group = `weworker-ax-${crypto.randomUUID()}`;
    const send = async (method, params) => {
      let timer; const remaining=deadline-Date.now();
      if(remaining<=0)throw fail('AX_SNAPSHOT_TIMEOUT','AX snapshot preparation exceeded 30 seconds.');
      try{return await Promise.race([chrome.debugger.sendCommand(isolated.source,method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('AX_SNAPSHOT_TIMEOUT','AX snapshot preparation exceeded 30 seconds.')),remaining);})]);}
      finally{clearTimeout(timer);}
    };
    const current = () => {
      if (![...state.contexts.values()].some(item => item.uniqueId === isolated.uniqueId && item.source.sessionId === isolated.source.sessionId)) throw fail('FRAME_DOCUMENT_CHANGED', 'The snapshot document changed. Read browser.frames/state again.');
      if (Date.now() >= deadline) throw fail('AX_SNAPSHOT_TIMEOUT', 'AX snapshot preparation exceeded 30 seconds. Read current page state before retrying.');
    };
    try {
      let captured, summary, axError;
      try { captured = await send('Accessibility.getFullAXTree', { frameId: isolated.auxData.frameId }); }
      catch(error) { if(error.code==='AX_SNAPSHOT_TIMEOUT')throw error;axError = fail('AX_UNAVAILABLE', 'Chrome could not capture accessibility data for the selected frame. Inspect the page or explicitly select source=dom.'); }
      current();
      if (!axError && (!Array.isArray(captured?.nodes) || !captured.nodes.length)) axError = fail('AX_UNAVAILABLE', 'The selected frame has no accessibility tree.');
      if (!axError) summary = summarizeBrowserAx(captured.nodes, limit);
      if (compare) {
        const ax = axError ? {ok:false,error:{code:axError.code,message:axError.message},elapsedMs:Date.now()-started} : { ok: true, ...summary.metrics, elapsedMs: Date.now() - started };
        const domStarted = Date.now();
        const dom = await executeFrameScript(chrome, tabId, selected, runBrowserPageCommand, ['state', { limit, metricsOnly: true }]); current();
        if (!dom.result?.ok) throw fail('PAGE_UNAVAILABLE', 'The DOM source could not be measured in the same document.');
        return { frameId: selected.frameId, documentId: selected.documentId, capturedAt:Date.now(), url: dom.result.data.url, title: dom.result.data.title,
          comparison: 'snapshot_sources', sources: { dom: { ok: true, ...dom.result.data.metrics, elapsedMs: Date.now() - domStarted }, ax } };
      }
      if (axError) throw axError;
      const snapshotId = crypto.randomUUID();
      const snapshot = await send('Runtime.evaluate', { uniqueContextId: isolated.uniqueId, objectGroup:group,
        expression: `({snapshotId:${JSON.stringify(snapshotId)},source:'ax',deadline:${deadline},document:document,url:location.href,title:document.title,refs:new Map()})` });
      const snapshotObject = snapshot.result?.objectId;
      if (!snapshotObject || snapshot.exceptionDetails) throw fail('FRAME_DOCUMENT_CHANGED', 'The snapshot document is unavailable.');
      const elements = []; let unresolved = 0;
      for (const node of summary.candidates) {
        current(); if (!node.backendDOMNodeId) { unresolved++; continue; }
        const ref = `ax:${selected.frameId}:${encodeURIComponent(selected.documentId)}:${snapshotId}:${elements.length + 1}`;
        const ax = {role:roleOf(node),name:nameOf(node)};
        let objectId;
        try {
          const resolved = await send('DOM.resolveNode', {backendNodeId:node.backendDOMNodeId,executionContextId:isolated.id,objectGroup:group});
          objectId = resolved.object?.objectId; if (!objectId) {unresolved++;continue;}
          const registered = await send('Runtime.callFunctionOn', {objectId, returnByValue:true, functionDeclaration:
            'function(snapshot,ref,backendNodeId,ax){if(this.nodeType!==1||this.ownerDocument!==snapshot.document||!this.isConnected)return false;snapshot.refs.set(ref,{node:this,backendNodeId,ax});return true;}',
            arguments:[{objectId:snapshotObject},{value:ref},{value:node.backendDOMNodeId},{value:ax}]});
          current();
          if (registered.result?.value !== true) {unresolved++;continue;}
        } catch(error) { if(error.code)throw error;current();unresolved++;continue; }
        elements.push({ref,...ax,properties:propsOf(node)});
      }
      current();
      const committed = await send('Runtime.callFunctionOn', {objectId:snapshotObject,returnByValue:true,
        functionDeclaration:'function(){if(Date.now()>this.deadline||this.document!==document||this.url!==location.href)return null;globalThis.__weworkerBrowserSnapshot=this;return {url:this.url,title:this.title};}'});
      current(); if (!committed.result?.value) throw fail('FRAME_DOCUMENT_CHANGED','The document changed while building its snapshot.');
      return {...committed.result.value,source:'ax',snapshotId,capturedAt:Date.now(),frameId:selected.frameId,documentId:selected.documentId,
        matches:summary.metrics.interactiveNodes,elements,tree:summary.tree,text:summary.text,
        metrics:{...summary.metrics,returnedElements:elements.length,unresolvedElements:unresolved,elapsedMs:Date.now()-started},truncated:summary.metrics.truncated||unresolved>0};
    } finally {
      let timer;
      try {await Promise.race([chrome.debugger.sendCommand(isolated.source,'Runtime.releaseObjectGroup',{objectGroup:group}),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);} catch {} finally{clearTimeout(timer);}
    }
  });
}

export async function validateBrowserAxReference(chrome,tabId,args,ensureCdpAttached,command) {
  return withBrowserFrameContext(chrome,tabId,args,ensureCdpAttached,async({isolated})=>{
    const deadline=Date.now()+30000;
    const send=async(method,params)=>{
      let timer;const remaining=deadline-Date.now();
      if(remaining<=0)throw fail('AX_REFERENCE_TIMEOUT','AX reference validation timed out; no action was dispatched. Read current state again.');
      try{return await Promise.race([chrome.debugger.sendCommand(isolated.source,method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('AX_REFERENCE_TIMEOUT','AX reference validation timed out; no action was dispatched. Read current state again.')),remaining);})]);}
      finally{clearTimeout(timer);}
    };
    const result=await send('Runtime.evaluate',{uniqueContextId:isolated.uniqueId,returnByValue:true,expression:
      `(()=>{const s=globalThis.__weworkerBrowserSnapshot,e=s?.refs.get(${JSON.stringify(args.ref)});return s?.source==='ax'&&s.url===location.href&&e?.node.isConnected&&e.node.ownerDocument===document?{backendNodeId:e.backendNodeId,ax:e.ax}:null})()`});
    const entry=result.result?.value;
    if(!entry) throw fail('STALE_REF','AX reference expired. Read browser.state again; no replacement element was selected.');
    let nodes;
    try{({nodes}=await send('Accessibility.getPartialAXTree',{backendNodeId:entry.backendNodeId,fetchRelatives:false}));}
    catch(error){if(error.code==='AX_REFERENCE_TIMEOUT')throw error;throw fail('STALE_REF','The referenced accessibility node is unavailable. Read browser.state again.');}
    const node=nodes?.find(node=>node.backendDOMNodeId===entry.backendNodeId&&!node.ignored);
    if(!node||roleOf(node)!==entry.ax.role||nameOf(node)!==entry.ax.name)throw fail('STALE_REF','The referenced accessible role/name changed. Read browser.state again.');
    if(!['get','find','extract'].includes(command)&&propsOf(node).disabled===true)throw fail('ELEMENT_DISABLED','The accessibility target is disabled.');
  });
}
