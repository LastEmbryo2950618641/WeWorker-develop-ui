import {executeFrameScript,withBrowserFrameContext} from './browser-frames.js';
import {runBrowserPageCommand} from './browser-page.js';
import {validateBrowserAxReference} from './browser-ax.js';

const fail=(code,message,details)=>Object.assign(new Error(message),{code,...(details?{details}:{})});
const sourceKey=source=>source.sessionId||'';

// Runs on the exact retained file input in the extension's isolated world.
// No query is repeated after selection and no local path is put into the page.
export function inspectUploadTarget(token,phase,expected){
  try{
    const captured=globalThis[token];
    if(!captured||captured.node!==this)throw Object.assign(new Error('Upload target reference expired.'),{code:'UPLOAD_TARGET_CHANGED'});
    captured.validate(phase);
    if(phase==='before')return{ok:true};
    const files=this.files||[];
    if(files.length!==expected.length||expected.some((item,index)=>files[index].name!==item.name||files[index].size!==item.size))throw Object.assign(new Error('The file input did not retain the expected file names and sizes. Inspect its current state before retrying.'),{code:'UPLOAD_VERIFICATION_FAILED'});
    return{ok:true,count:files.length};
  }catch(error){return{ok:false,error:{code:error.code||'UPLOAD_VERIFICATION_FAILED',message:error.code?error.message:'The selected file input could not be verified.'}};}
}

export async function uploadBrowserFiles(chrome,tabId,args,ensureCdpAttached){
  if(!Array.isArray(args.paths)||!args.paths.length||args.paths.length>20||!Array.isArray(args._uploadFiles)||args._uploadFiles.length!==args.paths.length
    ||args._uploadFiles.some(file=>!file||typeof file.name!=='string'||!Number.isSafeInteger(file.size)||file.size<0))throw fail('INVALID_ARGUMENT','Upload requires locally validated files.');
  return withBrowserFrameContext(chrome,tabId,args,ensureCdpAttached,async({isolated,selected,state})=>{
    const token=`__weworkerUpload_${crypto.randomUUID().replaceAll('-','')}`,group=`weworker-upload-${crypto.randomUUID()}`;
    const selection={...args,frameId:selected.frameId,documentId:selected.documentId};
    const deadline=Date.now()+30000;let dispatched=false;
    const check=()=>{
      if(Date.now()>=deadline)throw fail('UPLOAD_INTERRUPTED','Upload preparation or verification exceeded its deadline.',{dispatched});
      if(![...state.contexts.values()].some(context=>context.uniqueId===isolated.uniqueId&&sourceKey(context.source)===sourceKey(isolated.source)))throw fail('FRAME_DOCUMENT_CHANGED','The upload document is no longer available.',{dispatched});
    };
    const bounded=async operation=>{
      check();let timer;
      try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('UPLOAD_INTERRUPTED','Upload timed out; inspect current state before retrying.',{dispatched})),Math.max(1,deadline-Date.now()));})]);}
      finally{clearTimeout(timer);}
    };
    const send=(method,params)=>bounded(()=>chrome.debugger.sendCommand(isolated.source,method,params));
    try{
      // File paths/metadata are deliberately omitted from page script arguments.
      const {paths,_uploadFiles,...target}=selection;
      const prepared=await bounded(()=>executeFrameScript(chrome,tabId,selection,runBrowserPageCommand,['upload-target',{...target,uploadToken:token,uploadDeadline:deadline,fileCount:paths.length}]));
      if(!prepared.result?.ok)throw fail(prepared.result?.error?.code||'ELEMENT_NOT_FOUND',prepared.result?.error?.message||'The file input is unavailable.');
      const resolved=await send('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(token)}]?.node`,uniqueContextId:isolated.uniqueId,objectGroup:group});
      if(resolved.exceptionDetails||!resolved.result?.objectId)throw fail('UPLOAD_TARGET_CHANGED','The retained upload target is no longer available.');
      const objectId=resolved.result.objectId;
      const inspect=async phase=>{
        const result=await send('Runtime.callFunctionOn',{objectId,functionDeclaration:inspectUploadTarget.toString(),arguments:[{value:token},{value:phase},{value:phase==='after'?_uploadFiles:[]}],returnByValue:true});
        if(result.exceptionDetails||!result.result?.value?.ok)throw fail(result.result?.value?.error?.code||'UPLOAD_VERIFICATION_FAILED',result.result?.value?.error?.message||'The retained file input could not be verified.',{dispatched});
        return result.result.value;
      };
      if(typeof args.ref==='string'&&args.ref.startsWith('ax:'))await bounded(()=>validateBrowserAxReference(chrome,tabId,selection,ensureCdpAttached,'upload'));
      await inspect('before');check();
      // Object identity belongs to the selected target session, including OOPIFs.
      await bounded(()=>{dispatched=true;return chrome.debugger.sendCommand(isolated.source,'DOM.setFileInputFiles',{objectId,files:paths});});
      const verified=await inspect('after');
      return{completed:true,verified:true,count:verified.count,...prepared.result.data,frameId:selected.frameId,documentId:selected.documentId};
    }catch(error){
      if(error.code)throw Object.assign(error,{details:{...error.details,dispatched}});
      throw fail('UPLOAD_INTERRUPTED','The upload was interrupted. Its page events may have happened; inspect state before retrying.',{dispatched});
    }finally{
      try{await executeFrameScript(chrome,tabId,{frameId:selected.frameId,documentId:selected.documentId},function(name){delete globalThis[name];},[token]);}catch{}
      try{await chrome.debugger.sendCommand(isolated.source,'Runtime.releaseObjectGroup',{objectGroup:group});}catch{}
    }
  });
}
