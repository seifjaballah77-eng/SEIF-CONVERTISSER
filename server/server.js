const express=require('express');
const cors=require('cors');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const multer=require('multer');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

// Keep the PO-token provider private inside this container; yt-dlp talks to loopback only.
const potProvider=spawn(process.execPath,[process.env.POT_PROVIDER_PATH||'/opt/bgutil-ytdlp-pot-provider/server/build/main.js','--host','127.0.0.1','--port','4416'],{stdio:['ignore','ignore','pipe']});
potProvider.stderr.on('data',d=>console.error('[bgutil-pot]',d.toString().trim()));
potProvider.on('error',err=>console.error('[bgutil-pot] failed to start:',err.message));
potProvider.on('exit',(code)=>{potProviderReady=false;console.error('[bgutil-pot] exited with code',code);});
let potProviderReady=false;

const app=express();
// Render runs this service behind one trusted reverse proxy.
app.set('trust proxy',1);
const PORT=process.env.PORT||8080;
const MAX_UPLOAD_MB=Number(process.env.MAX_UPLOAD_MB||500);
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(cors({origin:(origin,cb)=>{if(!origin||!allowedOrigins.length||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('Origin not allowed'));}}));
app.use(express.json({limit:'1mb'}));
app.use('/api/',rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_UPLOAD_MB*1024*1024,files:1}});

app.get('/health',(req,res)=>res.json({ok:true,service:'SEIF CONVERTISSER API',ffmpeg:'configured-at-runtime',youtubePoTokenProvider:potProviderReady?'ready':'unavailable'}));

