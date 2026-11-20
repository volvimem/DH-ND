'use strict';

// Real XLSX exporter, in-memory SheetJS/DOM, and fictitious registrations only.
// The portable contract fixture contains only the real Apps Script readers;
// no Script Properties are read and no Google/Firebase service is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const headers = ['Ordem','Placa','Categoria','Atleta','Cidade/UF','Situação','Tipo de Volta','Hora de Largada','Hora de Chegada','Resultado Final','Penalidade (+s)','ID_SISTEMA'];

function exporter(source) {
  const start = source.lastIndexOf('window.gerarExcelLargada =');
  const end = source.indexOf('window.importarExcelTempos =', start);
  assert.ok(start >= 0 && end > start, 'Last real exporter/importer boundary missing');
  return source.slice(start, end);
}

function fixtures(eventId = 987654321027) {
  const registration = (status, placa, id = eventId) => ({id,status,placa});
  return {
    events:[{id:eventId,t:'CIRCUITO FICTICIO'}],
    users:[
      {cpf:'00123456789',nome:'ANA DE SOUZA FICTICIA',cat:'ELITE',city:'RECIFE',uf:'PE',inscricoes:[registration('CONFIRMADO','001')]},
      {cpf:'11223344556',nome:'BRUNO TESTE',cat:'ELITE',city:'OLINDA',uf:'PE',inscricoes:[registration('PENDENTE','002')]},
      {cpf:'22334455667',nome:'CARLA TESTE',cat:'MASTER A',city:'JABOATAO',uf:'PE',inscricoes:[registration('ISENTO','003')]},
      {cpf:'33445566778',nome:'EXCLUIDO TESTE',cat:'ELITE',inscricoes:[registration('CANCELADO','004')]},
      {cpf:'44556677889',nome:'OUTRO EVENTO',cat:'ELITE',inscricoes:[registration('CONFIRMADO','005','outro-evento')]}
    ],
    tempos:[
      {evtId:eventId,cpf:'00123456789',cat:'ELITE',runType:'qualify',val:'01:05.000',startClock:'09:00:00'},
      {evtId:eventId,cpf:'00123456789',cat:'ELITE',runType:'1st',val:'01:03.250',startClock:'09:30:00',finishClock:'09:31:03.250',penaltyStr:'+2'},
      {evtId:eventId,cpf:'00123456789',cat:'ELITE',runType:'2nd',val:'DNF',startClock:'10:00:00'},
      {evtId:eventId,cpf:'11223344556',cat:'ELITE',runType:'qualify',val:'01:10.000'},
      {evtId:eventId,cpf:'22334455667',cat:'MASTER A',runType:'1st',val:'02:00.000',startClock:'08:00:00'},
      {evtId:'outro-evento',cpf:'00123456789',cat:'ELITE',runType:'1st',val:'99:59.999'}
    ]
  };
}

function generate(source, run = '1st', eventId, selectedId, categories = [], qualifyingTimes = []) {
  const db = fixtures(eventId), files = [], messages = [], errors = [];
  categories.forEach((cat, index) => db.users.push({
    cpf:String(index + 1).padStart(11,'0'), nome:'ATLETA ' + cat, cat, city:'JUPI',
    inscricoes:[{id:db.events[0].id,status:'CONFIRMADO',placa:String(index + 10)}]
  }));
  qualifyingTimes.forEach(time => db.tempos.push({evtId:db.events[0].id,runType:'qualify',...time}));
  const original = clone(db);
  const button = {tagName:'BUTTON',innerHTML:'LARGADA',disabled:false};
  const nodes = {'adm-res-evt':{value:selectedId === undefined ? String(db.events[0].id) : selectedId},'adm-res-runtype':{value:run}};
  const c = {
    db, console:{error:error=>errors.push(String(error))},
    document:{activeElement:button,getElementById:id=>nodes[id]||null},
    toast:(...args)=>messages.push(args),setTimeout:callback=>callback(),
    normalizeCatName:value=>String(value).toUpperCase(),
    getPlacaAtletaEvento:(_user,_event,registration)=>registration.placa,
    tempoParaMilissegundos:value=>{const match=/^(\d+):(\d+)\.(\d+)$/.exec(value);return match ? Number(match[1])*60000+Number(match[2])*1000+Number(match[3]) : Infinity;},
    XLSX:{utils:{
      aoa_to_sheet:rows=>({__rows:clone(rows)}),book_new:()=>({SheetNames:[],Sheets:{}}),
      book_append_sheet:(book,sheet,name)=>{book.SheetNames.push(name);book.Sheets[name]=sheet;}
    },writeFile:(book,name)=>files.push({book:clone(book),name})}
  };
  c.window=c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ranking-policy.js'),'utf8'),c);
  c.comparePublicCategories = c.DHNDCategories.compareStartOrder;
  vm.runInContext(exporter(source),c,{filename:'real-gerarExcelLargada.js'});
  c.gerarExcelLargada();
  assert.deepEqual(errors,[],'Exporter swallowed an unexpected error');
  assert.deepEqual(db,original,'Export must not mutate registrations/results');
  return {files,messages,button};
}

