import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const extensions = (require as any).extensions;
extensions['.css'] = (module: any) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_target,key)=>String(key) }) }; };

const props = {
  noteDraft:{title:'',body:''},onNoteDraftChange:()=>{},
  name:'Jan Kowalski', notes:[{id:'n1',title:'Ustalenia',body:'Zażółć gęślą jaźń',occurredAt:'2026-07-18T11:28:00Z',actor:{name:'Anna'}}],
  tasks:[], canWrite:true, onOpenClient:()=>{},onOpenTasks:()=>{},onAddNote:async()=>{},onEditNote:async()=>{},onDeleteNote:async()=>{},
};
test('three overview modules retain content and provide inline note actions',async()=>{
  const {default:Overview}=await import('./ClientOverview');
  const html=renderToStaticMarkup(React.createElement(Overview,props));
  for(const label of ['Dane klienta','Notatki','Zadania','Dodaj notatkę','Edytuj notatkę','Usuń notatkę','Zażółć gęślą jaźń','Notatki']) assert.ok(html.includes(label),label);
  assert.equal((html.match(/<section/g)||[]).length,3);
  assert.ok(html.includes('Brak zadań.'));
});
test('readonly overview hides note write controls',async()=>{
  const {default:Overview}=await import('./ClientOverview');
  const html=renderToStaticMarkup(React.createElement(Overview,{...props,canWrite:false}));
  assert.ok(!html.includes('Dodaj notatkę'));
  assert.ok(!html.includes('Usuń notatkę'));
  assert.ok(!html.includes('Edytuj notatkę'));
  assert.ok(html.includes('Ustalenia'));
});
test('task counters use CRM OPEN status and exclude closed tasks from overdue',async()=>{
  const {overviewTaskStats}=await import('./ClientOverview');
  const tasks=['OPEN','IN_PROGRESS','DONE','CANCELLED'].map((status,index)=>({id:String(index),title:status,status,priority:'NORMAL',dueAt:'2026-10-01T10:00:00Z'}));
  assert.deepEqual(overviewTaskStats(tasks,Date.parse('2026-11-02T10:00:00Z')),{all:4,todo:1,progress:1,overdue:2});
  assert.deepEqual(overviewTaskStats([],Date.now()),{all:0,todo:0,progress:0,overdue:0});
});
test('remounted overview restores the parent-owned note draft',async()=>{
  const {default:Overview}=await import('./ClientOverview');
  const html=renderToStaticMarkup(React.createElement(Overview,{...props,noteDraft:{title:'Rozpoczęta notatka',body:'Nie zgub tej treści'}}));
  assert.ok(html.includes('Rozpoczęta notatka'));
  assert.ok(html.includes('Nie zgub tej treści'));
  assert.ok(html.includes('<textarea'));
});
