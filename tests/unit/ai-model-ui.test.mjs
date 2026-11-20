import test from 'node:test';
import assert from 'node:assert/strict';
import { setDeps, handleAiCallback2 } from '../../dist/ai.mjs';

test('discovery runs in background, saves verified models, and selection uses the saved result', async () => {
  const oldFetch=globalThis.fetch;
  const user={nvidiaKey:'fake-key'}; const outputs=[]; let selected='';
  const fakeAI={getNvidiaKey:()=>user.nvidiaKey, getUserSelectedModel:()=>selected, setUserModel:(_id,m)=>{selected=m;}};
  setDeps({getUser:()=>user,saveUser:(_id,data)=>Object.assign(user,data),aiMenuKeyboard:()=>({}),init_ai_manager:()=>{},ai_manager_exports:fakeAI});
  const bot={sendMessage:async (_chat,text,options)=>{outputs.push({text,options});return {message_id:1};}, editMessageText:async()=>{}};
  globalThis.fetch=async url=>{
    if (url.includes('build.nvidia.com')) return new Response('<li><span>Free Endpoint</span><a data-nvtrack-nav-object="artifact-card" href="/nvidia/model">x</a></li>');
    if (url.endsWith('/models')) return new Response(JSON.stringify({data:[{id:'nvidia/model'}]}));
    return new Response(JSON.stringify({choices:[{message:{content:'OK'}}]}));
  };
  try {
    await handleAiCallback2(bot,1,'u','ai_discover_models');
    for (let i=0;i<100 && !user.aiDiscoveredModels;i++) await new Promise(r=>setTimeout(r,5));
    assert.deepEqual(user.aiDiscoveredModels.models.map(m=>m.id),['nvidia/model']);
    for (let i=0;i<100 && !outputs.some(o=>o.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('ai_free_pick_'));i++) await new Promise(r=>setTimeout(r,5));
    const menu=outputs.find(o=>o.options?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith('ai_free_pick_'));
    const callback=menu.options.reply_markup.inline_keyboard[0][0].callback_data;
    await handleAiCallback2(bot,1,'u',callback);
    assert.equal(selected,'nvidia/model');
    user.nvidiaKey='changed'; selected='';
    await handleAiCallback2(bot,1,'u',callback);
    assert.equal(selected,'');
  } finally {globalThis.fetch=oldFetch;}
});
