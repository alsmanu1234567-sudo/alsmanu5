import { quickReply, listButton, urlButton, sendInteractive } from './interactive.js';

export function parseInteractiveConfig(type, input) {
  const lines = String(input || '').replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean);
  const text = lines.shift();
  if (!text || text.length > 3500 || !lines.length || lines.length > 9) throw new Error('اكتب نص الرسالة ثم من 1 إلى 9 خيارات في أسطر منفصلة.');
  const entries = lines.map((line, i) => {
    const pos=line.indexOf('|');
    const label=line.slice(0,pos).trim(), value=line.slice(pos+1).trim();
    if (pos < 1 || !label || !value || label.length > 24 || value.length > 1000) throw new Error(`السطر ${i+2}: استخدم عنوان|قيمة، العنوان حتى 24 حرفاً والقيمة حتى 1000.`);
    if(type === 'button_url') { try { const url=new URL(value); if (!['https:','http:'].includes(url.protocol)) throw Error(); } catch { throw new Error(`الرابط في السطر ${i+2} غير صالح؛ استخدم https://`); } }
    return {label,value};
  });
  if (!['button_quick','button_url','button_list'].includes(type)) throw new Error('نوع الزر غير مدعوم.');
  return {text,entries};
}
export function validateInteractiveConfig(type, raw) {
  let config; try { config=JSON.parse(raw); } catch { throw new Error('إعدادات الأزرار غير صالحة.'); }
  if (!config || !Array.isArray(config.entries)) throw new Error('إعدادات الأزرار غير صالحة.');
  return parseInteractiveConfig(type, [config.text,...config.entries.map(x=>`${x.label}|${x.value}`)].join('\n'));
}
export function makeInteractiveMessage(rule) {
  const config=validateInteractiveConfig(rule.replyType,rule.replyContent);
  const id=i=>`arbtn:${rule.id}:${i}`;
  const buttons=rule.replyType==='button_quick' ? config.entries.map((e,i)=>quickReply(e.label,id(i)))
    : rule.replyType==='button_url' ? config.entries.map(e=>urlButton(e.label,e.value))
    : [listButton('عرض الخيارات',[{title:'اختر من القائمة',rows:config.entries.map((e,i)=>({title:e.label,id:id(i)}))}])];
  return {text:config.text,buttons,footer:'اختر من الخيارات'};
}
export async function sendInteractiveAutoReply(sock,chatId,rule) {
  return sendInteractive(sock,chatId,{headerTitle:'⚡ رد تلقائي',...makeInteractiveMessage(rule)});
}
export function resolveInteractiveAnswer(rule,index) {
  if (!['button_quick','button_list'].includes(rule?.replyType)) return null;
  const config=validateInteractiveConfig(rule.replyType,rule.replyContent);
  return Number.isInteger(index) && index>=0 && index<config.entries.length ? config.entries[index].value : null;
}
