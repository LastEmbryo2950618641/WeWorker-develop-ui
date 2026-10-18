import assert from 'node:assert/strict';
import http from 'node:http';

export async function verifyOriginNavigation({ cli, record, passed, stopBridge, startBridge }) {
  const requests = [], sessions = [], servers = [];
  let drift = false, entryOrigin, resultOrigin, revision = 0, hashDocuments = 0;
  const listen = async handler => { const server = http.createServer(handler); servers.push(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; };
  const entryPort = await listen((req,res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('cache-control','no-store'); res.setHeader('content-type','text/html; charset=utf-8');
    if (url.pathname === '/return') {
      const itemId = url.searchParams.get('item'), category = url.searchParams.get('category');
      requests.push({ pathname: '/return', itemId, category });
      res.end('<!doctype html><h1>Returned result</h1><script>window.publicResult=' + JSON.stringify({ item: { id: itemId }, category, page: 3 }).replaceAll('<','\\u003c') + '</script>'); return;
    }
    res.end('<!doctype html><title>Public entry</title><h1>Entry</h1>');
  });
  entryOrigin = 'http://127.0.0.1:' + entryPort;
  const resultPort = await listen((req,res) => {
    const url = new URL(req.url,'http://localhost'); res.setHeader('cache-control','no-store');
    if (url.pathname === '/hash-app') {
      hashDocuments++; res.setHeader('content-type','text/html; charset=utf-8');
      res.end(`<!doctype html><h1>Public hash destination</h1><script>
        window.publicResult={item:{id:'initial'},category:'initial',page:1,revision:0};
        async function read(){
          const fragment=new URL('http://localhost/'+location.hash.slice(1));
          const itemId=decodeURIComponent(fragment.pathname.split('/')[2]),category=fragment.searchParams.get('category');
          if(itemId==='redirect'){location.replace(${JSON.stringify(entryOrigin + '/unexpected')});return;}
          window.publicResult=await(await fetch('/hash-data?item='+encodeURIComponent(itemId)+'&category='+encodeURIComponent(category))).json();
        }
        window.addEventListener('hashchange',read);read();
      </script>`); return;
    }
    if (url.pathname === '/hash-data') {
      const itemId=url.searchParams.get('item'),category=url.searchParams.get('category');
      requests.push({pathname:'/hash-data',itemId,category});res.setHeader('content-type','application/json');
      res.end(JSON.stringify({item:{id:itemId},category,page:1,revision:++revision}));return;
    }
    if (!['/items','/next'].includes(url.pathname)) { res.statusCode=404;res.end();return; }
    const itemId = url.searchParams.get('item'), category = url.searchParams.get('category');
    requests.push({ pathname: url.pathname, itemId, category });
    if(itemId === 'redirect') { res.writeHead(302,{location: entryOrigin+'/unexpected'});res.end();return; }
    const data = { item: { id: itemId, title: 'Example '+itemId }, category, page: url.pathname === '/next' ? 2 : 1 };
    if(url.pathname === '/next') { res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return; }
    res.setHeader('content-type','text/html; charset=utf-8');
    const field = drift ? 'changedResult' : 'publicResult';
    setTimeout(()=>res.end(`<!doctype html><title>Public destination</title><h1>Result</h1><button id="next">Next page</button><script>
      window.${field}=${JSON.stringify(data).replaceAll('<','\\u003c')};
      document.querySelector('#next').onclick=async()=>{window.${field}=await(await fetch('/next'+location.search)).json()};
    </script>`),itemId==='slow'?5000:50);
  });
  resultOrigin = 'http://localhost:'+resultPort;
  const settle = async taskId => { for(let i=0;i<150;i++){const state=(await cli('exploration.get',{taskId})).data;if(!['collecting','validating','installing'].includes(state.status))return state;await new Promise(r=>setTimeout(r,200));}throw Error('Origin task did not settle'); };
  const base = field => ({ mode:'navigate',resultOrigin,resultPathname:'/items',queryParameters:[{name:'itemId',queryKey:'item',description:'Public item ID'},{name:'category',queryKey:'category',description:'Public category'}],result:{strategy:'DOM_STATE',path:[field]},timeoutMs:10000 });
  const hashSource = () => ({ mode:'navigate',resultOrigin,resultPathname:'/hash-app',result:{strategy:'DOM_STATE',path:['publicResult']},timeoutMs:10000,
    hashNavigation:{template:'items/:id',pathParameters:[{segmentIndex:1,name:'itemId',description:'Public item ID'}],queryParameters:[{name:'category',queryKey:'category',description:'Public category'}],matchResult:{'item.id':'itemId',category:'category'},freshnessPath:'revision',sameTarget:'reload'} });
  const flow = () => ({mode:'workflow',timeoutMs:20000,steps:[
    {pathname:'/entry',query:{mode:'navigate',resultPathname:'/entry',result:{strategy:'UI_SELECTOR',selector:'h1',fields:{title:{}}}}},
    {pathname:'/entry',query:base('publicResult')},
    {origin:resultOrigin,pathname:'/items',query:{mode:'filter',resultPathname:'/items',trigger:{kind:'pagination',selector:'#next'},result:{strategy:'DOM_STATE',path:['publicResult']}}},
  ]});
  const open = async (kind, allow=true) => {
    const session='example-origin-'+kind;sessions.push(session);
    const tabId=(await cli('browser.open',{session,url:entryOrigin+'/entry'})).data.tabId;
    const taskId=(await cli('exploration.start',{tabId,goal:'Read declared public destination',requestId:session,...(allow?{allowedOrigins:[resultOrigin]}:{})})).data.taskId;await settle(taskId);return {session,tabId,taskId};
  };
  try {
    const refused=await open('undeclared',false), initial=requests.length;
    await cli('exploration.query',{taskId:refused.taskId,source:base('publicResult'),values:{itemId:'007',category:'books'},reason:'Undeclared public destination refusal'});
    assert.equal((await settle(refused.taskId)).error.code,'PAGE_ORIGIN_NOT_ALLOWED');assert.equal(requests.length,initial);
    passed('cross-origin observation refuses an undeclared task destination before navigation');
    for(const kind of ['single','workflow','hash','return']) {
      const {tabId,taskId}=await open(kind), source=kind==='single'?base('publicResult'):kind==='hash'?hashSource():flow();
      if(kind==='return')source.steps.push({origin:resultOrigin,pathname:'/items',query:{...base('publicResult'),resultOrigin:entryOrigin,resultPathname:'/return'}});
      const expectedPage=kind==='return'?3:kind==='workflow'?2:1;
      await cli('exploration.query',{taskId,source,values:{itemId:'example-unretained-origin',category:'books'},reason:'Explicit public cross-origin read'});
      let state=await settle(taskId);assert.equal(state.status,'evidence_ready',JSON.stringify(state));
      const evidence=(await cli('exploration.evidence',{taskId})).data;assert.ok(!JSON.stringify(evidence).includes('example-unretained-origin'));
      const plan={tools:[{name:'read_origin_'+kind,risk:'read',strategy:'UI_SELECTOR',sourcePageId:evidence.pageSources[0].id,readReason:'Public destination read'}]};
      const tool=(await cli('exploration.generate',{taskId,plan})).data.toolNames[0];
      const cases=['007','示例'].map((itemId,i)=>({id:'origin-'+i,args:{itemId,category:['books','music'][i]},expect:{equals:{'data.item.id':itemId,'data.category':['books','music'][i],'data.page':expectedPage}}}));
      const beforeCases=(await cli('exploration.verification-read',{taskId,tool})).data;
      await cli('exploration.verification-write',{taskId,tool,expectedHash:beforeCases.hash,cases});
      if(kind==='single'){await stopBridge();await startBridge();}
      await cli('exploration.validate',{taskId});
      state=await settle(taskId);assert.equal(state.status,'review_ready',JSON.stringify(state));
      const review=(await cli('exploration.review',{taskId})).data;assert.ok(review.permissions.some(x=>x.includes(resultOrigin)));
      await cli('exploration.install',{taskId,reviewId:review.reviewId,confirmed:true});assert.equal((await settle(taskId)).status,'installed');
      let previousRevision=0;
      for(const [index,itemId] of (kind==='workflow'?['009','009','示例',...Array(9).fill('009')]:['009','009','示例']).entries()) {
        const before=requests.length,docsBefore=hashDocuments,actual=await cli(tool,{itemId,category:'books'});
        assert.equal(actual.ok,true,JSON.stringify({kind,index,actual}));
        assert.equal(actual.data.item.id,itemId);assert.equal(actual.data.category,'books');assert.equal(actual.data.page,expectedPage);
        assert.deepEqual(requests.slice(before).map(x=>x.pathname),kind==='return'?['/items','/next','/return']:kind==='workflow'?['/items','/next']:kind==='hash'?['/hash-data']:['/items']);
        if(kind==='hash'){assert.ok(actual.data.revision>previousRevision);previousRevision=actual.data.revision;assert.equal(hashDocuments,docsBefore+(index===1?1:0));}
      }
      const known=(await cli('exploration.knowledge-read',{site:review.name})).data;await cli('exploration.knowledge-save',{taskId,expectedHash:known.hash});
      const saved=(await cli('exploration.knowledge-read',{site:review.name})).data;assert.ok(JSON.stringify(saved).includes(resultOrigin));
      const before=requests.length, invalid=await cli(tool,{itemId:'redirect',category:'books'},false);
      assert.equal(invalid.error.code,'PAGE_QUERY_ORIGIN_CHANGED');assert.equal(requests.length,before+(kind==='hash'?0:1));
      await record('origin-'+kind,state);
      passed('cross-origin '+kind+': explicit hosts, exact destination, author validation/install/call/knowledge, repeated destination calls and redirect refusal without replay');
      // Restore the explicitly declared entry before starting a fresh repair task.
      await cli('browser.open',{session:'example-origin-'+kind,url:entryOrigin+'/entry'});
      if(kind==='single') {
        drift=true;
        const repairId=(await cli('exploration.start',{tabId,goal:'Repair destination extraction',requestId:'example-origin-repair',allowedOrigins:[resultOrigin]})).data.taskId;await settle(repairId);
        await cli('exploration.query',{taskId:repairId,source:base('changedResult'),values:{itemId:'010',category:'books'},reason:'Observe changed public destination result'});assert.equal((await settle(repairId)).status,'evidence_ready');
        const fresh=(await cli('exploration.evidence',{taskId:repairId})).data, info=(await cli('exploration.repair-info',{site:review.name})).data;
        await cli('exploration.repair',{taskId:repairId,site:review.name,expectedDigest:info.digest,plan:{tools:[{...plan.tools[0],name:'read-origin-single',sourcePageId:fresh.pageSources[0].id}]}});
        await cli('exploration.validate',{taskId:repairId});assert.equal((await settle(repairId)).status,'draft');
        const file='extension/commands/read-origin-single.js',old=(await cli('exploration.draft-read',{taskId:repairId,file})).data;
        await cli('exploration.draft-write',{taskId:repairId,file,expectedHash:old.hash,content:old.content.replaceAll('publicResult','changedResult')});
        await cli('exploration.validate',{taskId:repairId});assert.equal((await settle(repairId)).status,'review_ready');
        const fixed=(await cli('exploration.review',{taskId:repairId})).data;await cli('exploration.install',{taskId:repairId,reviewId:fixed.reviewId,confirmed:true});assert.equal((await settle(repairId)).status,'installed');
        assert.equal((await cli(tool,{itemId:'011',category:'books'})).data.item.id,'011');drift=false;
        passed('cross-origin extraction repair preserves exact destination permission and reruns imported cases before install');
      }
    }
    {
      const {session,taskId}=await open('preview-cancel');
      await cli('exploration.query',{taskId,source:flow(),values:{itemId:'007',category:'books'},reason:'Public cross-origin preview cancellation'});
      assert.equal((await settle(taskId)).status,'evidence_ready');
      const evidence=(await cli('exploration.evidence',{taskId})).data;
      const tool=(await cli('exploration.generate',{taskId,plan:{tools:[{name:'cancel_origin',risk:'read',strategy:'UI_SELECTOR',sourcePageId:evidence.pageSources[0].id,readReason:'Public bounded read'}]}})).data.toolNames[0];
      const verification=(await cli('exploration.verification-read',{taskId,tool})).data;
      await cli('exploration.verification-write',{taskId,tool,expectedHash:verification.hash,cases:['slow','later-case'].map((itemId,i)=>({id:'cancel-'+i,args:{itemId,category:['books','music'][i]},expect:{equals:{'data.item.id':itemId}}}))});
      const before=requests.length;
      await cli('exploration.validate',{taskId});
      for(let i=0;i<150&&requests.length===before;i++)await new Promise(r=>setTimeout(r,50));
      assert.deepEqual(requests.slice(before).map(x=>x.itemId),['slow']);
      await cli('exploration.cancel',{taskId});
      await new Promise(r=>setTimeout(r,5500));
      await cli('browser.get',{session,selector:'h1',property:'text'});
      assert.equal((await cli('exploration.get',{taskId})).data.status,'cancelled');
      assert.deepEqual(requests.slice(before).map(x=>[x.pathname,x.itemId]),[['/items','slow']]);
      passed('cross-origin author validation cancel: next destination action and next case never dispatched');
    }
    for(const kind of ['cancel','restart']) {
      const {session,taskId}=await open(kind),before=requests.length;
      await cli('exploration.query',{taskId,source:base('publicResult'),values:{itemId:'slow',category:kind},reason:'Interrupted public destination navigation'});
      for(let i=0;i<100&&requests.length===before;i++)await new Promise(r=>setTimeout(r,50));assert.equal(requests.length,before+1);
      if(kind==='cancel')await cli('exploration.cancel',{taskId});else{await stopBridge();await startBridge();}
      const end=Date.now()+9000;
      while(true){try{await cli('browser.get',{session,selector:'h1',property:'text'});break;}catch(error){if(Date.now()>end)throw error;}await new Promise(r=>setTimeout(r,100));}
      assert.equal((await cli('exploration.get',{taskId})).data.status,kind==='cancel'?'cancelled':'interrupted');
      assert.equal(requests.length,before+1);assert.equal((await cli('exploration.evidence',{taskId})).data.pageSources.length,0);
      passed('cross-origin '+kind+': navigation not replayed, queue releases and late result omitted');
    }
  } finally {
    await record('origin-requests',requests.map(x=>({...x,itemId:x.itemId==='example-unretained-origin'?'[observation omitted]':x.itemId})));
    for(const session of sessions)await cli('browser.close',{session}).catch(()=>{});
    for(const server of servers)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }
}
