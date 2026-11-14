const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const platforms=['Spotify','Apple Music','YouTube Music','YouTube','TikTok','PeerTube','Internet Archive'];
const tools=[['discover','⌕','البحث والاكتشاف','اكتشف المحتوى بالكلمات المفتاحية'],['fetch','↧','تحليل الرابط','فهم الرابط والبحث عن بدائل'],['batch','▤','المعالجة الجماعية','إدارة عدة روابط'],['images','▧','صور المنشورات','حفظ الصور المسموح بها'],['trim','✂','قص الفيديو','تحديد البداية والنهاية'],['audio','♫','استخراج الصوت','MP3 و WAV و M4A'],['identify','⌁','التعرّف على الأغاني','اكتشف اسم الأغنية من مقطع صوتي'],['convert','⇄','تحويل الصيغ','فيديو وصوت'],['compress','◫','ضغط الملفات','موازنة الجودة والحجم'],['gif','▣','صانع GIF','تحويل مقطع قصير']];
const pageNames={home:'الرئيسية',discover:'البحث والاكتشاف',fetch:'جلب الوسائط',batch:'المعالجة الجماعية',images:'صور المنشورات',trim:'قص الفيديو',audio:'استخراج الصوت',identify:'التعرّف على الأغاني',convert:'تحويل الصيغ',compress:'ضغط الملفات',gif:'صانع GIF',downloads:'مركز التنزيلات',history:'سجل الروابط',settings:'الإعدادات'};
const KEY='seif-convertisser-history-v1',SET='seif-convertisser-settings-v1';let batch=[],downloads=[],trimObjectUrl=null,identifyFile=null,identifyObjectUrl=null,identifyRecorder=null,identifyStream=null,identifyTimer=null,identifyChunks=[];
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
/* Platform selection is intentionally automatic in Smart Finder. */
function readHistory(){try{return JSON.parse(localStorage.getItem(KEY)||'[]').filter(x=>Date.now()-x.time<30*864e5)}catch{return []}}
function saveHistory(items){localStorage.setItem(KEY,JSON.stringify(items));updateCount()}
function addHistory(url,platform='غير محددة',name=''){if(!url)return;let items=readHistory().filter(x=>x.url!==url);items.unshift({url,platform,name,time:Date.now()});saveHistory(items.slice(0,300));renderHistory()}
function updateCount(){$('#historyCount').textContent=readHistory().length}
function renderHistory(){const items=readHistory();saveHistory(items);$('#historyList').innerHTML=items.length?items.map((x,i)=>`<div class="history-item"><div style="min-width:0;flex:1"><div class="url">${esc(x.url)}</div><div class="history-meta">${esc(x.platform)} · ${new Date(x.time).toLocaleString('ar')}</div></div><button class="mini-btn" data-copy="${i}">نسخ</button><button class="mini-btn" data-open="${i}">فتح</button><button class="mini-btn" data-remove="${i}">حذف</button></div>`).join(''):'<div class="panel empty-state"><div class="empty-icon">◷</div><h3>السجل فارغ</h3><p>ستظهر الروابط التي تضيفها هنا لمدة 30 يوماً.</p></div>';$$('[data-copy]').forEach(b=>b.onclick=()=>copy(readHistory()[+b.dataset.copy].url));$$('[data-open]').forEach(b=>b.onclick=()=>window.open(readHistory()[+b.dataset.open].url,'_blank','noopener'));$$('[data-remove]').forEach(b=>b.onclick=()=>{let a=readHistory();a.splice(+b.dataset.remove,1);saveHistory(a);renderHistory()})}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function copy(s){try{await navigator.clipboard.writeText(s);toast('تم نسخ الرابط')}catch{toast('تعذر النسخ؛ تحقق من إذن الحافظة')}}
function detect(url){try{const h=new URL(url).hostname.toLowerCase();const has=d=>h===d||h.endsWith('.'+d);if(h==='music.youtube.com')return'YouTube Music';if(has('youtube.com')||has('youtu.be')||has('youtube-nocookie.com'))return'YouTube';if(has('tiktok.com'))return'TikTok';if(has('instagram.com'))return'Instagram';if(has('x.com')||has('twitter.com'))return'X (Twitter)';if(has('facebook.com')||has('fb.watch'))return'Facebook';if(has('twitch.tv'))return'Twitch';if(has('dailymotion.com')||has('dai.ly'))return'Dailymotion'}catch{}return'منصة غير معروفة'}
function validUrl(s){try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)}catch{return false}}
let quickInspectTimer=null,smartResolved=null;
function setMediaStatus(el,message,kind=''){if(!el)return;el.textContent=message;el.className='media-status '+kind+(kind==='loading'?' is-loading':'')}
function smartResultCard(r){
  const image=r.thumbnail?'<img class="smart-thumb" src="'+esc(r.thumbnail)+'" alt="" loading="lazy" onerror="this.style.display=\'none\'">':'<div class="smart-thumb smart-thumb-empty">'+(r.kind==='music'?'♫':'▶')+'</div>';
  const duration=r.duration?'<span class="chip">'+Math.floor(r.duration/60)+':'+String(Math.floor(r.duration%60)).padStart(2,'0')+'</span>':'';
  const action=r.downloadable&&r.downloadUrl?'<a class="primary-btn smart-action" href="'+esc(getBackend()+r.downloadUrl)+'" download>'+(r.kind==='music'?'تنزيل الأغنية مباشرة ↓':'تنزيل الملف مباشرة ↓')+'</a>':'<a class="secondary-btn smart-action" href="'+esc(r.url||'#')+'" target="_blank" rel="noopener">'+(r.kind==='music'?'استمع / افتح المصدر الرسمي ↗':'فتح المصدر الرسمي ↗')+'</a>';
  const preview=(r.previewUrl||r.embedUrl)?'<div class="smart-preview '+(r.kind==='music'?'smart-music-preview':'')+'"><iframe src="'+esc(r.previewUrl||r.embedUrl)+'" loading="lazy" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" title="معاينة '+esc(r.title)+'"></iframe></div>':'';
  return '<article class="smart-card">'+image+'<div class="smart-card-body"><div class="media-tags"><span class="chip">'+esc(r.platform||'مصدر')+'</span><span class="chip">'+(r.kind==='music'?'موسيقى':'فيديو')+'</span>'+(Number.isFinite(Number(r.matchScore))?'<span class="chip">تطابق '+Number(r.matchScore)+'%</span>':'')+duration+'</div><b>'+esc(r.title||'بدون عنوان')+'</b><small>'+esc(r.artist||r.album||'')+'</small><p>'+esc(r.note||r.description||'')+'</p>'+preview+'<div class="smart-card-actions">'+action+'</div></div></article>';
}
function renderSmartResults(rows,target='#searchResults'){
  const el=$(target);if(!el)return;
  el.innerHTML=rows.length?rows.map(smartResultCard).join(''):'';
}
async function smartSearch(term,type='all',target='#searchResults',state='#searchState'){
  const base=getBackend();
  if(!base)throw new Error('عنوان الخادم غير مضبوط. افتح الإعدادات.');
  const response=await fetch(base+'/api/smart/search?q='+encodeURIComponent(term)+'&type='+encodeURIComponent(type));
  const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر البحث.');
  renderSmartResults(data.results||[],target);
  const stateEl=$(state);
  if(stateEl){
    const n=(data.results||[]).length;
    stateEl.className='empty-state';
    stateEl.innerHTML=n?'<div class="empty-icon">✦</div><h3>عثرنا على '+n+' نتيجة</h3><p>'+(data.warnings||[]).map(esc).join(' · ')+'</p>':'<div class="empty-icon">⌕</div><h3>لم نجد نتائج مطابقة</h3><p>جرّب كتابة اسم الأغنية مع الفنان، أو عنوان الفيديو بكلمات أبسط.</p>';
  }
  return data;
}
async function resolveSmartLink(url){
  const base=getBackend();if(!base)throw new Error('الخادم غير متصل.');
  const response=await fetch(base+'/api/smart/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر تحليل الرابط.');
  smartResolved=data;return data;
}
function renderResolved(data){
  const box=$('#mediaResult');box.hidden=false;
  const isMusic=data.mediaType==='music';
  const spotifyEmbed=data.embedUrl&&/^https:\/\/open\.spotify\.com\/embed\//.test(data.embedUrl);
  const appleEmbed=data.embedUrl&&/^https:\/\/embed\.music\.apple\.com\//.test(data.embedUrl);
  const embed=spotifyEmbed||appleEmbed?'<div class="smart-preview '+(appleEmbed?'apple-preview':'spotify-preview')+'"><iframe src="'+esc(data.embedUrl)+'" width="100%" height="'+(appleEmbed?'175':'152')+'" frameborder="0" allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture" loading="lazy" title="مشغل الموسيقى الرسمي"></iframe></div>':'';
  const thumb=data.thumbnail?'<img class="media-thumb" src="'+esc(data.thumbnail)+'" alt="">':'<div class="media-thumb thumb-placeholder">'+(isMusic?'♫':'▶')+'</div>';
  box.innerHTML='<div class="media-result-main">'+thumb+'<div class="media-details"><div class="media-tags"><span class="chip">'+esc(data.platform)+'</span><span class="chip">'+(isMusic?'أغنية / موسيقى':'فيديو')+'</span></div><b>'+esc(data.title)+'</b><small>'+esc(data.artist||'تم استخراج معلومات المصدر')+'</small></div></div>'+embed+'<div class="smart-search-next"><p>تم فهم الرابط. الآن نبحث عن نسخ أو نتائج مناسبة في مصادر أخرى.</p><button class="primary-btn" id="smartFindAlternatives">ابحث عن محتوى مطابق ✦</button></div>';
  $('#smartFindAlternatives').onclick=async()=>{
    const btn=$('#smartFindAlternatives');btn.disabled=true;btn.textContent='جارٍ البحث…';
    try{await smartSearch(data.query||data.title,isMusic?'music':'video','#searchResults','#searchState');go('discover');$('#searchQuery').value=data.query||data.title;$('#searchType').value=isMusic?'music':'video';}
    catch(err){setMediaStatus($('#mediaStatus'),err.message,'error')}
    finally{btn.disabled=false;btn.textContent='ابحث عن محتوى مطابق ✦'}
  };
}
async function runSmartLink(url){
  if(!validUrl(url))throw new Error('أدخل رابطاً صحيحاً يبدأ بـ https://.');
  $('#mediaResult').hidden=true;setMediaStatus($('#mediaStatus'),'جارٍ فهم الرابط وتحديد هل هو أغنية أم فيديو…','loading');
  const data=await resolveSmartLink(url);addHistory(url,data.platform,data.title);renderResolved(data);
  setMediaStatus($('#mediaStatus'),'تم تحليل المحتوى: '+(data.mediaType==='music'?'موسيقى':'فيديو')+' · '+data.platform+'. لم يبدأ أي تنزيل تلقائي.','success');
  return data;
}
$('#quickLink').addEventListener('input',e=>{
  const url=e.target.value.trim();smartResolved=null;$('#mediaResult').hidden=true;
  clearTimeout(quickInspectTimer);if(!url){setMediaStatus($('#mediaStatus'),'ألصق رابط أغنية أو فيديو، وسنحدد نوعه تلقائياً.');return}
  if(!validUrl(url))return;
  setMediaStatus($('#mediaStatus'),'تم التعرف على '+detect(url)+' مبدئياً. جارٍ فهم المحتوى…','loading');
  quickInspectTimer=setTimeout(()=>runSmartLink(url).catch(err=>setMediaStatus($('#mediaStatus'),err.message,'error')),700);
});
$('#quickLinkForm').onsubmit=async e=>{e.preventDefault();try{await runSmartLink($('#quickLink').value.trim())}catch(err){setMediaStatus($('#mediaStatus'),err.message,'error')}};
$('#fetchForm').onsubmit=async e=>{e.preventDefault();const url=$('#fetchUrl').value.trim();if(!validUrl(url))return;try{const data=await resolveSmartLink(url);$('#fetchFeedback').textContent='تم التعرف: '+(data.mediaType==='music'?'موسيقى':'فيديو')+' — '+data.title+'. انتقل إلى البحث والاكتشاف للعثور على بدائل.';$('#fetchFeedback').className='feedback success';$('#searchQuery').value=data.query||data.title;$('#searchType').value=data.mediaType;go('discover');await smartSearch(data.query||data.title,data.mediaType)}catch(err){$('#fetchFeedback').textContent=err.message;$('#fetchFeedback').className='feedback error'}};
$('#searchForm').onsubmit=async e=>{
  e.preventDefault();const q=$('#searchQuery').value.trim();if(q.length<2)return;
  $('#searchState').className='empty-state operation-state';$('#searchState').innerHTML=loaderMarkup('search','جارٍ البحث في كتالوجات الموسيقى وأرشيف الفيديو…');$('#searchResults').innerHTML='';
  try{await smartSearch(q,$('#searchType').value||'all')}catch(err){$('#searchState').className='empty-state';$('#searchState').innerHTML='<div class="empty-icon">!</div><h3>تعذر إكمال البحث</h3><p>'+esc(err.message)+'</p>'}
};
$('#addBatch').onclick=()=>{const urls=$('#batchInput').value.split(/\n+/).map(x=>x.trim()).filter(Boolean);let added=0;for(const u of urls){if(validUrl(u)){addHistory(u,detect(u));if(!batch.includes(u)){batch.push(u);added++}}}renderBatch();toast(added+' رابط أضيف إلى الطابور')};
$('#clearBatch').onclick=()=>{batch=[];renderBatch()};function renderBatch(){$('#batchList').innerHTML=batch.map((u,i)=>`<div class="queue-item"><span class="url">${esc(u)}</span><button class="mini-btn" data-bcopy="${i}">نسخ</button><button class="mini-btn" data-bdel="${i}">حذف</button></div>`).join('');$$('[data-bcopy]').forEach(b=>b.onclick=()=>copy(batch[+b.dataset.bcopy]));$$('[data-bdel]').forEach(b=>b.onclick=()=>{batch.splice(+b.dataset.bdel,1);renderBatch()})}
$('#imageInspect').onclick=()=>{$('#imageFeedback').textContent='تم استلام الرابط. استخراج الصور الأصلية يتطلب موصل المنصة والتحقق من صلاحية الوصول.';$('#imageFeedback').className='feedback'};
$('#trimFile').onchange=e=>{const f=e.target.files[0];if(!f)return;if(trimObjectUrl)URL.revokeObjectURL(trimObjectUrl);trimObjectUrl=URL.createObjectURL(f);$('#trimPreview').src=trimObjectUrl;$('#trimPreview').hidden=false;$('#trimPreview').onloadedmetadata=()=>{$('#trimEnd').value=$('#trimPreview').duration.toFixed(2);$('#trimDuration').textContent='المدة: '+$('#trimPreview').duration.toFixed(2)+' ثانية';$('#trimProcess').disabled=false}};
$('#trimStart').oninput=updateTimeline;$('#trimEnd').oninput=updateTimeline;function updateTimeline(){const v=$('#trimPreview');if(!v.duration)return;const s=Math.max(0,+$('#trimStart').value||0),e=Math.min(v.duration,+$('#trimEnd').value||v.duration);$('#timelineFill').style.width=Math.max(0,Math.min(100,(e-s)/v.duration*100))+'%'}
$('#trimProcess').onclick=()=>processFile($('#trimFile').files[0],'trim',{start:+$('#trimStart').value,end:+$('#trimEnd').value},'trimFeedback');
$('#audioProcess').onclick=()=>processFile($('#audioFile').files[0],'audio',{format:$('#audioFormat').value,bitrate:$('#audioBitrate').value},'audioFeedback');

