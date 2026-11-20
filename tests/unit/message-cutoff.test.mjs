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
