import {readdir,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,basename} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root='.source-archive/listening-20261001';
await mkdir(root,{recursive:true});
const base='D:/BaiduNetdiskDownload/九分达人阅读+听力全套/9分达人-听力1-7';
const pdfs=[...['100句翻译.pdf','100句翻译 -答案.pdf'].map(n=>'D:/BaiduNetdiskDownload/句子翻译练习/'+n),...[1,2,3,5,7].map(n=>`${base}/【听力${n}】9分达人听力真题还原及解析${n}.pdf`)];
const digest=async p=>{const h=createHash('sha256');for await(const c of createReadStream(p))h.update(c);return h.digest('hex');};
const old=JSON.parse(await readFile('.source-archive/source-catalog.json','utf8')).documents;
const inventory=[];
for(const path of pdfs){const sha256=await digest(path);const info=await stat(path);const match=old.find(d=>d.sha256===sha256);const {stdout}=await run('mineru',['parse',path,'--tier','standard','--pages','all','--no-wait','--limit','100','--json'],{windowsHide:true,timeout:60000,maxBuffer:2e6});const parsed=JSON.parse(stdout);await writeFile(join(root,sha256+'.parse.json'),stdout);inventory.push({path,name:basename(path),bytes:info.size,sha256,existingDocumentId:match?.id??null,parse:parsed.parse,error:parsed.error??null});console.log(basename(path)+': '+(parsed.parse?.status??JSON.stringify(parsed.error)));}
const audio=[];async function walk(dir,book){for(const f of await readdir(dir,{withFileTypes:true})){const path=join(dir,f.name);if(f.isDirectory())await walk(path,book);else if(/\.mp3$/i.test(f.name)){const label=path.replace(/\\/g,'/');const test=Number(label.match(/test\s*(\d+)/i)?.[1]??label.match(/\/T(\d+)\//i)?.[1]);const section=Number(label.match(/(?:section|part)\s*(\d+)/i)?.[1]);audio.push({path,name:f.name,book,test,section,bytes:(await stat(path)).size,sha256:await digest(path),pairingStatus:'filename_only_unverified'});}}}
for(let book=1;book<=7;book++)await walk(join(base,'听力音频mp3格式','九分达人'+book),book);
const missing=[];for(let book=1;book<=7;book++)for(let test=1;test<=6;test++)for(let section=1;section<=4;section++)if(!audio.some(a=>a.book===book&&a.test===test&&a.section===section))missing.push({book,test,section});
await writeFile(join(root,'inventory.json'),JSON.stringify({createdAt:new Date().toISOString(),releasePolicy:'local_only',pdfs:inventory,audio,missing,booksWithoutPdf:[4,6]},null,2));
console.log(JSON.stringify({pdfs:inventory.length,audio:audio.length,missing,audioBytes:audio.reduce((n,a)=>n+a.bytes,0)}));
