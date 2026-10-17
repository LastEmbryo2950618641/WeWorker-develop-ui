import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inflateSync} from 'node:zlib';

// Decode Chrome's non-interlaced PNG for exact annotation/fixture pixel checks.
function imagePixels(buffer){
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20),channels=buffer[25]===6?4:3,parts=[];
  assert.equal(buffer[24],8);assert.ok([2,6].includes(buffer[25]));assert.equal(buffer[28],0);
  for(let at=8;at<buffer.length;){const size=buffer.readUInt32BE(at),name=buffer.toString('ascii',at+4,at+8);if(name==='IDAT')parts.push(buffer.subarray(at+8,at+8+size));at+=12+size;}
  const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,pixels=Buffer.alloc(height*stride);
  const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c;};
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){
    const at=y*stride+x,left=x>=channels?pixels[at-channels]:0,up=y?pixels[at-stride]:0,corner=y&&x>=channels?pixels[at-stride-channels]:0;
    const add=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];assert.notEqual(add,undefined);
    pixels[at]=(raw[y*(stride+1)+1+x]+add)&255;
  }}
  return(x,y)=>[...pixels.subarray((Math.round(y)*width+Math.round(x))*channels,(Math.round(y)*width+Math.round(x))*channels+3)];
}

export async function verifyBrowserScreenshots({cli,root,record,passed,setZoom}) {
  const session='example-screenshot';
  const server=http.createServer((_req,res)=>{
    res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Example screenshots</title><style>
      *{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:18px sans-serif}header{height:100px;background:#dbeafe;padding:20px}button,input{font:18px sans-serif;padding:10px;margin:12px}.layout{height:120px;background:#fef3c7}#bottom{margin-top:1600px;background:#dcfce7;height:140px}#fixed{position:fixed;right:10px;top:10px;background:#bfdbfe;width:80px;height:35px}@media(max-width:600px){.layout{height:240px;background:#fecdd3}}
      #action{background:#0ea5e9}
      </style><header>Example screenshot page</header><button id="action" onclick="window.exampleClicked=(window.exampleClicked||0)+1">Example action</button><input aria-label="Example input"><div class="layout">Responsive example</div><div id="fixed">Fixed</div><div id="bottom"><button id="end">Example bottom action</button></div><script>
      window.exampleMutations=0;new MutationObserver(rows=>window.exampleMutations+=rows.length).observe(document.body,{childList:true,subtree:true,attributes:true});
      </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const call=(command,args={},ok=true)=>cli(`browser.${command}`,{session,...args},ok);
  const state=async()=> (await call('eval',{expression:'({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,x:scrollX,y:scrollY,mutations:window.exampleMutations,layout:document.querySelector(".layout").getBoundingClientRect().height})'})).data.value;
  const png=data=>{const buffer=Buffer.from(data,'base64');return{width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20),buffer};};
  let tabId;
  try{
    tabId=(await call('open',{url:`http://127.0.0.1:${server.address().port}/screenshots`})).data.tabId;
    const before=await state();
    const basic=(await call('screenshot')).data;assert.equal(png(basic.data).width,Math.round(before.width*before.dpr));assert.equal(png(basic.data).height,Math.round(before.height*before.dpr));assert.equal(basic.restoration.verified,true);
    const marked=(await call('screenshot',{annotate:true})).data;
    assert.equal(png(marked.data).height,Math.round(marked.clip.height*marked.viewport.dpr));
    assert.equal(marked.annotated,true);assert.ok(marked.annotations.length>=2);assert.equal(marked.annotations.some(item=>item.name==='Example bottom action'),false);
    const action=marked.annotations.find(item=>item.name==='Example action');assert.ok(action?.ref);assert.equal(action.frameId,0);
    const pixel=imagePixels(png(marked.data).buffer),b=action.bounds,dpr=marked.viewport.dpr;
    assert.deepEqual(pixel((b.x+1)*dpr,(b.y+b.height/2)*dpr),[225,29,72]);
    // Chrome's display color profile can shift native page pixels slightly;
    // require the blue button, allowing at most 3/255 per channel.
    const assertButton=(read,bounds,scale)=>assert.ok(read((bounds.x+bounds.width/2)*scale,(bounds.y+6)*scale).every((value,index)=>Math.abs(value-[14,165,233][index])<=3),'Annotation coordinates must align with the actual blue button pixels');
    assertButton(pixel,b,dpr);
    await fs.writeFile(path.join(root,'screenshot-annotated.png'),png(marked.data).buffer);
    assert.equal((await state()).mutations,before.mutations,'Annotations must not alter the DOM');
    await call('click',{ref:action.ref});assert.equal((await call('eval',{expression:'window.exampleClicked'})).data.value,1);
    await call('eval',{expression:'scrollTo({top:400,behavior:"instant"});true'});
    const scrolled=await state();assert.equal(scrolled.y,400);
    const small=(await call('screenshot',{width:500,height:360,annotate:true})).data;
    const smallPng=png(small.data);assert.equal(small.viewport.width,500);assert.equal(small.viewport.height,360);
    assert.equal(smallPng.width,Math.round(500*before.dpr));assert.equal(smallPng.height,Math.round(360*before.dpr));
    assert.deepEqual(await state(),scrolled);assert.equal(small.restoration.verified,true);
    const full=(await call('screenshot',{fullPage:true,width:500,height:100,annotate:true})).data;
    assert.equal(full.viewport.width,500);assert.equal(full.heightIgnored,true);assert.ok(full.clip.height>2000);
    assert.ok(full.annotations.some(item=>item.name==='Example bottom action'));
    await fs.writeFile(path.join(root,'screenshot-full.png'),png(full.data).buffer);
    assert.deepEqual(await state(),scrolled);
    assert.equal(full.restoration.verified,true);
    const destination=path.join(root,'example-saved.png');
    const saved=(await call('screenshot',{path:destination,annotate:true})).data;
    assert.equal(saved.path,destination);assert.equal(saved.data,undefined);assert.equal((await fs.stat(destination)).size,saved.bytes);
    assert.equal((await call('screenshot',{path:destination},false)).error.code,'SCREENSHOT_FILE_EXISTS');
    assert.equal((await call('screenshot',{width:8192,height:8192},false)).error.code,'SCREENSHOT_TOO_LARGE');
    assert.deepEqual(await state(),scrolled);
    await call('eval',{expression:'document.body.style.minHeight="1000000px";true'});
    const tall=await state();
    assert.equal((await call('screenshot',{fullPage:true,width:500},false)).error.code,'SCREENSHOT_TOO_LARGE');
    assert.deepEqual(await state(),tall);
    await call('eval',{expression:'document.body.style.minHeight="";true'});
    if(setZoom){
      await call('eval',{expression:'scrollTo({top:0,behavior:"instant"});true'});
      await setZoom(tabId,1.25);
      const zoomed=await state();const screenshot=(await call('screenshot',{width:500,height:360,annotate:true})).data;
      assert.equal(screenshot.viewport.width,500);assert.equal(screenshot.viewport.height,360);assert.equal(screenshot.viewport.zoom,1.25);
      assert.equal(png(screenshot.data).width,Math.round(500*zoomed.dpr));assert.deepEqual(await state(),zoomed);
      assertButton(imagePixels(png(screenshot.data).buffer),screenshot.annotations.find(item=>item.name==='Example action').bounds,screenshot.viewport.dpr);
      await fs.writeFile(path.join(root,'screenshot-zoom.png'),png(screenshot.data).buffer);
      await setZoom(tabId,1);
    }
    await call('eval',{expression:'scrollTo({top:300,behavior:"instant"});addEventListener("resize",()=>{location.href="/screenshots?navigated=1"},{once:true});true'});
    const navigation=(await call('screenshot',{width:501},false));
    assert.equal(navigation.error.code,'SCREENSHOT_DOCUMENT_CHANGED');assert.equal(navigation.error.details.restoration.verified,true);
    const navigated=await state();assert.equal(navigated.width,before.width);assert.equal(navigated.height,before.height);assert.equal(navigated.y,0);
    await record('screenshot-report',{passed:true,default:{width:basic.width,height:basic.height,viewport:basic.viewport},annotations:marked.annotations.length,
      resized:{width:small.width,height:small.height,viewport:small.viewport,restoration:small.restoration},full:{width:full.width,height:full.height,restoration:full.restoration},zoomTested:!!setZoom});
    passed('screenshots: PNG dimensions, numbered actionable refs without DOM overlays, responsive viewport/full page, scroll restoration, size limit and exclusive local file save'+(setZoom?', including 125% browser zoom':''));
  }finally{if(setZoom&&tabId)await setZoom(tabId,1).catch(()=>{});try{await call('close');}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
