// Newly authored physical state model, independent of DOM and graphics APIs.
import {resolveParameters} from './parameters.js';
export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
export function approach(current, target, seconds, rate=14) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0,Math.min(.1,seconds))*rate));
}
export function sceneState(config, pointer, reduced = false) {
  reduced = reduced || !config.motion;
  const x=reduced?0:clamp(pointer.x,-1,1), y=reduced?0:clamp(pointer.y,-1,1);
  const depth=config.depth;
  const params=resolveParameters(config.parameters,config.preset,config.frame);
  const heightFactor=.12+.88*Math.min(1,Math.hypot(x,y));
  const states={background:{x:0,y:0,z:0}};
  for(const layer of config.layers) {
    const p=layer.role==='accent'?1.15:layer.role==='midground'?.55:1;
    const z=layer.role==='accent'?1.2:layer.role==='midground'?.55:1;
    const pose={x:x*1.45*p*depth,y:y*1.25*p*depth,z:reduced?0:19*z*depth*heightFactor};
    pose.x*=params.parallaxStrength;pose.y*=params.parallaxStrength;pose.z*=params.depthStrength;
    if(layer.role==='accent'){
      pose.x*=params.foregroundAccentStrength;pose.y*=params.foregroundAccentStrength;pose.z*=params.foregroundAccentStrength;
    }
    const receiver=states[layer.receiver];
    if(!receiver) throw new Error('Shadow receiver must precede caster');
    if(layer.role==='foreground_occluder') {
      const o=layer.occlusion, range=o.safeMotionRange;
      // Clamp RELATIVE motion, not the parent's depth. Bounds are source-pixel
      // coverage evidence; desiredParallax is a ratio, not an entitlement.
      const dx=Math.min(1.45*depth*params.parallaxStrength*(o.desiredParallax-1),range.x/config.size[0]*100);
      const dy=Math.min(1.25*depth*params.parallaxStrength*(o.desiredParallax-1),range.y/config.size[1]*100);
      pose.x=receiver.x+x*dx;pose.y=receiver.y+y*dy;
      // A 2D coverage proof cannot authorize extra perspective displacement.
      pose.z=receiver.z;
    }
    const gap=Math.max(0,pose.z-receiver.z);
    // Shadow follows the receiving plane, lags the caster, and projects away
    // from the moving light. Layer height controls softness, not dark drama.
    const shadow={
      x:receiver.x+(pose.x-receiver.x)*.55-x*gap*.018+gap*.012,
      y:receiver.y+(pose.y-receiver.y)*.55-y*gap*.018+gap*.021,
      z:receiver.z+.02,
      blur:2+gap*.24,
      opacity:(layer.role==='foreground_occluder'&&gap===0?0:layer.role==='accent'?.12:.16)*(1-.3*Math.min(1,gap/28))*Math.min(.35,depth),
    };
    shadow.blur*=params.shadowSoftness;
    shadow.opacity=Math.min(.075,shadow.opacity*params.shadowStrength);
    states[layer.id]={...pose,shadow};
  }
  return {layers:states,tiltX:-y*7*params.tiltStrength,tiltY:x*7*params.tiltStrength,pointer:{x,y}};
}
