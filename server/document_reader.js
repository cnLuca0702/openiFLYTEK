// Local parsing/rendering only. No document macros, shell interpolation or remote resources.
import { Worker } from 'node:worker_threads';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
const exec = promisify(execFile);
export const DOCUMENT_EXTENSIONS = ['pdf','pptx','ppt','docx','doc','txt','md','csv','xlsx','png','jpg','jpeg','webp'];
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_PAGES = 200;
const columnName = index => {let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
function check(pages) {
  if (!pages.length || pages.length > MAX_PAGES || pages.reduce((n,p) => n + p.text.length,0) > 2000000) throw new Error('文件为空或超出处理上限（200页 / 200万字），请拆分文件');
  return pages;
}
async function officePdf(file, dir) {
  const candidates = [process.env.VIAIM_LIBREOFFICE, '/Applications/LibreOffice.app/Contents/MacOS/soffice', 'libreoffice'].filter(Boolean);
  for (const bin of candidates) {
    try {
      await exec(bin, [`-env:UserInstallation=file://${path.join(dir,'office-profile')}`, '--headless','--convert-to','pdf','--outdir',dir,file], {timeout:120000,maxBuffer:1024*1024});
      const pdf = path.join(dir, path.basename(file,path.extname(file))+'.pdf');
      await fs.access(pdf); return pdf;
    } catch (e) { if (e.code !== 'ENOENT') throw new Error('Office 转换失败：文件可能加密、损坏或格式不受支持'); }
  }
  throw new Error('等待 LibreOffice：PPT/PPTX/DOC 需要本机安装 LibreOffice 才能完整渲染；安装后将自动重试');
}
export function readDocumentIsolated(file,ext,dir) {
  return new Promise((resolve,reject)=> {
    const worker=new Worker(new URL('./document_worker.js',import.meta.url),{workerData:{file,ext,dir},resourceLimits:{maxOldGenerationSizeMb:512}});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('文件解析超时，请拆分后上传'));},180000);
    worker.once('message',message=>{clearTimeout(timer);void worker.terminate();message.error?reject(new Error(message.error)):resolve(message.pages);});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('文件解析进程退出，将自动重试'));});
  });
}
export async function readDocument(file, ext, dir) {
  let zip;
  if(['pptx','docx','xlsx'].includes(ext)) {
    zip=await JSZip.loadAsync(await fs.readFile(file));
    const entries=Object.values(zip.files);
    if(entries.length>20000||entries.reduce((n,e)=>n+(e._data?.uncompressedSize||0),0)>200*1024*1024)throw new Error('文件解压后超出处理上限，请拆分');
  }
  const notes=new Map();let slideOrder=[];
  if(ext==='pptx') {
    const presentation=await zip.file('ppt/presentation.xml')?.async('string');
    const rels=await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
    const targets=new Map((rels?.match(/<Relationship\s[^>]*>/g)||[]).map(r=>[/Id="([^"]+)"/.exec(r)?.[1],/Target="([^"]+)"/.exec(r)?.[1]]));
    slideOrder=[...(presentation||'').matchAll(/<p:sldId\s[^>]*r:id="([^"]+)"/g)].map(m=>Number(/slide(\d+)\.xml$/.exec(targets.get(m[1])||'')?.[1]));
    // Resolve each slide's notes relation; note file numbering need not match slide numbering.
    for(const [name,entry] of Object.entries(zip.files)) {
      const match=/^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/.exec(name);if(!match)continue;
      const relationships=await entry.async('string');
      for(const relation of relationships.match(/<Relationship\s[^>]*>/g)||[]) {
        if(!/notesSlide/.test(relation)||/TargetMode="External"/.test(relation))continue;
        const target=/Target="([^"]+)"/.exec(relation)?.[1];if(!target)continue;
        const part=zip.file(path.posix.normalize(path.posix.join('ppt/slides',target)));if(!part)continue;
        const xml=await part.async('string');
        const text=[...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(m=>m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')).join(' ');
        notes.set(Number(match[1]),text.slice(0,20000));
      }
    }
  }
  if (['ppt','pptx','doc'].includes(ext)) file = await officePdf(file,dir);
  if (['pdf','ppt','pptx','doc'].includes(ext)) {
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({data:new Uint8Array(await fs.readFile(file)), isEvalSupported:false, useSystemFonts:true});
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > MAX_PAGES) throw new Error('文件超过200页，请拆分后上传');
      const pages=[];
      for(let i=1;i<=pdf.numPages;i++) {
        const page=await pdf.getPage(i), base=page.getViewport({scale:1});
        const viewport=page.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;
        const image=`page-${i}.png`; await fs.writeFile(path.join(dir,image),canvas.toBuffer('image/png'),{mode:0o600});
        const text=(await page.getTextContent()).items.map(x=>x.str||'').join(' ');
        pages.push({number:i,label:`${['ppt','pptx'].includes(ext)?'幻灯片':'第'} ${i} 页`,text,image,notes:notes.get(slideOrder[i-1]||i)||''}); page.cleanup();
      }
      return check(pages);
    } finally { await loading.destroy(); }
  }
  if (['png','jpg','jpeg','webp'].includes(ext)) {
    const img=await loadImage(file); const scale=Math.min(1,1800/Math.max(img.width,img.height));
    const canvas=createCanvas(Math.ceil(img.width*scale),Math.ceil(img.height*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    await fs.writeFile(path.join(dir,'page-1.png'),canvas.toBuffer('image/png'),{mode:0o600});
    return [{number:1,label:'图片 1',text:'',image:'page-1.png'}];
  }
  if(ext==='xlsx'||ext==='csv') {
    const pages=[];
    const add=(name,rows)=> { for(let i=0;i<rows.length;i+=30) pages.push({number:pages.length+1,label:`${name} · 第${i+1}–${Math.min(i+30,rows.length)}行`,text:rows.slice(i,i+30).map((row,j)=>`${i+j+1}: ${row.map((v,k)=>`${columnName(k)}${i+j+1}=${v??''}`).join(' | ')}`).join('\n')}); };
    if(ext==='csv') add('CSV',parse(await fs.readFile(file,'utf8'),{bom:true,relax_column_count:true,skip_empty_lines:true}));
    else { const workbook=new ExcelJS.Workbook(); await workbook.xlsx.readFile(file); workbook.eachSheet(sheet=> {const rows=[];sheet.eachRow({includeEmpty:true},row=>rows.push(row.values.slice(1).map(v=>typeof v==='object'?JSON.stringify(v):v)));add(sheet.name,rows);}); }
    return check(pages);
  }
  const text=ext==='docx'?(await mammoth.extractRawText({path:file})).value:new TextDecoder('utf-8',{fatal:true}).decode(await fs.readFile(file));
  const parts=text.trim().match(/[\s\S]{1,4000}/g)||[];
  return check(parts.map((text,i)=>({number:i+1,label:`段落组 ${i+1}`,text})));
}
