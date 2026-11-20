import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {webappBaseUrl} from '../dist/webapp-auth.mjs';
import {sendRichXoHtml} from './xo-ultra.mjs';
const secret=()=>randomBytes(32).toString('base64url');
const SAFE=new Set([0,8,13,21,26,34,39,47]), COLORS=['red','green','yellow','blue'], FINISH=57;
export function createLudoEngine({dice=()=>randomInt(1,7), now=Date.now}={}) {
 const games=new Map(),ttl=45*60*1000,max=500;
 function prune(){for(const [id,g] of games)if(g.expires<=now())games.delete(id)}
 function get(id){prune();const g=games.get(String(id||''));if(!g)throw Error('انتهت اللعبة أو الرابط غير صالح');return g}
 function lock(g,fn){const p=g.lock.then(fn);g.lock=p.catch(()=>{});return p}
 function touch(g){g.expires=now()+ttl}
 function snapshot(g,key){const me=g.players.findIndex(p=>p.key===key);return {status:g.status,players:g.players.map(p=>({color:p.color,name:p.name,bot:!!p.bot,pieces:[...p.pieces]})),me,turn:g.turn,phase:g.phase,dice:g.dice,lastRoll:g.lastRoll,legal:me===g.turn&&g.phase==='move'?legal(g.players[me],g.dice):[],winner:g.winner,notice:g.notice}}
 function legal(p,n){return p.pieces.flatMap((v,i)=>v===-1?(n===6?[i]:[]):v<FINISH&&v+n<=FINISH?[i]:[])}
 function next(g){g.turn=(g.turn+1)%g.players.length;g.sixes=0;g.phase='roll';g.dice=null}
 function requireTurn(g,key,phase){if(g.status!=='active')throw Error('المباراة لم تبدأ أو انتهت');const player=g.players[g.turn];if(!key||!player||player.key!==key)throw Error('ليس دورك');if(g.phase!==phase)throw Error(phase==='roll'?'حرّك قطعة أولاً':'ارمِ النرد أولاً');return player}
 function allocate(){prune();if(games.size>=max)throw Error('عدد الألعاب كبير، حاول لاحقاً');const id=secret();games.set(id,{id,status:'waiting',players:[],turn:0,phase:'roll',dice:null,lastRoll:null,sixes:0,winner:null,notice:'بانتظار اللاعبين',expires:now()+ttl,lock:Promise.resolve()});return id}
 function remove(id){games.delete(id)}
 function state(id,key){return snapshot(get(id),key)}
 async function join(id,key,name){const g=get(id);return lock(g,()=>{let i=g.players.findIndex(p=>p.key===key&&key);if(i>=0)return {...snapshot(g,key),seat:key};if(g.status!=='waiting'||g.players.length>=4)throw Error('المباراة بدأت أو امتلأت');const seat=secret(),color=COLORS[g.players.length],playerName=String(name||'').trim().replace(/[\x00-\x1f]/g,'').slice(0,20)||`اللاعب ${g.players.length+1}`;g.players.push({key:seat,color,name:playerName,pieces:[-1,-1,-1,-1]});g.notice=`انضم ${playerName}`;touch(g);return {...snapshot(g,seat),seat}})}
 async function start(id,key){const g=get(id);return lock(g,()=>{if(g.status!=='waiting')throw Error('المباراة بدأت بالفعل');if(g.players[0]?.key!==key)throw Error('فقط أول لاعب يبدأ المباراة');if(g.players.length===1)g.players.push({key:secret(),color:COLORS[1],name:'الروبوت 🤖',bot:true,pieces:[-1,-1,-1,-1]});g.status='active';g.turn=0;g.notice=`دور ${g.players[0].name} لرمي النرد`;touch(g);return snapshot(g,key)})}
 function rollCore(g,key){const p=requireTurn(g,key,'roll'),n=dice();if(!Number.isInteger(n)||n<1||n>6)throw Error('تعذر رمي النرد');g.dice=n;g.lastRoll=n;g.sixes=n===6?g.sixes+1:0;if(g.sixes>=3){g.notice=`${p.name}: ثلاث مرات ٦، ينتقل الدور`;next(g)}else if(!legal(p,n).length){g.notice=`${p.name}: لا توجد حركة متاحة (${n})`;next(g)}else{g.phase='move';g.notice=`${p.name} رمى ${n}، اختر قطعة`;};touch(g)}
 function moveCore(g,key,piece){const p=requireTurn(g,key,'move');if(!Number.isInteger(piece)||!legal(p,g.dice).includes(piece))throw Error('الحركة غير مسموحة');const n=g.dice,from=p.pieces[piece];const dest=from<0?0:from+n;p.pieces[piece]=dest;let captured=0;if(dest<52){const square=(COLORS.indexOf(p.color)*13+dest)%52;if(!SAFE.has(square)){for(const other of g.players){if(other===p)continue;for(let i=0;i<4;i++){const v=other.pieces[i];if(v>=0&&v<52&&(COLORS.indexOf(other.color)*13+v)%52===square){other.pieces[i]=-1;captured++}}}}}if(p.pieces.every(v=>v===FINISH)){g.status='finished';g.winner=g.turn;g.notice=`🏆 فاز ${p.name}!`;g.phase='finished';g.dice=null}else if(n===6){g.phase='roll';g.dice=null;g.notice=`${p.name} يلعب مرة ثانية${captured?' · أعاد قطعة الخصم':''}`}else{g.notice=captured?`${p.name} أعاد ${captured} قطعة للبيت`:`${p.name} حرّك قطعة`;next(g)}touch(g)}
 function playBot(g){let actions=0;while(g.status==='active'&&g.players[g.turn]?.bot&&actions++<100){const p=g.players[g.turn];if(g.phase==='roll')rollCore(g,p.key);else {const choices=legal(p,g.dice);const piece=choices.reduce((best,i)=>p.pieces[i]>p.pieces[best]?i:best,choices[0]);moveCore(g,p.key,piece)}}if(actions>=100&&g.players[g.turn]?.bot){g.notice='انتهى دور الروبوت';next(g)}}
 async function roll(id,key){const g=get(id);return lock(g,()=>{rollCore(g,key);playBot(g);return snapshot(g,key)})}
 async function move(id,key,piece){const g=get(id);return lock(g,()=>{moveCore(g,key,piece);playBot(g);return snapshot(g,key)})}
 return {allocate,remove,state,join,start,roll,move};
}
export const ludoEngine=createLudoEngine();
export async function sendLudoGame({sock,chatId,baseUrl=webappBaseUrl(),fallback=true,fallbackText=''}){
 if(!baseUrl||!/^https:\/\//i.test(baseUrl))throw Error('لودو تحتاج رابط ويب عام HTTPS');if(!chatId?.endsWith('@g.us'))throw Error('لعبة لودو الجماعية متاحة في المجموعات');
 const base=String(baseUrl).replace(/\/+$/,''),id=ludoEngine.allocate(),link=`${base}/ludo#${id}`;
 try{let html=await readFile(new URL('../public/ludo.html',import.meta.url),'utf8');const config=JSON.stringify({base,id}).replace(/</g,'\\u003c');html=html.replace('<head>','<head><script>window.LUDO_CONFIG='+config+';</script>');try{await sendRichXoHtml(sock,chatId,html,'🎲 LUDO ROYALE');}catch(err){if(fallback===false)throw err}if(fallback!==false)await sock.sendMessage(chatId,{text:String(fallbackText||'🎲 إذا لم تظهر لودو، افتح الرابط: _get').replaceAll('_get',link)});return {id}}catch(err){ludoEngine.remove(id);throw err}
}
