// XO ULTRA HTML game adapted from BOT-STEAM / Steam-v2/xo.js.
// The WhatsApp rich-response format is undocumented and may not render on all clients.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { webappBaseUrl } from '../dist/webapp-auth.mjs';

let htmlPromise;
export function loadXoUltraHtml() {
  return htmlPromise ||= readFile(new URL('../public/xo-ultra.html', import.meta.url), 'utf8');
}
export async function sendXoUltra(sock, chatId, {baseUrl = webappBaseUrl(), fallback = true, fallbackText = ""} = {}) {
  const html = await loadXoUltraHtml();
  const section = { __typename:'GenAIUnifiedResponseSection', view_model:{ __typename:'GenAISingleLayoutViewModel', primitive:{ __typename:'GenAIaeacdsnwHtmlPrimitive', payload:html, trusted_sources:[] } } };
  const unifiedResponse = { response_id:randomUUID(), sections:[section], embedded_screens:[{id:'xo-ultra',title:'اللعبة',content:[{__typename:'FOAEmbeddedScreenContentTabbed',tabs:[{id:'xo-game',tab_header:'اللعبة',sections:[section]}]}]}] };
  let richSent = false;
  try {
    if(typeof sock?.relayMessage !== 'function') throw new Error('relayMessage unavailable');
    await sock.relayMessage(chatId, {
      messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},
      botForwardedMessage:{message:{richResponseMessage:{messageType:1,submessages:[{messageType:2,messageText:'❌⭕ XO ULTRA'}],unifiedResponse:{data:Buffer.from(JSON.stringify(unifiedResponse)).toString('base64')},contextInfo:{forwardingScore:1,isForwarded:true,forwardedAiBotMessageInfo:{botJid:'867051314767696@bot'},forwardOrigin:4}}}}
    }, {additionalNodes:[{tag:'biz',attrs:{actual_actors:'2',host_storage:'2',privacy_mode_ts:String(Math.floor(Date.now()/1000))},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]}]});
    richSent = true;
  } catch (error) {
    if (!baseUrl || fallback === false) throw error;
  }
  // Relay success does not establish that WhatsApp rendered the undocumented payload.
  // Supply a real browser link whenever the bot has a public HTTPS address.
  if (baseUrl && fallback !== false) { const link=`${String(baseUrl).replace(/\/+$/,'')}/xo-ultra`; await sock.sendMessage(chatId, {text:String(fallbackText || "🎮 لعبة XO ضد الجهاز\nإذا لم تظهر النافذة داخل واتساب، افتح اللعبة من هنا:\n_get").replaceAll("_get",link)}); }
  return {richSent, fallbackAvailable:!!baseUrl && fallback !== false};
}
