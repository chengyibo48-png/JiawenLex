import schema from './parameters.json' with {type:'json'};
export const {controls,presets}=schema;
export function resolveParameters(values={},preset='default',frame=false){
 if(!Object.hasOwn(presets,preset))throw new Error('Unknown effect preset');
 if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Invalid parameters');
 const result=Object.fromEntries(Object.keys(controls).map(key=>[key,key==='frameStrength'?Number(frame):1]));
 for(const [key,value] of Object.entries({...presets[preset],...values})){
  if(!Object.hasOwn(controls,key)||!Number.isFinite(value)||value<0||value>controls[key].max)throw new Error('Invalid parameter: '+key);
  result[key]=value;
 }
 return result;
}
