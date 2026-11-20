import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {webappBaseUrl} from '../dist/webapp-auth.mjs';
import {sendRichXoHtml} from './xo-ultra.mjs';
const token=()=>randomBytes(32).toString('base64url');
const games=new Map(), TTL=30*60*1000, MAX=500;
const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function prune(){const now=Date.now();for(const [id,g] of games)if(g.expires<=now)games.delete(id)}
function get(id){prune();const g=games.get(String(id||''));if(!g)throw Error('انتهت اللعبة أو الرابط غير صالح');return g}
function publicState(g,seat){const p=g.players.find(p=>p.key===seat);return {status:g.status,board:[...g.board],turn:g.turn,mark:p?.mark||null,count:g.players.length,winner:g.winner||null}}
function serialize(g,fn){const next=g.lock.then(fn);g.lock=next.catch(()=>{});return next}
export async function createSharedGame({sock,chatId,baseUrl=webappBaseUrl(),fallback=true,fallbackText=''}){
  prune();if(!baseUrl||!/^https:\/\//i.test(baseUrl))throw Error('اللعبة تحتاج رابط ويب عام HTTPS يعمل من الهاتف');if(!chatId?.endsWith('@g.us'))throw Error('اللعبة بين شخصين متاحة في المجموعات فقط');if(games.size>=MAX)throw Error('عدد الألعاب كبير، حاول لاحقاً');
  const id=token(),base=String(baseUrl).replace(/\/+$/,''),g={id,status:'waiting',board:Array(9).fill(null),players:[],turn:'X',winner:null,expires:Date.now()+TTL,lock:Promise.resolve()};games.set(id,g);
  const link=`${base}/xo-shared#${id}`;
  try{
    let html=await readFile(new URL('../public/xo-shared.html',import.meta.url),'utf8');
    const config=JSON.stringify({base,id}).replace(/</g,'\\u003c');
    html=html.replace('<head>','<head><script>window.XO_SHARED_CONFIG='+config+';</script>');
    try{await sendRichXoHtml(sock,chatId,html,'❌⭕ XO ULTRA — لاعبان');}
    catch(error){if(fallback===false)throw error;}
    if(fallback!==false)await sock.sendMessage(chatId,{text:String(fallbackText||'🎮 إذا لم تظهر اللعبة، افتح الرابط: _get').replaceAll('_get',link)});
    return {id};
  }catch(error){games.delete(id);throw error}
}
export function getSharedState(id,seat){return publicState(get(id),String(seat||''));}
export async function joinShared(id,seat){const g=get(id);return serialize(g,()=>{let p=g.players.find(p=>p.key===seat);if(p)return {...publicState(g,p.key),seat:p.key};if(g.status!=='waiting'||g.players.length>=2)throw Error('المباراة مكتملة بالفعل');p={key:token(),mark:g.players.length?'O':'X'};g.players.push(p);if(g.players.length===2)g.status='active';g.expires=Date.now()+TTL;return {...publicState(g,p.key),seat:p.key};});}
export async function moveShared(id,seat,pos){const g=get(id);return serialize(g,()=>{const p=g.players.find(p=>p.key===seat);if(!p)throw Error('انضم أولاً للعبة');if(g.status!=='active')throw Error('انتظر اللاعب الثاني أو انتهت المباراة');if(g.turn!==p.mark)throw Error('ليس دورك');if(!Number.isInteger(pos)||pos<0||pos>8||g.board[pos])throw Error('الخانة غير صالحة أو مستخدمة');g.board[pos]=p.mark;if(wins.some(w=>w.every(i=>g.board[i]===p.mark))){g.status='finished';g.winner=p.mark}else if(g.board.every(Boolean))g.status='draw';else g.turn=p.mark==='X'?'O':'X';g.expires=Date.now()+TTL;return publicState(g,p.key)});}
