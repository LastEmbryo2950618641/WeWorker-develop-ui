import test from 'node:test';
import assert from 'node:assert/strict';
import { browserScreenshotOptions, screenshotGeometryStable, screenshotLabels, screenshotPngSize, captureBrowserScreenshot } from '../background/browser-screenshot.js';

function png(width=800,height=600){const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes.toString('base64');}
test('screenshot arguments, output bounds and annotation coordinate clipping are explicit',()=>{
  assert.deepEqual(browserScreenshotOptions({fullPage:'true',annotate:true,width:'500',height:100}),{fullPage:true,annotate:true,width:500,height:100});
  for(const args of [{width:0},{width:8193},{width:true},{height:-1},{annotate:'yes'},{fullPage:[]}])assert.throws(()=>browserScreenshotOptions(args),{code:'INVALID_ARGUMENT'});
  assert.deepEqual(screenshotPngSize(png()),{width:800,height:600});assert.throws(()=>screenshotPngSize(png(8192,8192)),{code:'SCREENSHOT_TOO_LARGE'});
  const state={elements:[{ref:'example-one',role:'button',name:'Example one'},{ref:'example-two',role:'button',name:'Example two'}]};
  const geometry={url:'https://example.com/',snapshotId:'example',annotations:[{ref:'example-one',x:5,y:90,width:40,height:30},{ref:'example-two',x:10,y:400,width:50,height:20}]};
  assert.deepEqual(screenshotLabels(state,geometry,{x:0,y:100,width:200,height:100}),[{label:'1',ref:'example-one',role:'button',name:'Example one',bounds:{x:5,y:0,width:40,height:20}}]);
  assert.equal(screenshotGeometryStable(geometry,structuredClone(geometry)),true);
  const changed=structuredClone(geometry);changed.annotations[0].y+=1;assert.equal(screenshotGeometryStable(geometry,changed),false);
});
function fixture({captureFailure=false,restoreFailure=false,oversized=false,existingOverride=false,captureDrift=false,wrongPixels=false,navigateOnCapture=false}={}){
  const original={url:'https://example.com/',width:800,height:600,dpr:1,scale:1,x:0,y:100,screen:{width:1440,height:900}},state=structuredClone(original),calls=[];
  let captures=0,documentId='example-document';
  const chrome={tabs:{getZoom:async()=>1},scripting:{executeScript:async request=>{
    calls.push({method:'executeScript',documentId,args:request.args});
    if(request.target.documentIds&&!request.target.documentIds.includes(documentId))return[];
    if(request.args?.[1]){state.x=request.args[1].x;state.y=request.args[1].y;}
    return[{frameId:0,documentId,result:structuredClone(state)}];
  }},debugger:{sendCommand:async(_source,method,params)=>{
    calls.push({method,params});
    if(method==='Emulation.setDeviceMetricsOverride'){state.width=params.width;state.height=params.height;}
    if(method==='Emulation.clearDeviceMetricsOverride'){if(restoreFailure)throw Error('Detached');state.width=existingOverride?900:800;state.height=600;}
    if(method==='Page.getLayoutMetrics')return{cssContentSize:{width:state.width,height:oversized?100000:2000},cssVisualViewport:{pageX:state.x,pageY:state.y,clientWidth:state.width,clientHeight:state.height}};
    if(method==='Page.captureScreenshot'){
      captures++;
      if(captureFailure)throw Object.assign(new Error('Example capture failure'),{code:'EXAMPLE_CAPTURE_FAILED'});
      if(captureDrift&&captures===1)state.height=400;
      if(navigateOnCapture){documentId='example-successor';state.url='https://example.com/next';state.y=0;}
      return{data:png(params.clip?.width||state.width,wrongPixels?300:(params.clip?.height||state.height))};
    }
    return{};
  }}};return{chrome,state,original,calls};
}
test('temporary dimensions and full-page scroll restore after capture failure and pixel-limit rejection',async()=>{
  for(const options of [{captureFailure:true},{oversized:true}]){
    const f=fixture(options);
    await assert.rejects(captureBrowserScreenshot(f.chrome,7,{width:500,fullPage:true},async()=>{}),{code:options.captureFailure?'EXAMPLE_CAPTURE_FAILED':'SCREENSHOT_TOO_LARGE'});
    assert.deepEqual(f.state,f.original);assert.ok(f.calls.some(call=>call.method==='Emulation.clearDeviceMetricsOverride'));
    if(options.oversized)assert.equal(f.calls.some(call=>call.method==='Page.captureScreenshot'),false);
  }
});
test('restoration failure is explicit and retains the original error code; no successful screenshot is returned',async()=>{
  const f=fixture({captureFailure:true,restoreFailure:true});
  await assert.rejects(captureBrowserScreenshot(f.chrome,7,{width:500},async()=>{}),error=>error.code==='SCREENSHOT_RESTORE_FAILED'&&error.details.originalError==='EXAMPLE_CAPTURE_FAILED');
});
test('a pre-existing desktop viewport is restored by measured override and reported rather than claiming native state',async()=>{
  const f=fixture({existingOverride:true});
  const result=await captureBrowserScreenshot(f.chrome,7,{width:500,height:360},async()=>{});
  assert.deepEqual(f.state,f.original);assert.deepEqual(result.restoration,{mode:'observed_desktop_override',verified:true});
  assert.equal(result.width,500);assert.equal(result.height,360);
});

test('capture-induced viewport drift discards the first image, captures once more and restores geometry',async()=>{
  const f=fixture({captureDrift:true});
  const result=await captureBrowserScreenshot(f.chrome,7,{},async()=>{});
  assert.equal(f.calls.filter(call=>call.method==='Page.captureScreenshot').length,2);
  assert.equal(result.width,800);assert.equal(result.height,600);
  assert.deepEqual(f.state,f.original);assert.deepEqual(result.restoration,{mode:'native',verified:true});
});

test('repeated wrong PNG dimensions fail after one recapture and still restore viewport and scroll',async()=>{
  const f=fixture({wrongPixels:true});
  await assert.rejects(captureBrowserScreenshot(f.chrome,7,{width:500,fullPage:true},async()=>{}),{code:'SCREENSHOT_DIMENSION_MISMATCH'});
  assert.equal(f.calls.filter(call=>call.method==='Page.captureScreenshot').length,2);
  assert.deepEqual(f.state,f.original);
});

test('navigation restores the new document viewport without applying the old document scroll',async()=>{
  const f=fixture({navigateOnCapture:true});
  await assert.rejects(captureBrowserScreenshot(f.chrome,7,{width:500,fullPage:true},async()=>{}),error=>error.code==='SCREENSHOT_DOCUMENT_CHANGED'&&error.details.restoration.verified);
  assert.equal(f.state.width,f.original.width);assert.equal(f.state.height,f.original.height);
  assert.equal(f.state.url,'https://example.com/next');assert.equal(f.state.y,0);
  assert.equal(f.calls.some(call=>call.method==='executeScript'&&call.documentId==='example-successor'&&call.args?.[1]),false);
});
