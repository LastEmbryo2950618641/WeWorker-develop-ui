import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {it,expect,afterEach} from 'vitest';
import {inspectLocalUpload} from '../upload-files.js';
const roots=[];
const root=()=>{const value=fs.mkdtempSync(path.join(os.tmpdir(),'example-directory-'));roots.push(value);return value;};
afterEach(()=>{for(const value of roots.splice(0))fs.rmSync(value,{recursive:true,force:true});});
it('snapshots duplicate leaf names by relative path and rejects empty/wrong modes',()=>{
  const folder=root();
  expect(()=>inspectLocalUpload([folder],true)).toThrow(/contain a file/);
  fs.mkdirSync(path.join(folder,'nested'));fs.writeFileSync(path.join(folder,'same.json'),'one');fs.writeFileSync(path.join(folder,'nested/same.json'),'two2');
  const files=inspectLocalUpload([folder],true);
  expect(files).toEqual([{name:'same.json',size:4,relativePath:path.basename(folder)+'/nested/same.json'},{name:'same.json',size:3,relativePath:path.basename(folder)+'/same.json'}]);
  expect(()=>inspectLocalUpload([folder])).toThrow(/regular files/);
  expect(()=>inspectLocalUpload([folder,folder],true)).toThrow(/one directory/);
  expect(()=>inspectLocalUpload([path.join(folder,'missing')],true)).toThrow(/unavailable/);
});
it('rejects directory junctions, too many files and deep trees before dispatch',()=>{
  const folder=root(),outside=root();fs.writeFileSync(path.join(outside,'example.json'),'example');
  fs.symlinkSync(outside,path.join(folder,'link'),process.platform==='win32'?'junction':'dir');
  expect(()=>inspectLocalUpload([folder],true)).toThrow(/links or junctions/);
  const many=root();for(let i=0;i<201;i++)fs.writeFileSync(path.join(many,String(i)+'.json'),'x');
  expect(()=>inspectLocalUpload([many],true)).toThrow(/200 files/);
  const deep=root();let dir=deep;for(let i=0;i<17;i++){dir=path.join(dir,'d');fs.mkdirSync(dir);}
  fs.writeFileSync(path.join(dir,'example.json'),'x');expect(()=>inspectLocalUpload([deep],true)).toThrow(/16 levels/);
});
