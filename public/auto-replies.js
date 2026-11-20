(() => {
  const types={text:'نص',ai:'ذكاء اصطناعي',reaction:'تفاعل بإيموجي',rotating:'رسائل متناوبة',morphing:'رسالة تتعدّل',xo:'لعبة X و O',button_quick:'أزرار رد سريع',button_list:'قائمة خيارات',button_url:'أزرار روابط',image:'صورة',video:'فيديو',audio:'صوت',document:'ملف',sticker:'ملصق WebP'};
  const media=['image','video','audio','document','sticker'];
  let entries=[],numbers=[],host=null,loading=false,loaded=false,editing=null;
  const $=(id)=>document.getElementById(id), e=x=>esc(String(x??''));
  const option=(value,label,current)=>`<option value="${e(value)}" ${value===current?'selected':''}>${e(label)}</option>`;
  const input=(id,label,value='',type='text',extra='')=>`<label class="ar-field"><span>${e(label)}</span><input id="${id}" type="${type}" value="${e(value)}" ${extra}></label>`;
  const select=(id,label,choices,value)=>`<label class="ar-field"><span>${e(label)}</span><select id="${id}">${choices.map(([k,v])=>option(k,v,value)).join('')}</select></label>`;
  const area=(id,label,value='',hint='')=>`<label class="ar-field"><span>${e(label)}</span><textarea id="${id}" rows="4">${e(value)}</textarea>${hint?`<small>${e(hint)}</small>`:''}</label>`;
  function click(id,fn){ $(id)?.addEventListener('click',fn); }
  async function refresh(){
    loading=true;
    try {const res=await api('/api/replies/list');entries=res.replies||[];numbers=res.numbers||[];loaded=true;}
    catch(err){if(host && TAB==='replies')host.innerHTML=`<div class="empty">❌ ${e(err.message)}<br>تأكد من فتح الرابط من البوت.</div>`;throw err;}
    finally{loading=false;}
  }
  async function render(container,query=''){
    host=container;
    if(!loaded){if(loading)return;host.innerHTML='<div class="empty"><span class="spin"></span><br>جارٍ تحميل الردود…</div>';try{await refresh()}catch{return;}}
    if(TAB!=='replies')return;
    query=Q;
    const q=String(query).trim().toLowerCase();
    const visible=entries.filter(r=>!q || `${r.trigger||''} ${r.replyContent||''} ${types[r.replyType]||r.replyType}`.toLowerCase().includes(q));
    const active=entries.filter(r=>r.isActive).length;
    host.innerHTML=`<section class="ar-hero"><div><div class="ar-kicker">أدوات الأتمتة</div><h2>الردود التلقائية</h2><p>أنشئ ردوداً للرسائل، وحدد متى ولمن تعمل.</p></div><div class="ar-summary"><strong>${entries.length}</strong><span>رد محفوظ</span><strong>${active}</strong><span>مفعّل</span></div></section>
      <div class="ar-actions"><button class="btn btn-p" id="arNew">＋ رد جديد</button><button class="btn btn-s" id="arRefresh">↻ تحديث</button><button class="btn btn-s" id="arSettings">⚙️ إعدادات</button></div>
      <div class="ar-tools"><button id="arOn">تفعيل الكل</button><button id="arOff">إيقاف الكل</button><button id="arExport">تصدير JSON</button><button id="arImport">استيراد JSON</button><button id="arGuide">دليل الذكاء</button><input id="arImportFile" type="file" accept="application/json,.json" hidden></div>
      <div class="ar-list-header"><strong>ردودك</strong><span>${visible.length} نتيجة</span></div>
      ${visible.length?visible.map(r=>`<article class="ar-card"><div class="ar-card-head"><div class="ar-icon">${r.replyType==='ai'?'✦':r.replyType==='xo'?'🎮':r.replyType?.startsWith('button_')?'🔘':'💬'}</div><div class="ar-card-name"><strong>${e(r.trigger)}</strong><small>${e(types[r.replyType]||r.replyType||'نص')} · ${e(({all:'الجميع',self:'رسائلي',specific:'شخص محدد',multiple:'عدة أشخاص'})[r.target]||'الجميع')} · ${e(({both:'الكل',private:'خاص',groups:'مجموعات',group:'مجموعات'})[r.scope]||'الكل')}</small></div><span class="ar-status ${r.isActive?'on':''}">${r.isActive?'مفعّل':'متوقف'}</span></div><div class="ar-card-foot"><span>📊 ${Number(r.usage||0)} استخدام</span><div><button data-action="edit" data-id="${e(r.id)}">تعديل</button><button data-action="toggle" data-id="${e(r.id)}">${r.isActive?'إيقاف':'تفعيل'}</button><button data-action="duplicate" data-id="${e(r.id)}">نسخ</button><button class="danger" data-action="delete" data-id="${e(r.id)}">حذف</button></div></div></article>`).join(''):'<div class="ar-empty">✦<strong>لا توجد ردود مطابقة</strong><span>أضف ردك الأول أو جرّب كلمة بحث أخرى.</span></div>'}`;
    click('arNew',()=>openEditor());click('arRefresh',async()=>{try{await refresh();render(host,Q);toast('✅ تم تحديث الردود')}catch{}});
    click('arSettings',openSettings); click('arGuide',openGuide);
    click('arOn',()=>bulk(true));click('arOff',()=>bulk(false));click('arExport',exportJson);click('arImport',()=>$('arImportFile').click());
    $('arImportFile').addEventListener('change',importJson);
    host.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action,b.dataset.id)));
  }
  async function action(action,id){
    const r=entries.find(x=>String(x.id)===id);if(!r)return;
    if(action==='edit')return openEditor(r);
    if(action==='delete'&&!confirm(`حذف الرد «${r.trigger}»؟`))return;
    try {await api('/api/replies/'+action,{id,...(action==='toggle'?{enabled:!r.isActive}:{})});await refresh();render(host,Q);toast('✅ تم الحفظ');}catch(err){toast('❌ '+err.message)}
  }
  async function bulk(enabled){if(!entries.length||!confirm(enabled?'تفعيل جميع الردود؟':'إيقاف جميع الردود؟'))return;try{await api('/api/replies/all',{enabled});await refresh();render(host,Q);toast('✅ تم تحديث الردود')}catch(err){toast('❌ '+err.message)}}
  function openSheet(html){const sh=$('sheet');sh.innerHTML='<div class="grip"></div>'+html;$('sheetBg').classList.add('open');sh.classList.add('open');sh.scrollTop=0;return sh;}
  function close(){closeSheet()}
  function openSettings(){
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">إعدادات الأرقام</span><h2>⏱️ تأخير الرد العشوائي</h2></div><button class="ar-close" id="arClose">×</button></div><p class="ar-note">يطبّق تأخيراً عشوائياً قبل الردود لكل رقم تختاره.</p>${numbers.length?numbers.map((n,i)=>`<div class="ar-setting"><span>📱 ${e(n.label||n.number||'رقم')}<small>${e(n.number||'')}</small></span><label class="sw"><input type="checkbox" data-delay="${i}" ${n.randomDelayEnabled?'checked':''}><span class="sl"></span></label></div>`).join(''):'<p class="ar-note">لا توجد أرقام مرتبطة.</p>'}`);
    click('arClose',close);document.querySelectorAll('[data-delay]').forEach(el=>el.addEventListener('change',async()=>{const n=numbers[Number(el.dataset.delay)];try{await api('/api/replies/delay',{id:n.id,enabled:el.checked});n.randomDelayEnabled=el.checked;toast('✅ تم حفظ الإعداد')}catch(err){el.checked=!el.checked;toast('❌ '+err.message)}}));
  }
  function exportJson(){const data=entries.map(({usage,...r})=>r);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='auto-replies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('✅ تم تصدير الردود. الوسائط لا تُرفق داخل الملف.');}
  async function importJson(ev){try{const file=ev.target.files?.[0];if(!file)return;if(file.size>1_000_000)throw Error('الملف أكبر من 1 ميغابايت');const json=JSON.parse(await file.text());const list=Array.isArray(json)?json:[json];if(!confirm(`استيراد ${list.length} رد؟`))return;const result=await api('/api/replies/import',{replies:list});await refresh();render(host,Q);toast(`✅ تم استيراد ${result.count} رد`)}catch(err){toast('❌ '+err.message)}finally{ev.target.value=''}}
  function openGuide(){
    const example={trigger:'قائمة',triggerType:'exact',caseSensitive:false,replyType:'button_quick',replyContent:JSON.stringify({text:'اختر:',entries:[{label:'الخدمات',value:'هذه خدماتنا'}]}),target:'all',targetNumbers:[],scope:'both',isActive:true,dailyLimit:0,perUserLimit:0};
    const guide=`أنشئ مصفوفة JSON فقط لردود واتساب. حقول كل رد: trigger، triggerType من exact/contains/starts/ends/regex، caseSensitive، replyType من text/ai/reaction/rotating/morphing/xo/button_quick/button_list/button_url، replyContent، target من all/self/specific/multiple، targetNumbers كمصفوفة أرقام، scope من both/private/groups، dailyLimit وperUserLimit (0 بلا حد)، scheduleFrom وscheduleTo بصيغة HH:MM، langFilter من arabic/english أو null. الرد المتناوب يستخدم rotatingMessages مصفوفة نصوص. morphing يستخدم replyContent كنص أولي وmorphEdits مصفوفة {text,delaySeconds}. أزرار replyContent نص JSON مشفر يحتوي text وentries [{label,value}]، والروابط http/https. لا تنشئ مسارات ملفات محلية؛ الوسائط يجب رفعها في الويب. مثال:\n${JSON.stringify([example],null,2)}`;
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">الاستيراد والتصدير</span><h2>🤖 برومبت دليل الذكاء</h2></div><button class="ar-close" id="arClose">×</button></div><p class="ar-note">انسخ الدليل إلى أداة الذكاء، ثم استورد JSON الناتج. الوسائط تحتاج إعادة رفع عند النقل لجهاز آخر.</p><textarea class="ar-guide" id="arGuideText" readonly>${e(guide)}</textarea><button class="btn btn-p" id="arCopyGuide">نسخ البرومبت</button>`);
    click('arClose',close);click('arCopyGuide',async()=>{try{await navigator.clipboard.writeText(guide);toast('✅ تم النسخ')}catch{const t=$('arGuideText');t.select();if(document.execCommand('copy'))toast('✅ تم النسخ');else toast('تعذّر النسخ')}});
  }
  function makeBody(type,r){
    if(type==='xo')return '<div class="ar-note">🎮 يرسل لعبة ضد البوت عند مطابقة المفتاح.</div>';
    if(media.includes(type))return `<div class="ar-note">ارفع ملفاً حتى 4 ميغابايت.${type==='sticker'?' الملصق يجب أن يكون WebP.':''} ${r.replyContent?.startsWith('local:')?'يوجد ملف محفوظ؛ اترك الخانة فارغة للاحتفاظ به.':''}</div><label class="ar-field"><span>ملف الوسائط</span><input id="arFile" type="file" accept="${({image:'image/*',video:'video/*',audio:'audio/*',sticker:'image/webp',document:'*/*'})[type]}"></label>`;
    if(type==='rotating')return area('arRotating','الرسائل المتناوبة',(r.rotatingMessages||[]).join('\n'),'رسالة واحدة في كل سطر، وتُرسل بالتتابع.');
    if(type==='morphing')return area('arContent','النص الأولي',r.replyContent||'')+area('arMorph','التعديلات',(r.morphEdits||[]).map(x=>`${x.delaySeconds}|${x.text}`).join('\n'),'كل سطر: الثواني|النص الجديد');
    if(type.startsWith('button_')){let cfg={text:'',entries:[]};try{cfg=JSON.parse(r.replyContent||'{}')}catch{}return area('arButtonBody','نص الرسالة',cfg.text||'')+area('arButtonRows','إعداد الخيارات',(cfg.entries||[]).map(x=>`${x.label}|${x.value}`).join('\n'),type==='button_url'?'كل سطر: عنوان الزر|https://الرابط':'كل سطر: عنوان الزر|الرد عند الضغط. حتى 9 خيارات.');}
    return area('arContent',type==='ai'?'برومبت الرد (اختياري)':type==='reaction'?'الإيموجي':'نص الرد',r.replyContent==='__ai_default__'?'':r.replyContent||'',type==='text'?'المتغيرات: {name} {number} {group} {time} {date} {random}':type==='ai'?'اتركه فارغاً لاستخدام الإعداد الافتراضي.':'');
  }
  function openEditor(rule){
    editing=rule?structuredClone(rule):{trigger:'',triggerType:'exact',replyType:'text',target:'all',scope:'both',isActive:true};
    if(!types[editing.replyType])return toast('⚠️ هذا النوع القديم غير مدعوم للتحرير؛ احتفظ به أو صدّره.');
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">الردود التلقائية</span><h2>${rule?'تعديل الرد':'✨ رد جديد'}</h2></div><button class="ar-close" id="arClose">×</button></div>
      <form id="arForm"><section class="ar-form-section"><h3>١ · متى يعمل؟</h3>${input('arTrigger','الكلمة أو العبارة',editing.trigger)}${select('arMatch','طريقة التطابق',[['exact','تطابق تام'],['contains','يحتوي'],['starts','يبدأ بـ'],['ends','ينتهي بـ'],['regex','تعبير منتظم']],editing.triggerType||'exact')}<label class="ar-check"><input type="checkbox" id="arCase" ${editing.caseSensitive?'checked':''}> حساس لحالة الأحرف</label></section>
      <section class="ar-form-section"><h3>٢ · ماذا يرسل؟</h3>${select('arType','نوع الرد',Object.entries(types),editing.replyType)}<div id="arTypeFields">${makeBody(editing.replyType,editing)}</div></section>
      <section class="ar-form-section"><h3>٣ · لمن وأين؟</h3>${select('arTarget','الهدف',[['all','الجميع'],['self','رسائلي أنا'],['specific','شخص محدد'],['multiple','عدة أشخاص']],editing.target||'all')}<div id="arNumbersWrap">${area('arNumbers','الأرقام الدولية',(editing.targetNumbers||[]).join('\n'),'رقم لكل سطر مع مفتاح الدولة، بدون علامة +.')}</div>${select('arScope','النطاق',[['both','الخاص والمجموعات'],['private','الخاص فقط'],['groups','المجموعات فقط']],editing.scope==='group'?'groups':editing.scope||'both')}</section>
      <details class="ar-advanced"><summary>⚙️ الحدود والجدولة واللغة</summary><div class="ar-grid">${input('arDaily','الحد اليومي (0 بلا حد)',editing.dailyLimit||0,'number','min="0" max="100000"')}${input('arPerUser','حد كل شخص / 8 ساعات',editing.perUserLimit||0,'number','min="0" max="100000"')}${input('arFrom','من',editing.scheduleFrom||'','time')}${input('arTo','إلى',editing.scheduleTo||'','time')}</div>${select('arLang','فلتر اللغة',[['','كل اللغات'],['arabic','عربي'],['english','إنجليزي']],editing.langFilter||'')}</details>
      <label class="ar-check"><input type="checkbox" id="arActive" ${editing.isActive!==false?'checked':''}> الرد مفعّل</label><div class="ar-form-actions"><button class="btn btn-s" type="button" id="arCancel">إلغاء</button><button class="btn btn-p" id="arSave" type="submit">💾 حفظ الرد</button></div></form>`);
    click('arClose',close);click('arCancel',close);
    const syncNumbers=()=>{$('arNumbersWrap').style.display=['specific','multiple'].includes($('arTarget').value)?'':'none'}; $('arTarget').addEventListener('change',syncNumbers);syncNumbers();
    $('arType').addEventListener('change',()=>{$('arTypeFields').innerHTML=makeBody($('arType').value,{})});
    $('arForm').addEventListener('submit',saveEditor);
  }
  async function saveEditor(event){
    event.preventDefault();const b=$('arSave');b.disabled=true;b.textContent='جارٍ الحفظ…';
    try{
      const type=$('arType').value; const payload={id:editing.id,trigger:$('arTrigger').value,triggerType:$('arMatch').value,caseSensitive:$('arCase').checked,replyType:type,target:$('arTarget').value,targetNumbers:$('arNumbers').value,scope:$('arScope').value,dailyLimit:$('arDaily').value,perUserLimit:$('arPerUser').value,scheduleFrom:$('arFrom').value,scheduleTo:$('arTo').value,langFilter:$('arLang').value,isActive:$('arActive').checked,replyContent:$('arContent')?.value||''};
      if(type==='rotating')payload.rotatingMessages=$('arRotating').value.split('\n');
      if(type==='morphing')payload.morphEdits=$('arMorph').value.split('\n').filter(x=>x.trim()).map(line=>{const p=line.indexOf('|');if(p<0)throw Error('كل تعديل يجب أن يكون بالشكل ثواني|نص');return {delaySeconds:Number(line.slice(0,p).trim()),text:line.slice(p+1).trim()}});
      if(type.startsWith('button_')){const rows=$('arButtonRows').value.split('\n').filter(x=>x.trim()).map(line=>{const p=line.indexOf('|');if(p<1)throw Error('كل خيار يجب أن يكون بالشكل عنوان|قيمة');return {label:line.slice(0,p).trim(),value:line.slice(p+1).trim()}});payload.replyContent=JSON.stringify({text:$('arButtonBody').value.trim(),entries:rows});}
      if(media.includes(type)){
        const file=$('arFile').files?.[0];
        if(file){if(file.size>4*1024*1024)throw Error('الملف أكبر من 4 ميغابايت');if(type==='sticker'&&!/\.webp$/i.test(file.name))throw Error('اختر ملصق WebP');const encoded=(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('تعذّر قراءة الملف'));reader.readAsDataURL(file)})).split(',')[1];Object.assign(payload,await api('/api/replies/upload',{name:file.name,type,mime:file.type,data:encoded}));}
        else {if(editing.replyType!==type)throw Error('ارفع ملفاً');payload.replyContent=editing.replyContent||'';payload._audioMime=editing._audioMime||'';payload._fileName=editing._fileName||'';}
      }
      await api('/api/replies/save',payload);close();await refresh();render(host,Q);toast('✅ تم حفظ الرد');
    }catch(err){toast('❌ '+err.message)}finally{if(b.isConnected){b.disabled=false;b.textContent='💾 حفظ الرد'}}
  }
  window.RepliesUI={render};
})();
