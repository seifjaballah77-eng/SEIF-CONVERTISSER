const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const platforms=['YouTube','YouTube Music','TikTok','Instagram','X (Twitter)','Facebook','Twitch','Dailymotion'];
const tools=[['discover','⌕','البحث والاكتشاف','اكتشف المحتوى بالكلمات المفتاحية'],['fetch','↧','جلب الوسائط','تحليل الروابط وحفظها'],['batch','▤','المعالجة الجماعية','إدارة عدة روابط'],['images','▧','صور المنشورات','حفظ الصور المسموح بها'],['trim','✂','قص الفيديو','تحديد البداية والنهاية'],['audio','♫','استخراج الصوت','MP3 و WAV و M4A'],['convert','⇄','تحويل الصيغ','فيديو وصوت'],['compress','◫','ضغط الملفات','موازنة الجودة والحجم'],['gif','▣','صانع GIF','تحويل مقطع قصير']];
const pageNames={home:'الرئيسية',discover:'البحث والاكتشاف',fetch:'جلب الوسائط',batch:'المعالجة الجماعية',images:'صور المنشورات',trim:'قص الفيديو',audio:'استخراج الصوت',convert:'تحويل الصيغ',compress:'ضغط الملفات',gif:'صانع GIF',downloads:'مركز التنزيلات',history:'سجل الروابط',settings:'الإعدادات'};
const KEY='seif-convertisser-history-v1',SET='seif-convertisser-settings-v1';let batch=[],downloads=[],trimObjectUrl=null;
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)}
function go(page){if(!pageNames[page])return;$$('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+page));$$('.nav-link').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$('#pageCrumb').textContent=pageNames[page];$('#sidebar').classList.remove('open');history.replaceState(null,'','#'+page);if(page==='history')renderHistory();if(page==='downloads')renderDownloads()}
$$('.nav-link').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
$('#menuBtn').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',e=>{if(innerWidth<=760&&!e.target.closest('#sidebar')&&!e.target.closest('#menuBtn'))$('#sidebar').classList.remove('open')});
$('#homeTools').innerHTML=tools.map(([id,ic,n,d])=>`<button class="tool-card" data-go="${id}"><span class="tool-icon">${ic}</span><b>${n}</b><small>${d}</small></button>`).join('');
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('#platformChips').innerHTML=platforms.map(p=>`<span class="chip">${p}</span>`).join('');
$('#platformDirectory').innerHTML=platforms.map(p=>`<div class="platform-card"><b>${p}</b><small>فيديو · صور · منشورات · بث حسب دعم المنصة</small></div>`).join('');
const options='<option value="auto">اكتشاف تلقائي</option>'+platforms.map(p=>`<option>${p}</option>`).join('');
$('#searchPlatform').innerHTML='<option value="all">جميع المنصات</option>'+platforms.map(p=>`<option>${p}</option>`).join('');
function readHistory(){try{return JSON.parse(localStorage.getItem(KEY)||'[]').filter(x=>Date.now()-x.time<30*864e5)}catch{return []}}
function saveHistory(items){localStorage.setItem(KEY,JSON.stringify(items));updateCount()}
function addHistory(url,platform='غير محددة',name=''){if(!url)return;let items=readHistory().filter(x=>x.url!==url);items.unshift({url,platform,name,time:Date.now()});saveHistory(items.slice(0,300));renderHistory()}
function updateCount(){$('#historyCount').textContent=readHistory().length}
function renderHistory(){const items=readHistory();saveHistory(items);$('#historyList').innerHTML=items.length?items.map((x,i)=>`<div class="history-item"><div style="min-width:0;flex:1"><div class="url">${esc(x.url)}</div><div class="history-meta">${esc(x.platform)} · ${new Date(x.time).toLocaleString('ar')}</div></div><button class="mini-btn" data-copy="${i}">نسخ</button><button class="mini-btn" data-open="${i}">فتح</button><button class="mini-btn" data-remove="${i}">حذف</button></div>`).join(''):'<div class="panel empty-state"><div class="empty-icon">◷</div><h3>السجل فارغ</h3><p>ستظهر الروابط التي تضيفها هنا لمدة 30 يوماً.</p></div>';$$('[data-copy]').forEach(b=>b.onclick=()=>copy(readHistory()[+b.dataset.copy].url));$$('[data-open]').forEach(b=>b.onclick=()=>window.open(readHistory()[+b.dataset.open].url,'_blank','noopener'));$$('[data-remove]').forEach(b=>b.onclick=()=>{let a=readHistory();a.splice(+b.dataset.remove,1);saveHistory(a);renderHistory()})}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function copy(s){try{await navigator.clipboard.writeText(s);toast('تم نسخ الرابط')}catch{toast('تعذر النسخ؛ تحقق من إذن الحافظة')}}
function detect(url){try{const h=new URL(url).hostname.toLowerCase();const has=d=>h===d||h.endsWith('.'+d);if(h==='music.youtube.com')return'YouTube Music';if(has('youtube.com')||has('youtu.be')||has('youtube-nocookie.com'))return'YouTube';if(has('tiktok.com'))return'TikTok';if(has('instagram.com'))return'Instagram';if(has('x.com')||has('twitter.com'))return'X (Twitter)';if(has('facebook.com')||has('fb.watch'))return'Facebook';if(has('twitch.tv'))return'Twitch';if(has('dailymotion.com')||has('dai.ly'))return'Dailymotion'}catch{}return'منصة غير معروفة'}
function validUrl(s){try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)}catch{return false}}
let currentMedia=null,quickInspectTimer=null,inspectionTask=null;
function mediaTypeLabel(t){return t==='video'?'فيديو':t==='image'?'صورة':t==='audio'?'صوت':'وسائط'}
function setMediaStatus(el,message,kind=''){if(!el)return;el.textContent=message;const loading=kind==='loading'||/^جارٍ|^تم تجهيز طلب التنزيل/.test(message);el.className='media-status '+kind+(loading?' is-loading':'');el.dataset.loader=/فحص|التعرف/.test(message)?'scan':/تنزيل|طلب التنزيل/.test(message)?'download':'generic'}
function setProgressStatus(el,label,percent=null,detail=''){
  if(!el)return;
  el.className='media-status is-loading progress-status';
  el.dataset.loader='download';
  if(!el.querySelector('.progress-copy'))el.innerHTML='<div class="progress-copy"><b></b><small></small></div><div class="progress-track"><i></i></div>';
  el.querySelector('.progress-copy b').textContent=label;
  el.querySelector('.progress-copy small').textContent=detail;
  const track=el.querySelector('.progress-track'),fill=track.querySelector('i');
  if(percent===null||!Number.isFinite(Number(percent))){fill.classList.add('indeterminate');fill.style.width='38%';}
  else{fill.classList.remove('indeterminate');fill.style.width=Math.max(0,Math.min(100,Number(percent)))+'%';}
}
function elapsedLabel(ms){const sec=Math.max(0,Math.floor(ms/1000));return 'الوقت المنقضي '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')}
function formatBytes(n){if(!Number.isFinite(n)||n<=0)return '—';const units=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i?1:0)+' '+units[i]}
function renderMediaResult(url,data){
  const box=$('#mediaResult');if(!box)return;
  const thumb=data.thumbnail&&/^https:\/\//i.test(data.thumbnail)?data.thumbnail:'';
  const platform=detect(url)==='منصة غير معروفة'?data.platform:detect(url);
  box.hidden=false;
  box.innerHTML=`<div class="media-result-main">${thumb?`<img class="media-thumb" src="${esc(thumb)}" alt="الصورة المصغرة للفيديو" onerror="this.onerror=null;this.src=this.dataset.fallback||'';this.classList.toggle('thumb-failed',!this.src)" data-fallback="${esc(data.thumbnailFallback||'')}">`:'<div class="media-thumb thumb-placeholder">▶</div>'}<div class="media-details"><div class="media-tags"><span class="chip">${esc(platform)}</span><span class="chip">${mediaTypeLabel(data.mediaType)}</span></div><b>${esc(data.title||'وسائط من المصدر')}</b><small>${data.duration?Math.floor(data.duration/60)+':'+String(Math.floor(data.duration%60)).padStart(2,'0'):'معاينة الفيديو'}</small></div></div><div class="media-download-row"><label>الجودة<select id="mediaQuality">${data.mediaType==='video'?(data.formats||[{value:'best',label:'أفضل جودة متاحة'}]).map(x=>`<option value="${x.value==='best'?'mp4':'mp4_'+esc(x.value)}">${x.value==='best'?'MP4 · أفضل جودة متاحة':'MP4 · '+esc(x.label)}</option>`).join(''):''}${data.mediaType==='image'?'<option value="best">أفضل جودة أصلية</option>':''}${data.mediaType!=='image'?'<option value="audio">MP3 · صوت فقط</option>':''}</select></label><button class="primary-btn" id="downloadMediaBtn">تنزيل الملف الآن ↓</button></div><p class="media-note">${data.partnerNoTube?'اختر الصيغة المطلوبة، وسيتم فتح صفحة إكمال المعالجة.':'سيتم تنزيل أفضل نسخة متاحة من المصدر دون ادعاء جودة غير موجودة.'}</p>`;
  $('#downloadMediaBtn').onclick=()=>downloadMedia(url);
}
async function getPartnerPreview(url,platform){
  const data={platform,title:platform==='TikTok'?'فيديو من TikTok':platform==='YouTube Music'?'مقطع من YouTube Music':'فيديو من YouTube',mediaType:'video'};
  try{
    const u=new URL(url);
    if(platform==='YouTube'||platform==='YouTube Music'){
      const id=u.searchParams.get('v')||(u.hostname==='youtu.be'?u.pathname.split('/').filter(Boolean)[0]:'');
      if(id){
        data.thumbnail='https://i.ytimg.com/vi/'+encodeURIComponent(id)+'/hqdefault.jpg';
        data.thumbnailFallback='https://i.ytimg.com/vi/'+encodeURIComponent(id)+'/mqdefault.jpg';
        try{const r=await fetch('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(url));if(r.ok){const meta=await r.json();data.title=meta.title||data.title;data.thumbnail=meta.thumbnail_url||data.thumbnail}}catch{}
      }
    }else if(platform==='TikTok'){
      const r=await fetch('https://www.tiktok.com/oembed?url='+encodeURIComponent(url));
      if(r.ok){const meta=await r.json();data.title=meta.title||data.title;data.thumbnail=meta.thumbnail_url||''}
    }
  }catch{}
  return data;
}
async function inspectMedia(url,statusEl=$('#mediaStatus')){
  if(inspectionTask&&inspectionTask.url===url)return inspectionTask.promise;
  const base=getBackend();
  if(!base){setMediaStatus(statusEl,'تم التعرف على '+detect(url)+' من الرابط. لتنزيل الملف فعلياً يجب نشر خادم المعالجة وربطه من الإعدادات.','error');return false}
  const started=Date.now();
  setProgressStatus(statusEl,'جارٍ البحث عن معلومات الفيديو وفحصه',null,elapsedLabel(0)+' · يتم الاتصال بالمصدر');
  const clock=setInterval(()=>setProgressStatus(statusEl,'جارٍ البحث عن معلومات الفيديو وفحصه',null,elapsedLabel(Date.now()-started)+' · قد تختلف المدة حسب المنصة'),1000);
  const promise=(async()=>{try{
    const response=await fetch(base+'/api/media/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر تحليل الرابط');
    currentMedia={url,data};addHistory(url,detect(url),data.title||'');
    if(statusEl===$('#mediaStatus'))renderMediaResult(url,data);
    setMediaStatus(statusEl,'تم التعرف تلقائياً: '+(detect(url)==='منصة غير معروفة'?data.platform:detect(url))+' · '+mediaTypeLabel(data.mediaType)+'. أصبح الملف جاهزاً للتنزيل.','success');
    return true;
  }catch(err){currentMedia=null;setMediaStatus(statusEl,err.message,'error');return false}finally{clearInterval(clock)}})();
  inspectionTask={url,promise};const result=await promise;inspectionTask=null;return result;
}
function downloadFilename(response){
  const header=response.headers.get('Content-Disposition')||'';
  const utf=header.match(/filename\*=UTF-8''([^;]+)/i);
  if(utf){try{return decodeURIComponent(utf[1])}catch{}}
  const plain=header.match(/filename="?([^";]+)"?/i);
  return plain?.[1]||'seif-media-download';
}
async function downloadMedia(url,statusEl=$('#mediaStatus')){
  if(!validUrl(url)){setMediaStatus(statusEl,'أدخل رابطاً صحيحاً أولاً.','error');return}
  if(!currentMedia||currentMedia.url!==url){const ok=await inspectMedia(url,statusEl);if(!ok)return}
  const base=getBackend();if(!base)return;
  const quality=$('#mediaQuality')?.value||'mp4';
  addHistory(url,detect(url),currentMedia?.data?.title||'');
  const started=Date.now();
  setProgressStatus(statusEl,'جارٍ تجهيز طلب التنزيل',null,elapsedLabel(0)+' · الاتصال بخادم المعالجة');
  try{
    const create=await fetch(base+'/api/media/download-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,quality})});
    const created=await create.json();if(!create.ok)throw new Error(created.error||'تعذر بدء التنزيل');
    const jobId=created.jobId;if(!jobId)throw new Error('لم يُرجع الخادم رقم مهمة التنزيل.');
    let job=null;
    while(true){
      await new Promise(resolve=>setTimeout(resolve,2500));
      const check=await fetch(base+'/api/media/download-jobs/'+encodeURIComponent(jobId));
      const state=await check.json();if(!check.ok)throw new Error(state.error||'تعذر متابعة التنزيل');
      job=state;
      if(job.status==='failed')throw new Error(job.error||'فشل تجهيز الملف');
      if(job.status==='ready')break;
      const pct=job.percent!==null&&job.percent!==undefined&&Number.isFinite(Number(job.percent))?Number(job.percent):null;
      const details=[elapsedLabel(Date.now()-started),job.speed?'السرعة '+job.speed:'',job.eta?'المتبقي '+job.eta:''].filter(Boolean).join(' · ');
      setProgressStatus(statusEl,job.stage||'جارٍ تجهيز الفيديو',pct,details);
    }
    const nameUrl=base+'/api/media/download-jobs/'+encodeURIComponent(jobId)+'/file';
    if(Number(job.size)>150*1024*1024){
      const a=document.createElement('a');a.href=nameUrl;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
      setMediaStatus(statusEl,'اكتمل تجهيز '+formatBytes(job.size)+'، وبدأ التنزيل عبر مدير التنزيلات في المتصفح.','success');
      return;
    }
    setProgressStatus(statusEl,'جارٍ نقل الملف إلى جهازك',0,'اكتمل تجهيز الملف على الخادم · '+formatBytes(job.size));
    const response=await fetch(nameUrl);
    if(!response.ok){let message='تعذر نقل الملف إلى جهازك.';try{message=(await response.json()).error||message}catch{}throw new Error(message)}
    const total=Number(response.headers.get('Content-Length')||job.size||0);
    let received=0;const chunks=[];
    if(response.body&&response.body.getReader){
      const reader=response.body.getReader();
      while(true){
        const part=await reader.read();if(part.done)break;
        chunks.push(part.value);received+=part.value.byteLength;
        const pct=total?received/total*100:null;
        setProgressStatus(statusEl,'جارٍ نقل الملف إلى جهازك',pct,[total?formatBytes(received)+' من '+formatBytes(total):formatBytes(received),elapsedLabel(Date.now()-started)].join(' · '));
      }
    }else{const blob=await response.blob();chunks.push(blob);received=blob.size}
    const blob=new Blob(chunks,{type:response.headers.get('Content-Type')||'application/octet-stream'});
    if(!blob.size)throw new Error('عاد المصدر بملف فارغ. جرّب رابطاً آخر.');
    const name=downloadFilename(response);
    const objectUrl=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=objectUrl;a.download=name;a.rel='noopener';
    document.body.appendChild(a);a.click();a.remove();
    downloads.unshift({name,url:objectUrl,size:blob.size,time:Date.now()});renderDownloads();
    setMediaStatus(statusEl,'اكتمل التنزيل وتجهيز الملف: '+name,'success');
  }catch(err){
    setMediaStatus(statusEl,err.message||'تعذر تنزيل الملف. تحقق من الرابط وحاول مجدداً.','error');
  }
}
$('#quickLink').addEventListener('input',e=>{
  const url=e.target.value.trim();currentMedia=null;$('#mediaResult').hidden=true;
  if(!url){setMediaStatus($('#mediaStatus'),'ألصق الرابط وسيتم التعرف على المصدر تلقائياً.');return}
  if(!validUrl(url))return;
  setMediaStatus($('#mediaStatus'),'تم التعرف على '+detect(url)+' من عنوان الرابط. جارٍ فحص الوسائط…');
  clearTimeout(quickInspectTimer);quickInspectTimer=setTimeout(()=>inspectMedia(url),650);
});
$('#quickLinkForm').onsubmit=async e=>{e.preventDefault();const url=$('#quickLink').value.trim();if(!validUrl(url))return setMediaStatus($('#mediaStatus'),'أدخل رابطاً صحيحاً يبدأ بـ https://.','error');await downloadMedia(url)};
$('#fetchForm').onsubmit=async e=>{e.preventDefault();const url=$('#fetchUrl').value.trim();if(!validUrl(url))return;await downloadMedia(url,$('#fetchFeedback'))};
$('#searchForm').onsubmit=async e=>{e.preventDefault();const q=$('#searchQuery').value.trim();if(!q)return;$('#searchState').className='empty-state operation-state';$('#searchState').innerHTML=loaderMarkup('search','جارٍ البحث في المصادر المتاحة…');$('#searchResults').innerHTML='';const base=getBackend();if(base){try{const r=await fetch(base+'/api/search?q='+encodeURIComponent(q)+'&platform='+encodeURIComponent($('#searchPlatform').value));if(r.ok){const data=await r.json();renderResults(data.results||[]);return}}catch{}}$('#searchState').innerHTML='<div class="empty-icon">⌕</div><h3>البحث غير متاح حالياً</h3><p>لم يتم إعداد موصلات بحث فعلية بعد.</p>';};
function renderResults(rows){$('#searchState').textContent=rows.length?'نتائج البحث':'لم يتم العثور على نتائج';$('#searchResults').innerHTML=rows.map(r=>`<article class="platform-card"><b>${esc(r.title||'بدون عنوان')}</b><small>${esc(r.platform||'')} · ${esc(r.duration||'')}</small><p>${esc(r.description||'')}</p><button class="mini-btn" data-result-copy="${esc(r.url||'')}">نسخ الرابط</button></article>`).join('');$$('[data-result-copy]').forEach(b=>b.onclick=()=>copy(b.dataset.resultCopy))}
$('#addBatch').onclick=()=>{const urls=$('#batchInput').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);let added=0;for(const u of urls){if(validUrl(u)){addHistory(u,detect(u));if(!batch.includes(u)){batch.push(u);added++}}}renderBatch();toast(added+' رابط أضيف إلى الطابور')};
$('#clearBatch').onclick=()=>{batch=[];renderBatch()};function renderBatch(){$('#batchList').innerHTML=batch.map((u,i)=>`<div class="queue-item"><span class="url">${esc(u)}</span><button class="mini-btn" data-bcopy="${i}">نسخ</button><button class="mini-btn" data-bdel="${i}">حذف</button></div>`).join('');$$('[data-bcopy]').forEach(b=>b.onclick=()=>copy(batch[+b.dataset.bcopy]));$$('[data-bdel]').forEach(b=>b.onclick=()=>{batch.splice(+b.dataset.bdel,1);renderBatch()})}
$('#imageInspect').onclick=()=>{$('#imageFeedback').textContent='تم استلام الرابط. استخراج الصور الأصلية يتطلب موصل المنصة والتحقق من صلاحية الوصول.';$('#imageFeedback').className='feedback'};
$('#trimFile').onchange=e=>{const f=e.target.files[0];if(!f)return;if(trimObjectUrl)URL.revokeObjectURL(trimObjectUrl);trimObjectUrl=URL.createObjectURL(f);$('#trimPreview').src=trimObjectUrl;$('#trimPreview').hidden=false;$('#trimPreview').onloadedmetadata=()=>{$('#trimEnd').value=$('#trimPreview').duration.toFixed(2);$('#trimDuration').textContent='المدة: '+$('#trimPreview').duration.toFixed(2)+' ثانية';$('#trimProcess').disabled=false}};
$('#trimStart').oninput=updateTimeline;$('#trimEnd').oninput=updateTimeline;function updateTimeline(){const v=$('#trimPreview');if(!v.duration)return;const s=Math.max(0,+$('#trimStart').value||0),e=Math.min(v.duration,+$('#trimEnd').value||v.duration);$('#timelineFill').style.width=Math.max(0,Math.min(100,(e-s)/v.duration*100))+'%'}
$('#trimProcess').onclick=()=>processFile($('#trimFile').files[0],'trim',{start:+$('#trimStart').value,end:+$('#trimEnd').value},'trimFeedback');
$('#audioProcess').onclick=()=>processFile($('#audioFile').files[0],'audio',{format:$('#audioFormat').value,bitrate:$('#audioBitrate').value},'audioFeedback');
$('#convertProcess').onclick=()=>processFile($('#convertFile').files[0],'convert',{format:$('#convertFormat').value,name:$('#convertName').value},'convertFeedback');
$('#compressProcess').onclick=()=>processFile($('#compressFile').files[0],'compress',{level:$('#compressLevel').value},'compressFeedback');
$('#gifProcess').onclick=()=>processFile($('#gifFile').files[0],'gif',{start:+$('#gifStart').value,duration:+$('#gifDuration').value},'gifFeedback');
const DEFAULT_BACKEND='https://seif-convertisser.onrender.com';
function getBackend(){let settings={};try{settings=JSON.parse(localStorage.getItem(SET)||'{}')||{}}catch{}const value=typeof settings.backend==='string'?settings.backend.trim():'';return (value||DEFAULT_BACKEND).replace(/\/$/,'')}
const operationLabels={trim:'قص الفيديو',audio:'استخراج الصوت',convert:'تحويل الصيغة',compress:'ضغط الفيديو',gif:'إنشاء GIF'};
function loaderMarkup(action,message,progress=null){const labels={search:'search',trim:'trim',audio:'audio',convert:'convert',compress:'compress',gif:'gif'};const pct=Number.isFinite(progress)?Math.max(0,Math.min(100,progress)):null;return '<div class="operation-loader loader-'+(labels[action]||'generic')+'"><span class="loader-visual" aria-hidden="true"><i></i><i></i><i></i></span><span class="loader-copy"><b>'+esc(message)+'</b>'+(pct===null?'<small>جارٍ تنفيذ العملية…</small>':'<small>'+Math.round(pct)+'%</small>')+'</span>'+(pct===null?'<span class="loader-track indeterminate"><i></i></span>':'<span class="loader-track"><i style="width:'+pct+'%"></i></span>')+'</div>'}
async function processFile(file,action,params,target){const out=$('#'+target);if(!file){out.textContent='اختر ملفاً أولاً.';out.className='feedback error';return}const base=getBackend();if(!base){out.textContent='لم يتم إعداد خادم المعالجة بعد. افتح الإعدادات وأضف عنوان Backend بعد نشره.';out.className='feedback error';return}const fd=new FormData();fd.append('file',file);Object.entries(params).forEach(([k,v])=>fd.append(k,String(v)));out.className='feedback operation-feedback';out.innerHTML=loaderMarkup(action,'جارٍ رفع الملف…',0);try{const result=await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',base+'/api/process/'+action);xhr.responseType='blob';xhr.upload.onprogress=e=>{if(e.lengthComputable){const p=e.total?e.loaded/e.total*100:0;out.innerHTML=loaderMarkup(action,p>=100?'تم الرفع؛ يجري '+operationLabels[action]+'…':'جارٍ رفع الملف…',p)}};xhr.upload.onload=()=>{out.innerHTML=loaderMarkup(action,'تم الرفع؛ يجري '+operationLabels[action]+'…')};xhr.onprogress=e=>{if(e.lengthComputable){out.innerHTML=loaderMarkup(action,'جارٍ استلام الملف الناتج…',e.total?e.loaded/e.total*100:0)}else{out.innerHTML=loaderMarkup(action,'تمت المعالجة؛ جارٍ استلام النتيجة…')}};xhr.onload=async()=>{if(xhr.status<200||xhr.status>=300){let msg='فشل الطلب';try{msg=(await xhr.response.text()).slice(0,250)||msg}catch{}reject(new Error(msg));return}resolve({blob:xhr.response,disposition:xhr.getResponseHeader('Content-Disposition')||''})};xhr.onerror=()=>reject(new Error('تعذر الاتصال بالخادم'));xhr.send(fd)});const blob=result.blob;const name=result.disposition.match(/filename="?([^";]+)"?/i)?.[1]||'seif-output';const url=URL.createObjectURL(blob);downloads.unshift({name,url,size:blob.size,time:Date.now()});renderDownloads();const a=document.createElement('a');a.href=url;a.download=name;a.click();out.textContent='اكتملت المعالجة. بدأ تنزيل الملف.';out.className='feedback success'}catch(err){out.textContent='تعذرت المعالجة: '+err.message;out.className='feedback error'}}
function renderDownloads(){$('#downloadsList').innerHTML=downloads.length?downloads.map(d=>`<div class="history-item"><div style="flex:1"><b>${esc(d.name)}</b><div class="history-meta">${(d.size/1048576).toFixed(2)} MB</div></div><a class="mini-btn" href="${d.url}" download="${esc(d.name)}">تنزيل</a></div>`).join(''):'<div class="empty-state"><div class="empty-icon">⇩</div><h3>لا توجد ملفات بعد</h3><p>ستظهر هنا نتائج المعالجة خلال هذه الجلسة.</p></div>'}
$('#copyAllHistory').onclick=()=>copy(readHistory().map(x=>x.url).join('\n'));
$('#clearHistory').onclick=()=>{if(confirm('هل تريد مسح سجل الروابط بالكامل؟')){saveHistory([]);renderHistory();toast('تم مسح السجل')}};
function loadSettings(){let s={};try{s=JSON.parse(localStorage.getItem(SET)||'{}')}catch{}$('#backendUrl').value=s.backend||DEFAULT_BACKEND;$('#themeSelect').value=s.theme||'dark';document.body.classList.toggle('light',s.theme==='light');$('#themeBtn').textContent=s.theme==='light'?'☾':'☼'}
$('#saveSettings').onclick=()=>{const s={backend:$('#backendUrl').value.trim(),theme:$('#themeSelect').value,language:$('#languageSelect').value};localStorage.setItem(SET,JSON.stringify(s));document.body.classList.toggle('light',s.theme==='light');$('#settingsFeedback').textContent='تم حفظ الإعدادات على هذا الجهاز.';$('#settingsFeedback').className='feedback success'};
$('#themeBtn').onclick=()=>{const light=!document.body.classList.contains('light');document.body.classList.toggle('light',light);$('#themeSelect').value=light?'light':'dark';$('#themeBtn').textContent=light?'☾':'☼';let s={};try{s=JSON.parse(localStorage.getItem(SET)||'{}')}catch{}s.theme=light?'light':'dark';localStorage.setItem(SET,JSON.stringify(s))};
updateCount();loadSettings();renderHistory();const initial=location.hash.slice(1);if(pageNames[initial])go(initial);
