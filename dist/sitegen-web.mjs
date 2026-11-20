import {startSite,stopSite,listSites,TEMPLATES,sitePublicBaseUrl} from './site-generator.mjs';
export function createSiteGenWebService({developerId}){
 function authorize(uid){if(!developerId||String(uid)!==String(developerId))throw Error('هذه الأداة للمطوّر فقط')}
 return {
  overview(uid){authorize(uid);let base='';try{base=sitePublicBaseUrl()}catch{}return {templates:Object.entries(TEMPLATES).map(([id,t])=>({id,label:t.label})),sites:listSites().map(s=>({code:s.code,name:s.siteName,templateId:s.templateId,port:s.port,createdAt:s.createdAt,url:base?`${base}/tool/${encodeURIComponent(s.code)}/`:''}))}},
  async start(uid,input){authorize(uid);return startSite({code:input.code,templateId:input.templateId,siteName:input.siteName,chatId:String(uid),baseUrl:sitePublicBaseUrl()})},
  stop(uid,code){authorize(uid);if(!stopSite(String(code||'')))throw Error('الموقع غير موجود');return {ok:true}}
 };
}