function identifyStatus(message,kind=''){const el=$('#identifyStatus');el.textContent=message;el.className='feedback '+kind}
function setIdentifyFile(file){
  identifyFile=file||null;
  if(identifyObjectUrl)URL.revokeObjectURL(identifyObjectUrl);
  identifyObjectUrl=null;
  const preview=$('#identifyPreview');
  if(identifyFile){identifyObjectUrl=URL.createObjectURL(identifyFile);preview.src=identifyObjectUrl;preview.hidden=false;$('#identifySubmit').disabled=false;identifyStatus('تم اختيار: '+identifyFile.name+' · '+(identifyFile.size/1048576).toFixed(2)+' MB. اضغط «تعرّف على الأغنية».','success')}
  else{preview.removeAttribute('src');preview.hidden=true;$('#identifySubmit').disabled=true}
  $('#identifyResult').hidden=true;
}
$('#identifyFile').addEventListener('change',e=>setIdentifyFile(e.target.files[0]));
function stopIdentifyRecording(){
  if(identifyTimer){clearTimeout(identifyTimer);identifyTimer=null}
  if(identifyRecorder&&identifyRecorder.state==='recording')identifyRecorder.stop();
  $('#identifyStop').disabled=true;
}
$('#identifyRecord').onclick=async()=>{
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){identifyStatus('متصفحك لا يدعم التسجيل الصوتي. استخدم رفع ملف صوتي أو افتح التطبيق عبر HTTPS بمتصفح أحدث.','error');return}
  try{
    $('#identifyRecord').disabled=true;identifyStatus('بانتظار إذن الميكروفون…','loading');
    identifyStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    identifyChunks=[];
    const types=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    const mime=types.find(t=>MediaRecorder.isTypeSupported(t));
    identifyRecorder=new MediaRecorder(identifyStream,mime?{mimeType:mime}:{});
    identifyRecorder.ondataavailable=e=>{if(e.data&&e.data.size)identifyChunks.push(e.data)};
    identifyRecorder.onerror=()=>{identifyStream?.getTracks().forEach(t=>t.stop());$('#identifyRecord').disabled=false;$('#identifyStop').disabled=true;identifyStatus('حدث خطأ أثناء التسجيل. جرّب رفع ملف صوتي.','error')};
    identifyRecorder.onstop=()=>{
      const type=identifyRecorder.mimeType||'audio/webm';
      const blob=new Blob(identifyChunks,{type});
      identifyStream?.getTracks().forEach(t=>t.stop());identifyStream=null;
      $('#identifyRecord').disabled=false;$('#identifyStop').disabled=true;
      if(!blob.size){identifyStatus('لم يتم تسجيل صوت. حاول مرة أخرى.','error');return}
      const ext=type.includes('mp4')?'m4a':'webm';
      setIdentifyFile(new File([blob],'seif-recording.'+ext,{type}));
      $('#identifyRecordTime').textContent='تم تسجيل 12 ثانية تقريباً';
    };
    identifyRecorder.start(250);
    $('#identifyStop').disabled=false;
    $('#identifyRecordTime').textContent='جارٍ التسجيل… سيتوقف تلقائياً بعد 12 ثانية';
    identifyStatus('استمع إلى الأغنية قرب الميكروفون. لا تتحدث أثناء التسجيل.','loading');
    identifyTimer=setTimeout(stopIdentifyRecording,12000);
  }catch(err){
    identifyStream?.getTracks().forEach(t=>t.stop());identifyStream=null;
    $('#identifyRecord').disabled=false;$('#identifyStop').disabled=true;
    identifyStatus(err.name==='NotAllowedError'?'لم تسمح للمتصفح باستخدام الميكروفون. فعّل الإذن أو ارفع ملفاً صوتياً.':'تعذر تشغيل الميكروفون: '+err.message,'error');
  }
};
$('#identifyStop').onclick=stopIdentifyRecording;
function identifyLink(url,label){
  if(typeof url!=='string'||!/^https:\/\/[^ ]+/i.test(url))return '';
  return '<a class="secondary-btn identify-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+label+' ↗</a>';
}
async function renderIdentifyMatch(match){
  const result=$('#identifyResult');result.hidden=false;
  if(!match){result.innerHTML='<div class="identify-no-match"><div class="empty-icon">♫</div><b>لم نتعرف على الأغنية</b><p>جرّب مقطعاً أوضح مدته 8–12 ثانية، ويفضل أن تكون الموسيقى مسموعة دون كلام فوقها.</p></div>';return}
  const art=match.artwork?'<img class="identify-art" src="'+esc(match.artwork)+'" alt="غلاف الألبوم" loading="lazy">':'<div class="identify-art identify-art-empty">♫</div>';
  result.innerHTML='<div class="identify-match">'+art+'<div class="identify-match-info"><span class="eyebrow">بصمة الصوت الأقرب</span><h2>'+esc(match.title||'أغنية معروفة')+'</h2><b>'+esc(match.artist||'فنان غير معروف')+'</b><small>'+[match.album,match.releaseDate].filter(Boolean).map(esc).join(' · ')+'</small></div></div><div class="identify-candidates"><div class="identify-candidates-head"><b>أقرب النتائج المتاحة</b><span class="muted" id="identifyCandidateCount">جارٍ الفرز…</span></div><div id="identifyCandidateList"><div class="identify-loading">نبحث عن النسخ الأقرب ونرتبها لك…</div></div></div><p class="identify-download-note">نعرض هنا نتائج البحث من Spotify وApple Music فقط، مع روابط ومعاينات رسمية عند توفرها. لا نعرض نتائج من مصادر موسيقى أخرى.</p>';
  const q=[match.title,match.artist].filter(Boolean).join(' ');
  try{
    const response=await fetch(getBackend()+'/api/smart/search?q='+encodeURIComponent(q)+'&type=music');
    const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر البحث عن النسخ.');
    const rows=(data.results||[]).filter(r=>r&&r.kind==='music');
    const tokens=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu,' ').split(/\s+/).filter(Boolean);
    const target=tokens(q);
    const score=r=>{
      const title=tokens(r.title),artist=tokens(r.artist),all=new Set([...title,...artist]);
      const overlap=target.filter(t=>all.has(t)).length/Math.max(1,target.length);
      const exact=String(r.title||'').toLowerCase().includes(String(match.title||'').toLowerCase())?0.25:0;
      return Math.max(Number(r.matchScore)||0,Math.min(100,Math.round((overlap+exact)*100)));
    };
    rows.forEach(r=>r._closestScore=score(r));
    rows.sort((x,y)=>y._closestScore-x._closestScore);
    const list=$('#identifyCandidateList');
    if(!rows.length){list.innerHTML='<div class="identify-no-match"><b>لم نعثر على نسخ أخرى في المصادر المتاحة.</b></div>'}
    else{
      list.innerHTML=rows.slice(0,8).map(r=>{
        const card=smartResultCard(r);
        return card.replace('<article class="smart-card">','<article class="smart-card identify-ranked-card"><span class="identify-rank">قرب '+r._closestScore+'%</span>');
      }).join('');
    }
    $('#identifyCandidateCount').textContent=rows.length+' نتيجة مرتبة';
  }catch(err){
    $('#identifyCandidateCount').textContent='تعذر جلب النتائج';
    $('#identifyCandidateList').innerHTML='<div class="identify-no-match">'+esc(err.message)+'</div>';
  }
}
$('#identifySubmit').onclick=async()=>{
  if(!identifyFile){identifyStatus('اختر ملفاً أو سجّل مقطعاً أولاً.','error');return}
  const btn=$('#identifySubmit');btn.disabled=true;$('#identifyResult').hidden=true;
  identifyStatus('نحلّل البصمة الصوتية ونقارنها بقاعدة بيانات الأغاني…','loading');
  try{
    const fd=new FormData();fd.append('file',identifyFile,identifyFile.name);fd.append('offset',String(Math.max(0,Number($('#identifyOffset').value)||0)));
    const response=await fetch(getBackend()+'/api/smart/identify-audio',{method:'POST',body:fd});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'تعذر التعرف على الأغنية.');
    await renderIdentifyMatch(data.match);
    identifyStatus(data.match?'نجح التعرف على الأغنية.':'اكتمل التحليل دون العثور على تطابق.','success');
  }catch(err){identifyStatus(err.message||'تعذر الاتصال بخدمة التعرف.','error')}
  finally{btn.disabled=!identifyFile}
};

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
