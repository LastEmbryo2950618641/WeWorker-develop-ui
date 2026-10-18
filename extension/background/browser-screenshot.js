import { executeFrameScript } from './browser-frames.js';
import { runBrowserPageCommand } from './browser-page.js';

const fail = (code, message, details) => Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
const MAX_PIXELS = 40000000;
export function browserScreenshotOptions(args) {
  const boolean = name => {
    if (args[name] === undefined) return false;
    if (![true,false,'true','false'].includes(args[name])) throw fail('INVALID_ARGUMENT', `${name} must be true or false.`);
    return args[name] === true || args[name] === 'true';
  };
  const dimension = name => {
    if (args[name] === undefined) return undefined;
    const number = (typeof args[name] === 'number' || (typeof args[name] === 'string' && /^\d+$/.test(args[name]))) ? Number(args[name]) : NaN;
    if (!Number.isInteger(number) || number < 1 || number > 8192) throw fail('INVALID_ARGUMENT', `${name} must be 1–8192 CSS pixels.`);
    return number;
  };
  return {fullPage:boolean('fullPage'),annotate:boolean('annotate'),width:dimension('width'),height:dimension('height')};
}

// Isolated-world measurements: no overlay, event handlers, or page-owned script.
export function screenshotPageState(annotations = false, restoreScroll) {
  if (restoreScroll) scrollTo({left:restoreScroll.x,top:restoreScroll.y,behavior:'instant'});
  const snapshot=globalThis.__weworkerBrowserSnapshot;
  return {url:location.href,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,x:scrollX,y:scrollY,
    screen:{width:screen.width,height:screen.height},scale:visualViewport?.scale||1,
    ...(annotations ? {snapshotId:snapshot?.snapshotId,annotations:[...(snapshot?.refs||[])].flatMap(([ref,entry])=>{
      const node=entry.node;if(!node.isConnected||node.ownerDocument!==document||!node.getClientRects().length||getComputedStyle(node).visibility==='hidden')return[];
      const rect=node.getBoundingClientRect();
      return [{ref,x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height}];
    })} : {})};
}
export function screenshotGeometryStable(before, after) {
  if(before.url!==after.url||before.snapshotId!==after.snapshotId||before.annotations.length!==after.annotations.length)return false;
  return before.annotations.every((item,index)=>item.ref===after.annotations[index].ref&&['x','y','width','height'].every(key=>Math.abs(item[key]-after.annotations[index][key])<=0.5));
}
export function screenshotLabels(snapshot, geometry, clip) {
  return geometry.annotations.flatMap(rect=>{
    const element=snapshot.elements.find(item=>item.ref===rect.ref);
    const left=Math.max(rect.x,clip.x),top=Math.max(rect.y,clip.y),right=Math.min(rect.x+rect.width,clip.x+clip.width),bottom=Math.min(rect.y+rect.height,clip.y+clip.height);
    if(!element||right-left<1||bottom-top<1)return[];
    return [{ref:rect.ref,role:element.role,name:element.name,bounds:{x:left-clip.x,y:top-clip.y,width:right-left,height:bottom-top}}];
  }).map((item,index)=>({...item,label:String(index+1)}));
}
export function screenshotPngSize(data) {
  const header=atob(String(data).slice(0,44));
  if(header.slice(1,4)!=='PNG'||header.length<24)throw fail('SCREENSHOT_INVALID','Chrome did not return a PNG image.');
  const uint=offset=>[0,1,2,3].reduce((value,i)=>value*256+header.charCodeAt(offset+i),0);
  const width=uint(16),height=uint(20);
  if(!width||!height||width*height>MAX_PIXELS)throw fail('SCREENSHOT_TOO_LARGE','Screenshot exceeds 40 million image pixels. Use smaller dimensions or a viewport screenshot.');
  return {width,height};
}
async function annotateScreenshot(data, size, clip, annotations) {
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  try {
    const canvas=new OffscreenCanvas(size.width,size.height),ctx=canvas.getContext('2d');
    if(!ctx)throw fail('SCREENSHOT_ANNOTATION_UNAVAILABLE','A screenshot drawing context is unavailable.');
    ctx.drawImage(bitmap,0,0);const sx=size.width/clip.width,sy=size.height/clip.height;
    ctx.scale(sx,sy);ctx.font='bold 13px sans-serif';ctx.textBaseline='top';ctx.lineWidth=2;
    for(const {label,bounds:b}of annotations){
      ctx.strokeStyle='#e11d48';ctx.strokeRect(b.x+1,b.y+1,Math.max(0,b.width-2),Math.max(0,b.height-2));
      const w=Math.ceil(ctx.measureText(label).width)+8,h=19,x=Math.max(0,Math.min(clip.width-w,b.x)),y=Math.max(0,Math.min(clip.height-h,b.y-19));
      ctx.fillStyle='#111827';ctx.fillRect(x,y,w,h);ctx.fillStyle='#ffffff';ctx.fillText(label,x+4,y+2);
    }
    const blob=await canvas.convertToBlob({type:'image/png'}),output=new Uint8Array(await blob.arrayBuffer());
    let binary='';for(let i=0;i<output.length;i+=32768)binary+=String.fromCharCode(...output.subarray(i,i+32768));
    return btoa(binary);
  } finally {bitmap.close();}
}