function rowValues(sheet) {return sheet.__rows.map(row=>row.map(cell=>cell&&typeof cell==='object' ? cell.v : cell));}
function configRows(eventId,label) {return [['A','B'],[],['CONFIGURAÇÃO','VALOR'],['EVENT_ID',String(eventId)],['TIPO_VOLTA',label],['SINCRONIZACAO','ATIVA']];}

function expectedRows(run,label) {
  const carla=[1,'003','MASTER A','CARLA TESTE','JABOATAO-PE','OK',label,run==='1st'?'08:00:00':'',run==='1st'?'08:02:00.000':'',run==='1st'?'02:00.000':'','','22334455667'];
  const ana=[0,'001','ELITE','ANA DE SOUZA','RECIFE-PE','OK',label,
    {qualify:'09:00:00','1st':'09:30:00','2nd':'10:00:00'}[run],
    {qualify:'09:01:05.000','1st':'09:31:03.250','2nd':''}[run],
    {qualify:'01:05.000','1st':'01:03.250','2nd':'DNF'}[run],run==='1st'?'+2':'','00123456789'];
  const bruno=[0,'002','ELITE','BRUNO TESTE','OLINDA-PE','PENDENTE',label,'','',run==='qualify'?'01:10.000':'','','11223344556'];
  const elite=[ana,bruno];
  elite.forEach((row,index)=>{row[0]=index+1;});
  return [headers,carla,Array(12).fill(''),...elite];
}

function fakeSheet(sheet) {
  const data=rowValues(sheet),width=Math.max(...data.map(row=>row.length));
  const range=(r,c,rows,cols)=>({getDisplayValues:()=>Array.from({length:rows},(_,i)=>Array.from({length:cols},(_,j)=>String(data[r+i-1]?.[c+j-1]??'')))});
  return {getLastRow:()=>data.length,getLastColumn:()=>width,getDataRange:()=>range(1,1,data.length,width),getRange:range};
}

function validateAppsScript(source,book,eventId,label) {
  const sheets=Object.fromEntries(Object.entries(book.Sheets).map(([name,sheet])=>[name,fakeSheet(sheet)]));
  const c={SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:name=>sheets[name]||null})}};
  vm.createContext(c);
  vm.runInContext(source,c,{filename:'sheets-contract.cjs'});
  const config=clone(c.lerConfigDHPE_());
  assert.equal(config.EVENT_ID,String(eventId));
  assert.equal(config.TIPO_VOLTA,label);
  assert.equal(config.SINCRONIZACAO,'ATIVA');
  const header=clone(c.localizarCabecalhoDHPE_(sheets[book.SheetNames[0]]));
  assert.equal(header.linha,1);
  assert.equal(header.colunas.CATEGORIA,3);
  assert.equal(header.colunas['TIPO DE VOLTA'],7);
  assert.equal(header.colunas['RESULTADO FINAL'],10);
  assert.equal(header.colunas.ID_SISTEMA,12);
  assert.equal(c.localizarCabecalhoDHPE_(sheets.CONFIG),null,'CONFIG is not a result tab');
}

