const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const platforms=['YouTube','TikTok','Instagram','X (Twitter)','Facebook','Twitch','Dailymotion'];
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
function detect(url){try{const h=new URL(url).hostname.toLowerCase();const has=d=>h===d||h.endsWith('.'+d);if(has('youtube.com')||has('youtu.be')||has('youtube-nocookie.com'))return'YouTube';if(has('tiktok.com'))return'TikTok';if(has('instagram.com'))return'Instagram';if(has('x.com')||has('twitter.com'))return'X (Twitter)';if(has('facebook.com')||has('fb.watch'))return'Facebook';if(has('twitch.tv'))return'Twitch';if(has('dailymotion.com')||has('dai.ly'))return'Dailymotion'}catch{}return'منصة غير معروفة'}
function validUrl(s){try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)}catch{return false}}
let currentMedia=null,quickInspectTimer=null,inspectionTask=null;
function mediaTypeLabel(t){return t==='video'?'فيديو':t==='image'?'صورة':t==='audio'?'صوت':'وسائط'}
function setMediaStatus(el,message,kind=''){if(!el)return;el.textContent=message;el.className='media-status '+kind}
function renderMediaResult(url,data){
  const box=$('#mediaResult');if(!box)return;
  const thumb=data.thumbnail&&/^https:\/\//i.test(data.thumbnail)?data.thumbnail:'';
  const platform=detect(url)==='منصة غير معروفة'?data.platform:detect(url);
  box.hidden=false;
  box.innerHTML=`<div class="media-result-main">${thumb?`<img class="media-thumb" src="${esc(thumb)}" alt="">`:'<div class="media-thumb thumb-placeholder">▶</div>'}<div class="media-details"><div class="media-tags"><span class="chip">${esc(platform)}</span><span class="chip">${mediaTypeLabel(data.mediaType)}</span></div><b>${esc(data.title||'وسائط من المصدر')}</b><small>${data.duration?Math.floor(data.duration/60)+':'+String(Math.floor(data.duration%60)).padStart(2,'0'):'المعلومات المتاحة من المصدر'}</small></div></div><div class="media-download-row"><label>الجودة<select id="mediaQuality">${(data.formats||[{value:'best',label:'أفضل جودة متاحة'}]).map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</select></label><button class="primary-btn" id="downloadMediaBtn">تنزيل الملف الآن ↓</button></div><p class="media-note">سيتم تنزيل أفضل نسخة متاحة من المصدر دون ادعاء جودة غير موجودة.</p>`;
  $('#downloadMediaBtn').onclick=()=>downloadMedia(url);
}
async function inspectMedia(url,statusEl=$('#mediaStatus')){
  if(inspectionTask&&inspectionTask.url===url)return inspectionTask.promise;
  const base=getBackend();
  if(!base){setMediaStatus(statusEl,'تم التعرف على '+detect(url)+' من الرابط. لتنزيل الملف فعلياً يجب نشر خادم المعالجة وربطه من الإعدادات.','error');return false}
  setMediaStatus(statusEl,'جارٍ التعرف على المنصة وفحص نوع المحتوى والجودات…');
  const promise=(async()=>{try{
    const response=await fetch(base+'/api/media/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر تحليل الرابط');
    currentMedia={url,data};addHistory(url,detect(url),data.title||'');
    if(statusEl===$('#mediaStatus'))renderMediaResult(url,data);
    setMediaStatus(statusEl,'تم التعرف تلقائياً: '+(detect(url)==='منصة غير معروفة'?data.platform:detect(url))+' · '+mediaTypeLabel(data.mediaType)+'. أصبح الملف جاهزاً للتنزيل.','success');
    return true;
  }catch(err){currentMedia=null;setMediaStatus(statusEl,err.message,'error');return false}})();
  inspectionTask={url,promise};const result=await promise;inspectionTask=null;return result;
}
async function downloadMedia(url,statusEl=$('#mediaStatus')){
  if(!validUrl(url)){setMediaStatus(statusEl,'أدخل رابطاً صحيحاً أولاً.','error');return}
  if(!currentMedia||currentMedia.url!==url){const ok=await inspectMedia(url,statusEl);if(!ok)return}
  const base=getBackend();if(!base)return;
  const quality=$('#mediaQuality')?.value||'best';
  addHistory(url,detect(url),currentMedia?.data?.title||'');
  setMediaStatus(statusEl,'تم تجهيز طلب التنزيل. إذا كان المصدر يسمح بالوصول، سيبدأ حفظ الملف الآن.','success');
  const a=document.createElement('a');a.href=base+'/api/media/download?url='+encodeURIComponent(url)+'&quality='+encodeURIComponent(quality);a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
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
$('#searchForm').onsubmit=async e=>{e.preventDefault();const q=$('#searchQuery').value.trim();if(!q)return;$('#searchState').className='empty-state';$('#searchState').innerHTML='<div class="empty-icon">⌕</div><h3>البحث غير مفعّل بعد</h3><p>واجهة البحث جاهزة. أضف موصلات بحث رسمية أو مصادر عامة مسموحاً بها في الخادم لعرض نتائج حقيقية؛ لن نعرض نتائج تجريبية على أنها حقيقية.</p>';$('#searchResults').innerHTML='';const base=getBackend();if(base){try{const r=await fetch(base+'/api/search?q='+encodeURIComponent(q)+'&platform='+encodeURIComponent($('#searchPlatform').value));if(r.ok){const data=await r.json();renderResults(data.results||[]);return}}catch{}}};
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
function getBackend(){return(localStorage.getItem(SET)?JSON.parse(localStorage.getItem(SET)).backend:'').replace(/\/$/,'')}
async function processFile(file,action,params,target){const out=$('#'+target);if(!file){out.textContent='اختر ملفاً أولاً.';out.className='feedback error';return}const base=getBackend();if(!base){out.textContent='لم يتم إعداد خادم المعالجة بعد. افتح الإعدادات وأضف عنوان Backend بعد نشره.';out.className='feedback error';return}const fd=new FormData();fd.append('file',file);Object.entries(params).forEach(([k,v])=>fd.append(k,String(v)));out.textContent='جارٍ رفع الملف وبدء المعالجة…';out.className='feedback';try{const res=await fetch(base+'/api/process/'+action,{method:'POST',body:fd});if(!res.ok)throw new Error((await res.text()).slice(0,250)||'فشل الطلب');const blob=await res.blob();const name=(res.headers.get('Content-Disposition')||'').match(/filename="?([^";]+)"?/i)?.[1]||'seif-output';const url=URL.createObjectURL(blob);downloads.unshift({name,url,size:blob.size,time:Date.now()});renderDownloads();const a=document.createElement('a');a.href=url;a.download=name;a.click();out.textContent='اكتملت المعالجة. بدأ تنزيل الملف.';out.className='feedback success'}catch(err){out.textContent='تعذرت المعالجة: '+err.message;out.className='feedback error'}}
function renderDownloads(){$('#downloadsList').innerHTML=downloads.length?downloads.map(d=>`<div class="history-item"><div style="flex:1"><b>${esc(d.name)}</b><div class="history-meta">${(d.size/1048576).toFixed(2)} MB</div></div><a class="mini-btn" href="${d.url}" download="${esc(d.name)}">تنزيل</a></div>`).join(''):'<div class="empty-state"><div class="empty-icon">⇩</div><h3>لا توجد ملفات بعد</h3><p>ستظهر هنا نتائج المعالجة خلال هذه الجلسة.</p></div>'}
$('#copyAllHistory').onclick=()=>copy(readHistory().map(x=>x.url).join('\n'));
$('#clearHistory').onclick=()=>{if(confirm('هل تريد مسح سجل الروابط بالكامل؟')){saveHistory([]);renderHistory();toast('تم مسح السجل')}};
function loadSettings(){let s={};try{s=JSON.parse(localStorage.getItem(SET)||'{}')}catch{}$('#backendUrl').value=s.backend||'';$('#themeSelect').value=s.theme||'dark';document.body.classList.toggle('light',s.theme==='light');$('#themeBtn').textContent=s.theme==='light'?'☾':'☼'}
$('#saveSettings').onclick=()=>{const s={backend:$('#backendUrl').value.trim(),theme:$('#themeSelect').value,language:$('#languageSelect').value};localStorage.setItem(SET,JSON.stringify(s));document.body.classList.toggle('light',s.theme==='light');$('#settingsFeedback').textContent='تم حفظ الإعدادات على هذا الجهاز.';$('#settingsFeedback').className='feedback success'};
$('#themeBtn').onclick=()=>{const light=!document.body.classList.contains('light');document.body.classList.toggle('light',light);$('#themeSelect').value=light?'light':'dark';$('#themeBtn').textContent=light?'☾':'☼';let s={};try{s=JSON.parse(localStorage.getItem(SET)||'{}')}catch{}s.theme=light?'light':'dark';localStorage.setItem(SET,JSON.stringify(s))};
updateCount();loadSettings();renderHistory();const initial=location.hash.slice(1);if(pageNames[initial])go(initial);