export async function captureBrowserScreenshot(chrome,tabId,args,ensureCdpAttached) {
  const options=browserScreenshotOptions(args);await ensureCdpAttached(tabId);
  const send=(method,params)=>chrome.debugger.sendCommand({tabId},method,params);
  const first=await executeFrameScript(chrome,tabId,{frameId:0},screenshotPageState,[false]);
  const selection={frameId:0,documentId:first.documentId},original=first.result;
  const measure=async(annotations=false,scroll)=> (await executeFrameScript(chrome,tabId,selection,screenshotPageState,scroll===undefined?[annotations]:[annotations,scroll])).result;
  const zoom=await chrome.tabs.getZoom(tabId);
  if(!Number.isFinite(zoom)||zoom<=0)throw fail('SCREENSHOT_VIEWPORT_UNAVAILABLE','Chrome tab zoom is unavailable.');
  const resized=options.width!==undefined||(!options.fullPage&&options.height!==undefined);
  let overrideAttempted=false,scrollAttempted=false,result,primaryError,restoration={mode:'unchanged',verified:true};
  const override=state=>({width:Math.round(state.width*zoom),height:Math.round(state.height*zoom),deviceScaleFactor:state.dpr/zoom,mobile:false,
    screenWidth:state.screen.width,screenHeight:state.screen.height});
  const sameViewport=(a,b)=>['width','height','dpr','scale'].every(key=>Math.abs(a[key]-b[key])<0.01);
  const settle=async(target,reader=()=>measure())=>{
    let previous;for(let i=0;i<30;i++){
      const state=await reader();
      if((!target||(Math.abs(state.width-target.width)<=1&&Math.abs(state.height-target.height)<=1))&&previous&&sameViewport(previous,state))return state;
      previous=state;await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw fail('SCREENSHOT_VIEWPORT_UNSTABLE','The requested viewport did not settle.');
  };
  try {
    if(resized){
      const target={...original,width:options.width??original.width,height:options.fullPage?original.height:(options.height??original.height)};
      if(target.width*target.height*original.dpr**2>MAX_PIXELS)throw fail('SCREENSHOT_TOO_LARGE','Requested viewport exceeds 40 million image pixels.');
      overrideAttempted=true;await send('Emulation.setDeviceMetricsOverride',override(target));await settle(target);
    }
    if(options.fullPage){scrollAttempted=true;await measure(false,{x:0,y:0});}
    const viewport=await settle();
    const metrics=await send('Page.getLayoutMetrics'),content=metrics.cssContentSize||metrics.contentSize,visual=metrics.cssVisualViewport||metrics.visualViewport;
    const clip=options.fullPage?{x:0,y:0,width:Math.ceil(content.width),height:Math.ceil(content.height)}:
      {x:visual.pageX,y:visual.pageY,width:visual.clientWidth,height:visual.clientHeight};
    if(![clip.x,clip.y,clip.width,clip.height].every(Number.isFinite)||clip.width<=0||clip.height<=0)throw fail('SCREENSHOT_VIEWPORT_UNAVAILABLE','Chrome screenshot bounds are unavailable.');
    if(clip.width*clip.height*viewport.dpr**2>MAX_PIXELS)throw fail('SCREENSHOT_TOO_LARGE','Screenshot exceeds 40 million image pixels. Use a viewport screenshot or smaller width.');
    let snapshot,before;
    if(options.annotate){
      const frame=await executeFrameScript(chrome,tabId,selection,runBrowserPageCommand,['state',{limit:200}]);
      if(!frame.result?.ok)throw fail('SCREENSHOT_STATE_UNAVAILABLE','Page references could not be captured.');
      snapshot=frame.result.data;before=await measure(true);
    }
    const capture=()=>send('Page.captureScreenshot',{format:'png',captureBeyondViewport:options.fullPage,fromSurface:true,...(options.fullPage?{clip:{...clip,scale:1}}:{})});
    let shot=await capture(),after=await measure(options.annotate),size=screenshotPngSize(shot.data);
    const pixelsMatch=()=>Math.abs(size.width-Math.round(clip.width*viewport.dpr))<=1&&Math.abs(size.height-Math.round(clip.height*viewport.dpr))<=1;
    // Chrome may clear another CDP client's viewport override during capture.
    // Discard that image, pin the measured desktop geometry, and capture once
    // more. Never scale misplaced annotations onto a different viewport image.
    if(!sameViewport(viewport,after)||!pixelsMatch()){
      overrideAttempted=true;await send('Emulation.setDeviceMetricsOverride',override(viewport));await settle(viewport);
      if(options.annotate&&!screenshotGeometryStable(before,await measure(true)))throw fail('SCREENSHOT_LAYOUT_CHANGED','Annotated elements changed when restoring capture geometry.');
      shot=await capture();after=await measure(options.annotate);size=screenshotPngSize(shot.data);
    }
    if(!pixelsMatch())throw fail('SCREENSHOT_DIMENSION_MISMATCH','Chrome returned pixels inconsistent with the measured CSS viewport. Inspect zoom/emulation before retrying.');
    if(!sameViewport(viewport,after)||Math.abs(after.x-viewport.x)>0.5||Math.abs(after.y-viewport.y)>0.5){
      const fields=state=>Object.fromEntries(['width','height','dpr','scale','x','y'].map(key=>[key,state[key]]));
      throw fail('SCREENSHOT_LAYOUT_CHANGED','Viewport or scroll changed during capture. Read current state and capture again.',{before:fields(viewport),after:fields(after),clip});
    }
    if(options.annotate&&!screenshotGeometryStable(before,after))throw fail('SCREENSHOT_LAYOUT_CHANGED','Annotated elements changed during capture. Read current state and capture again.');
    const annotations=options.annotate?screenshotLabels(snapshot,before,clip):[];
    result={mimeType:'image/png',data:options.annotate?await annotateScreenshot(shot.data,size,clip,annotations):shot.data,...size,
      viewport:{width:viewport.width,height:viewport.height,dpr:viewport.dpr,zoom},clip,fullPage:options.fullPage,
      ...(options.fullPage&&options.height!==undefined?{heightIgnored:true}:{}),
      ...(options.annotate?{annotated:true,annotationScope:'main_document_dom',snapshotId:snapshot.snapshotId,documentId:selection.documentId,
        annotations:annotations.map(item=>({...item,frameId:0,documentId:selection.documentId})),annotationLimit:200,annotationsTruncated:snapshot.matches>200}: {})};
  } catch(error){primaryError=error;}
  finally {
    try {
      let documentChanged=false;
      const readCurrent=async()=>{
        const frame=await executeFrameScript(chrome,tabId,{frameId:0},screenshotPageState,[false]);
        if(frame.documentId!==selection.documentId)documentChanged=true;
        return frame.result;
      };
      if(!overrideAttempted&&!sameViewport(original,await readCurrent()))overrideAttempted=true;
      if(overrideAttempted){
        await send('Emulation.clearDeviceMetricsOverride');
        let restored=await settle(undefined,readCurrent);restoration={mode:'native',verified:true};
        // CDP has no getter for another client's device-metrics override.
        // If clearing changes the observed viewport, restore its measured
        // desktop dimensions explicitly and disclose that an override remains.
        if(!sameViewport(original,restored)){
          await send('Emulation.setDeviceMetricsOverride',override(original));restored=await settle(original,readCurrent);
          restoration={mode:'observed_desktop_override',verified:sameViewport(original,restored)};
        }
        if(!restoration.verified)throw Error('Original viewport did not return');
      }
      if(!documentChanged&&(scrollAttempted||overrideAttempted)){
        const restored=await measure(false,{x:original.x,y:original.y});
        if(Math.abs(restored.x-original.x)>1||Math.abs(restored.y-original.y)>1)throw Error('Original scroll did not return');
      }
      if(documentChanged)throw fail('SCREENSHOT_DOCUMENT_CHANGED','The page navigated during capture. Viewport restored; the new document was not scrolled.',{restoration});
    }catch(error){if(error.code==='SCREENSHOT_DOCUMENT_CHANGED')throw error;throw fail('SCREENSHOT_RESTORE_FAILED','Screenshot state restoration could not be verified. Inspect the selected tab before continuing.',{originalError:primaryError?.code||null,documentId:selection.documentId});}
  }
  if(primaryError)throw primaryError;
  return {...result,restoration};
}