function runSuite(options={}) {
  const appRoot=options.appRoot||path.join(__dirname,'..');
  const source=fs.readFileSync(path.join(appRoot,'script.js'),'utf8');
  const contractPath=options.contractPath||path.join(__dirname,'fixtures','sheets-contract.cjs');
  const appsScript=fs.readFileSync(contractPath,'utf8');
  let total=0,passed=0;
  function test(name,fn){total++;try{fn();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+'\n'+error.stack);}}
  for(const [run,label] of [['qualify','QUALIFY'],['1st','OFICIAL'],['2nd','2ª DESCIDA']]) {
    test(label+': CONFIG is the exact second sheet with selected event and run',()=>{
      const {files,button}=generate(source,run);
      assert.equal(files.length,1);
      const {book,name}=files[0];
      assert.deepEqual(book.SheetNames,['Largada '+label,'CONFIG']);
      assert.deepEqual(rowValues(book.Sheets.CONFIG),configRows(987654321027,label));
      assert.match(name,/^Largada_.+_circuito_ficticio\.xlsx$/);
      assert.equal(button.disabled,false);assert.equal(button.innerHTML,'LARGADA');
      assert.doesNotMatch(JSON.stringify(book.Sheets.CONFIG),/https?:|SYNC_KEY|FUNCTION_URL|SPREADSHEET_ID|password|token|secret/i);
    });
    test(label+': first-sheet layout, ordering, existing results and CPF text are preserved',()=>{
      const {book}=generate(source,run).files[0], sheet=book.Sheets[book.SheetNames[0]];
      assert.deepEqual(rowValues(sheet),expectedRows(run,label));
      assert.deepEqual(sheet['!cols'].map(column=>column.wch),[8,10,23,30,24,14,16,18,18,18,16,16]);
      for(const row of sheet.__rows.slice(1).filter(row=>row[11].v)) {
        assert.equal(row[11].t,'s');assert.match(row[11].v,/^\d{11}$/);
      }
      assert.equal(sheet.__rows.find(row=>row[11]?.v==='00123456789')[11].v,'00123456789');
    });
    test(label+': real Apps Script reads CONFIG and detects first-sheet header',()=>{
      validateAppsScript(appsScript,generate(source,run).files[0].book,987654321027,label);
    });
  }
  test('string event identifiers are preserved verbatim in CONFIG',()=>{
    const eventId='fixture-event-2027';
    const {book}=generate(source,'1st',eventId).files[0];
    assert.deepEqual(rowValues(book.Sheets.CONFIG),configRows(eventId,'OFICIAL'));
    validateAppsScript(appsScript,book,eventId,'OFICIAL');
  });
  test('start workbook orders RÍGIDA, ENDURO, OPEN and E-BIKE consecutively',()=>{
    const {book}=generate(source,'qualify',undefined,undefined,['OPEN','E-BIKE','ENDURO','RÍGIDA','FEMININO ELITE']).files[0];
    const categories=rowValues(book.Sheets[book.SheetNames[0]]).slice(1).filter(row=>row[2]).map(row=>row[2]);
    assert.deepEqual(categories.slice(0,5),['RÍGIDA','ENDURO','OPEN','E-BIKE','FEMININO ELITE']);
  });
  test('the official start list puts DNF first, then the fastest qualifying time, then missing times',()=>{
    const times=[
      {cpf:'000.000.000-01',cat:'ELITE (EXTRA)',val:'01:04.9'},
      {cpf:'00000000002',cat:'ELITE',val:'DNF',status:'DNF'},
      {cpf:'00000000001',cat:'ELITE',val:'DNF'},
      {cpf:'00000000003',cat:'JUNIOR',val:'00:30.000'},
      {cpf:'00000000003',evtId:'another-event',cat:'ELITE',val:'00:20.000'},
    ];
    const {book}=generate(source,'1st',undefined,undefined,['ELITE','ELITE','ELITE'],times).files[0];
    const rows=rowValues(book.Sheets[book.SheetNames[0]]).filter(row=>row[2]==='ELITE');
    assert.deepEqual(rows.map(row=>row[11]),['00000000002','00000000001','00123456789','11223344556','00000000003']);
  });
  test('no selected event never downloads a workbook',()=>{
    const result=generate(source,'1st',undefined,'');assert.equal(result.files.length,0);assert.equal(result.messages.at(-1)[1],'error');
  });
  console.log(`Start workbook: ${passed}/${total} passed. No live services.`);
  if(passed!==total)process.exitCode=1;
  return {passed,total};
}

module.exports={runSuite};
if(require.main===module)runSuite();
