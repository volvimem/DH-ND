'use strict';

// Execute the actual shared maintenance module. Every identity, route, token,
// DOM node, timer and database write below is an isolated in-memory fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const ROOT = 'dhnd_maintenance';
const CPF = '00123456789';
const profile = overrides => ({cpf:CPF,uid:'fixture-user',nome:'ATLETA FICTICIO',role:'USER',...overrides});
const firebaseUser = (overrides={}) => ({uid:'fixture-user',email:CPF+'@dhpe.com.br',getIdToken:async()=> 'fixture-token-not-real',...overrides});
const flush = async () => {for(let i=0;i<16;i++)await Promise.resolve();await new Promise(setImmediate);};

function setup(source,options={}) {
  const nodes = new Map(), textWrites=[], htmlWrites=[], requests=[], writes=[], changes=[], errors=[], events=new Map();
  let clock=0, sequence=0, currentProfile=options.profile===undefined?profile():options.profile;
  const timers=new Map(), sdkListeners=new Map(), authListeners=new Set(), pendingWrites=[], heldRequests=[];
  const remote={public:{enabled:true,message:'Preparação do sistema.'},admin:false,adminStatus:403,own:false,ownStatus:200,publicStatus:200,rootStatus:200,sdkConnected:true,...options.remote};
  const holdNext=new Set();
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes={};this.listeners=new Map();this._text='';this._html='';this.dataset={};this.hidden=false;this.value='';this.className='';const classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>{const add=on===undefined?!classes.has(x):on;add?classes.add(x):classes.delete(x);return add;}};}
    set id(value){this._id=value;nodes.set(value,this);}get id(){return this._id||'';}
    set textContent(value){this._text=String(value);textWrites.push(this._text);}get textContent(){return this._text;}
    set innerHTML(value){this._html=String(value);htmlWrites.push(this._html);if(!value)this.children=[];for(const match of this._html.matchAll(/\bid=["']([^"']+)["']/g)){if(!nodes.has(match[1])){const node=new Element();node.id=match[1];this.appendChild(node);}}}get innerHTML(){return this._html;}
    appendChild(node){node.parentNode=this;this.children.push(node);return node;}append(...items){items.forEach(item=>this.appendChild(item));}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
    setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);}getAttribute(key){return this.attributes[key];}
    addEventListener(name,callback){this.listeners.set(name,callback);}removeEventListener(name){this.listeners.delete(name);}
    querySelector(selector){return document.querySelector(selector);}querySelectorAll(selector){return document.querySelectorAll(selector);}focus(){}
  }
  const document={readyState:'complete',createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id)||null,
    querySelector:selector=>selector.startsWith('#')?nodes.get(selector.slice(1))||null:null,
    querySelectorAll:selector=>selector.startsWith('#')?(nodes.has(selector.slice(1))?[nodes.get(selector.slice(1))]:[]):[],
    addEventListener:(name,fn)=>events.set('document:'+name,fn)};
  document.body=new Element('body');document.head=new Element('head');document.documentElement=new Element('html');
  const auth={currentUser:options.user||null,onAuthStateChanged(callback){authListeners.add(callback);return()=>authListeners.delete(callback);}};
  const database={ref(reference){const key=String(reference).replace(/^\//,'');return {
    on(name,callback,cancel){const list=sdkListeners.get(key)||new Set();list.add({callback,cancel});sdkListeners.set(key,list);if(options.onListen)options.onListen(key,remote);Promise.resolve().then(()=>callback({val:()=>key==='.info/connected'?remote.sdkConnected:key===ROOT+'/public'?remote.public:key===ROOT+'/adminAccess'?remote.admin:key===ROOT+'/allowedCpfs/'+CPF?remote.own:null}));},
    off(name,callback){const list=sdkListeners.get(key);if(list)for(const item of list)if(!callback||item.callback===callback)list.delete(item);},
    set(value){writes.push({path:key,value:clone(value)});if(options.writeMode==='reject')return Promise.reject(new Error('fixture-write-denied'));if(options.writeMode==='delay')return new Promise((resolve,reject)=>pendingWrites.push({resolve,reject}));return Promise.resolve();}
  };}};
  function responseFor(url){const pathname=new URL(String(url)).pathname.replace(/^\//,'');
    if(pathname===ROOT+'/public.json')return {status:remote.publicStatus,value:remote.public};
    if(pathname===ROOT+'/adminAccess.json')return {status:remote.adminStatus,value:remote.admin};
    if(pathname===ROOT+'/allowedCpfs/'+CPF+'.json')return {status:remote.ownStatus,value:remote.own};
    if(pathname.startsWith(ROOT+'/allowedCpfs/'))return {status:remote.ownStatus,value:false};
    if(pathname===ROOT+'.json')return {status:remote.rootStatus,value:remote.root===undefined?{public:remote.public,allowedCpfs:{[CPF]:true},adminAccess:true}:remote.root};
    throw new Error('Unexpected fixture REST path: '+pathname);
  }
  function fetchFixture(url,init={}) {
    const parsed=new URL(String(url));assert.equal(parsed.origin,'https://maintenance-contract.invalid','Network must be isolated');
    requests.push({url:String(url),path:parsed.pathname,init:clone(init)});
    const spec=clone(responseFor(url)),response={ok:spec.status>=200&&spec.status<300,status:spec.status,json:async()=>{if(remote.jsonErrorPath===parsed.pathname)throw new Error('fixture-response-failed https://maintenance-contract.invalid/?auth=fixture-token-not-real');return clone(spec.value);},text:async()=>JSON.stringify(spec.value)};
    if(holdNext.delete(parsed.pathname))return new Promise(resolve=>heldRequests.push({path:parsed.pathname,resolve:()=>resolve(response)}));
    return Promise.resolve(response);
  }
  const setTimer=(fn,delay,repeat)=>{const id=++sequence;timers.set(id,{fn,due:clock+Number(delay||0),repeat});return id;};
  const context={document,auth,database,URL,fetch:fetchFixture,navigator:{onLine:options.online!==false},location:{href:'https://app-contract.invalid/'},
    console:{warn:(...args)=>errors.push(args.join(' ')),error:(...args)=>errors.push(args.join(' ')),log:()=>{}},
    setTimeout:(fn,delay)=>setTimer(fn,delay,0),clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>setTimer(fn,delay,Number(delay)),clearInterval:id=>timers.delete(id),
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    localStorage:{getItem:()=>JSON.stringify({allowed:true,admin:true,role:'ADMIN'}),setItem:()=>{throw new Error('Unwanted cache write');},removeItem:()=>{}},
    sessionStorage:{getItem:()=>JSON.stringify({allowed:true,admin:true,role:'ADMIN'}),setItem:()=>{throw new Error('Unwanted cache write');},removeItem:()=>{}}};
  context.window=context;vm.createContext(context);vm.runInContext(source,context,{filename:'maintenance.js'});
  assert.equal(typeof context.DHNDMaintenance?.create,'function','Real maintenance API missing');
  const calls={login:0,logout:0};
  const gate=context.DHNDMaintenance.create({database,auth,databaseURL:'https://maintenance-contract.invalid',identity:()=>currentProfile,
    onChange:state=>changes.push(clone(state)),onLogin:()=>{calls.login++;},onLogout:()=>{calls.logout++;}});
  return {gate,remote,auth,nodes,textWrites,htmlWrites,requests,writes,changes,errors,calls,pendingWrites,heldRequests,holdNext,navigator:context.navigator,
    setProfile:value=>{currentProfile=value;},
    async emitAuth(user){auth.currentUser=user;for(const callback of [...authListeners])callback(user);await flush();},
    async emitGlobal(name,event={}){events.get(name)?.(event);await flush();},
    async emitVisibility(value){document.visibilityState=value;events.get('document:visibilitychange')?.();await flush();},
    async emitSdk(key,value=null,error){const normalized=key.replace(/^\//,'');if(normalized==='.info/connected'&&!error)remote.sdkConnected=value;const list=sdkListeners.get(normalized)||[];for(const item of list)error?item.cancel?.(error):item.callback({val:()=>value});await flush();},
    async advance(ms){const target=clock+ms;let limit=0;while(true){const entries=[...timers.entries()].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due);if(!entries.length)break;if(++limit>100)throw Error('Timer loop');const [id,timer]=entries[0];clock=timer.due;timers.delete(id);if(timer.repeat)timers.set(id,{...timer,due:clock+timer.repeat});timer.fn();await flush();}clock=target;await flush();}
  };
}

async function runSuite(options={}) {
  const appRoot=options.appRoot||path.join(__dirname,'..'),source=fs.readFileSync(path.join(appRoot,'maintenance.js'),'utf8');
  let total=0,passed=0;
  async function test(name,fn){total++;try{await fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+'\n'+error.stack);}}
  async function started(settings,user=firebaseUser()){const h=setup(source,settings);await flush();await h.emitAuth(user);return h;}

  await test('create starts closed, waits for verified policy/Auth and never writes automatically',async()=>{
    const h=setup(source);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.ready,false);await flush();assert.equal(h.gate.guard(),false);assert.equal(h.writes.length,0);
  });
  await test('verified maintenance OFF permits the normal public entry after the initial null Auth callback',async()=>{
    const h=await started({profile:null,remote:{public:{enabled:false,message:'Livre.'}}},null);assert.equal(h.gate.state.ready,true);assert.equal(h.gate.state.enabled,false);assert.equal(h.gate.guard(),true);assert.equal(h.gate.state.admin,false);assert.equal(h.writes.length,0);
  });
  await test('verified absent public policy defaults OFF without creating configuration',async()=>{
    const h=await started({profile:null,remote:{public:null}},null);assert.equal(h.gate.guard(),true);assert.equal(h.gate.state.enabled,false);assert.equal(h.writes.length,0);
  });
  await test('public REST failure stays blocked despite an allowed/admin browser cache',async()=>{
    const h=await started({remote:{publicStatus:503}});assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.allowed,false);assert.equal(h.gate.state.admin,false);
  });
  await test('every confirmation read bypasses the HTTP cache and uses the isolated fixture endpoint',async()=>{
    const h=await started({remote:{own:true}});assert.ok(h.requests.length>=2);for(const request of h.requests)assert.equal(request.init.cache,'no-store');assert.equal(h.gate.guard(),true);
  });
  await test('maintenance ON denies unauthenticated visitors even with a cached administrator role',async()=>{
    const h=await started({profile:profile({role:'ADMIN'})},null);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('an explicit own-CPF allowance permits the matching Firebase account',async()=>{
    const h=await started({remote:{own:true,adminStatus:403}});assert.equal(h.gate.guard(),true);assert.equal(h.gate.state.admin,false);
  });
  await test('a local ADMIN role never grants admission when the server denies both routes',async()=>{
    const h=await started({profile:profile({role:'ADMIN'}),remote:{own:false}});assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('only server administrator authorization grants the administrative admission',async()=>{
    const h=await started({profile:profile({role:'USER'}),remote:{admin:true,adminStatus:200,own:false}});assert.equal(h.gate.guard(),true);assert.equal(h.gate.state.admin,true);
  });
  await test('an Auth email/CPF mismatch cannot use a server allowlist or administrator response',async()=>{
    const h=await started({remote:{admin:true,adminStatus:200,own:true}},firebaseUser({email:'00987654321@dhpe.com.br'}));assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('a present profile UID must match the current Firebase UID',async()=>{
    const h=await started({profile:profile({uid:'different-fixture-user'}),remote:{admin:true,adminStatus:200,own:true}});assert.equal(h.gate.guard(),false);
  });
  await test('a legacy server profile without UID still requires the matching Auth email and own permission',async()=>{
    const h=await started({profile:profile({uid:undefined}),remote:{own:true}});assert.equal(h.gate.guard(),true);assert.equal(h.gate.state.admin,false);
  });
  await test('an expected administrator 401 still permits checking the explicit own permission',async()=>{
    const h=await started({remote:{adminStatus:401,own:true}});assert.equal(h.gate.guard(),true);assert.equal(h.gate.state.admin,false);
  });
  await test('an own-permission read error is blocked rather than treated as a public admission',async()=>{
    const h=await started({remote:{ownStatus:503,own:true}});assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('only boolean true in the private allowance grants admission',async()=>{
    const h=await started({remote:{own:'true'}});assert.equal(h.gate.guard(),false);
  });
  await test('an invalid public object never defaults to an open maintenance policy',async()=>{
    const h=await started({remote:{public:{message:'Sem ativação definida.'},own:true}});assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.ready,false);
  });
  await test('revoking an allowed CPF is confirmed again and closes the existing admission',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.remote.own=false;await h.emitSdk(ROOT+'/allowedCpfs/'+CPF,false);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.allowed,false);
  });
  await test('a first SDK own-permission snapshot already revoked after REST closes the gate without waiting for polling',async()=>{
    let changed=false;const h=await started({remote:{own:true},onListen:(key,remote)=>{if(!changed&&key===ROOT+'/allowedCpfs/'+CPF){changed=true;remote.own=false;}}});await flush();assert.equal(changed,true);assert.equal(h.gate.guard(),false);
  });
  await test('a first SDK administrator snapshot already revoked after REST cannot leave an administrative admission',async()=>{
    let changed=false;const h=await started({remote:{admin:true,adminStatus:200,own:false},onListen:(key,remote)=>{if(!changed&&key===ROOT+'/adminAccess'){changed=true;remote.admin=false;}}});await flush();assert.equal(changed,true);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('a public realtime invalidation can close a formerly open public entry',async()=>{
    const h=await started({profile:null,remote:{public:{enabled:false,message:''}}},null);assert.equal(h.gate.guard(),true);h.remote.public={enabled:true,message:'Fechado.'};await h.emitSdk(ROOT+'/public',h.remote.public);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.enabled,true);
  });
  await test('Firebase sign-out revokes an existing own-CPF admission immediately',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);await h.emitAuth(null);assert.equal(h.gate.guard(),false);
  });
  await test('a late allowed response for a previous account cannot reopen the new denied session',async()=>{
    const h=setup(source,{remote:{own:true}});await flush();h.holdNext.add('/'+ROOT+'/allowedCpfs/'+CPF+'.json');await h.emitAuth(firebaseUser());assert.equal(h.heldRequests.length,1);assert.equal(h.gate.guard(),false);
    h.setProfile(profile({cpf:'00987654321',uid:'fixture-second-user'}));await h.emitAuth(firebaseUser({uid:'fixture-second-user',email:'00987654321@dhpe.com.br'}));assert.equal(h.gate.guard(),false);
    h.heldRequests[0].resolve();await flush();assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('refreshIdentity revokes admission when the profile stops matching the Firebase account',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.setProfile(profile({cpf:'00987654321'}));await h.gate.refreshIdentity();assert.equal(h.gate.guard(),false);
  });
  await test('guard denies a changed profile before an identity callback or explicit refresh',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.setProfile(profile({cpf:'00987654321'}));assert.equal(h.gate.guard(),false);await flush();assert.equal(h.gate.state.allowed,false);
  });
  await test('guard denies an Auth account switch before the Auth observer has fired',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.auth.currentUser=firebaseUser({uid:'fixture-other-account'});assert.equal(h.gate.guard(),false);await flush();assert.equal(h.gate.state.allowed,false);
  });
  await test('a delayed token from a signed-out account cannot authorize subsequent requests',async()=>{
    let release;const h=setup(source,{remote:{own:true}});await flush();await h.emitAuth(firebaseUser({getIdToken:()=>new Promise(resolve=>{release=resolve;})}));assert.equal(typeof release,'function');await h.emitAuth(null);release('fixture-token-not-real');await flush();assert.equal(h.gate.guard(),false);assert.equal(h.requests.some(request=>request.path==='/'+ROOT+'/allowedCpfs/'+CPF+'.json'),false);
  });
  await test('going offline closes an already authorized admission immediately',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.navigator.onLine=false;await h.emitGlobal('offline');assert.equal(h.gate.guard(),false);
  });
  await test('an offline startup never trusts an OFF cache or even attempts a confirmation request',async()=>{
    const h=await started({online:false,profile:null,remote:{public:{enabled:false,message:''}}},null);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.ready,false);assert.equal(h.requests.length,0);
  });
  await test('normal startup shows no maintenance dialog and verified OFF does not wait for the SDK connection',async()=>{
    const h=setup(source,{profile:null,remote:{sdkConnected:false,public:{enabled:false,message:'Livre.'}}});
    const dialog=h.nodes.get('dhnd-maintenance-gate');
    assert.equal(dialog.style.display,'none');
    await flush();
    assert.equal(dialog.style.display,'none');
    await h.emitAuth(null);
    assert.equal(h.gate.guard(),true);
    assert.equal(dialog.style.display,'none');
    assert.ok(!h.textWrites.includes('ACESSO INDISPONÍVEL'));
    const before=h.changes.length;
    await h.emitSdk('.info/connected',true);
    assert.equal(h.gate.guard(),true);
    assert.equal(h.changes.length,before,'Socket recovery must not cover normal entry');
    await h.emitAuth(firebaseUser());
    assert.equal(h.gate.guard(),true);
    assert.equal(h.changes.length,before,'Signing in must not reopen the maintenance screen when off');
  });
  await test('an authenticated tester sees pending startup until the SDK connects and permission is confirmed',async()=>{
    const h=await started({remote:{sdkConnected:false,own:true}});
    const dialog=h.nodes.get('dhnd-maintenance-gate');
    assert.equal(h.gate.state.enabled,true);
    assert.equal(h.gate.guard(),false);
    assert.equal(dialog.style.display,'none');
    await h.emitSdk('.info/connected',true);
    assert.equal(h.gate.guard(),true);
    assert.equal(dialog.style.display,'none');
  });
  await test('an SDK timeout shows connection unavailable and recovers after a fresh verification',async()=>{
    const h=await started({remote:{sdkConnected:false,own:true}});
    const dialog=h.nodes.get('dhnd-maintenance-gate');
    await h.advance(9999);
    assert.equal(dialog.style.display,'none');
    await h.advance(1);
    assert.equal(h.gate.guard(),false);
    assert.equal(dialog.style.display,'flex');
    assert.equal(dialog.children[0].textContent,'ACESSO INDISPONÍVEL');
    await h.emitSdk('.info/connected',true);
    assert.equal(h.gate.guard(),true);
    assert.equal(dialog.style.display,'none');
  });
  await test('a confirmed unauthorised session sees maintenance after connection',async()=>{
    const h=await started({remote:{sdkConnected:false,own:false}});
    const dialog=h.nodes.get('dhnd-maintenance-gate');
    assert.equal(dialog.style.display,'none');
    await h.emitSdk('.info/connected',true);
    assert.equal(h.gate.guard(),false);
    assert.equal(dialog.style.display,'flex');
    assert.equal(dialog.children[0].textContent,'SISTEMA EM MANUTENÇÃO');
  });
  await test('a login request after sign-out survives startup with active maintenance',async()=>{
    const h=setup(source,{profile:null,remote:{sdkConnected:false}});
    h.gate.beginLogin(false);
    await h.emitAuth(null);
    await h.emitSdk('.info/connected',true);
    assert.equal(h.gate.state.loginRequested,true);
    assert.equal(h.gate.guard(),false);
    assert.equal(h.nodes.get('dhnd-maintenance-gate').style.display,'none');
  });
  await test('losing the Firebase SDK connection revokes an existing admission immediately',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);await h.emitSdk('.info/connected',false);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.allowed,false);
  });
  await test('a restored SDK connection confirms the permission again instead of reviving the old grant',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);await h.emitSdk('.info/connected',false);h.remote.own=false;const before=h.requests.length;await h.emitSdk('.info/connected',true);assert.ok(h.requests.length>before);assert.equal(h.gate.guard(),false);
  });
  await test('an approved athlete returning from phone lock reopens after a fresh check while the SDK reconnects',async()=>{
    const h=await started({remote:{own:true}});
    await h.emitVisibility('hidden'); await h.emitSdk('.info/connected',false);
    assert.equal(h.gate.guard(),false);
    const before=h.requests.length;
    await h.emitVisibility('visible');
    assert.equal(h.gate.guard(),true);
    assert.ok(h.requests.slice(before).some(request=>request.path.endsWith('/allowedCpfs/'+CPF+'.json')&&request.init.cache==='no-store'));
    assert.equal(h.calls.login,0);
  });
  await test('a resumed athlete whose grant changed is denied while the SDK reconnects',async()=>{
    const h=await started({remote:{own:true}});
    await h.emitVisibility('hidden'); await h.emitSdk('.info/connected',false);
    h.remote.own=false; await h.emitGlobal('pageshow',{persisted:true});
    await h.emitVisibility('visible');
    assert.equal(h.gate.guard(),false);
    assert.equal(h.gate.state.admin,false);
  });
  await test('switching accounts during foreground recovery cannot unlock with the old grant',async()=>{
    const h=await started({remote:{own:true}});
    await h.emitVisibility('hidden'); await h.emitSdk('.info/connected',false);
    h.holdNext.add('/'+ROOT+'/allowedCpfs/'+CPF+'.json');
    await h.emitVisibility('visible'); assert.equal(h.heldRequests.length,1);
    h.setProfile(profile({cpf:'00987654321',uid:'second-account'}));
    await h.emitAuth(firebaseUser({uid:'second-account',email:'00987654321@dhpe.com.br'}));
    h.heldRequests[0].resolve(); await flush();
    assert.equal(h.gate.guard(),false);
  });
  await test('the SDK dropping just after wake does not strand an allowed athlete behind the gate',async()=>{
    const h=await started({remote:{own:true}});
    await h.emitVisibility('hidden'); await h.emitVisibility('visible');
    await h.emitSdk('.info/connected',false);
    assert.equal(h.gate.guard(),true);
    assert.equal(h.calls.login,0);
  });
  await test('reconnecting requires a fresh permission and cannot revive an old allowance',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.navigator.onLine=false;await h.emitGlobal('offline');h.remote.own=false;const before=h.requests.length;h.navigator.onLine=true;await h.emitGlobal('online');assert.ok(h.requests.length>before);assert.equal(h.gate.guard(),false);
  });
  await test('a failed poll revokes the last verified allowance rather than retaining it as a cache',async()=>{
    const h=await started({remote:{own:true}});assert.equal(h.gate.guard(),true);h.remote.publicStatus=503;await h.advance(20000);assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.allowed,false);
  });
  await test('an unchanged confirmation poll never repeats the UI change callback',async()=>{
    const h=await started({remote:{own:true}}),before=h.changes.length,requests=h.requests.length;await h.advance(20000);assert.ok(h.requests.length>requests,'Poll must confirm with REST');assert.equal(h.changes.length,before);
  });
  await test('the public maintenance message is written as text rather than executable HTML',async()=>{
    const attack='<img src=x onerror="fixtureAttack()">';const h=await started({profile:null,remote:{public:{enabled:true,message:attack}}},null);assert.equal(h.gate.guard(),false);assert.ok(h.textWrites.includes(attack),'Message needs literal textContent');assert.ok(!h.htmlWrites.some(value=>value.includes(attack)),'Untrusted maintenance message reached innerHTML');
  });
  await test('beginLogin requests the existing login flow without granting application access',async()=>{
    const h=await started({profile:null},null);h.gate.beginLogin();await flush();assert.equal(h.calls.login,1);assert.equal(h.gate.state.loginRequested,true);assert.equal(h.gate.guard(),false);
  });
  await test('getPolicy uses server root authorization before local admin state and never grants admission',async()=>{
    const h=await started({remote:{own:false,admin:false,adminStatus:403}});assert.equal(h.gate.state.admin,false);assert.equal(h.gate.guard(),false);
    const result=await h.gate.getPolicy();assert.equal(result.public.enabled,true);assert.deepEqual(clone(result.allowedCpfs),{[CPF]:true});assert.equal(h.gate.state.admin,false);assert.equal(h.gate.guard(),false);
    assert.ok(h.requests.some(request=>request.path==='/'+ROOT+'.json'));
  });
  await test('an absent authorized root returns an OFF policy and empty list without opening the gate or writing',async()=>{
    const h=await started({remote:{root:null}});const result=await h.gate.getPolicy();assert.equal(result.public.enabled,false);assert.deepEqual(clone(result.allowedCpfs),{});assert.equal(h.gate.guard(),false);assert.equal(h.writes.length,0);
  });
  await test('getPolicy denied by server rejects without trusting local administrator metadata',async()=>{
    const h=await started({profile:profile({role:'ADMIN'}),remote:{rootStatus:403}});await assert.rejects(h.gate.getPolicy());assert.equal(h.gate.guard(),false);assert.equal(h.gate.state.admin,false);
  });
  await test('a response decoding/network error never exposes a URL or token through getPolicy',async()=>{
    const h=await started({remote:{jsonErrorPath:'/'+ROOT+'.json'}});await assert.rejects(h.gate.getPolicy(),error=>!error.message.includes('fixture-token-not-real')&&!error.message.includes('maintenance-contract.invalid'));assert.ok(!h.errors.join(' ').includes('fixture-token-not-real'));
  });
  await test('savePolicy waits for the actual root write acknowledgement and keeps the private list separate',async()=>{
    const h=await started({writeMode:'delay'});let complete=false;const operation=h.gate.savePolicy({public:{enabled:true,message:'Texto de manutenção'},allowedCpfs:{[CPF]:true,'00987654321':false}}).then(value=>{complete=true;return value;});await flush();
    assert.equal(complete,false);assert.equal(h.writes.length,1);assert.equal(h.writes[0].path,ROOT);const sent=h.writes[0].value;assert.equal(sent.public.enabled,true);assert.equal(sent.public.message,'Texto de manutenção');assert.equal(typeof sent.public.updatedAt,'number');assert.deepEqual(sent.allowedCpfs,{[CPF]:true});assert.equal(sent.adminAccess,true);assert.equal(Object.hasOwn(sent.public,'allowedCpfs'),false);
    h.pendingWrites[0].resolve();const saved=await operation;assert.equal(complete,true);assert.equal(saved.public.message,'Texto de manutenção');assert.equal(h.gate.guard(),false);
  });
  await test('savePolicy propagates server denial and never invents successful activation',async()=>{
    const h=await started({writeMode:'reject'});await assert.rejects(h.gate.savePolicy({enabled:true,message:'Teste',allowedCpfs:{[CPF]:true}}),/fixture-write-denied/);assert.equal(h.writes.length,1);assert.equal(h.gate.guard(),false);
  });
  await test('a pending save times out while an identical retry reuses the same write',async()=>{
    const h=await started({writeMode:'delay'}),policy={enabled:true,message:'Teste pendente',allowedCpfs:{[CPF]:true}};
    const attempt=h.gate.savePolicy(policy).then(()=>null,error=>error);await flush();assert.equal(h.writes.length,1);await h.advance(20000);const error=await attempt;assert.equal(error.code,'maintenance/save-timeout');assert.equal(h.gate.guard(),false);
    const retry=h.gate.savePolicy(policy);await flush();assert.equal(h.writes.length,1);h.pendingWrites[0].resolve();await retry;assert.equal(h.writes.length,1);
  });
  await test('a different policy is not queued behind an unacknowledged save',async()=>{
    const h=await started({writeMode:'delay'});const first=h.gate.savePolicy({enabled:true,message:'Primeira',allowedCpfs:{}});await flush();
    await assert.rejects(h.gate.savePolicy({enabled:false,message:'Segunda',allowedCpfs:{}}),error=>error.code==='maintenance/pending');assert.equal(h.writes.length,1);h.pendingWrites[0].resolve();await first;
  });
  await test('savePolicy validation refuses malformed allowance entries before any write',async()=>{
    const h=await started();await assert.rejects(h.gate.savePolicy({enabled:true,message:'Teste',allowedCpfs:{'invalid-cpf':true}}));assert.equal(h.writes.length,0);
  });
  await test('a maintenance message above 300 characters is rejected instead of truncated or written',async()=>{
    const h=await started();await assert.rejects(h.gate.savePolicy({enabled:true,message:'x'.repeat(301),allowedCpfs:{}}));assert.equal(h.writes.length,0);
  });

  console.log(`Maintenance: ${passed}/${total} passed. No live services.`);
  if(passed!==total)process.exitCode=1;
  return {passed,total};
}

module.exports={runSuite};
if(require.main===module)runSuite().catch(error=>{console.error(error);process.exitCode=1;});
