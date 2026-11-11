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

const app=express();
const PORT=process.env.PORT||8080;
const MAX_UPLOAD_MB=Number(process.env.MAX_UPLOAD_MB||500);
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(cors({origin:(origin,cb)=>{if(!origin||!allowedOrigins.length||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('Origin not allowed'));}}));
app.use(express.json({limit:'1mb'}));
app.use('/api/',rateLimit({windowMs:60_000,limit:30,standardHeaders:true,legacyHeaders:false}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_UPLOAD_MB*1024*1024,files:1}});

app.get('/health',(req,res)=>res.json({ok:true,service:'SEIF CONVERTISSER API',ffmpeg:'configured-at-runtime'}));
app.get('/api/search',(req,res)=>res.status(501).json({error:'Search connectors are not configured. Add approved platform search providers before enabling live results.'}));

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
      args=['-ss',String(start),'-t',String(duration),'-i',input,'-vf','fps=12,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse','-loop','0',output];
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
app.listen(PORT,()=>console.log('SEIF CONVERTISSER API listening on '+PORT));