// Smart Finder: identify a pasted source, then search a suitable catalog.
function smartSafeUrl(raw){
  let u;try{u=new URL(raw)}catch{throw new Error('الرابط غير صالح.')}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('أدخل رابط HTTP أو HTTPS صالحاً دون بيانات دخول.');
  const h=u.hostname.toLowerCase();
  const allowed=['youtube.com','youtu.be','youtube-nocookie.com','tiktok.com','instagram.com','x.com','twitter.com','facebook.com','fb.watch','twitch.tv','dailymotion.com','dai.ly','spotify.com','spotify.link','music.apple.com','soundcloud.com','vimeo.com'];
  if(!allowed.some(d=>h===d||h.endsWith('.'+d)))throw new Error('هذا المصدر غير مدعوم للتحليل حالياً.');
  return u;
}
async function smartJson(url,timeout=14000){
  const r=await fetch(url,{headers:{'User-Agent':'SEIF-SMART-FINDER/1.0'},signal:AbortSignal.timeout(timeout)});
  if(!r.ok)throw new Error('المصدر أعاد استجابة غير متاحة ('+r.status+').');
  return r.json();
}
function firstText(v){return Array.isArray(v)?String(v[0]||''):String(v||'')}
function smartLicenseAllowed(meta){
  const m=meta.metadata||{};
  const license=firstText(m.licenseurl||m.license_url).toLowerCase();
  const rights=firstText(m.rights).toLowerCase();
  return /creativecommons\.org\/(licenses|publicdomain)/.test(license)||/public domain|creative commons|cc0|cc by([ -]|$)/i.test(rights);
}
app.post('/api/smart/resolve',async(req,res)=>{
  try{
    const u=smartSafeUrl(req.body&&req.body.url);
    const host=u.hostname.toLowerCase();
    const isSpotify=host==='spotify.com'||host.endsWith('.spotify.com')||host==='spotify.link';
    const isMusic= isSpotify || host==='music.youtube.com' || host==='soundcloud.com' || host.endsWith('.soundcloud.com') || host==='music.apple.com';
    let title='',thumbnail=null,embedUrl=null,artist='',duration=null,platform=host.replace(/^www\./,'');
    if(isSpotify){
      const meta=await smartJson('https://open.spotify.com/oembed?url='+encodeURIComponent(u.toString()));
      title=meta.title||'محتوى Spotify';
      thumbnail=meta.thumbnail_url||null;
      const src=String(meta.html||'').match(/src=["']([^"']+)["']/i)?.[1];
      if(src&&/^https:\/\/open\.spotify\.com\/embed\//i.test(src))embedUrl=src;
      else{
        const m=u.pathname.match(/^\/(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/);
        if(m)embedUrl='https://open.spotify.com/embed/'+m[1]+'/'+m[2];
      }
      const bits=title.split(/\s+[·–—]\s+/);
      if(bits.length>1){title=bits[0];artist=bits.slice(1).join(' · ')}
    }else if(host==='music.apple.com'){
      const id=u.searchParams.get('i')||u.pathname.match(/\/(\d+)(?:\/?$)/)?.[1];
      if(id){
        const catalog=await smartJson('https://itunes.apple.com/lookup?id='+encodeURIComponent(id)+'&entity=song&country=US');
        const item=(catalog.results||[]).find(x=>x.wrapperType==='track')||(catalog.results||[])[0];
        if(item){
          title=item.trackName||item.collectionName||'محتوى Apple Music';
          artist=item.artistName||'';
          thumbnail=item.artworkUrl100||item.artworkUrl60||null;
          const link=item.trackViewUrl||u.toString();
          embedUrl=link.replace(/^https:\/\/music\.apple\.com\//i,'https://embed.music.apple.com/');
        }
      }
      if(!title){
        const meta=await smartJson('https://itunes.apple.com/search?media=music&entity=song&limit=1&term='+encodeURIComponent(decodeURIComponent(u.pathname.split('/').filter(Boolean).slice(2,-1).join(' ').replace(/-/g,' '))));
        const item=meta.results?.[0];
        if(item){title=item.trackName||'';artist=item.artistName||'';thumbnail=item.artworkUrl100||null;embedUrl=(item.trackViewUrl||'').replace(/^https:\/\/music\.apple\.com\//i,'https://embed.music.apple.com/')}
      }
    }else if(host==='music.youtube.com'){
      const raw=await runYtDlp(['--dump-single-json','--skip-download','--no-warnings','--no-progress','--no-playlist',u.toString()],{timeoutMs:18000,maxOutput:500000});
      const info=JSON.parse(raw);title=info.track||info.title||info.fulltitle||'';artist=info.artist||info.artists?.join(', ')||info.uploader||'';thumbnail=info.thumbnail||null;duration=Number(info.duration)||null;
    }else if(host==='youtube.com'||host==='youtu.be'||host.endsWith('.youtube.com')){
      const meta=await smartJson('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(u.toString()));
      title=meta.title||'فيديو من YouTube';thumbnail=meta.thumbnail_url||null;
    }else if(host==='tiktok.com'||host.endsWith('.tiktok.com')){
      const meta=await smartJson('https://www.tiktok.com/oembed?url='+encodeURIComponent(u.toString()));
      title=meta.title||'فيديو من TikTok';thumbnail=meta.thumbnail_url||null;
    }else{
      const raw=await runYtDlp(['--dump-single-json','--skip-download','--no-warnings','--no-progress','--no-playlist',u.toString()],{timeoutMs:18000,maxOutput:500000});
      const info=JSON.parse(raw);title=info.title||info.fulltitle||'';artist=info.artist||info.uploader||'';thumbnail=info.thumbnail||null;duration=Number(info.duration)||null;
    }
    if(!title)throw new Error('لم أستطع استخراج عنوان واضح من الرابط. جرّب لصق رابط المحتوى الأصلي.');
    res.json({ok:true,mediaType:isMusic?'music':'video',platform,title,artist,thumbnail,duration,sourceUrl:u.toString(),embedUrl,query:[title,artist].filter(Boolean).join(' ')});
  }catch(err){res.status(422).json({error:err.message||'تعذر فهم الرابط.'});}
});

function smartMatchScore(query,candidate){
  const norm=v=>String(v||'').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const q=norm(query).split(/\s+/).filter(x=>x.length>1),c=norm(candidate).split(/\s+/).filter(x=>x.length>1);
  if(!q.length||!c.length)return 0;
  const set=new Set(c),hits=q.filter(t=>set.has(t)).length;
  const coverage=hits/q.length,precision=hits/Math.max(1,new Set(c).size);
  if(norm(query)===norm(candidate))return 100;
  return Math.round(Math.min(99,coverage*78+precision*22));
}

async function searchArchiveAudio(term){
  const clean=term.replace(/[+\\-!(){}\\[\\]^"~*?:]/g,' ').replace(/\\s+/g,' ').trim().slice(0,150);
  if(!clean)return [];
  const q='mediatype:audio AND (title:"'+clean.replace(/"/g,'')+'" OR creator:"'+clean.replace(/"/g,'')+'")';
  const endpoint='https://archive.org/advancedsearch.php?q='+encodeURIComponent(q)+'&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&rows=12&page=1&output=json';
  const data=await smartJson(endpoint,18000);
  const docs=data.response?.docs||[];
  const rows=await Promise.all(docs.slice(0,10).map(async doc=>{
    try{
      const meta=await smartJson('https://archive.org/metadata/'+encodeURIComponent(doc.identifier),12000);
      const files=(meta.files||[]).filter(f=>f.source==='original'&&/\\.(mp3|ogg|oga|flac|wav|m4a)$/i.test(f.name||''));
      const file=files.sort((a,b)=>(Number(b.size)||0)-(Number(a.size)||0))[0];
      const allowed=smartLicenseAllowed(meta);
      const title=firstText(doc.title)||doc.identifier;
      const artist=firstText(doc.creator);
      return {kind:'music',title,artist,album:'',thumbnail:'https://archive.org/services/img/'+encodeURIComponent(doc.identifier),
        duration:null,platform:'Internet Archive',url:'https://archive.org/details/'+encodeURIComponent(doc.identifier),
        matchScore:smartMatchScore(clean,[title,artist].join(' ')),downloadable:!!file&&allowed,
        downloadUrl:file&&allowed?'/api/smart/archive-audio/'+encodeURIComponent(doc.identifier)+'/'+encodeURIComponent(file.name):null,
        license:firstText(meta.metadata?.licenseurl||meta.metadata?.rights)||'ترخيص غير محدد',
        note:file&&allowed?'ملف صوتي أصلي متاح للتنزيل وفق الترخيص الظاهر.':'المصدر لا يثبت حالياً إذناً واضحاً بالتنزيل.'};
    }catch{return null}
  }));
  return rows.filter(Boolean);
}
let spotifyTokenCache={token:'',expiresAt:0};
async function getSpotifyAccessToken(){
  const id=process.env.SPOTIFY_CLIENT_ID,secret=process.env.SPOTIFY_CLIENT_SECRET;
  if(!id||!secret)return null;
  if(spotifyTokenCache.token&&spotifyTokenCache.expiresAt>Date.now()+60000)return spotifyTokenCache.token;
  const auth=Buffer.from(id+':'+secret).toString('base64');
  const response=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('تعذر الحصول على تصريح البحث من Spotify ('+response.status+').');
  const data=await response.json();
  if(!data.access_token)throw new Error('لم يرجع Spotify رمز بحث صالحاً.');
  spotifyTokenCache={token:data.access_token,expiresAt:Date.now()+Math.max(60,Number(data.expires_in)||3600)*1000};
  return spotifyTokenCache.token;
}
async function searchSpotifyMusic(term){
  const token=await getSpotifyAccessToken();
  if(!token)return {results:[],warning:'بحث Spotify يحتاج SPOTIFY_CLIENT_ID وSPOTIFY_CLIENT_SECRET في إعدادات Render.'};
  const response=await fetch('https://api.spotify.com/v1/search?q='+encodeURIComponent(term)+'&type=track&limit=12&market=US',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('تعذر البحث في Spotify ('+response.status+').');
  const data=await response.json();
  const results=(data.tracks?.items||[]).map(x=>{
    const url=x.external_urls?.spotify||'';
    const candidate=[x.name,...(x.artists||[]).map(a=>a.name)].join(' ');
    return {kind:'music',title:x.name||'أغنية',artist:(x.artists||[]).map(a=>a.name).join(', '),
      album:x.album?.name||'',thumbnail:x.album?.images?.[0]?.url||null,duration:x.duration_ms?Math.round(x.duration_ms/1000):null,
      url,previewUrl:x.id?'https://open.spotify.com/embed/track/'+encodeURIComponent(x.id):null,
      matchScore:smartMatchScore(term,candidate),platform:'Spotify',downloadable:false,
      note:'رابط ومشغل Spotify الرسمي. تنزيل الأغاني المحمية غير متاح من خلال Spotify.'};
  }).filter(x=>x.url);
  return {results};
}
async function searchAppleMusic(term){
  const url='https://itunes.apple.com/search?media=music&entity=song&limit=12&country=US&term='+encodeURIComponent(term);
  const data=await smartJson(url,14000);
  const results=(data.results||[]).map(x=>{
    const url=x.trackViewUrl||x.collectionViewUrl||'';
    const embedUrl=url.replace(/^https:\/\/music\.apple\.com\//i,'https://embed.music.apple.com/');
    const candidate=[x.trackName,x.artistName].filter(Boolean).join(' ');
    return {kind:'music',title:x.trackName||'أغنية',artist:x.artistName||'فنان غير معروف',
      album:x.collectionName||'',thumbnail:x.artworkUrl100||null,duration:x.trackTimeMillis?Math.round(x.trackTimeMillis/1000):null,
      url,previewUrl:/^https:\/\/embed\.music\.apple\.com\//i.test(embedUrl)?embedUrl:null,
      matchScore:smartMatchScore(term,candidate),platform:'Apple Music',downloadable:false,
      note:'رابط ومعاينة Apple Music الرسمية؛ تنزيل الأغاني المحمية غير متاح من خدمة البث.'};
  }).filter(x=>x.url);
  return {results};
}
async function searchSmartMusic(term){
  const [spotify,apple,archive]=await Promise.all([
    searchSpotifyMusic(term).catch(error=>({results:[],warning:error.message||'تعذر البحث في Spotify.'})),
    searchAppleMusic(term).then(x=>({...x})).catch(error=>({results:[],warning:'تعذر الوصول إلى Apple Music الآن.'})),
    searchArchiveAudio(term).then(results=>({results})).catch(()=>({results:[]}))
  ]);
  const results=[...spotify.results,...apple.results,...archive.results];
  const seen=new Set();
  return results.filter(x=>{const key=x.url||[x.title,x.artist,x.platform].join('|');if(seen.has(key))return false;seen.add(key);return true;})
    .sort((a,b)=>Number(b.matchScore)-Number(a.matchScore)).slice(0,24);
}
async function searchArchiveVideos(term){
  const clean=term.replace(/[+\-!(){}\[\]^"~*?:]/g,' ').replace(/\s+/g,' ').trim().slice(0,150);
  if(!clean) return [];
  const q='mediatype:movies AND (title:"'+clean.replace(/"/g,'')+'" OR description:"'+clean.replace(/"/g,'')+'")';
  const endpoint='https://archive.org/advancedsearch.php?q='+encodeURIComponent(q)+'&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&fl[]=date&rows=10&page=1&output=json';
  const data=await smartJson(endpoint,18000);
  const docs=data.response?.docs||[];
  const details=await Promise.all(docs.slice(0,8).map(async doc=>{
    try{
      const meta=await smartJson('https://archive.org/metadata/'+encodeURIComponent(doc.identifier),12000);
      const files=(meta.files||[]).filter(f=>f.source==='original'&&/\.(mp4|webm|m4v|mov|mpeg|mpg|ogv)$/i.test(f.name||''));
      const file=files.sort((a,b)=>(Number(b.size)||0)-(Number(a.size)||0))[0];
      const allowed=smartLicenseAllowed(meta);
      const title=firstText(doc.title)||doc.identifier;
      return {
        kind:'video',title,artist:firstText(doc.creator),matchScore:smartMatchScore(clean,title),
        description:firstText(doc.description).replace(/<[^>]*>/g,' ').slice(0,240),
        thumbnail:'https://archive.org/services/img/'+encodeURIComponent(doc.identifier),
        duration:null,platform:'Internet Archive',url:'https://archive.org/details/'+encodeURIComponent(doc.identifier),
        previewUrl:'https://archive.org/embed/'+encodeURIComponent(doc.identifier),
        downloadable:!!file&&allowed,
        downloadUrl:file&&allowed?'/api/smart/archive/'+encodeURIComponent(doc.identifier)+'/'+encodeURIComponent(file.name):null,
        license:firstText(meta.metadata?.licenseurl||meta.metadata?.rights)||'ترخيص غير محدد',
        note:file&&allowed?'يتوفر ملف أصلي مع ترخيص يسمح بإعادة الاستخدام.': 'المعاينة متاحة؛ لم نتحقق من ترخيص يسمح بالتنزيل.'
      };
    }catch{return null}
  }));
  return details.filter(Boolean).sort((a,b)=>b.matchScore-a.matchScore);
}

async function searchPeerTube(term){
  const instances=['https://peertube.cpy.re','https://peertube2.cpy.re'];
  const batches=await Promise.all(instances.map(async base=>{
    try{
      const data=await smartJson(base+'/api/v1/search/videos?search='+encodeURIComponent(term)+'&count=6&sort=-match&nsfw=false',14000);
      return (data.data||[]).map(v=>{
        const id=v.uuid||v.shortUUID||v.id;
        const embedPath=v.embedPath||'';
        const thumbnailPath=v.thumbnailPath||'';
        const toAbsolute=p=>/^https?:\/\//i.test(p)?p:(p?base+p:null);
        const title=String(v.name||v.title||'فيديو من PeerTube');
        return {
          kind:'video',title,artist:v.channel?.displayName||v.account?.displayName||'',
          description:String(v.description||'').replace(/<[^>]*>/g,' ').slice(0,220),
          matchScore:smartMatchScore(term,title),platform:'PeerTube · '+new URL(base).hostname,
          thumbnail:toAbsolute(thumbnailPath),duration:Number(v.duration)||null,
          url:v.url||base+'/videos/watch/'+id,
          previewUrl:embedPath?toAbsolute(embedPath):(id?base+'/videos/embed/'+id:null),
          downloadable:false,
          note:'معاينة من PeerTube. التنزيل لا يظهر إلا عندما يمكن التحقق من إذن الناشر والترخيص.'
        };
      });
    }catch{return []}
  }));
  const seen=new Set();
  return batches.flat().filter(v=>{const k=v.url||v.title;if(seen.has(k))return false;seen.add(k);return true});
}
async function searchSmartVideo(term){
  const [archive,peer]=await Promise.all([
    searchArchiveVideos(term).catch(()=>[]),
    searchPeerTube(term).catch(()=>[])
  ]);
  return [...archive,...peer].sort((a,b)=>b.matchScore-a.matchScore).slice(0,16);
}


const audioIdentifyUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1}});
app.post('/api/smart/identify-audio',audioIdentifyUpload.single('file'),async(req,res)=>{
  if(!process.env.AUDD_API_TOKEN)return res.status(503).json({error:'ميزة التعرف تحتاج مفتاح AudD. أضف AUDD_API_TOKEN في Render Environment ثم أعد نشر الخادم.',code:'AUDD_NOT_CONFIGURED'});
  if(!req.file)return res.status(400).json({error:'اختر ملفاً صوتياً أو سجّل مقطعاً أولاً.'});
  const mime=String(req.file.mimetype||'').toLowerCase();
  if(!mime.startsWith('audio/')&&!mime.startsWith('video/'))return res.status(415).json({error:'الملف يجب أن يكون صوتاً أو فيديو يحتوي على صوت.'});
  const offset=num(req.body.offset,0,0,86400);
  const work=path.join(os.tmpdir(),'seif-audio-id-'+crypto.randomUUID());
  await fs.promises.mkdir(work,{recursive:true});
  const ext=path.extname(req.file.originalname||'').replace(/[^.a-z0-9]/gi,'').slice(0,10)||'.bin';
  const input=path.join(work,'input'+ext),output=path.join(work,'recognition.mp3');
  try{
    await fs.promises.writeFile(input,req.file.buffer);
    await runFFmpeg(['-ss',String(offset),'-i',input,'-t','12','-vn','-ac','1','-ar','44100','-b:a','128k','-f','mp3',output]);
    const audio=await fs.promises.readFile(output);
    if(!audio.length)throw new Error('لم أستطع استخراج صوت واضح من الملف.');
    const form=new FormData();
    form.append('api_token',process.env.AUDD_API_TOKEN);
    form.append('return','apple_music,spotify,deezer');
    form.append('market','us');
    form.append('file',new Blob([audio],{type:'audio/mpeg'}),'seif-audio-clip.mp3');
    const upstream=await fetch('https://api.audd.io/',{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
    if(!upstream.ok)throw new Error('خدمة التعرف الصوتي غير متاحة مؤقتاً ('+upstream.status+').');
    const payload=await upstream.json();
    if(payload.status!=='success'){
      const code=Number(payload.error?.error_code||payload.error?.code||0);
      if(code===900||code===901)return res.status(502).json({error:'مفتاح AudD غير صالح أو غير مفعّل. راجع AUDD_API_TOKEN في Render.'});
      if(code===400)return res.status(413).json({error:'المقطع الصوتي أكبر من الحد المسموح بعد المعالجة.'});
      if(code===500||code===300)return res.status(422).json({error:'تعذر تحليل هذا التسجيل. جرّب مقطعاً أوضح يحتوي على موسيقى.'});
      return res.status(502).json({error:'خدمة التعرف لم تقبل المقطع. تحقق من إعداد AudD وحاول مجدداً.'});
    }
    const r=payload.result;
    if(!r)return res.json({ok:true,match:null,message:'لم نعثر على تطابق. جرّب مقطعاً أوضح أو اختر جزءاً آخر من الأغنية.'});
    const link=v=>typeof v==='string'&&/^https:\/\/[^ ]+/i.test(v)?v:null;
    res.json({ok:true,match:{
      title:String(r.title||''),
      artist:String(r.artist||''),
      album:String(r.album||''),
      releaseDate:String(r.release_date||''),
      label:String(r.label||''),
      timecode:String(r.timecode||''),
      songUrl:link(r.song_link),
      spotifyUrl:link(r.spotify?.external_urls?.spotify||r.spotify?.url),
      appleMusicUrl:link(r.apple_music?.url),
      deezerUrl:link(r.deezer?.link||r.deezer?.url),
      artwork:link(r.spotify?.album?.images?.[0]?.url||r.apple_music?.artwork?.url||r.apple_music?.artwork_url)
    }});
  }catch(err){
    console.error('[audio-identify]',err.message);
    res.status(422).json({error:err.message||'تعذر التعرف على الأغنية.'});
  }finally{
    await fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{});
  }
});

app.get('/api/smart/search',async(req,res)=>{
  const term=String(req.query.q||'').trim().slice(0,180);
  const type=String(req.query.type||'all');
  if(term.length<2)return res.status(400).json({error:'اكتب كلمتين أو أكثر للبحث.'});
  if(!['all','music','video'].includes(type))return res.status(400).json({error:'نوع البحث غير صالح.'});
  const tasks=[];
  if(type==='all'||type==='music')tasks.push(searchSmartMusic(term).then(results=>({type:'music',results,warnings:[]})).catch(error=>({type:'music',results:[],warning:'تعذر الوصول إلى فهارس الموسيقى الآن.'})));
  if(type==='all'||type==='video')tasks.push(searchSmartVideo(term).then(results=>({type:'video',results})).catch(error=>({type:'video',results:[],warning:'تعذر الوصول إلى أرشيف الفيديو الآن.'})));
  const sections=await Promise.all(tasks);
  res.json({ok:true,query:term,sections,results:sections.flatMap(x=>x.results),warnings:sections.filter(x=>x.warning).map(x=>x.warning)});
});
app.get('/api/smart/archive-audio/:identifier/:fileName',async(req,res)=>{
  const id=String(req.params.identifier||''),name=String(req.params.fileName||'');
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(id)||!/^[A-Za-z0-9._ -]{1,180}\\.(mp3|ogg|oga|flac|wav|m4a)$/i.test(name))return res.status(400).json({error:'اسم الملف الصوتي غير صالح.'});
  try{
    const meta=await smartJson('https://archive.org/metadata/'+encodeURIComponent(id),15000);
    if(!smartLicenseAllowed(meta))return res.status(403).json({error:'لم يثبت أن ترخيص هذا الملف يسمح بالتنزيل.'});
    const file=(meta.files||[]).find(f=>f.name===name&&f.source==='original');
    if(!file)return res.status(404).json({error:'الملف الصوتي غير موجود.'});
    const upstream=await fetch('https://archive.org/download/'+encodeURIComponent(id)+'/'+encodeURIComponent(name),{redirect:'follow',signal:AbortSignal.timeout(120000)});
    if(!upstream.ok||!upstream.body)throw new Error('تعذر جلب الملف الصوتي.');
    const {Readable}=require('node:stream');
    res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/octet-stream');
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));
    if(upstream.headers.get('content-length'))res.setHeader('Content-Length',upstream.headers.get('content-length'));
    Readable.fromWeb(upstream.body).pipe(res);
  }catch(err){if(!res.headersSent)res.status(422).json({error:err.message||'تعذر تنزيل الملف الصوتي.'});}
});
app.get('/api/smart/archive/:identifier/:fileName',async(req,res)=>{
  const id=String(req.params.identifier||''),name=String(req.params.fileName||'');
  if(!/^[A-Za-z0-9._-]{1,80}$/.test(id)||!/^[A-Za-z0-9._ -]{1,180}\.(mp4|webm|m4v|mov|mpeg|mpg|ogv)$/i.test(name))return res.status(400).json({error:'اسم الملف غير صالح.'});
  try{
    const meta=await smartJson('https://archive.org/metadata/'+encodeURIComponent(id),15000);
    if(!smartLicenseAllowed(meta))return res.status(403).json({error:'لم يثبت أن ترخيص هذا الملف يسمح بالتنزيل.'});
    const file=(meta.files||[]).find(f=>f.name===name&&f.source==='original');
    if(!file)return res.status(404).json({error:'الملف غير موجود ضمن العنصر المحدد.'});
    const upstream=await fetch('https://archive.org/download/'+encodeURIComponent(id)+'/'+encodeURIComponent(name),{redirect:'follow',signal:AbortSignal.timeout(120000)});
    if(!upstream.ok||!upstream.body)throw new Error('تعذر جلب الملف من الأرشيف.');
    const {Readable}=require('node:stream');
    res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/octet-stream');
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));
    if(upstream.headers.get('content-length'))res.setHeader('Content-Length',upstream.headers.get('content-length'));
    Readable.fromWeb(upstream.body).pipe(res);
  }catch(err){if(!res.headersSent)res.status(422).json({error:err.message||'تعذر تنزيل الملف.'});}
});


const supportedHosts=['youtube.com','youtu.be','youtube-nocookie.com','tiktok.com','instagram.com','x.com','twitter.com','facebook.com','fb.watch','twitch.tv','dailymotion.com','dai.ly'];
function checkedMediaUrl(raw){
  let u;try{u=new URL(raw)}catch{throw new Error('الرابط غير صالح.')}
  if(!['http:','https:'].includes(u.protocol))throw new Error('يسمح بروابط HTTP و HTTPS فقط.');
  const host=u.hostname.toLowerCase();
  if(!supportedHosts.some(d=>host===d||host.endsWith('.'+d)))throw new Error('هذه المنصة غير مدعومة حالياً.');
  if(u.username||u.password)throw new Error('الروابط التي تتضمن بيانات دخول غير مسموحة.');
  return u.toString();
}
// Optional authenticated source access. Render Secret Files may be Netscape
// or a JSON cookie export; JSON is converted locally and never logged or committed.
let ytCookiesPath=null;
function jsonCookiesToNetscape(contents){
  let cookies;
  try{cookies=JSON.parse(contents);}catch{throw new Error('ملف YouTube Cookies ليس JSON صالحاً ولا بصيغة Netscape.');}
  if(!Array.isArray(cookies)||!cookies.length)throw new Error('ملف JSON لا يحتوي على قائمة Cookies صالحة.');
  const lines=['# Netscape HTTP Cookie File'];
  for(const c of cookies){
    if(!c||typeof c!=='object'||typeof c.name!=='string'||typeof c.value!=='string'||typeof c.domain!=='string')continue;
    const domain=c.domain.trim();
    const cookiePath=typeof c.path==='string'&&c.path.startsWith('/')?c.path:'/';
    if(!domain||/[\t\r\n]/.test(domain)||/[\t\r\n]/.test(c.name)||/[\t\r\n]/.test(c.value)||/[\t\r\n]/.test(cookiePath))continue;
    const includeSubdomains=c.hostOnly===true?'FALSE':'TRUE';
    const secure=c.secure===true?'TRUE':'FALSE';
    const expires=c.session===true?0:Math.max(0,Math.floor(Number(c.expirationDate)||0));
    const httpOnly=c.httpOnly===true;
    const cookieDomain=(httpOnly?'#HttpOnly_':'')+domain;
    lines.push([cookieDomain,includeSubdomains,cookiePath,secure,String(expires),c.name,c.value].join('\t'));
  }
  if(lines.length===1)throw new Error('لم نعثر على Cookies قابلة للتحويل داخل ملف JSON.');
  return lines.join('\n')+'\n';
}
function getYtDlpCookieArgs(){
  if(!ytCookiesPath){
    const configured=process.env.YT_COOKIES_FILE;
    // A stale/incorrect override must not disable Render's standard Secret File
    // locations. Prefer the explicit path, then known mounts, then Base64.
    const candidates=[configured,'/etc/secrets/youtube-cookies.txt','/etc/secrets/cookies.json.txt'].filter(Boolean);
    const secretFile=[...new Set(candidates)].find(file=>{
      try{return fs.statSync(file).isFile()&&fs.statSync(file).size>0;}catch{return false;}
    });
    let contents='';
    if(secretFile){
      const stat=fs.statSync(secretFile);
      if(!stat.isFile()||stat.size<1||stat.size>2_000_000)throw new Error('ملف YouTube Cookies غير صالح أو حجمه أكبر من الحد المسموح.');
      contents=fs.readFileSync(secretFile,'utf8');
    }else{
      const encoded=process.env.YT_COOKIES_BASE64;
      if(!encoded)return [];
      const decoded=Buffer.from(encoded,'base64');
      if(!decoded.length||decoded.length>2_000_000)throw new Error('إعداد Cookies غير صالح أو حجمه أكبر من الحد المسموح.');
      contents=decoded.toString('utf8');
    }
    if(contents.includes('# Netscape HTTP Cookie File')||contents.includes('# HTTP Cookie File')){
      // Render Secret Files are read-only. yt-dlp may rewrite its cookie jar
      // on shutdown, so always give it a private writable temporary copy.
      ytCookiesPath=path.join(os.tmpdir(),'seif-ytdlp-cookies-'+process.pid+'.txt');
      fs.writeFileSync(ytCookiesPath,contents,{mode:0o600});
    }else{
      const netscape=jsonCookiesToNetscape(contents);
      ytCookiesPath=path.join(os.tmpdir(),'seif-ytdlp-cookies-'+process.pid+'.txt');
      fs.writeFileSync(ytCookiesPath,netscape,{mode:0o600});
    }
  }
  return ['--cookies',ytCookiesPath];
}
function runYtDlp(args,{maxOutput=2_000_000,timeoutMs=60_000,onProgress}={}){
  return new Promise((resolve,reject)=>{
    let authArgs;
    // Apply the user's YouTube session only to YouTube URLs. Other platforms
    // must remain independent from YouTube authentication and cookie failures.
    const targetUrl=args.find(x=>typeof x==='string'&&/^https?:\/\//i.test(x));
    const isYouTube=targetUrl&&(()=>{try{const h=new URL(targetUrl).hostname.toLowerCase();return h==='youtube.com'||h.endsWith('.youtube.com')||h==='youtu.be'||h.endsWith('.youtu.be')||h==='youtube-nocookie.com'||h.endsWith('.youtube-nocookie.com')}catch{return false}})();
    try{authArgs=isYouTube?getYtDlpCookieArgs():[]}catch(err){reject(err);return}
    const youtubeProviderArgs=isYouTube?['--extractor-args','youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416']:[];
    // Let current yt-dlp select the appropriate player clients automatically.
    // This is important for music.youtube.com, where forcing mweb can suppress
    // yt-dlp's dedicated web_music client selection.
    const p=spawn(process.env.YTDLP_PATH||'yt-dlp',['--ignore-config','--socket-timeout','8','--retries','1','--extractor-retries','1',...authArgs,...youtubeProviderArgs,...args],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',settled=false;
    const finish=(err,value)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(err)reject(err);else resolve(value);
    };
    const timer=setTimeout(()=>{
      p.kill('SIGKILL');
      finish(new Error('انتهت مهلة الاتصال بالمصدر. جرّب الرابط لاحقاً أو تحقق من أن الفيديو متاح للعامة.'));
    },timeoutMs);
    p.stdout.on('data',d=>{
      stdout+=d.toString();
      if(stdout.length>maxOutput){
        p.kill('SIGKILL');
        finish(new Error('استجابة المصدر كبيرة جداً.'));
      }
    });
    p.stderr.on('data',d=>{
      const chunk=d.toString();
      stderr+=chunk;if(stderr.length>12000)stderr=stderr.slice(-12000);
      if(typeof onProgress==='function'){
        for(const line of chunk.split(/\r?\n/)){
          const m=line.match(/SEIF_PROGRESS:\s*([\d.]+)%\|([^|]*)\|([^|\r\n]*)/);
          if(m)onProgress({percent:Math.max(0,Math.min(100,Number(m[1])||0)),speed:m[2].trim(),eta:m[3].trim()});
        }
      }
    });
    p.on('error',err=>finish(err));
    p.on('close',code=>{
      if(code===0)finish(null,stdout.trim());
      else finish(new Error(stderr.trim().slice(-1300)||'تعذر جلب الوسائط من المصدر.'));
    });
  });
}
function mediaSummary(info){
  const fs=Array.isArray(info.formats)?info.formats:[];
  const imageExts=new Set(['jpg','jpeg','png','webp','gif','avif']);
  const imageFormats=fs.filter(x=>imageExts.has(String(x.ext||'').toLowerCase()));
  const maxHeight=Math.max(0,...fs.map(x=>Number(x.height)||0));
  const hasVideo=fs.some(x=>x.vcodec&&x.vcodec!=='none');
  const hasAudio=fs.some(x=>x.acodec&&x.acodec!=='none');
  const imageOnly=(imageFormats.length>0||imageExts.has(String(info.ext||'').toLowerCase()))&&!hasVideo;
  return {
    title:info.title||info.fulltitle||'وسائط من المصدر',
    platform:info.extractor_key||info.extractor||'مصدر معروف',
    thumbnail:info.thumbnail||((info.thumbnails||[]).slice(-1)[0]||{}).url||null,
    duration:Number(info.duration)||null,
    mediaType:imageOnly?'image':hasVideo?'video':hasAudio?'audio':'unknown',
    maxHeight,
    formats:[{value:'best',label:'أفضل جودة متاحة'}]
      .concat([2160,1440,1080,720,480,360].filter(h=>maxHeight>=h).map(h=>({value:String(h),label:h+'p'})))
  };
}
app.post('/api/media/inspect',async(req,res)=>{
  try{
    const url=checkedMediaUrl(req.body&&req.body.url);
    const raw=await runYtDlp(['--dump-single-json','--skip-download','--no-warnings','--no-progress','--no-playlist',url],{timeoutMs:20_000});
    const info=JSON.parse(raw);
    res.json({ok:true,...mediaSummary(info)});
  }catch(err){res.status(422).json({error:err.message||'تعذر تحليل الرابط.'});}
});
const qualitySelectors={best:'bestvideo*+bestaudio/best','2160':'bestvideo*[height<=2160]+bestaudio/best[height<=2160]','1440':'bestvideo*[height<=1440]+bestaudio/best[height<=1440]','1080':'bestvideo*[height<=1080]+bestaudio/best[height<=1080]','720':'bestvideo*[height<=720]+bestaudio/best[height<=720]','480':'bestvideo*[height<=480]+bestaudio/best[height<=480]','360':'bestvideo*[height<=360]+bestaudio/best[height<=360]','audio':'bestaudio/best','mp4':'bestvideo*+bestaudio/best','mp4_2160':'bestvideo*[height<=2160]+bestaudio/best[height<=2160]','mp4_1440':'bestvideo*[height<=1440]+bestaudio/best[height<=1440]','mp4_1080':'bestvideo*[height<=1080]+bestaudio/best[height<=1080]','mp4_720':'bestvideo*[height<=720]+bestaudio/best[height<=720]','mp4_480':'bestvideo*[height<=480]+bestaudio/best[height<=480]','mp4_360':'bestvideo*[height<=360]+bestaudio/best[height<=360]'};
const mediaJobs=new Map();
// Process one media download at a time to protect the service from overload.
// Jobs remain on the server if the browser tab is closed.
const mediaJobQueue=[];
let activeMediaWorkers=0;
function enqueueMediaJob(job,runner){
  job.status='queued';
  job.stage='في قائمة الانتظار';
  mediaJobQueue.push({job,runner});
  pumpMediaJobQueue();
}
function pumpMediaJobQueue(){
  while(activeMediaWorkers<1&&mediaJobQueue.length){
    const item=mediaJobQueue.shift();
    activeMediaWorkers++;
    item.job.status='processing';
    Promise.resolve().then(item.runner).finally(()=>{
      activeMediaWorkers=Math.max(0,activeMediaWorkers-1);
      pumpMediaJobQueue();
    });
  }
}
app.post('/api/media/download-jobs',async(req,res)=>{
  let url,quality,work;
  try{url=checkedMediaUrl(req.body&&req.body.url);quality=String(req.body&&req.body.quality||'best');}
  catch(err){return res.status(400).json({error:err.message||'رابط غير صالح.'});}
  const format=qualitySelectors[quality]||qualitySelectors.best;
  const id=crypto.randomUUID();
  const job={id,status:'queued',stage:'في قائمة الانتظار',percent:null,speed:'',eta:'',createdAt:Date.now(),filePath:null,fileName:null,size:0,error:null};
  mediaJobs.set(id,job);
  res.status(202).json({ok:true,jobId:id});
  enqueueMediaJob(job,async()=>{
    try{
      work=path.join(os.tmpdir(),'seif-media-job-'+id);
      await fs.promises.mkdir(work,{recursive:true});
      const template=path.join(work,'%(title).90B-%(id)s.%(ext)s');
      const downloadArgs=['--no-warnings','--no-colors','--newline','--progress','--progress-template','download:SEIF_PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s','--no-playlist','--no-part','--format',format,'--output',template,'--print','after_move:filepath'];
      if(quality==='audio')downloadArgs.push('--extract-audio','--audio-format','mp3','--audio-quality','0');else if(quality==='mp4'||quality.startsWith('mp4_'))downloadArgs.push('--recode-video','mp4');
      job.stage='يتصل بالمصدر ويجهّز الفيديو';
      await runYtDlp([...downloadArgs,url],{maxOutput:100000,timeoutMs:2*60*60_000,onProgress:p=>{job.stage='جارٍ تنزيل الوسائط من المصدر';job.percent=p.percent;job.speed=p.speed;job.eta=p.eta;job.updatedAt=Date.now();}});
      const names=await fs.promises.readdir(work);
      if(!names.length)throw new Error('لم يُنشئ المصدر ملفاً قابلاً للتنزيل.');
      const file=path.join(work,names[0]),stat=await fs.promises.stat(file);
      if(!stat.isFile())throw new Error('الملف الناتج غير صالح.');
      job.filePath=file;job.fileName=safeBase(path.parse(file).name)+path.extname(file).toLowerCase();job.size=stat.size;job.percent=100;job.stage='اكتمل تجهيز الملف';job.status='ready';job.updatedAt=Date.now();
    }catch(err){
      job.status='failed';job.error=err.message||'تعذر تنزيل الوسائط.';job.stage='فشل التنزيل';job.updatedAt=Date.now();
      if(work)await fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{});
    }
  });
  const expiry=setTimeout(async()=>{const j=mediaJobs.get(id);if(j){if(work)await fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{});mediaJobs.delete(id);}},24*60*60_000);
  expiry.unref?.();
});
app.get('/api/media/download-jobs/:id', (req,res)=>{
  const job=mediaJobs.get(req.params.id);
  if(!job)return res.status(404).json({error:'انتهت صلاحية طلب التنزيل أو لم يتم العثور عليه.'});
  res.json({ok:true,status:job.status,stage:job.stage,percent:job.percent,speed:job.speed,eta:job.eta,size:job.size,error:job.error});
});
app.get('/api/media/download-jobs/:id/file',async(req,res)=>{
  const job=mediaJobs.get(req.params.id);
  if(!job||job.status!=='ready'||!job.filePath)return res.status(409).json({error:'الملف لم يجهز بعد.'});
  const filePath=job.filePath;
  res.download(filePath,job.fileName,async err=>{
    if(err&&!res.headersSent)res.status(500).end();
    const current=mediaJobs.get(req.params.id);
    if(current){current.status='completed';mediaJobs.delete(req.params.id);}
    const dir=path.dirname(filePath);
    await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{});
  });
});
app.get('/api/media/download',async(req,res)=>{
  let work;
  try{
    const url=checkedMediaUrl(req.query.url);
    const quality=String(req.query.quality||'best');
    const format=qualitySelectors[quality]||qualitySelectors.best;
    work=path.join(os.tmpdir(),'seif-media-'+crypto.randomUUID());
    await fs.promises.mkdir(work,{recursive:true});
    const template=path.join(work,'%(title).90B-%(id)s.%(ext)s');
    const downloadArgs=['--no-warnings','--no-progress','--no-playlist','--no-part','--format',format,'--output',template,'--print','after_move:filepath'];
    if(quality==='audio')downloadArgs.push('--extract-audio','--audio-format','mp3','--audio-quality','0');else if(quality==='mp4'||quality.startsWith('mp4_'))downloadArgs.push('--recode-video','mp4');
    await runYtDlp([...downloadArgs,url],{maxOutput:100000,timeoutMs:10*60_000});
    const names=await fs.promises.readdir(work);
    if(!names.length)throw new Error('لم يُنشئ المصدر ملفاً قابلاً للتنزيل.');
    const file=path.join(work,names[0]);
    const stat=await fs.promises.stat(file);
    if(!stat.isFile())throw new Error('الملف الناتج غير صالح.');
    const ext=path.extname(file).toLowerCase();
    const mime=({'.mp4':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.m4a':'audio/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'})[ext]||'application/octet-stream';
    res.setHeader('Content-Type',mime);
    res.setHeader('Content-Length',stat.size);
    const downloadName=safeBase(path.parse(file).name)+ext;
    res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(downloadName));
    const stream=fs.createReadStream(file);
    stream.on('error',()=>{if(!res.headersSent)res.status(500).end();});
    stream.on('close',()=>fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{}));
    stream.pipe(res);
  }catch(err){
    if(work)await fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{});
    if(!res.headersSent)res.status(422).json({error:err.message||'تعذر تنزيل الوسائط.'});
  }
});


function runFFmpeg(args){return new Promise((resolve,reject)=>{const p=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',d=>err+=d.toString());p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error(err.slice(-1800)||'FFmpeg failed')));});}
function safeBase(s){return String(s||'seif-output').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,90)||'seif-output';}
function num(v,fallback,min,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
const formats=new Set(['mp4','webm','mkv','mp3','wav','m4a']);
app.post('/api/process/:action',upload.single('file'),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:'A file is required.'});
  const action=req.params.action;
  if(!['trim','audio','convert','compress','gif'].includes(action))return res.status(404).json({error:'Unknown processing action.'});
  const work=path.join(os.tmpdir(),'seif-convertisser-'+crypto.randomUUID());
  await fs.promises.mkdir(work,{recursive:true});
  const input=path.join(work,'input'+(path.extname(req.file.originalname)||'.bin'));
  const outputExt=action==='audio'?(req.body.format||'mp3'):action==='gif'?'gif':action==='trim'?'mp4':action==='compress'?'mp4':(req.body.format||'mp4');
  if(!formats.has(outputExt)&&outputExt!=='gif'){await fs.promises.rm(work,{recursive:true,force:true});return res.status(400).json({error:'Unsupported output format.'});}
  const output=path.join(work,'output.'+outputExt);
  try{
    await fs.promises.writeFile(input,req.file.buffer);
    let args=[];
    if(action==='trim'){
      const start=num(req.body.start,0,0,86400),end=num(req.body.end,0,0,86400);
      if(end<=start)throw new Error('End time must be greater than start time.');
      args=['-ss',String(start),'-i',input,'-t',String(end-start),'-map','0:v:0?','-map','0:a:0?','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-movflags','+faststart',output];
    }else if(action==='audio'){
      const format=['mp3','wav','m4a'].includes(req.body.format)?req.body.format:'mp3';
      const bitrate=['128k','192k','320k'].includes(req.body.bitrate)?req.body.bitrate:'320k';
      args=['-i',input,'-vn'];
      if(format==='mp3')args.push('-c:a','libmp3lame','-b:a',bitrate);
      if(format==='wav')args.push('-c:a','pcm_s16le');
      if(format==='m4a')args.push('-c:a','aac','-b:a',bitrate);
      args.push(output);
    }else if(action==='convert'){
      const format=formats.has(req.body.format)?req.body.format:'mp4';
      if(format==='mp3')args=['-i',input,'-vn','-c:a','libmp3lame','-b:a','192k',output];
      else if(format==='wav')args=['-i',input,'-vn','-c:a','pcm_s16le',output];
      else if(format==='m4a')args=['-i',input,'-vn','-c:a','aac','-b:a','192k',output];
      else args=['-i',input,'-c:v',format==='webm'?'libvpx-vp9':'libx264','-crf',format==='webm'?'32':'21','-c:a',format==='webm'?'libopus':'aac',output];
    }else if(action==='compress'){
      const level=req.body.level;
      const crf=level==='high'?'31':level==='light'?'23':'27';
      args=['-i',input,'-c:v','libx264','-preset','medium','-crf',crf,'-c:a','aac','-b:a','128k','-movflags','+faststart',output];
    }else if(action==='gif'){
      const start=num(req.body.start,0,0,86400),duration=num(req.body.duration,3,.5,20);
      args=['-ss',String(start),'-t',String(duration),'-i',input,'-filter_complex','[0:v]fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse','-loop','0',output];
    }
    await runFFmpeg(args);
    const stat=await fs.promises.stat(output);
    const downloadName=safeBase(req.body.name||path.parse(req.file.originalname).name)+'-seif.'+outputExt;
    res.setHeader('Content-Type',outputExt==='gif'?'image/gif':outputExt==='mp3'?'audio/mpeg':outputExt==='wav'?'audio/wav':outputExt==='m4a'?'audio/mp4':'application/octet-stream');
    res.setHeader('Content-Disposition','attachment; filename="'+downloadName.replace(/"/g,'')+'"');
    res.setHeader('Content-Length',stat.size);
    const stream=fs.createReadStream(output);
    stream.on('error',()=>{if(!res.headersSent)res.status(500).end();});
    stream.on('close',()=>fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{}));
    stream.pipe(res);
  }catch(err){
    await fs.promises.rm(work,{recursive:true,force:true});
    res.status(422).json({error:err.message||'Processing failed.'});
  }
});
app.use((err,req,res,next)=>{if(err instanceof multer.MulterError)return res.status(413).json({error:'Upload too large or invalid.'});res.status(500).json({error:err.message||'Server error.'});});
async function startServer(){
  // Wait for the local token provider before accepting media requests.
  for(let attempt=0;attempt<30;attempt++){
    try{
      const response=await fetch('http://127.0.0.1:4416/ping',{signal:AbortSignal.timeout(1500)});
      if(response.ok){potProviderReady=true;break;}
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  app.listen(PORT,()=>console.log('SEIF CONVERTISSER API listening on '+PORT));
}
startServer().catch(err=>{console.error('Server startup failed:',err);process.exit(1);});
