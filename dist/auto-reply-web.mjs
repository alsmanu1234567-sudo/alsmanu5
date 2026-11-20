import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateInteractiveConfig } from '../services/auto-reply-interactive.mjs';

const TYPES = new Set(['text','ai','reaction','rotating','morphing','xo','xo_ultra','xo_multi','ludo','button_quick','button_list','button_url','image','video','audio','document','sticker']);
const MEDIA = new Set(['image','video','audio','document','sticker']);
const STR = (v,max,name) => { const s=String(v ?? '').trim(); if(s.length>max) throw Error(`${name} طويل جداً`); return s; };
const integer = (v,name) => { const n=Number(v || 0); if(!Number.isInteger(n)||n<0||n>100000) throw Error(`${name} غير صالح`);return n; };
const safeUser = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g,'_');
const mediaRoot = uid => path.resolve('data/auto-reply-media',safeUser(uid));
function localMedia(uid, content) {
  if (!content.startsWith('local:')) throw Error('ارفع ملف الوسائط من جهازك');
  const full=path.resolve(content.slice(6)), root=mediaRoot(uid);
  if (!full.startsWith(root+path.sep)) throw Error('الملف لا يخص حسابك؛ ارفع الملف من جديد');
  return content;
}
export function validateWebReply(uid, input, existing = {}) {
  const trigger=STR(input.trigger,300,'المفتاح'); if(!trigger) throw Error('أدخل المفتاح');
  const triggerType=String(input.triggerType || 'exact');
  if(!['exact','contains','starts','ends','regex'].includes(triggerType)) throw Error('نوع التطابق غير صالح');
  if(triggerType==='regex') { try { new RegExp(trigger); } catch { throw Error('التعبير المنتظم غير صالح'); } }
  const replyType=String(input.replyType||'text'); if(!TYPES.has(replyType)) throw Error('نوع الرد غير مدعوم');
  const target=String(input.target||'all'); if(!['all','self','specific','multiple'].includes(target)) throw Error('الهدف غير صالح');
  const targetNumbers=(Array.isArray(input.targetNumbers)?input.targetNumbers:String(input.targetNumbers||'').split(/[\s,،]+/)).map(x=>String(x).replace(/\D/g,'')).filter(Boolean);
  if (targetNumbers.length>100 || targetNumbers.some(n=>n.length<7||n.length>15) || (['specific','multiple'].includes(target)&&!targetNumbers.length) || (target==='specific' && targetNumbers.length!==1)) throw Error('أدخل أرقاماً دولية صالحة للهدف');
  const scope=String(input.scope||'both'); if(!['both','private','groups'].includes(scope)) throw Error('النطاق غير صالح');
  let replyContent=STR(input.replyContent,50000,'محتوى الرد');
  let rotatingMessages=[], morphEdits=[];
  if(replyType==='ai' && !replyContent) replyContent='__ai_default__';
  if(replyType==='xo') replyContent='__xo_game__';
  if(replyType==='xo_ultra') replyContent='__xo_ultra__';
  if(replyType==='xo_multi') replyContent='__xo_multi__';
  if(replyType==='ludo') replyContent='__ludo__';
  if(MEDIA.has(replyType) && !(existing.replyType===replyType && existing.replyContent===replyContent)) localMedia(uid,replyContent);
  if(['text','reaction','morphing'].includes(replyType) && !replyContent) throw Error('أدخل محتوى الرد');
  if(replyType==='rotating') {
    rotatingMessages=(Array.isArray(input.rotatingMessages)?input.rotatingMessages:String(input.rotatingMessages||'').split('\n')).map(x=>STR(x,4000,'النص المتناوب')).filter(Boolean);
    if(!rotatingMessages.length || rotatingMessages.length>30) throw Error('أدخل من 1 إلى 30 رسالة متناوبة');
  }
  if(replyType==='morphing') {
    if(!Array.isArray(input.morphEdits)||!input.morphEdits.length||input.morphEdits.length>20) throw Error('أضف من 1 إلى 20 تعديلاً');
    morphEdits=input.morphEdits.map(e=>{const text=STR(e.text,4000,'نص التعديل'), delaySeconds=Number(e.delaySeconds);if(!text||!Number.isFinite(delaySeconds)||delaySeconds<0.1||delaySeconds>300) throw Error('التعديل يحتاج نصاً ومدة بين 0.1 و300 ثانية');return {text,delaySeconds};});
  }
  if(replyType.startsWith('button_')) validateInteractiveConfig(replyType,replyContent);
  const langFilter=String(input.langFilter||''); if(!['','arabic','english'].includes(langFilter)) throw Error('فلتر اللغة غير صالح');
  const scheduleFrom=String(input.scheduleFrom||''),scheduleTo=String(input.scheduleTo||'');
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if ((scheduleFrom||scheduleTo) && (!time.test(scheduleFrom)||!time.test(scheduleTo))) throw Error('أدخل وقت البداية والنهاية بصيغة 24 ساعة');
  return {...existing,trigger,triggerType,caseSensitive:input.caseSensitive===true,replyType,replyContent,target,targetNumbers,scope,
    isActive: input.isActive !== false, dailyLimit:integer(input.dailyLimit,'الحد اليومي'),perUserLimit:integer(input.perUserLimit,'حد الشخص'),
    scheduleFrom:scheduleFrom||null,scheduleTo:scheduleTo||null,langFilter:langFilter||null,rotatingMessages,morphEdits,
    ...(["xo_ultra","xo_multi","ludo"].includes(replyType) ? {xoFallbackEnabled:input.xoFallbackEnabled !== false, xoFallbackText:STR(input.xoFallbackText||"",2000,"رسالة الرابط")} : {}),
    ...(MEDIA.has(replyType) ? {_audioMime: STR(input._audioMime || existing._audioMime || '',120,'نوع الملف'), _fileName: STR(input._fileName || existing._fileName || '',160,'اسم الملف')} : {})};
}
export function createAutoReplyWebService({getUserReplies,inMemoryDB,persistReplies,getReplyStat,getUserNumbers,updateNumber}) {
  const list=uid=>getUserReplies(String(uid)).map(r=>({...r, usage:getReplyStat(String(uid),r.id)}));
  function write(uid, replies) { inMemoryDB.autoReplies.set(String(uid), replies); persistReplies(); }
  function find(uid,id) {const r=getUserReplies(String(uid)).find(x=>String(x.id)===String(id)); if(!r) throw Error('الرد غير موجود'); return r;}
  return {
    list,
    save(uid,input) {uid=String(uid);const items=getUserReplies(uid),old=input.id?find(uid,input.id):null; const r=validateWebReply(uid,input,old||{}); if(old){r.id=old.id;write(uid,items.map(x=>x===old?r:x));} else {r.id=randomUUID();r.createdAt=new Date().toISOString();write(uid,[...items,r]);}return r;},
    delete(uid,id){uid=String(uid);const old=find(uid,id);write(uid,getUserReplies(uid).filter(x=>x!==old));return {ok:true};},
    toggle(uid,id,on){if(typeof on!=='boolean')throw Error('الحالة غير صالحة');uid=String(uid);const old=find(uid,id);write(uid,getUserReplies(uid).map(x=>x===old?{...x,isActive:on}:x));return {ok:true};},
    all(uid,on){if(typeof on!=='boolean')throw Error('الحالة غير صالحة');uid=String(uid);write(uid,getUserReplies(uid).map(x=>({...x,isActive:on})));return {ok:true};},
    duplicate(uid,id){uid=String(uid);const old=find(uid,id);const copy={...structuredClone(old),id:randomUUID(),trigger:old.trigger,createdAt:new Date().toISOString(),isActive:false};write(uid,[...getUserReplies(uid),copy]);return copy;},
    import(uid,data){uid=String(uid);if(!Array.isArray(data)||!data.length||data.length>500)throw Error('أدخل مصفوفة تضم من 1 إلى 500 رد'); const previous=getUserReplies(uid); const items=data.map(x=>({...validateWebReply(uid,x,previous.find(r=>r.replyType===x.replyType && r.replyContent===x.replyContent)||{}),id:randomUUID(),createdAt:new Date().toISOString()}));write(uid,[...getUserReplies(uid),...items]);return {count:items.length};},
    numbers(uid){return getUserNumbers(String(uid)).map(n=>({id:n.id,number:n.number,label:n.label,randomDelayEnabled:!!n.randomDelayEnabled}));},
    delay(uid,id,on){if(typeof on!=='boolean')throw Error('الحالة غير صالحة');const n=getUserNumbers(String(uid)).find(n=>String(n.id)===String(id));if(!n)throw Error('الرقم غير موجود');if(!updateNumber(String(uid),n.id,{randomDelayEnabled:on}))throw Error('تعذر حفظ الإعداد');return {ok:true};},
    async upload(uid,{name,data,type,mime}) {uid=String(uid);if(!MEDIA.has(type))throw Error('نوع الملف غير مدعوم');const encoded=String(data||'');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length>5_600_000)throw Error('الملف غير صالح أو أكبر من 4 ميغابايت');const buffer=Buffer.from(encoded,'base64');if(!buffer.length||buffer.length>4*1024*1024)throw Error('الملف غير صالح أو أكبر من 4 ميغابايت');const mt=String(mime||''); if (['image','video','audio'].includes(type) && !mt.startsWith(type+'/')) throw Error('نوع الملف لا يطابق نوع الرد'); if(type==='sticker' && !(buffer.length>=12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP')) throw Error('الملصق يجب أن يكون ملف WebP صالحاً'); const cleanName=path.basename(String(name||'file')).replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)||'file';const ext=path.extname(cleanName).slice(0,12).replace(/[^.a-zA-Z0-9]/g,'');const dir=mediaRoot(uid);await mkdir(dir,{recursive:true});const file=path.join(dir,randomUUID()+ext);await writeFile(file,buffer,{flag:'wx'});return {replyContent:'local:'+file,_audioMime:STR(mime,120,'نوع الملف'),_fileName:cleanName};}
  };
}
