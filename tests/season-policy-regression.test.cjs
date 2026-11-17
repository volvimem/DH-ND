'use strict';

// Shared season policy and Club scoring on local fixtures only. No Firebase or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const policy = fs.readFileSync(path.join(root, 'season-policy.js'), 'utf8');
const club = fs.readFileSync(path.join(root, 'dhclub.js'), 'utf8');
const rankingPolicy = fs.readFileSync(path.join(root, 'ranking-policy.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const sandbox = vm.createContext({});
sandbox.window = sandbox;
vm.runInContext(policy, sandbox, {filename:'season-policy.js',timeout:2000});
const seasons = sandbox.DHNDSeasons;
const storage = values => ({getItem:key => Object.hasOwn(values,key) ? values[key] : null, setItem() { throw new Error('Policy must not write storage'); }});
const tests=[];
const test=(name,run)=>tests.push([name,run]);

test('legacy data root stays fixed when the calendar advances from 2026 to 2027 or later',()=>{
  for(const clockYear of [2026,2027,2028,2030]) assert.deepEqual(clone(seasons.context(storage({}),clockYear)),{root:'dhpe_v25_final_stable_fix',year:clockYear});
});
test('2027 can be selected during 2026 without moving the database root',()=>{
  assert.deepEqual(clone(seasons.context(storage({dhpe_active_season:'dhpe_v25_final_stable_fix',dhpe_selected_year:'2027'}),2026)),{root:'dhpe_v25_final_stable_fix',year:2027});
});
test('the selectable future year is limited to clock plus one with 2027 available at minimum',()=>{
  assert.equal(seasons.context(storage({dhpe_selected_year:'2028'}),2026).year,2026);
  assert.equal(seasons.context(storage({dhpe_selected_year:'2027'}),2025).year,2027);
  assert.equal(seasons.context(storage({dhpe_selected_year:'2029'}),2028).year,2029);
});
test('an existing archive or explicitly dated active root keeps its own season',()=>{
  assert.deepEqual(clone(seasons.context(storage({dhpe_active_season:'dhpe_2025_archive',dhpe_selected_year:'2027'}),2026)),{root:'dhpe_2025_archive',year:2025});
  assert.deepEqual(clone(seasons.context(storage({dhpe_active_season:'dhpe_2027_active',dhpe_selected_year:'2026'}),2026)),{root:'dhpe_2027_active',year:2027});
});
test('unavailable storage and malformed selected years safely fall back without storage writes',()=>{
  assert.deepEqual(clone(seasons.context({getItem(){throw new Error('blocked');}},2026)),{root:'dhpe_v25_final_stable_fix',year:2026});
  for(const selected of ['2027oops','', 'Infinity','2027.5']) assert.equal(seasons.context(storage({dhpe_selected_year:selected}),2026).year,2026);
});
test('explicit year/ano wins over ISO hints and root metadata',()=>{
  assert.equal(seasons.eventYear({year:2027,ano:2026,m:'MAR',closeDate:'2026-03-20'}),2027);
  assert.equal(seasons.eventYear({year:'invalid',ano:'2027'},'dhpe_2025_archive'),2027);
  assert.equal(seasons.eventYear({year:[2027],ano:2026}),2026);
});
test('events without a clear year retain legacy 2026 or their dated-root year',()=>{
  assert.equal(seasons.eventYear({id:1,m:'JAN',d:'20'}),2026);
  assert.equal(seasons.eventYear({id:1,m:'JAN',d:'20'},'dhpe_2025_archive'),2025);
  assert.equal(seasons.eventYear(null),2026);
});
test('same-month ISO date hints can identify 2027 without using the current clock',()=>{
  assert.equal(seasons.eventYear({m:'MAR',closeDate:'2027-03-20T23:59'}),2027);
  assert.equal(seasons.eventYear({m:'JAN',qDate:'2027-01-05',closeDate:'2026-12-20T23:59'}),2027);
  assert.equal(seasons.eventYear({m:'03',qDate:'2027-03-21'}),2027);
});
test('ambiguous, cross-month or invalid ISO hints never guess a new year',()=>{
  assert.equal(seasons.eventYear({m:'JAN',closeDate:'2026-12-20T23:59'}),2026);
  assert.equal(seasons.eventYear({m:'MAR',qDate:'2027-03-21',closeDate:'2026-03-20'}),2026);
  assert.equal(seasons.eventYear({m:'FEV',qDate:'2027-02-30'}),2026);
  assert.equal(seasons.eventYear({m:'MAR',closeDate:'2027-03-20T99:99'}),2026);
});
test('inYear requires an event and a valid matching season',()=>{
  assert.equal(seasons.inYear({year:2027},2027),true);
  assert.equal(seasons.inYear({year:2027},2026),false);
  assert.equal(seasons.inYear(null,2026),false);
  assert.equal(seasons.inYear({year:2027},'bad'),false);
});

const data={
  users:[{cpf:'11144477735',role:'ADMIN',cardReleasedYear:2026,idReleased:true}],
  config:{allowAllIDsYear:2026,categories:[{name:'ELITE',active:true}]},
  events:[{id:26,t:'LEGADO',m:'JAN',d:'20'},{id:27,t:'2027',year:2027},{id:28,t:'INFERIDO',m:'MAR',closeDate:'2027-03-01'}],
  tempos:[{evtId:26,cpf:'11144477735',val:'02:00.000',cat:'ELITE'},{evtId:'27',cpf:'11144477735',val:'02:01.000',cat:'ELITE'},{evtId:28,cpf:'11144477735',val:'02:02.000',cat:'ELITE'},{evtId:999,val:'00:01.000'},{}],
  auditLog:[{message:'MANTER'}]
};
test('scopeCore isolates year events and linked results while preserving every profile/configuration',()=>{
  const before=clone(data), result=seasons.scopeCore(data,2027);
  assert.deepEqual(clone(result.events).map(event=>event.id),[27,28]);
  assert.deepEqual(clone(result.tempos).map(result=>result.evtId),['27',28]);
  assert.equal(result.users,data.users); assert.equal(result.config,data.config);
  assert.deepEqual(clone(result.auditLog),data.auditLog);
  assert.deepEqual(data,before,'The source retains 2026 and 2027 data unchanged');
  assert.equal(data.events.length,3); assert.equal(data.tempos.length,5);
});
test('scopeCore accepts keyed Firebase event/result maps without dropping user-map keys',()=>{
  const input={users:{atleta:data.users[0]},config:data.config,events:{a:data.events[0],b:data.events[1]},tempos:{x:data.tempos[0],y:data.tempos[1]}};
  const result=seasons.scopeCore(input,2027);
  assert.equal(result.users,input.users);
  assert.deepEqual(clone(result.events),[data.events[1]]);
  assert.deepEqual(clone(result.tempos),[data.tempos[1]]);
});
test('empty or malformed core collections produce empty season views rather than copied profiles',()=>{
  assert.deepEqual(clone(seasons.scopeCore(null,2027)),{users:[],config:{},events:[],tempos:[]});
  const result=seasons.scopeCore({users:data.users,config:data.config,events:[null,false,{}],tempos:[null,{}]},2027);
  assert.equal(result.users,data.users); assert.deepEqual(clone(result.events),[]); assert.deepEqual(clone(result.tempos),[]);
});

function extractFunction(source,name) {
  const match=new RegExp('function\\s+'+name+'\\s*\\(').exec(source);
  assert.ok(match,'Missing Club function '+name);
  let depth=0,mode='';
  for(let i=source.indexOf('{',match.index);i<source.length;i++) {
    const c=source[i],next=source[i+1];
    if(mode==='line'){if(c==='\n')mode='';continue;}
    if(mode==='block'){if(c==='*'&&next==='/'){mode='';i++;}continue;}
    if(mode){if(c==='\\')i++;else if(c===mode)mode='';continue;}
    if(c==='/'&&next==='/'){mode='line';i++;continue;}
    if(c==='/'&&next==='*'){mode='block';i++;continue;}
    if(c==='"'||c==="'"||c==='`'){mode=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return source.slice(match.index,i+1);
  }
  throw new Error('Unclosed Club function '+name);
}
test('Club card validation uses the real clock year even when viewing the upcoming season',()=>{
  const context=vm.createContext({CLOCK_YEAR:2026,SYSTEM_YEAR:2027,core:{config:{} }});
  vm.runInContext(extractFunction(club,'drawHasActiveDigitalCard'),context);
  assert.equal(context.drawHasActiveDigitalCard({cardReleasedYear:2026}),true);
  assert.equal(context.drawHasActiveDigitalCard({cardReleasedYear:2027}),false);
  assert.equal(context.drawHasActiveDigitalCard({idReleased:true}),true);
  assert.equal(context.drawHasActiveDigitalCard({idReleased:false}),false);
});
test('Club ranking on scoped core cannot mix 2026 and 2027 points',()=>{
  const context=vm.createContext({cleanCPF:value=>String(value||'').replace(/\D/g,'')});
  context.window=context;
  vm.runInContext(policy+'\n'+rankingPolicy,context);
  vm.runInContext(['normalizeCat','timeMs','hasOfficialPointsTable','isOfficialScoringEvent','officialPointsRanking'].map(name=>extractFunction(club,name)).join('\n'),context);
  const input=clone(data);
  input.events[0].points=[100];input.events[0].status='CLOSED';
  input.events[1].points=[50];input.events[1].status='OPEN';
  input.events[2].points=[25];input.events[2].status='OPEN';
  const before=clone(input);
  context.core=context.DHNDSeasons.scopeCore(input,2027);
  const result=clone(context.officialPointsRanking());
  assert.equal(result.length,1);assert.equal(result[0].totalPts,75);
  assert.deepEqual(input,before);
});
test('Club initial and realtime core loading both apply the shared read-only season scope',()=>{
  assert.equal((club.match(/core = window\.DHNDSeasons\.scopeCore\(/g)||[]).length,2);
  assert.match(club,/const CLOCK_YEAR = new Date\(\)\.getFullYear\(\)/);
  assert.match(club,/const SYSTEM_YEAR = SEASON_CONTEXT\.year/);
  assert.match(club,/const DB_KEY = SEASON_CONTEXT\.root/);
  assert.ok(!club.includes("defaultKey = 'dhpe_2027_active'"));
});

let passed=0;
for(const [name,run] of tests){run();passed++;console.log('PASS '+name);}
console.log('Season policy/Club: '+passed+'/'+tests.length+' passed. Local data only.');
