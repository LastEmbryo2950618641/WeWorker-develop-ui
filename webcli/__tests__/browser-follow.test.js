import { expect, it, vi } from 'vitest';
import { followBrowser } from '../browser-follow.js';
const batch = (entries, startCursor = 'example:console:0', nextCursor = entries.at(-1)?.eventCursor || startCursor, extra = {}) => ({ ok: true, data: { observationVersion: 1, entries, startCursor, nextCursor, ...extra } });
const row = n => ({ eventCursor: 'example:console:' + n, sequence: n, text: 'Example ' + n, timestamp: 10000 });

it('streams same-timestamp events exactly once, resumes batches and ends at an exact event limit', async () => {
  const lines=[],calls=[];let n=0;
  const request=async args=>{calls.push(args);return n++===0?batch([row(1),row(2)],undefined,undefined,{hasMore:true}):batch([row(3),row(4)],row(2).eventCursor)};
  const code=await followBrowser('console',{session:'work',follow:true,maxEvents:3},{request,emit:async line=>lines.push(line)});
  expect(code).toBe(0);expect(lines.map(x=>x.event)).toEqual(['ready','entry','entry','entry','end']);
  expect(calls[1].cursor).toBe(row(2).eventCursor);expect(lines.at(-1)).toMatchObject({reason:'max_events',cursor:row(3).eventCursor,entries:3});
});

it('waits for each output write before polling more and emits filter checkpoints', async () => {
  const controller=new AbortController(),lines=[];let resumeWrite;
  const request=vi.fn(async()=>batch([],undefined,'example:console:2'));
  const pending=followBrowser('console',{session:'work',follow:true},{request,signal:controller.signal,
    emit:line=>{lines.push(line);return line.event==='ready'?new Promise(resolve=>{resumeWrite=resolve}):Promise.resolve()},sleep:async()=>controller.abort('SIGINT')});
  await vi.waitFor(()=>expect(resumeWrite).toBeTypeOf('function'));expect(request).toHaveBeenCalledOnce();resumeWrite();
  expect(await pending).toBe(130);expect(lines.map(x=>x.event)).toEqual(['ready','checkpoint','end']);expect(lines.at(-1).cursor).toBe('example:console:2');
});

it('disconnect/expired cursors stop with a resumable error and never restart the observation', async () => {
  const lines=[];let n=0;
  const request=vi.fn(async()=>n++===0?batch([row(1)]):{ok:false,error:{code:'OBSERVATION_CURSOR_EXPIRED',message:'Example expired'}});
  expect(await followBrowser('console',{session:'work',follow:true},{request,emit:async line=>lines.push(line),sleep:async()=>{}})).toBe(1);
  expect(request).toHaveBeenCalledTimes(2);expect(lines.at(-1)).toMatchObject({event:'error',cursor:row(1).eventCursor,error:{code:'OBSERVATION_CURSOR_EXPIRED'}});
});

it('duration ends quietly, SIGTERM stops an in-flight request, and a failed initial poll is not a successful stream', async () => {
  let now=0;const lines=[];
  expect(await followBrowser('console',{session:'work',follow:true,durationMs:1000},{now:()=>now,request:async()=>batch([]),emit:async line=>lines.push(line),sleep:async ms=>{now+=ms}})).toBe(0);
  expect(lines.map(x=>x.event)).toEqual(['ready','end']);expect(lines.at(-1).reason).toBe('duration');
  const controller=new AbortController();
  expect(await followBrowser('console',{session:'work',follow:true},{request:async()=>{controller.abort('SIGTERM');return{ok:false,error:{code:'ABORTED'}}},signal:controller.signal,emit:async()=>{}})).toBe(143);
  now=0;
  expect(await followBrowser('console',{session:'work',follow:true,durationMs:1000},{now:()=>now,request:async()=>{now=1000;return {ok:false,error:{code:'TIMEOUT',message:'Example timeout'}}},emit:async()=>{}})).toBe(1);
});

it('invalid stream options, old protocol and network gaps fail explicitly', async () => {
  for(const args of [{detail:'example'},{after:1},{intervalMs:1},{maxEvents:-1},{maxEvents:null},{durationMs:true},{unknown:true}]){
    const request=vi.fn(),lines=[];expect(await followBrowser('network',{session:'work',follow:true,...args},{request,emit:async line=>lines.push(line)})).toBe(1);expect(request).not.toHaveBeenCalled();expect(lines[0].event).toBe('error');
  }
  const lines=[];expect(await followBrowser('network',{session:'work',follow:true},{request:async()=>({ok:true,data:{}}),emit:async line=>lines.push(line)})).toBe(1);expect(lines[0].error.code).toBe('EXTENSION_UPGRADE_REQUIRED');
  const gap=[];expect(await followBrowser('network',{session:'work',follow:true},{request:async()=>batch([{phase:'gap'}]),emit:async line=>gap.push(line)})).toBe(1);expect(gap.at(-1).error.code).toBe('OBSERVATION_GAP');
});

it('a closed output pipe ends quietly even before the stream error signal, and a failing error writer does not throw', async () => {
  expect(await followBrowser('console', {session:'work'}, { request:async()=>batch([]), emit:async()=>{throw Object.assign(new Error('closed'),{code:'EPIPE'})} })).toBe(0);
  expect(await followBrowser('console', {session:'work'}, { request:async()=>({ok:false,error:{code:'EXAMPLE'}}), emit:async()=>{throw new Error('unwritable')} })).toBe(1);
});
