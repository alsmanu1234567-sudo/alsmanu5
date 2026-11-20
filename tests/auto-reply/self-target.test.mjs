import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesReplyTarget, protectAutoReplySocket, isGeneratedAutoReply } from '../../services/auto-reply-routing.mjs';

test('self and incoming targets are disjoint', () => {
  const own = { key: { fromMe: true, remoteJid: '123@s.whatsapp.net' } };
  const other = { key: { fromMe: false, remoteJid: '123@s.whatsapp.net' } };
  assert.equal(matchesReplyTarget({ target: 'self' }, own), true);
  assert.equal(matchesReplyTarget({ target: 'all' }, own), false);
  assert.equal(matchesReplyTarget({ target: 'self' }, other), false);
  assert.equal(matchesReplyTarget({ target: 'specific', targetNumbers: ['+123'] }, other), true);
});

test('generated responses are marked before sending', async () => {
  let sentId;
  const sock = { async sendMessage(jid, payload, options) {
    sentId = options.messageId;
    assert.equal(isGeneratedAutoReply(sentId), true);
    return { key: { id: sentId } };
  } };
  await protectAutoReplySocket(sock).sendMessage('123@s.whatsapp.net', { text: 'x' });
  assert.equal(isGeneratedAutoReply(sentId), true);
});

test('actual dispatch rule loop selects self rules and replies in the same chat', async () => {
  const source = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('      async function runAutoReplies(');
  const end = source.indexOf('      // تتبع جميع الرسائل الصادرة', start);
  assert.ok(start > 0 && end > start);
  const factory = new Function('getUserReplies', 'getUserNumbers', 'incrementReplyStat', 'inMemoryDB', 'matchesReplyTarget', 'isGeneratedAutoReply', 'protectAutoReplySocket', 'logger', 'jid', 'isGroup', 'userId', source.slice(start, end) + '\nreturn runAutoReplies;');
  const rules = [
    { id: 'incoming', target: 'all', trigger: 'go', triggerType: 'exact', isActive: true, replyContent: 'wrong' },
    { id: 'unmatched', target: 'self', trigger: 'no', triggerType: 'exact', isActive: true },
    { id: 'own', target: 'self', trigger: 'go', triggerType: 'exact', isActive: true, replyType: 'text', replyContent: 'hello' },
  ];
  const calls = [];
  const jid = '123@s.whatsapp.net';
  const sock = { user: { id: '456@s.whatsapp.net' }, async sendMessage(...args) { calls.push(args); } };
  const run = factory(() => rules, () => [], () => {}, {}, matchesReplyTarget, isGeneratedAutoReply, protectAutoReplySocket, console, jid, false, 'u');
  await run(sock, { key: { fromMe: true, remoteJid: jid, id: 'manual' } }, 'go', 'me');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], jid);
  assert.equal(calls[0][1].text, 'hello');
  await run(sock, { key: { fromMe: true, remoteJid: jid, id: calls[0][2].messageId } }, 'go', 'me');
  assert.equal(calls.length, 1);
});
