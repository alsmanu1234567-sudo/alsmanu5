import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {sendXoUltra,loadXoUltraHtml} from '../../services/xo-ultra.mjs';
import {validateWebReply} from '../../dist/auto-reply-web.mjs';

test('STEAM game HTML is self-contained and scripts parse',async()=>{const html=await loadXoUltraHtml();assert.match(html,/XO ULTRA/);for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Script(m[1]));});
test('rich message carries playable HTML and fallback URL',async()=>{let content,text;const sock={relayMessage:async(_jid,payload)=>{content=payload},sendMessage:async(_jid,payload)=>{text=payload.text}};const result=await sendXoUltra(sock,'g@g.us',{baseUrl:'https://example.org'});const raw=JSON.parse(Buffer.from(content.botForwardedMessage.message.richResponseMessage.unifiedResponse.data,'base64').toString());assert.match(raw.embedded_screens[0].content[0].tabs[0].sections[0].view_model.primitive.payload,/XO ULTRA/);assert.match(text,/https:\/\/example.org\/xo-ultra/);assert.equal(result.richSent,true);});
test('falls back to URL if relay fails, otherwise reports failure',async()=>{const sent=[];const sock={relayMessage:async()=>{throw Error('failed')},sendMessage:async(_jid,payload)=>sent.push(payload)};assert.equal((await sendXoUltra(sock,'g',{baseUrl:'https://example.org'})).richSent,false);assert.match(sent[0].text,/\/xo-ultra/);await assert.rejects(()=>sendXoUltra(sock,'g',{baseUrl:null}));});
test('XO ultra can be saved as a reply',()=>{assert.equal(validateWebReply('u',{trigger:'play',replyType:'xo_ultra'}).replyContent,'__xo_ultra__')});
test('custom and disabled fallback settings work',async()=>{const sent=[];const sock={relayMessage:async()=>{},sendMessage:async(_j,p)=>sent.push(p.text)};await sendXoUltra(sock,'g',{baseUrl:'https://example.org',fallback:false});assert.equal(sent.length,0);await sendXoUltra(sock,'g',{baseUrl:'https://example.org',fallbackText:'رابطك _get!'});assert.equal(sent[0],'رابطك https://example.org/xo-ultra!')});
