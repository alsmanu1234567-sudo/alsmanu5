import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInteractiveConfig,makeInteractiveMessage,resolveInteractiveAnswer} from '../../services/auto-reply-interactive.mjs';
import {handleAutoReplyCallback,handleAutoReplyTextInput,setDeps} from '../../dist/auto-reply.mjs';

for (const type of ['button_quick','button_list','button_url']) test(`${type} validates and builds supported WhatsApp button`,()=>{
  const value=type==='button_url'?'https://example.com':'رد على الاختيار';
  const config=parseInteractiveConfig(type,`اختر\nنعم|${value}`);
  const rule={id:'abc_123',replyType:type,replyContent:JSON.stringify(config)};
  const rendered=makeInteractiveMessage(rule);
  assert.equal(rendered.text,'اختر');
  assert.equal(rendered.buttons[0].name, {button_quick:'quick_reply',button_list:'single_select',button_url:'cta_url'}[type]);
  if(type!=='button_url') assert.equal(resolveInteractiveAnswer(rule,0),value);
});
test('invalid button configurations rejected before save',()=>{
  assert.throws(()=>parseInteractiveConfig('button_url','اختر\nرابط|javascript:alert(1)'),/الرابط/);
  assert.throws(()=>parseInteractiveConfig('button_quick','اختر\nخيار بدون رد'));
});
test('button wizard stores config and advances to target selection',async()=>{
  let state={state:'awaiting_reply_type',data:{trigger:'menu',triggerType:'exact'}};
  const messages=[];
  setDeps({getUser:()=>({}),getUserReplies:()=>[],getState:()=>state,setState:(_id,status,data)=>{state={state:status,data:{...state.data,...data}}},replyTargetKeyboard:()=>({inline_keyboard:[]}),DEVELOPER_ID:'dev'});
  const bot={sendMessage:async(...x)=>messages.push(x)};
  await handleAutoReplyCallback(bot,'chat','u','rtype_button_quick');
  assert.equal(state.state,'awaiting_button_config');
  await handleAutoReplyTextInput(bot,'chat','u','أهلا\nابدأ|تم الاختيار',state);
  assert.equal(state.state,'awaiting_reply_target');
  assert.equal(JSON.parse(state.data.replyContent).entries[0].value,'تم الاختيار');
  assert.equal(state.data.trigger,'menu');
});
test('export sends a complete JSON file even for large collections',async()=>{
  const replies=[{trigger:'a',replyType:'button_list',replyContent:'x'.repeat(6000)}];let file;
  setDeps({getUser:()=>({}),getUserReplies:()=>replies,DEVELOPER_ID:'dev'});
  const bot={sendDocument:async(_chat,buffer)=>{file=buffer}};
  await handleAutoReplyCallback(bot,'chat','u','reply_export');
  assert.deepEqual(JSON.parse(file.toString()),replies);
});

test('actual dispatcher handles button click in the same chat and respects target', async()=>{
  const {readFileSync}=await import('node:fs');
  const {matchesReplyTarget}=await import('../../services/auto-reply-routing.mjs');
  const src=readFileSync(new URL('../../dist/index.mjs',import.meta.url),'utf8');
  const start=src.indexOf('      async function handleAutoReplyInteraction(');
  const end=src.indexOf('      // تتبع جميع الرسائل الصادرة',start);
  assert.ok(start>0 && end>start);
  const create=new Function('getUserReplies','matchesReplyTarget','resolveInteractiveAnswer','sock','jid','msg','isGroup','userId',src.slice(start,end)+'\nreturn handleAutoReplyInteraction;');
  const reply={id:'r123',isActive:true,target:'all',scope:'both',replyType:'button_quick',replyContent:JSON.stringify({text:'اختيار',entries:[{label:'نعم',value:'تم بنجاح'}]})};
  const sent=[];const sock={sendMessage:async(...args)=>sent.push(args)};const jid='123@s.whatsapp.net';
  const run=create(()=>[reply],matchesReplyTarget,resolveInteractiveAnswer,sock,jid,{key:{fromMe:false,remoteJid:jid}},false,'u');
  assert.equal(await run('arbtn:r123:0'),true);
  assert.equal(sent[0][0],jid);assert.equal(sent[0][1].text,'تم بنجاح');
  reply.target='self';await run('arbtn:r123:0');assert.equal(sent.length,1);
});

test('interactive relay failure fallback includes the configured answers and links',async()=>{
  const {formatInteractiveFallback}=await import('../../services/auto-reply-interactive.mjs');
  assert.equal(formatInteractiveFallback({replyType:'button_quick',replyContent:JSON.stringify({text:'اختر',entries:[{label:'خدمة',value:'تفاصيل'}]})}),'اختر\n\nخدمة: تفاصيل');
});
