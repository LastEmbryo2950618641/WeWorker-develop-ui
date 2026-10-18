import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyUiWrites({ cli, record, passed, stopBridge, startBridge }) {
  const requests = [], values = new Map(), held = new Map(), effects = new Map();
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'), label = url.pathname.split('/').pop();
    if (url.pathname.startsWith('/editor/')) {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'example_ui=example-placeholder; HttpOnly; SameSite=Strict; Path=/' });
      res.end(`<!doctype html><title>Example native editor</title>
        <form id="editor" method="post" action="/items/${label}">
          <label>Public item <input id="item" name="item" value="example-item"></label>
          <label>Title <input id="title" name="title" value="Before"></label>
          <label>Correlation <input id="marker" name="marker" value="before"></label>
          <button id="save" type="submit">Save</button></form><p id="receipt" data-marker="before">Example acknowledgement</p>
        <script>
          window.exampleSubmissions=0; window.exampleInputEvents=0;
          document.addEventListener('input',()=>window.exampleInputEvents++);
          document.addEventListener('change',()=>window.exampleInputEvents++);
          document.querySelector('#editor').addEventListener('submit',async event=>{
            event.preventDefault();window.exampleSubmissions++;
            const form=event.target, body=Object.fromEntries(new FormData(form));
            try {
              const response=await fetch(form.action,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
              await response.json();
              if(${JSON.stringify(label)}==='navigation'){location.reload();return;}
              if(response.ok)document.querySelector('#receipt').setAttribute('data-marker',body.marker);
            }catch{}
          });
        </script>`); return;
    }
    if (!url.pathname.startsWith('/items/')) { res.end(''); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ label, method: req.method, body, hasIdempotency: Boolean(req.headers['idempotency-key']), authenticated: req.headers.cookie?.includes('example_ui=example-placeholder') === true });
    res.setHeader('content-type', 'application/json');
    if (!requests.at(-1).authenticated) { res.writeHead(401); res.end('{}'); return; }
    if (req.method === 'POST') {
      const submitted = JSON.parse(body);
      if (label !== 'noeffect') {
        effects.set(label, (effects.get(label) || 0) + 1);
        values.set(label, label === 'wrongidentity' ? { ...submitted, item: 'other-item' } : submitted);
      }
      if (label === 'lost') { req.socket.destroy(); return; }
      if (['timeout', 'stopped', 'restart'].includes(label)) { held.set(label, { res, submitted }); return; }
      if (label === 'error') { res.writeHead(409); res.end('{}'); return; }
      res.end(JSON.stringify({ ok: true })); return;
    }
    res.end(JSON.stringify(values.get(label) || { item: 'example-item', title: 'Before', marker: 'before' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const count = label => requests.filter(v => v.label === label && v.method === 'POST').length;
  async function settle(taskId) {
    for (let i=0;i<400;i++) {
      const state=(await cli('exploration.get',{taskId})).data;
      if(!['collecting','validating','verifying_write','installing'].includes(state.status))return state;
      await pause();
    }
    throw new Error('UI task did not settle');
  }
  async function draft(label) {
    const session='example-ui-'+label;
    const tabId=(await cli('browser.open',{session,url:origin+'/editor/'+label})).data.tabId;
    const taskId=(await cli('exploration.start',{tabId,requestId:session,goal:'Submit an isolated public native form'})).data.taskId;
    await settle(taskId);
    const url=origin+'/items/'+label;
    await cli('exploration.declare-write',{taskId,url,method:'POST',bodyKeys:['item','title','marker'],reason:'Public isolated form action declaration'});
    const evidence=(await cli('exploration.evidence',{taskId})).data;
    const index=evidence.candidates.findIndex(v=>v.url===url&&v.method==='POST');
    const plan={tools:[{name:'ui_write_'+label,risk:'write',sourceApiKind:'action',sourceApiIndexes:[index],strategy:'UI_SELECTOR',pagePathname:'/editor/'+label,
      uiWrite:{form:'#editor',inputMode:'native-setter-no-events',inputs:['item','title','marker'].map(name=>({selector:'#'+name,name,parameter:name})),submit:{selector:'#save',text:'Save'},confirmation:{selector:'#receipt',attribute:'data-marker',parameter:'marker'}},
      writeReason:'Update public example through one submit event',strategyNote:{reason:'The native form reads its current fields on submission',limitations:'No input/change events, same document, no server idempotency guarantee'}}]};
    const generated=(await cli('exploration.generate',{taskId,plan})).data,tool=generated.toolNames[0];
    const representativeArgs={item:'example-item',title:'007 示例',marker:'after-'+label};
    const fixture={id:'example-'+label,representativeArgs,expectedSubmission:{url,method:'POST',body:representativeArgs},
      effect:{readback:{url},identityPath:'item',argumentPaths:{item:'item',title:'title',marker:'marker'},before:{equals:{item:'example-item',title:'Before',marker:'before'}},after:{equals:representativeArgs}}};
    const old=(await cli('exploration.write-verification-read',{taskId,tool})).data;
    await cli('exploration.write-verification-write',{taskId,tool,fixture,expectedHash:old.hash});
    const before=requests.length;
    await cli('exploration.validate',{taskId}); const state=await settle(taskId); assert.equal(state.status,'write_review_ready',JSON.stringify(state));
    const review=(await cli('exploration.write-review',{taskId,tool})).data;
    assert.equal(requests.length,before); assert.ok(review.page.ui); assert.equal(review.page.idempotency,undefined);
    return {args:{taskId,tool,reviewId:review.reviewId,confirmed:true},session,representativeArgs};
  }
  try {
    const f=await draft('success'), args=f.args;
    assert.equal((await cli('exploration.write-verify',{...args,confirmed:false},false)).error.code,'CONFIRMATION_REQUIRED');
    assert.equal(count('success'),0);
    await Promise.all([cli('exploration.write-verify',args),cli('exploration.write-verify',args)]);
    const state=await settle(args.taskId); assert.equal(state.status,'review_ready',JSON.stringify(state));
    assert.deepEqual(values.get('success'),f.representativeArgs);
    assert.deepEqual(requests.filter(v=>v.label==='success').map(v=>v.method),['GET','POST','GET']);
    const page=(await cli('browser.eval',{session:f.session,expression:'({submissions:window.exampleSubmissions,events:window.exampleInputEvents})'})).data.value;
    assert.deepEqual(page,{submissions:1,events:0});
    await cli('exploration.write-verify',args); assert.equal(count('success'),1);
    passed('UI native fields, no input/change events, one submit, exact review and input-correlated independent GET effect');
    const review=(await cli('exploration.review',{taskId:args.taskId})).data; assert.ok(review.permissions.some(v=>v.startsWith('ui-write:')));
    await cli('exploration.install',{taskId:args.taskId,reviewId:review.reviewId,confirmed:true}); assert.equal((await settle(args.taskId)).status,'installed');
    assert.equal((await cli(args.tool,f.representativeArgs,false)).code,'CONFIRMATION_REQUIRED'); assert.equal(count('success'),1);
    const ordinary=await cli(args.tool,{...f.representativeArgs,marker:'ordinary-example',__confirmed:true});
    assert.equal(ordinary.confirmationMatched,true); assert.equal(ordinary.effectVerified,false); assert.equal(count('success'),2); assert.equal(values.get('success').marker,'ordinary-example');
    const duplicate=await cli(args.tool,{...f.representativeArgs,marker:'ordinary-example',__confirmed:true}); assert.equal(duplicate.ok,false); assert.equal(count('success'),2);
    const knowledge=(await cli('exploration.knowledge-read',{site:review.name})).data;
    await cli('exploration.knowledge-save',{taskId:args.taskId,expectedHash:knowledge.hash});
    assert.equal((await cli('exploration.knowledge-read',{site:review.name})).data.knowledge.commands[args.tool].writeVerification.kind,'ui_single_submit_v1');
    passed('UI install permission, ordinary confirmation, stale acknowledgement refusal and durable knowledge');
    for(const label of ['noeffect','wrongidentity','lost','timeout','error','navigation']) {
      const f=await draft(label); await cli('exploration.write-verify',f.args); const state=await settle(f.args.taskId);
      assert.equal(state.writeExecutions[0].status,'uncertain',JSON.stringify(state)); const sent=count(label); assert.ok(sent>=1);
      if(label!=='lost')assert.equal(sent,1);
      const submissions=(await cli('browser.eval',{session:f.session,expression:'window.exampleSubmissions'})).data.value;assert.equal(submissions,label==='navigation'?0:1); // Reload creates a new page counter; the server request count is independently asserted above.
      await cli('exploration.write-verify',f.args); assert.equal(count(label),sent);
      assert.equal((await cli('exploration.write-readback',{taskId:f.args.taskId,reviewId:f.args.reviewId})).data.passed,['lost','timeout','error','navigation'].includes(label));
      assert.equal((await cli('exploration.review',{taskId:f.args.taskId},false)).error.code,'VALIDATION_REQUIRED');
      if(held.has(label))held.get(label).res.end('{}');
    }
    passed('UI acknowledgement without effect, wrong resource and missing response remain uncertain; only readonly recovery');
    for(const label of ['stale','disabled','extra','ambiguous','override','precondition']) {
      const f=await draft(label);
      const expressions={stale:"document.querySelector('#receipt').setAttribute('data-marker','after-stale')",disabled:"document.querySelector('#save').disabled=true",
        extra:"document.querySelector('#editor').insertAdjacentHTML('beforeend','<input type=hidden name=unexpected value=example>')",
        ambiguous:"document.querySelector('#editor').appendChild(document.querySelector('#title').cloneNode(true))",
        override:"document.querySelector('#save').setAttribute('formaction','/items/unintended')"};
      if(expressions[label])await cli('browser.eval',{session:f.session,expression:expressions[label]+';true'});
      if(label==='precondition')values.set(label,{item:'example-item',title:'Other',marker:'before'});
      await cli('exploration.write-verify',f.args); const state=await settle(f.args.taskId);
      assert.notEqual(state.status,'review_ready'); assert.equal(count(label),0);
      await cli('exploration.write-verify',f.args); assert.equal(count(label),0);
    }
    assert.equal(count('unintended'),0);
    passed('UI preconditions reject stale receipts, disabled/ambiguous controls, extra fields and submit overrides with no submission');
    for(const label of ['stopped','restart']) {
      const f=await draft(label); await cli('exploration.write-verify',f.args);
      for(let i=0;i<100&&!held.has(label);i++)await pause(); assert.equal(count(label),1);
      if(label==='stopped')await cli('exploration.cancel',{taskId:f.args.taskId});
      await stopBridge(); await startBridge();
      held.get(label).res.end('{}');
      // The old page evaluation may still be winding down; it must never submit again.
      const state=(await cli('exploration.get',{taskId:f.args.taskId})).data;
      assert.equal(state.status,label==='stopped'?'cancelled':'interrupted'); assert.equal(state.writeExecutions[0].status,'uncertain');
      await cli('exploration.write-verify',f.args); assert.equal(count(label),1);
      assert.equal((await cli('exploration.write-readback',{taskId:f.args.taskId,reviewId:f.args.reviewId})).data.passed,true);
    }
    passed('UI cancellation and real Bridge restart consume authorization durably; recovery performs GET without replay');
    assert.ok(requests.every(v=>v.authenticated&&!v.hasIdempotency));
  } finally { await record('ui-write-requests',requests); await record('ui-write-mutations',Object.fromEntries(effects)); await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); }
}
