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
app.get('/api/search',(req,res)=>res.status(501).json({error:'Search connectors are not configured. Add approved platform search providers before enabling live results.'}));

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
    const candidates=configured?[configured]:['/etc/secrets/youtube-cookies.txt','/etc/secrets/cookies.json.txt'];
    let secretFile=candidates.find(file=>fs.existsSync(file));
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
function runYtDlp(args,{maxOutput=2_000_000,timeoutMs=60_000}={}){
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
    p.stderr.on('data',d=>{stderr+=d.toString();if(stderr.length>12000)stderr=stderr.slice(-12000);});
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
const qualitySelectors={best:'bestvideo*+bestaudio/best','2160':'bestvideo*[height<=2160]+bestaudio/best[height<=2160]','1440':'bestvideo*[height<=1440]+bestaudio/best[height<=1440]','1080':'bestvideo*[height<=1080]+bestaudio/best[height<=1080]','720':'bestvideo*[height<=720]+bestaudio/best[height<=720]','480':'bestvideo*[height<=480]+bestaudio/best[height<=480]','360':'bestvideo*[height<=360]+bestaudio/best[height<=360]','audio':'bestaudio/best'};
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
    if(quality==='audio')downloadArgs.push('--extract-audio','--audio-format','mp3','--audio-quality','0');
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
