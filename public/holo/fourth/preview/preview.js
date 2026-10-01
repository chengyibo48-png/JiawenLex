import {mountCard} from './card.js';
import {controls as parameterControls} from './parameters.js';
const host=document.querySelector('#card'),status=document.querySelector('#status');
const layerDetails=document.querySelector('details');
try{
 const response=await fetch('../presentation.json');if(!response.ok)throw new Error('Cannot load presentation.json: '+response.status);
 const config=await response.json();
 const card=await mountCard(host,config,{baseURL:new URL('../',location.href).href,onError:error=>{status.textContent=error.message;document.querySelector('#export').disabled=true;}});
 document.querySelector('#tilt').checked=config.motion;document.querySelector('#material').value=config.material;
 let userTilt=config.motion;
 document.querySelector('#tilt').onchange=e=>{userTilt=e.target.checked;card.setTilt(userTilt);};
 document.querySelector('#material').onchange=e=>card.setMaterial(e.target.value);
 const controls=document.querySelector('.controls');
 const foilLabel=document.createElement('label');
 foilLabel.innerHTML='<input id="foil" type="checkbox" checked> Foil';controls.append(foilLabel);
 document.querySelector('#foil').onchange=e=>card.setFoil(e.target.checked);
 const tuning=document.createElement('details');tuning.id='tuning';
 const heading=document.createElement('summary');heading.textContent='调整效果 / Adjust effects';tuning.append(heading);
 const preset=document.createElement('select');preset.id='preset';preset.setAttribute('aria-label','效果预设');
 for(const [value,label] of [['default','默认'],['restrained','克制'],['shimmer','更闪'],['depth','更立体']])preset.add(new Option(label,value));
 preset.add(new Option('自定义','custom'));preset.lastElementChild.disabled=true;preset.value=config.preset??'default';
 const reset=document.createElement('button');reset.id='reset-parameters';reset.textContent='重置默认';tuning.append(preset,reset);
 const sliders=new Map();
 for(const [key,spec] of Object.entries(parameterControls)){
  const label=document.createElement('label');label.className='parameter';
  const title=document.createElement('span');title.textContent=spec.label;
  const input=document.createElement('input');input.type='range';input.id=key;input.min='0';input.max=String(spec.max);input.step='0.05';input.setAttribute('aria-label',spec.label);
  input.disabled=key==='foregroundAccentStrength'&&!config.layers.some(l=>l.role==='accent');
  if(input.disabled)label.title='当前图片没有独立 accent 层；不会自动拆分或生成新图层。';
  const output=document.createElement('output');output.htmlFor=key;
  input.oninput=()=>{card.setParameters({[key]:Number(input.value)});output.value=Number(input.value).toFixed(2);preset.value='custom';};
  label.append(title,input,output);tuning.append(label);sliders.set(key,{input,output});
 }
 const sync=()=>{for(const [key,{input,output}] of sliders){input.value=card.getParameters()[key];output.value=Number(input.value).toFixed(2);}};
 preset.onchange=()=>{card.setPreset(preset.value);sync();};
 reset.onclick=()=>{
  card.resetParameters();preset.value='default';sync();
  card.setFoil(true);document.querySelector('#foil').checked=true;
  card.setMaterial(config.material);document.querySelector('#material').value=config.material;
  userTilt=config.motion;card.setTilt(userTilt);card.setInspection('all');select.value='all';
  document.querySelector('#tilt').disabled=false;document.querySelector('#tilt').checked=userTilt;
 };
 sync();controls.after(tuning);
 const select=document.createElement('select');select.id='inspection';select.setAttribute('aria-label','Inspect actual layers');
 for(const [value,label] of [['all','All layers'],['background','Background only'],['subject','Subject only'],['occluder','Foreground occluder only'],['accent','Accent only'],['internal','Internal parallax only (no foil)'],['tilt','Whole-card tilt only (no foil)']]){
  const option=new Option(label,value);option.disabled=(value==='accent'&&!config.layers.some(l=>l.role==='accent'))||(value==='occluder'&&!config.layers.some(l=>l.role==='foreground_occluder'));select.add(option);
 }
 const occluder=config.layers.find(l=>l.role==='foreground_occluder');
 if(occluder){const info=document.createElement('p');info.textContent='Occlusion safety: '+occluder.occlusion.occlusionRisk+'. Extra motion '+occluder.occlusion.safeMotionRange.x+' / '+occluder.occlusion.safeMotionRange.y+' source px; extra lift 0. '+(occluder.occlusion.fill==='none'?'No hidden content generated.':'Reviewed safe-region fill; see provenance.')+' Zero budget keeps the occluder coupled to the subject.';layerDetails.append(info);}
 layerDetails.insertBefore(select,document.querySelector('#layers'));
 select.onchange=e=>{
  const mode=e.target.value;card.setInspection(mode);
  const tiltControl=document.querySelector('#tilt');
  tiltControl.disabled=mode==='internal'||mode==='tilt';
  tiltControl.checked=mode==='internal'?false:mode==='tilt'?true:userTilt;
 };
 const save=document.querySelector('#export');save.disabled=false;
 save.onclick=async()=>{save.disabled=true;try{const blob=await card.exportPng();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='final.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Saved neutral, flat-pose PNG; no preview UI included.';}catch(error){status.textContent=error.message;}finally{save.disabled=false;}};
 for(const [name,path] of [['original',config.original],['background',config.background],...config.layers.map(l=>[l.id,l.src])]){
  const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');
  image.src=new URL('../'+path,location.href).href;image.alt=name;caption.textContent=name;figure.append(image,caption);document.querySelector('#layers').append(figure);
 }
 addEventListener('pagehide',()=>card.dispose(),{once:true});
}catch(error){host.textContent=error.message;host.className='lhc-error';host.setAttribute('role','alert');status.textContent='Preview failed. No flat-image fallback was rendered.';}
