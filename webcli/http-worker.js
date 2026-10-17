/** Serialized into a dedicated worker; Adapter code receives only realm-local objects. */
export function httpWorkerMain() {
  const { parentPort, workerData } = require('node:worker_threads');
  const vm = require('node:vm');
  const urlBridge = json => {
    try {
      const input = JSON.parse(json);
      const value = input.kind === 'url' ? new URL(input.value, input.base) : new URLSearchParams(input.value);
      if (input.set !== undefined) value[input.key] = input.set;
      let result;
      if (input.method) {
        result = value[input.method](...(input.args || []));
        if (['keys', 'values', 'entries'].includes(input.method)) result = [...result];
      } else result = value[input.key];
      return JSON.stringify({ value: value.toString(), result });
    } catch { return '{"error":true}'; }
  };
  const context = vm.createContext(Object.assign(Object.create(null), { __urlBridge: urlBridge }), { codeGeneration: { strings: false, wasm: false } });
  const factories = Object.entries(workerData.files).filter(([name]) => name.endsWith('.js')).map(([name, source]) =>
    JSON.stringify(name) + ': function(module, exports, require) { "use strict";\n' + source + '\n}').join(',\n');
  const setup = `
    (() => {
      const bridge = globalThis.__urlBridge; delete globalThis.__urlBridge;
      const rpc = input => { const output = JSON.parse(bridge(JSON.stringify(input))); if (output.error) throw new Error('Invalid URL operation.'); return output; };
      globalThis.URLSearchParams = class URLSearchParams {
        #value; #update;
        constructor(value = '', update = () => {}) { if (value instanceof URLSearchParams) value = value.toString(); this.#value = rpc({kind:'params',value}).value; this.#update = update; }
        #call(method, args = []) { const out = rpc({kind:'params',value:this.#value,method,args}); this.#value = out.value; this.#update(out.value); return out.result; }
        set(...args) { this.#call('set',args); } append(...args) { this.#call('append',args); } delete(...args) { this.#call('delete',args); }
        get(...args) { return this.#call('get',args); } getAll(...args) { return this.#call('getAll',args); } has(...args) { return this.#call('has',args); }
        keys() { return this.#call('keys')[Symbol.iterator](); } values() { return this.#call('values')[Symbol.iterator](); }
        entries() { return this.#call('entries')[Symbol.iterator](); } [Symbol.iterator]() { return this.entries(); }
        sort() { this.#call('sort'); } get size() { return [...this.entries()].length; }
        forEach(callback, thisArg) { for (const [key,value] of this.entries()) callback.call(thisArg,value,key,this); }
        toString() { return this.#value; }
      };
      globalThis.URL = class URL {
        #value;
        constructor(value, base) { this.#value = rpc({kind:'url',value:String(value),base:base === undefined ? undefined : String(base)}).value; }
        get href() { return this.#value; } set href(value) { this.#value = rpc({kind:'url',value}).value; }
        get origin() { return rpc({kind:'url',value:this.#value,key:'origin'}).result; }
        get protocol() { return rpc({kind:'url',value:this.#value,key:'protocol'}).result; }
        set protocol(set) { this.#value = rpc({kind:'url',value:this.#value,key:'protocol',set}).value; }
        get hostname() { return rpc({kind:'url',value:this.#value,key:'hostname'}).result; }
        set hostname(set) { this.#value = rpc({kind:'url',value:this.#value,key:'hostname',set}).value; }
        get host() { return rpc({kind:'url',value:this.#value,key:'host'}).result; }
        set host(set) { this.#value = rpc({kind:'url',value:this.#value,key:'host',set}).value; }
        get port() { return rpc({kind:'url',value:this.#value,key:'port'}).result; }
        set port(set) { this.#value = rpc({kind:'url',value:this.#value,key:'port',set}).value; }
        get username() { return rpc({kind:'url',value:this.#value,key:'username'}).result; }
        set username(set) { this.#value = rpc({kind:'url',value:this.#value,key:'username',set}).value; }
        get password() { return rpc({kind:'url',value:this.#value,key:'password'}).result; }
        set password(set) { this.#value = rpc({kind:'url',value:this.#value,key:'password',set}).value; }
        get pathname() { return rpc({kind:'url',value:this.#value,key:'pathname'}).result; }
        set pathname(set) { this.#value = rpc({kind:'url',value:this.#value,key:'pathname',set}).value; }
        get search() { return rpc({kind:'url',value:this.#value,key:'search'}).result; }
        set search(set) { this.#value = rpc({kind:'url',value:this.#value,key:'search',set}).value; }
        get hash() { return rpc({kind:'url',value:this.#value,key:'hash'}).result; }
        set hash(set) { this.#value = rpc({kind:'url',value:this.#value,key:'hash',set}).value; }
        get searchParams() { return new URLSearchParams(this.search, value => { this.search = value; }); }
        toString() { return this.#value; }
        toJSON() { return this.#value; }
      };
    })();
    (() => {
      const outbox = [], pending = new Map(), cache = new Map(); let sequence = 0;
      const request = options => new Promise((resolve,reject) => {
        const id = ++sequence; pending.set(id,{resolve,reject}); outbox.push({type:'request',id,options});
      });
      globalThis.__drain = () => JSON.stringify(outbox.splice(0));
      globalThis.__receive = json => {
        const message = JSON.parse(json), item = pending.get(message.id); if (!item) return;
        pending.delete(message.id);
        if (message.error) item.reject(Object.assign(new Error(message.error.message), {code:message.error.code})); else item.resolve(message.result);
      };
      const factories = {${factories}};
      const load = name => {
        if (cache.has(name)) return cache.get(name).exports;
        if (!Object.hasOwn(factories,name)) throw new Error('HTTP module is missing.');
        const module = {exports:{}}; cache.set(name,module);
        factories[name](module,module.exports,relative => {
          if (typeof relative !== 'string' || !relative.startsWith('.')) throw new Error('Only relative HTTP internal modules are supported.');
          const segments = name.split('/').slice(0,-1);
          for (const part of relative.split('/')) { if (part === '..') segments.pop(); else if (part && part !== '.') segments.push(part); }
          const target = segments.join('/');
          if (!target.startsWith('http/internal/') || !target.endsWith('.js')) throw new Error('HTTP imports must stay in http/internal/.');
          return load(target);
        });
        return module.exports;
      };
      (async () => {
        const execute = load(${JSON.stringify(workerData.module)});
        if (typeof execute !== 'function') throw new Error('HTTP command must export a function.');
        const result = await execute(JSON.parse(${JSON.stringify(JSON.stringify(workerData.args))}), Object.freeze({request}));
        outbox.push({type:'result',result:JSON.parse(JSON.stringify(result))});
      })().catch(error => outbox.push({type:'failure',error:{
        code:typeof error.code === 'string' && /^HTTP_[A-Z_]+$/.test(error.code) ? error.code : 'HTTP_COMMAND_FAILED',
        message:'HTTP command failed. Inspect the implementation and the declared request contract.'
      }}));
    })();`;
  new vm.Script(setup).runInContext(context);
  const drain = () => { for (const message of JSON.parse(vm.runInContext('__drain()', context))) parentPort.postMessage(message); };
  parentPort.on('message', message => {
    vm.runInContext('__receive(' + JSON.stringify(JSON.stringify(message)) + ')', context);
    setImmediate(drain);
  });
  setImmediate(drain);
}
