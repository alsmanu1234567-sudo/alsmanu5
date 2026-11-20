import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {readFileSync} from 'node:fs';
import {startMultiplayer,handleMultiInteraction,getMultiState,moveMulti,canonicalGroupPlayer} from '../../services/xo-multiplayer.mjs';
import {setInteractiveBaileysForTests} from '../../services/interactive.js';
const i=x=>x;setInteractiveBaileysForTests({proto:{Message:{InteractiveMessage:{create:i,Header:{create:i},Body:{create:i},Footer:{create:i},NativeFlowMessage:{create:i,NativeFlowButton:{create:i}}}}},generateWAMessageFromContent:(_jid,message)=>({message,key:{id:'m'}})});
const chat='123456@g.us',a='111111111@s.whatsapp.net',b='222222222@s.whatsapp.net';
function socket(){const sent=[];return {sent,relayMessage:async(jid,raw)=>sent.push({jid,raw}),sendMessage:async(jid,msg)=>sent.push({jid,...msg}),groupMetadata:async()=>({participants:[{id:a,pn:a,lid:'111@lid'},{id:b,pn:b,lid:'222@lid'}]})};}
const findToken=(sent,jid)=>{const msg=sent.find(x=>x.jid===jid&&x.text?.includes('/xo-multi#'));return msg?.text.split('/xo-multi#')[1].split(/\s/)[0]};
test('invitation waits, rejects outsiders and starts on opponent consent; turns and wins enforced',async()=>{
  const sock=socket();const {id}=await startMultiplayer({sock,chatId:chat,ownerId:'owner',playerId:a,opponentId:b,playerName:'A',opponentName:'B',baseUrl:'https://example.org',fallbackText:'افتح _get'});
  const ta=findToken(sock.sent,a);assert(ta);assert.equal(getMultiState(ta).status,'waiting');await assert.rejects(()=>moveMulti(ta,0),/لم تبدأ/);const tb=findToken(sock.sent,b);assert(tb);assert.equal(getMultiState(tb).status,'waiting');
  await handleMultiInteraction({sock,chatId:chat,ownerId:'owner',playerId:'333@s.whatsapp.net',interactionId:`mxo:${id}:join`});assert.equal(getMultiState(ta).status,'waiting');
  await handleMultiInteraction({sock,chatId:chat,ownerId:'owner',playerId:b,interactionId:`mxo:${id}:join`});assert.notEqual(ta,tb);assert.equal(getMultiState(ta).status,'active');
  await assert.rejects(()=>moveMulti(tb,0),/دورك/);await moveMulti(ta,0);await assert.rejects(()=>moveMulti(tb,0),/الخانة/);await moveMulti(tb,3);await moveMulti(ta,1);await moveMulti(tb,4);const result=await moveMulti(ta,2);assert.equal(result.winner,'X');assert.equal(getMultiState(tb).status,'finished');await assert.rejects(()=>moveMulti(tb,7),/انتهت/);
});
test('disabled fallback sends no link text and aliases resolve safely',async()=>{const sock=socket();await startMultiplayer({sock,chatId:chat,ownerId:'u',playerId:a,opponentId:b,baseUrl:'https://example.org',fallback:false});assert.equal(sock.sent.some(x=>x.text?.includes('/xo-multi#')),false);assert.equal((await canonicalGroupPlayer(sock,chat,'111@lid')).id,a);await assert.rejects(()=>canonicalGroupPlayer(sock,chat,'333@lid'),/عضوية/)});
test('XO multiplayer HTML javascript parses',()=>{const html=readFileSync(new URL('../../public/xo-multi.html',import.meta.url),'utf8');for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Script(m[1]);});
