import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setMessageCutoff, isMessageAfterCutoff, guardMessageSocket } from '../../engine/message-cutoff.mjs';
import { setupMsgPipeline, teardown } from '../../engine/msg-pipeline.mjs';

test('cleanup discards older and boundary messages and keeps other users isolated', () => {
  const cutoff = 1730000000500;
  setMessageCutoff('clean-test', cutoff);
  assert.equal(isMessageAfterCutoff('clean-test', {messageTimestamp: 1730000000}), false);
  assert.equal(isMessageAfterCutoff('clean-test', {messageTimestamp: 1729999999}), false);
  assert.equal(isMessageAfterCutoff('clean-test', {}), false);
  assert.equal(isMessageAfterCutoff('clean-test', {messageTimestamp: 1730000001}), true);
  assert.equal(isMessageAfterCutoff('other-test', {}), true);
});

test('cleanup silences sends by already running handlers', async () => {
  let sends = 0;
  const msg = {messageTimestamp: Math.floor(Date.now()/1000)+1};
  const guarded = guardMessageSocket({sendMessage: async () => { sends++; }}, 'inflight-test', msg, 0);
  await guarded.sendMessage('chat', {});
  setMessageCutoff('inflight-test');
  await guarded.sendMessage('chat', {});
  assert.equal(sends, 1);
});

test('pipeline rejects old replayed notifications after clean', async () => {
  const ev = new EventEmitter();
  let handled = 0;
  const sock = { ev };
  setMessageCutoff('pipeline-clean');
  setupMsgPipeline(sock, 'pipeline-clean', async () => {}, async () => {handled++;});
  ev.emit('messages.upsert', {type:'notify', messages:[{key:{remoteJid:'x@s.whatsapp.net'},messageTimestamp: Math.floor(Date.now()/1000)-5}]});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(handled, 0);
  teardown('pipeline-clean');
});

test('repeated cleanup in same millisecond invalidates already running generation', async () => {
  const {advanceMessageCutoff,getMessageCutoff} = await import('../../engine/message-cutoff.mjs');
  const first=advanceMessageCutoff('repeat-clean',1730000000500);
  const msg={messageTimestamp:1730000002}; let effects=0;
  const guarded=guardMessageSocket({groupUpdateSubject:async()=>{effects++}},'repeat-clean',msg,first);
  await guarded.groupUpdateSubject('x','a');
  advanceMessageCutoff('repeat-clean',1730000000500);
  await guarded.groupUpdateSubject('x','b');
  assert.equal(getMessageCutoff('repeat-clean'),first+1);
  assert.equal(effects,1);
});

test('cleanup clears queued old messages and suppresses running output; newer message works', async()=>{
  const {advanceMessageCutoff} = await import('../../engine/message-cutoff.mjs');
  const ev=new EventEmitter();let unblock;const gate=new Promise(r=>unblock=r);const forwarded=[],outputs=[];
  const sock={ev,sendMessage:async(_jid,value)=>outputs.push(value)};
  setupMsgPipeline(sock,'full-clean',async(_s,m)=>{forwarded.push(m.key.id);if(m.key.id==='old-running')await gate},async(m,_uid,s)=>s.sendMessage('x',m.key.id));
  const old=()=>({key:{remoteJid:'x@s.whatsapp.net',id:'old-running',fromMe:true},messageTimestamp:100});
  ev.emit('messages.upsert',{type:'notify',messages:[old()]});
  await new Promise(r=>setImmediate(r));
  advanceMessageCutoff('full-clean',100500);
  teardown('full-clean');
  ev.emit('messages.upsert',{type:'notify',messages:[{...old(),key:{...old().key,id:'replayed'},messageTimestamp:100}]});
  ev.emit('messages.upsert',{type:'notify',messages:[{...old(),key:{...old().key,id:'new'},messageTimestamp:101}]});
  await new Promise(r=>setImmediate(r));unblock();await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(forwarded,['old-running','new']);assert.deepEqual(outputs,['new']);
  teardown('full-clean');
});

test('clean removes queued commands only for the target user',async()=>{
  const ev1=new EventEmitter(),ev2=new EventEmitter();let release;const gate=new Promise(r=>release=r);const handled=[];
  const s1={ev:ev1},s2={ev:ev2};const uid='queue-clean-isolation';
  const work=async(m)=>{await gate;handled.push(m.key.id)};
  setupMsgPipeline(s1,uid,async()=>{},work);setupMsgPipeline(s2,'queue-clean-other',async()=>{},work);
  const mk=(id)=>({key:{remoteJid:'g@g.us',fromMe:true,id},messageTimestamp:100});
  try {
    ev1.emit('messages.upsert',{type:'notify',messages:Array.from({length:15},(_,i)=>mk('target-'+i))});
    ev2.emit('messages.upsert',{type:'notify',messages:[mk('other')]});
    await new Promise(r=>setImmediate(r));
    const {advanceMessageCutoff}=await import('../../engine/message-cutoff.mjs');advanceMessageCutoff(uid,100500);
    assert.equal(teardown(uid),4);
  } finally {release()}
  await new Promise(r=>setTimeout(r,30));
  assert(handled.includes('other'));assert(!handled.some(x=>/^target-1[1-4]$/.test(x)));
  teardown('queue-clean-other');
});
