import {randomBytes} from 'node:crypto';
import {quickReply,urlButton,sendInteractive} from './interactive.js';
import {webappBaseUrl} from '../dist/webapp-auth.mjs';

const TTL=30*60*1000, MAX=500;
const code=()=>randomBytes(18).toString('base64url');
const token=()=>randomBytes(32).toString('base64url');
const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const normalize=x=>String(x||'').toLowerCase().replace(/:\d+(?=@)/,'').replace(/@c\.us$/,'@s.whatsapp.net');
const same=(a,b)=>normalize(a)===normalize(b);
const fallbackDefault='🎮 إذا لم تظهر اللعبة، افتح الرابط: _get';
const games=new Map(), tokens=new Map();
function prune(){const now=Date.now();for(const [id,g] of games){if(g.expires<=now){games.delete(id);for(const p of g.players)tokens.delete(p.token)}}}
function urlFor(base,t){return `${base.replace(/\/+$/,'')}/xo-multi#${t}`}
function state(g,player){return {status:g.status,board:g.board,turn:g.turn,mark:player.mark,names:g.players.map(p=>p.name),winner:g.winner||null};}
function getToken(t){prune();const entry=tokens.get(String(t||''));if(!entry)throw Error('انتهت اللعبة أو الرابط غير صالح');const g=games.get(entry.id);if(!g)throw Error('انتهت اللعبة');return {g,player:g.players[entry.idx]};}
async function privateLink(g,p){
  const link=urlFor(g.base,p.token);
  try {await sendInteractive(g.sock,p.jid,{headerTitle:'🎮 XO ULTRA',text:'افتح نافذة اللعبة الخاصة بك',buttons:[urlButton('فتح اللعبة',link)]});}
  catch(error) { if(g.fallback===false) throw Error('تعذّر إرسال زر فتح اللعبة والرسالة البديلة متوقفة'); }
  if(g.fallback!==false) await g.sock.sendMessage(p.jid,{text:String(g.fallbackText||fallbackDefault).replaceAll('_get',link)});
}
export async function startMultiplayer({sock,chatId,ownerId,playerId,playerName,opponentId,opponentName,baseUrl=webappBaseUrl(),fallback=true,fallbackText='',hooks=null}){
  prune();if(!baseUrl || !/^https:\/\//i.test(baseUrl))throw Error('اللعبة تحتاج رابط ويب عام HTTPS يعمل من الهاتف');
  if(!chatId?.endsWith('@g.us'))throw Error('اللعبة بين شخصين تحتاج مجموعة ومنشن للخصم');
  if(!playerId||!opponentId||same(playerId,opponentId))throw Error('منشن عضواً آخر للعب');
  if(games.size>=MAX)throw Error('عدد الألعاب كبير؛ حاول لاحقاً');
  const g={id:code(),sock,chatId,ownerId:String(ownerId),base:baseUrl,status:'waiting',board:Array(9).fill(null),turn:'X',expires:Date.now()+TTL,players:[{jid:playerId,name:String(playerName||'اللاعب الأول').slice(0,60),mark:'X',token:token()},{jid:opponentId,name:String(opponentName||'اللاعب الثاني').slice(0,60),mark:'O',token:token()}],hooks,fallback,fallbackText,lock:Promise.resolve()};
  games.set(g.id,g);g.players.forEach((p,idx)=>tokens.set(p.token,{id:g.id,idx}));
  try {
    await privateLink(g,g.players[0]);
    await privateLink(g,g.players[1]);
    try { await sendInteractive(sock,chatId,{text:`🎮 تحدي XO من ${g.players[0].name} إلى ${g.players[1].name}\nبانتظار موافقة اللاعب الثاني.`,buttons:[quickReply('انضمام',`mxo:${g.id}:join`),quickReply('رفض',`mxo:${g.id}:reject`)]}); }
    catch {await sock.sendMessage(chatId,{text:`🎮 تحدي XO بانتظار قبول اللاعب الثاني.\nللموافقة: .انضم_اكس ${g.id}\nللرفض: .ارفض_اكس ${g.id}`});}
  } catch(error) {games.delete(g.id);g.players.forEach(p=>tokens.delete(p.token));throw error;}
  return {id:g.id};
}
export async function handleMultiInteraction({sock,chatId,ownerId,playerId,interactionId}){
  const m=String(interactionId||'').match(/^mxo:([A-Za-z0-9_-]+):(join|reject)$/);if(!m)return false;
  prune();const g=games.get(m[1]);if(!g||g.chatId!==chatId||g.ownerId!==String(ownerId)){await sock.sendMessage(chatId,{text:'الدعوة انتهت أو غير متاحة.'});return true;}
  if(!same(playerId,g.players[1].jid)){await sock.sendMessage(chatId,{text:'الانضمام متاح للخصم المذكور فقط.'});return true;}
  await respondToInvite(g,m[2],sock);return true;
}
async function respondToInvite(g, action, sock=g.sock) {
  return locked(g,async()=>{
    if(g.status!=='waiting') return;
    if(action==='reject'){g.status='rejected';await sock.sendMessage(g.chatId,{text:'رفض اللاعب الثاني التحدي.'});return;}
    if(g.hooks?.start)g.worldGame=await g.hooks.start();
    g.status='active';g.expires=Date.now()+TTL;
    await sock.sendMessage(g.chatId,{text:'✅ وافق اللاعب الثاني، بدأت المباراة! افتحا رابطكما الخاص للعب.'});
  });
}
export async function acceptMulti(t){const {g,player}=getToken(t);if(player.mark!=='O')throw Error('الموافقة للخصم فقط');await respondToInvite(g,'join');return state(g,player);}

function locked(g,fn){const next=g.lock.then(fn);g.lock=next.catch(()=>{});return next;}
export function getMultiState(t){const {g,player}=getToken(t);return state(g,player);}
export async function moveMulti(t,index){const {g,player}=getToken(t);return locked(g,async()=>{
  if(g.status!=='active')throw Error('المباراة لم تبدأ أو انتهت');if(g.turn!==player.mark)throw Error('ليس دورك');
  if(!Number.isInteger(index)||index<0||index>8||g.board[index])throw Error('الخانة غير صالحة أو مستخدمة');
  if(g.hooks?.move){const w=await g.hooks.move(g.worldGame,player.jid,index);g.board=w.board;g.turn=w.turn===g.players[0].jid?'X':'O';if(w.status==='finished'){g.status='finished';g.winner=w.winnerId===g.players[0].jid?'X':'O';}else if(w.status==='draw')g.status='draw';}
  else {g.board[index]=player.mark;if(wins.some(line=>line.every(i=>g.board[i]===player.mark))){g.status='finished';g.winner=player.mark;}else if(g.board.every(Boolean))g.status='draw';else g.turn=player.mark==='X'?'O':'X';}
  g.expires=Date.now()+TTL;return state(g,player);
});}

// Resolve PN/LID aliases to the same participant id used by group-world.
export async function canonicalGroupPlayer(sock,chatId,values){
  const candidates=(Array.isArray(values)?values:[values]).filter(Boolean);
  const metadata=await sock.groupMetadata(chatId);
  const participant=(metadata.participants||[]).find(p=>[p.id,p.jid,p.pn,p.lid].filter(Boolean).some(alias=>candidates.some(v=>same(alias,v))));
  if(!participant)throw Error('تعذّر التحقق من عضوية اللاعب في المجموعة');
  return {id:participant.id||participant.jid||participant.pn||participant.lid,name:participant.notify||participant.name||''};
}
export function mentionedJids(msg){let c=msg?.message||{};for(let i=0;i<6;i++){const w=c.ephemeralMessage?.message||c.viewOnceMessage?.message||c.viewOnceMessageV2?.message||c.viewOnceMessageV2Extension?.message;if(!w)break;c=w}return c.extendedTextMessage?.contextInfo?.mentionedJid||c.contextInfo?.mentionedJid||[];}
