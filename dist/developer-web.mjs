import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runShell} from '../services/developer/shell.mjs';
import {askCodeAI} from '../services/developer/code-ai.mjs';
import {webappBaseUrl} from './webapp-auth.mjs';
export function createDeveloperWeb({developerId,github,ai,texts,stats,sites,clock=Date.now}){
 const tokens=new Map(),life=15*60*1000;
 const check=uid=>{if(String(uid)!==String(developerId))throw Error('غير مصرح')};
 function issue(uid){check(uid);const base=webappBaseUrl();if(!base||!/^https:\/\//i.test(base))throw Error('اضبط WEBAPP_URL على رابط HTTPS عام أولاً');for(const [key,expiry] of tokens)if(expiry<=clock())tokens.delete(key);const token=randomBytes(32).toString('base64url');tokens.set(token,clock()+life);return `${base.replace(/\/+$/,'')}/developer-console#${token}`}
 function auth(req,res,next){const token=req.headers['x-developer-token'],expiry=tokens.get(token);res.setHeader('Cache-Control','no-store');if(!expiry||expiry<=clock()){if(token)tokens.delete(token);return res.status(401).json({error:'انتهت الجلسة؛ افتح رابطاً جديداً من البوت'});}if(req.method!=='GET'&&req.headers.origin){const origin=req.headers.origin;const host=req.headers.host;try{if(new URL(origin).host!==host) return res.status(403).json({error:'مصدر الطلب غير مصرح'})}catch{return res.status(403).json({error:'مصدر الطلب غير مصرح'})}}next()}
 const validRepo=x=>{x=String(x||'');if(!/^[\w.-]+\/[\w.-]+$/.test(x)||x.split('/').some(p=>p==='.'||p==='..'))throw Error('المستودع غير صالح');return x};
 const validPath=x=>{x=String(x||'').replace(/^\/+|\/+$/g,'');if(x.split('/').some(p=>p==='..'||p==='.')||x.length>1000)throw Error('المسار غير صالح');return x.split('/').map(encodeURIComponent).join('/')};
 const guarded=fn=>async(req,res)=>{try{res.json(await fn(req))}catch(e){res.status(400).json({error:String(e.message||'تعذر تنفيذ الطلب').slice(0,300)})}};
 function register(app){
  app.get('/developer-console',async(_req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");res.type('html').send(await readFile(new URL('../public/developer-console.html',import.meta.url),'utf8'))});
  app.get('/developer-console.js',async(_req,res)=>{res.setHeader('Cache-Control','no-store');res.type('application/javascript').send(await readFile(new URL('../public/developer-console.js',import.meta.url),'utf8'))});
  app.get('/api/developer/overview',auth,guarded(async()=>({stats:stats(),githubConfigured:github.hasToken(),model:ai.model(String(developerId)),texts:texts.list()})));
  app.post('/api/developer/shell',auth,guarded(async req=>runShell(req.body?.command)));
  app.post('/api/developer/text',auth,guarded(async req=>{const {key,value,reset}=req.body||{};if(!texts.list().includes(key))throw Error('النص غير معروف');if(reset)texts.reset(key);else {if(typeof value!=='string'||value.length>4000)throw Error('النص غير صالح');texts.set(key,value)}return {ok:true}}));
  app.get('/api/developer/text',auth,guarded(async req=>{const key=String(req.query.key||'');if(!texts.list().includes(key))throw Error('النص غير معروف');return {key,value:texts.get(key)}}));
  app.get('/api/developer/repos',auth,guarded(async()=>{if(!github.hasToken())throw Error('أضف توكن GitHub في البوت أولاً');return (await github.repos()).map(r=>({name:r.full_name,private:r.private,defaultBranch:r.default_branch,url:r.html_url}))}));
  app.get('/api/developer/files',auth,guarded(async req=>{const repo=validRepo(req.query.repo),path=validPath(req.query.path),ref=String(req.query.ref||'');const data=await github.fetch(`/repos/${repo}/contents/${path}${ref?'?ref='+encodeURIComponent(ref):''}`);if(Array.isArray(data))return {items:data.map(x=>({name:x.name,path:x.path,type:x.type}))};if(data.type!=='file'||data.encoding!=='base64'||data.size>500000)throw Error('الملف غير مدعوم أو أكبر من 500 كيلوبايت');const bytes=Buffer.from(data.content,'base64'),content=bytes.toString('utf8');if(!Buffer.from(content,'utf8').equals(bytes)||content.includes('\0'))throw Error('هذا ملف ثنائي ولا يمكن تعديله من المحرر النصي');return {file:{path:data.path,sha:data.sha,content}}}));
  app.post('/api/developer/files',auth,guarded(async req=>{const {repo,path,sha,content,message,branch}=req.body||{};const p=validPath(path),r=validRepo(repo);if(!p||typeof content!=='string'||Buffer.byteLength(content)>500000||typeof sha!=='string'||!sha)throw Error('بيانات الملف غير صالحة');const body={message:String(message||'Update file from developer console').slice(0,200),content:Buffer.from(content).toString('base64'),sha};if(branch)body.branch=String(branch).slice(0,200);const result=await github.fetch(`/repos/${r}/contents/${p}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {ok:true,sha:result.content?.sha}}));
  app.get('/api/developer/sites',auth,guarded(async()=>{if(!sites)throw Error('أداة المواقع غير متاحة');return sites.overview(String(developerId))}));
  app.post('/api/developer/sites/start',auth,guarded(async req=>{if(!sites)throw Error('أداة المواقع غير متاحة');return sites.start(String(developerId),req.body||{})}));
  app.post('/api/developer/sites/stop',auth,guarded(async req=>{if(!sites)throw Error('أداة المواقع غير متاحة');return sites.stop(String(developerId),req.body?.code)}));
  app.post('/api/developer/ai',auth,guarded(async req=>askCodeAI({apiKey:ai.key(String(developerId)),model:ai.model(String(developerId)),question:req.body?.question,context:req.body?.context})));
 }
 return {issue,register};
}
