import {clamp,approach,sceneState} from './motion.js';
import {createOptics} from './optics.js';
import {resolveParameters} from './parameters.js';

export function validateConfig(c){
 resolveParameters(c.parameters,c.preset,c.frame);
 if(c.version!==1||!Array.isArray(c.size)||c.size.length!==2||c.size.some(n=>!Number.isInteger(n)||n<1||n>32000)) throw new Error('Invalid card size/version');
 if(!['subtle','rainbow','pearl','cosmic','metal'].includes(c.material)) throw new Error('Invalid material');
 for(const [name,max] of [['depth',1.25],['foil',1]]) if(!Number.isFinite(c[name])||c[name]<0||c[name]>max)throw new Error('Invalid '+name);
 if(typeof c.motion!=='boolean'||typeof c.frame!=='boolean')throw new Error('Invalid motion/frame');
 if(!Array.isArray(c.layers)||!c.layers.length||c.layers.length>4)throw new Error('Invalid layers');
 const seen=new Set(['background']);let previous=-1,main=0,accent=0,occluder=0;
 for(const l of c.layers){
  const rank=['midground','main','foreground_occluder','accent'].indexOf(l.role);
  if(rank<previous||rank<0||seen.has(l.id)||!seen.has(l.receiver)||!/^[a-z][a-z0-9-]{0,39}$/.test(l.id))throw new Error('Invalid layer order/id/receiver');
  if(l.role==='main'){main++;if(l.id!=='subject')throw new Error('Invalid main id');}
  if(l.role==='accent'){accent++;if(l.id!=='foreground-accent')throw new Error('Invalid accent id');}
  if(l.role==='foreground_occluder'){
   occluder++;
   const o=l.occlusion,r=o?.safeMotionRange;
   if(l.id!=='foreground-occluder'||l.receiver!=='subject'||!o||!r||
      !Number.isFinite(o.desiredParallax)||o.desiredParallax<1||o.desiredParallax>1.2||
      r.units!=='source-px'||r.proof!=='opaque-coverage-chebyshev'||
      ![r.x,r.y].every(n=>Number.isFinite(n)&&n>=0)||r.lift!==0||o.finalParallax?.lift!==0||
      !o.receiverSource||![o.finalParallax?.x,o.finalParallax?.y].every(Number.isFinite)||
      (o.fill!=='none'&&(!o.fill?.image||!o.fill?.protectedMask||!o.fill?.review))||
      Math.abs(o.finalParallax?.x-Math.min(1.45*c.depth*(o.desiredParallax-1),r.x/c.size[0]*100))>1e-9||
      Math.abs(o.finalParallax?.y-Math.min(1.25*c.depth*(o.desiredParallax-1),r.y/c.size[1]*100))>1e-9||
      !['identity-sensitive','semantic-sensitive','low-detail'].includes(o.occlusionRisk))throw new Error('Invalid/unproven occluder motion bounds');
  }
  if(l.clip!==undefined){const [x,y,w,h]=l.clip||[];if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<=0||h<=0||x+w>c.size[0]||y+h>c.size[1])throw new Error('Invalid layer clip');}
  previous=rank;seen.add(l.id);
 }
 if(main!==1||accent>1||occluder>1)throw new Error('Exactly one main and at most one occluder/accent');
}

function loadImage(src,size){
 return new Promise((resolve,reject)=>{
  const image=new Image();image.decoding='async';
  image.onload=()=>image.naturalWidth===size[0]&&image.naturalHeight===size[1]?resolve(image):reject(new Error('Image dimensions differ: '+src));
  image.onerror=()=>reject(new Error('Cannot load image: '+src));image.src=src;
 });
}

