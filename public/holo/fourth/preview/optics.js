// Procedural optics. No downloaded atlases, shader fragments or texture assets.
const vertex=`#version 300 es
precision highp float;
out vec2 uv;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  uv=vec2(p.x,1.0-p.y);
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;
const fragment=`#version 300 es
precision highp float;
in vec2 uv; out vec4 pixel;
uniform sampler2D art;
uniform vec2 light; uniform float strength; uniform int material;
uniform float glareGain; uniform float textureGain;
float noise(vec2 p){return fract(sin(dot(p,vec2(83.71,219.43)))*17942.817);}
void main(){
 vec3 base=texture(art,uv).rgb;
 float lum=dot(base,vec3(.2126,.7152,.0722));
 vec2 spot=vec2(.36,.32)+light*vec2(.30,.26);
 vec2 delta=uv-spot;
 float broad=exp(-pow((delta.x*.79+delta.y*.61)*3.6,2.0));
 float crossed=exp(-pow((delta.x*-.52+delta.y*.85-.22)*5.2,2.0));
 float gloss=exp(-dot(delta*vec2(1.1,.86),delta*vec2(1.1,.86))*14.0);
 float phase=uv.x*.8+uv.y*.63+light.x*.23-light.y*.17;
 vec3 spectral=.55+.45*cos(6.2831853*(phase+vec3(0.0,.34,.67)));
 vec3 tint=material==0?vec3(.84,.86,.87):material==4?mix(vec3(.70,.72,.75),spectral,.13):spectral;
 float grain=noise(floor(uv*vec2(920.0,1240.0)))-.5;
 float micro=grain*.08;
 if(material==2) micro+=sin(uv.x*48.0+sin(uv.y*34.0))*cos(uv.y*29.0)*.03;
 if(material==4) micro+=sin(uv.y*2800.0)*.035;
 float flake=0.0;
 if(material==3){
   vec2 cell=floor(uv*vec2(165.0,221.0));
   float seed=noise(cell);
   float sparkle=pow(max(0.0,cos(seed*19.0+light.x*3.0+light.y*2.0)),28.0);
   flake=step(.985,seed)*sparkle*.27;
 }
 float protect=smoothstep(.015,.48,lum);
 float reflection=(broad*.22+crossed*.08+gloss*.13*glareGain+micro*textureGain)*protect;
 vec3 film=base+(1.0-base)*(tint*reflection+vec3(flake*textureGain));
 // A soft off-angle attenuation gives shape without turning skin gray:
 // skin never enters this canvas; it is an untouched foreground image.
 film-=base*crossed*.025*protect;
 pixel=vec4(mix(base,clamp(film,0.0,1.0),strength),1.0);
}`;

export function createOptics(canvas,image,onFailure) {
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:false});
 if(!gl) throw new Error('WebGL2 unavailable; layered foil preview cannot render');
 const objects=[];
 function shader(kind,source){
  const s=gl.createShader(kind); gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(message);}
  objects.push(s);return s;
 }
 const program=gl.createProgram();
 let texture;
 try{
  gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  if(Math.max(image.naturalWidth,image.naturalHeight)>gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Source exceeds GPU texture size');
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
  if(gl.getError()!==gl.NO_ERROR) throw new Error('GPU image upload failed');
 }catch(error){objects.forEach(s=>gl.deleteShader(s));gl.deleteProgram(program);if(texture)gl.deleteTexture(texture);throw error;}
 const uniforms=Object.fromEntries(['light','strength','material','glareGain','textureGain'].map(name=>[name,gl.getUniformLocation(program,name)]));
 let failed=false;
 const lost=event=>{event.preventDefault();failed=true;onFailure(new Error('WebGL context lost; reload preview to recover'));};
 canvas.addEventListener('webglcontextlost',lost);
 return {
  draw(pointer,strength,material,width,height,parameters={}){
   if(failed) throw new Error('WebGL context is lost');
   if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
   gl.viewport(0,0,width,height);gl.useProgram(program);
   gl.uniform2f(uniforms.light,pointer.x,pointer.y);gl.uniform1f(uniforms.strength,strength);
   gl.uniform1f(uniforms.glareGain,parameters.glareStrength??1);
   gl.uniform1f(uniforms.textureGain,parameters.textureStrength??1);
   gl.uniform1i(uniforms.material,['subtle','rainbow','pearl','cosmic','metal'].indexOf(material));
   gl.drawArrays(gl.TRIANGLES,0,3);
  },
  dispose(){canvas.removeEventListener('webglcontextlost',lost);objects.forEach(s=>gl.deleteShader(s));gl.deleteTexture(texture);gl.deleteProgram(program);}
 };
}