export async function mountCard(host,config,{baseURL=document.baseURI,onError=()=>{}}={}){
 validateConfig(config);
 const baselineFrame=config.frame;
 let parameters=resolveParameters(config.parameters,config.preset,baselineFrame);
 const base=new URL(baseURL,document.baseURI);
 const url=path=>{
  if(typeof path!=='string'||!path||path.includes('\\')||path.split('/').includes('..'))throw new Error('Unsafe asset path');
  const resolved=new URL(path,base);
  if(resolved.origin!==base.origin||!resolved.pathname.startsWith(new URL('.',base).pathname))throw new Error('Asset must stay inside output');
  const revision=new URLSearchParams(location.search).get('v');
  if(revision)resolved.searchParams.set('v',revision);
  return resolved.href;
 };
 let disposed=false,raf=0,failed=false;
 const fail=error=>{failed=true;cancelAnimationFrame(raf);host.replaceChildren();const box=document.createElement('p');box.className='lhc-error';box.setAttribute('role','alert');box.textContent=error.message;host.append(box);onError(error);};
 let images,coupledShadow=null;
 try{
  images=await Promise.all([loadImage(url(config.background),config.size),...config.layers.map(l=>loadImage(url(l.src),config.size))]);
  const front=config.layers.find(l=>l.role==='foreground_occluder');
  if(front&&front.occlusion.safeMotionRange.x===0&&front.occlusion.safeMotionRange.y===0){
   // A coupled partition remains one silhouette for the background shadow.
   // Do not lose the phone's existing shadow just because its RGB is separate.
   coupledShadow=await loadImage(url(front.occlusion.receiverSource),config.size);
  }
 }
 catch(error){fail(error);throw error;}
 const card=document.createElement('div');card.className='lhc'+(config.frame?' lhc-frame':'');card.style.aspectRatio=config.size.join(' / ');card.tabIndex=0;
 card.setAttribute('aria-label','Layered holographic image; move pointer or use arrow keys');
 const plane=document.createElement('div');plane.className='lhc-plane';card.append(plane);
 const surface=document.createElement('canvas');surface.className='lhc-surface';plane.append(surface);
 const entries=config.layers.map((layer,index)=>{
  const clip=document.createElement('div');clip.className='lhc-layer-clip';
  if(layer.clip){const [x,y,w,h]=layer.clip;clip.style.clipPath=`inset(${y/config.size[1]*100}% ${(config.size[0]-x-w)/config.size[0]*100}% ${(config.size[1]-y-h)/config.size[1]*100}% ${x/config.size[0]*100}%)`;}
  const shadow=document.createElement('canvas');shadow.className='lhc-shadow';shadow.setAttribute('aria-hidden','true');
  const image=images[index+1];image.className='lhc-cutout';image.alt='';image.draggable=false;
  image.dataset.layer=layer.id;clip.append(shadow,image);plane.append(clip);
  return {layer,clip,image,shadow,context:shadow.getContext('2d')};
 });
 host.replaceChildren(card);
 let engine;
 try{engine=createOptics(surface,images[0],fail);}catch(error){fail(error);throw error;}
 let tilt=config.motion,current={x:0,y:0},tiltCurrent={x:0,y:0},target={x:0,y:0},last=null;
 let inspection='all',foilEnabled=true;
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const imageById=Object.fromEntries(config.layers.map((l,i)=>[l.id,images[i+1]]));
 function renderScene(width,height,pointer,reduced,flat=false){
  reduced = reduced || !config.motion;
  if(reduced)pointer={x:0,y:0};
  const mode=flat?'all':inspection;
  engine.draw(pointer,foilEnabled&&!['internal','tilt'].includes(mode)?Math.min(1,config.foil*parameters.rainbowStrength):0,config.material,width,height,parameters);
  card.classList.toggle('lhc-frame',parameters.frameStrength>0);
  card.style.setProperty('--frame-strength',parameters.frameStrength);
  const state=sceneState(config,pointer,reduced||mode==='tilt');
  const whole=sceneState(config,tiltCurrent,reduced);
  plane.style.transform=(tilt||mode==='tilt')&&mode!=='internal'&&!reduced&&!flat?`rotateX(${whole.tiltX}deg) rotateY(${whole.tiltY}deg)`:'none';
  surface.style.visibility=['subject','occluder','accent'].includes(mode)?'hidden':'visible';
  for(const entry of entries){
   const pose=state.layers[entry.layer.id], shadow=pose.shadow;
   entry.image.style.visibility=mode==='background'||(mode==='subject'&&entry.layer.role!=='main')||(mode==='occluder'&&entry.layer.role!=='foreground_occluder')||(mode==='accent'&&entry.layer.role!=='accent')?'hidden':'visible';
   entry.shadow.style.visibility=['background','subject','occluder','accent'].includes(mode)?'hidden':'visible';
   entry.image.style.transform=`translate3d(${pose.x}%,${pose.y}%,${pose.z}px)`;
   entry.shadow.style.transform=`translateZ(${shadow.z}px)`;
   const c=entry.context;
   if(entry.shadow.width!==width||entry.shadow.height!==height){entry.shadow.width=width;entry.shadow.height=height;}
   c.clearRect(0,0,width,height);c.globalCompositeOperation='source-over';
   c.filter=`brightness(0) blur(${shadow.blur*width/440}px)`;c.globalAlpha=shadow.opacity;
   c.drawImage(entry.layer.id==='subject'&&coupledShadow?coupledShadow:entry.image,shadow.x*width/100,shadow.y*height/100,width,height);
   c.filter='none';c.globalAlpha=1;
   if(entry.layer.receiver!=='background'){
    const r=state.layers[entry.layer.receiver];c.globalCompositeOperation='destination-in';
    c.drawImage(imageById[entry.layer.receiver],r.x*width/100,r.y*height/100,width,height);
    c.globalCompositeOperation='source-over';
   }
  }
  return state;
 }
 function frame(now){
  raf=0;
  if(disposed||failed)return;
  const dt=last===null?1/60:Math.max(0,now-last)/1000;last=now;
  current={x:approach(current.x,target.x,dt,22),y:approach(current.y,target.y,dt,22)};
  tiltCurrent={x:approach(tiltCurrent.x,target.x,dt,10),y:approach(tiltCurrent.y,target.y,dt,10)};
  const width=Math.max(1,Math.round(card.clientWidth*Math.min(devicePixelRatio||1,1.5)));
  const height=Math.max(1,Math.round(width*config.size[1]/config.size[0]));
  try{renderScene(width,height,current,media.matches);}catch(error){fail(error);return;}
  if(!document.hidden&&!media.matches&&([current,tiltCurrent].some(p=>Math.abs(p.x-target.x)+Math.abs(p.y-target.y)>.0002)))raf=requestAnimationFrame(frame);
  else last=null;
 }
 // Input updates the target only. A queued frame and its clock are never reset.
 const schedule=()=>{if(!disposed&&!failed&&!document.hidden&&!raf)raf=requestAnimationFrame(frame);};
 const move=event=>{const b=card.getBoundingClientRect();target={x:clamp((event.clientX-b.left)/b.width*2-1,-1,1),y:clamp((event.clientY-b.top)/b.height*2-1,-1,1)};schedule();};
 const reset=()=>{target={x:0,y:0};schedule();};
 const down=event=>{if(event.pointerType!=='mouse')card.setPointerCapture(event.pointerId);move(event);};
 const up=event=>{if(card.hasPointerCapture(event.pointerId))card.releasePointerCapture(event.pointerId);reset();};
 const key=event=>{const delta={ArrowLeft:[-.16,0],ArrowRight:[.16,0],ArrowUp:[0,-.16],ArrowDown:[0,.16]}[event.key];if(event.key==='Home'){event.preventDefault();reset();}else if(delta){event.preventDefault();target={x:clamp(target.x+delta[0],-1,1),y:clamp(target.y+delta[1],-1,1)};schedule();}};
 const listeners={pointermove:move,pointerleave:reset,pointercancel:up,pointerdown:down,pointerup:up,blur:reset,keydown:key};
 Object.entries(listeners).forEach(([name,fn])=>card.addEventListener(name,fn));
 const visibility=()=>{cancelAnimationFrame(raf);raf=0;last=null;if(!document.hidden)schedule();};
 document.addEventListener('visibilitychange',visibility);media.addEventListener('change',schedule);
 const resize=new ResizeObserver(schedule);resize.observe(card);schedule();
 return {
  setParameters(value){resolveParameters(value);parameters=resolveParameters({...parameters,...value},'default',baselineFrame);config={...config,preset:'default',parameters};schedule();},
  setPreset(value){parameters=resolveParameters({},value,baselineFrame);config={...config,preset:value,parameters};schedule();},
  resetParameters(){parameters=resolveParameters({},'default',baselineFrame);config={...config,preset:'default',parameters};schedule();},
  getParameters(){return {...parameters};},
  setTilt(value){tilt=Boolean(value);schedule();},
  setFoil(value){foilEnabled=Boolean(value);schedule();},
  setInspection(value){
   if(!['all','background','subject','occluder','accent','internal','tilt'].includes(value))throw new Error('Unknown inspection mode');
   if(value==='accent'&&!config.layers.some(l=>l.role==='accent'))throw new Error('This image has no accent layer');
   if(value==='occluder'&&!config.layers.some(l=>l.role==='foreground_occluder'))throw new Error('This image has no occluder layer');
   inspection=value;schedule();
  },
  setMaterial(value){if(!['subtle','rainbow','pearl','cosmic','metal'].includes(value))throw new Error('Unknown material');config={...config,material:value};schedule();},
  async exportPng(){
   if(disposed||failed)throw new Error('Cannot export failed/disposed preview');
   cancelAnimationFrame(raf);
   raf=0;last=null;
   const [w,h]=config.size;
   const state=renderScene(w,h,{x:0,y:0},true,true);
   const out=document.createElement('canvas');out.width=w;out.height=h;
   const c=out.getContext('2d');c.drawImage(surface,0,0);
   for(const e of entries){
    const pose=state.layers[e.layer.id];c.save();
    if(e.layer.clip){const [x,y,width,height]=e.layer.clip;c.beginPath();c.rect(x,y,width,height);c.clip();}
    c.drawImage(e.shadow,0,0);c.drawImage(e.image,pose.x*w/100,pose.y*h/100,w,h);c.restore();
   }
   schedule();
   return new Promise((resolve,reject)=>out.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encode failed')),'image/png'));
  },
  dispose(){disposed=true;cancelAnimationFrame(raf);resize.disconnect();document.removeEventListener('visibilitychange',visibility);media.removeEventListener('change',schedule);Object.entries(listeners).forEach(([name,fn])=>card.removeEventListener(name,fn));engine.dispose();host.replaceChildren();},
 };
}
