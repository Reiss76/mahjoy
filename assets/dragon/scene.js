import * as THREE from './three.module.js';
import { RoundedBoxGeometry } from './RoundedBoxGeometry.js';
import { RoomEnvironment } from './RoomEnvironment.js';

export async function mount(section) {
const $ = selector => section.querySelector(selector);
const stage=$('.mj-dragon-stage'), host=$('.mj-dragon-canvas');
const soundButton=$('.mj-dragon-sound'), soundStatus=$('.mj-dragon-status');
const copy=JSON.parse(section.dataset.copy);
const mobileQuery=matchMedia('(max-width:760px)'), reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const diagnostics={ready:false,tiles:144,progress:0,sounds:0,impacts:0,soundEnabled:false,physics:'precomputed-rigid-body'};
Object.defineProperty(section,'dragonState',{get:()=>({...diagnostics})});
const asset=name=>new URL(name,import.meta.url);
let active=false,frameId=0,lastTime=0,progress=0,targetProgress=0;
// Short resonant impacts, synthesized locally: no recording, microphone or network.
class TileSound {
  constructor() { this.enabled = false; this.context = null; this.lastImpact = 0; }
  async toggle() {
    if (this.enabled) { this.enabled = false; return false; }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error(copy.unavailableShort);
    this.context ||= new AudioContext();
    await this.context.resume();
    this.enabled = this.context.state === 'running';
    if (this.enabled) this.impact(0.55, 1, true);
    return this.enabled;
  }
  impact(strength, variation, preview = false) {
    if (!this.enabled || document.hidden || this.context?.state !== 'running') return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const t = preview ? now + 0.008 : Math.max(now + 0.008, this.lastImpact + 0.075);
    // Fast scrolling may cross several landings in one frame. Keep a short,
    // bounded sequence instead of dropping every impact after the first one.
    if (t - now > 0.24) return;
    this.lastImpact = t;
    const gain = ctx.createGain();
    const compressor = this.compressor ||= (() => {
      const node = ctx.createDynamicsCompressor();
      node.threshold.value = -14; node.knee.value = 12; node.ratio.value = 5;
      node.attack.value = 0.002; node.release.value = 0.1;
      node.connect(ctx.destination); return node;
    })();
    gain.gain.setValueAtTime(0.17 * Math.min(1, strength), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    gain.connect(compressor);
    const pitch = 0.92 + (variation % 5) * 0.045;
    [1120, 1870, 2960, 4380].forEach((frequency, i) => {
      const osc = ctx.createOscillator(); const envelope = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(frequency * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(frequency * pitch * 0.78, t + 0.09);
      envelope.gain.setValueAtTime([0.7, 0.35, 0.2, 0.09][i], t);
      envelope.gain.exponentialRampToValueAtTime(0.0001, t + 0.075 + i * 0.011);
      osc.connect(envelope); envelope.connect(gain); osc.start(t); osc.stop(t + 0.14);
      osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
    });
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.028), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4);
    const source = ctx.createBufferSource(); source.buffer = noise;
    const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1900;
    const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.25;
    source.connect(filter); filter.connect(noiseGain); noiseGain.connect(gain); source.start(t);
    source.onended = () => { source.disconnect(); filter.disconnect(); noiseGain.disconnect(); };
    window.setTimeout(() => gain.disconnect(), 230);
    diagnostics.sounds++;
  }
}
const sound = new TileSound();
soundButton.addEventListener('click', async () => {
  try {
    const enabled = await sound.toggle();
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.setAttribute('aria-label', enabled ? copy.mute : copy.enable);
    soundButton.querySelector('.sound-label').textContent = enabled ? copy.on : copy.enable;
    soundStatus.textContent = enabled ? copy.statusOn : copy.statusOff;
    diagnostics.soundEnabled = enabled;
  } catch {
    soundStatus.textContent = copy.unavailable;
    soundButton.querySelector('.sound-label').textContent = copy.unavailableShort;
    soundButton.disabled = true;
  }
});


const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function makeFace(kind, color, star, logo) {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 880;
  const ctx = canvas.getContext('2d');
  const stroke = color; const gold = '#ad783c';
  ctx.strokeStyle = stroke; ctx.fillStyle = stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ring = (x, y, radius, center = true) => {
    ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, radius - 15, 0, Math.PI * 2); ctx.stroke();
    if (center) { ctx.beginPath(); ctx.arc(x, y, radius * 0.32, 0, Math.PI * 2); ctx.fill(); }
  };
  const stamp = (x, y, size) => {
    ctx.save(); ctx.translate(x, y); ctx.drawImage(star, -size / 2, -size / 2, size, size);
    ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = color; ctx.fillRect(-size / 2, -size / 2, size, size); ctx.restore();
  };
  if (kind === 'dots') {
    for (const y of [230, 440, 650]) for (const x of [200, 440]) ring(x, y, 60);
  } else if (kind === 'bamboo') {
    for (const x of [190, 320, 450]) {
      for (let i = 0; i < 3; i++) {
        const y = 200 + i * 180;
        ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 140); ctx.stroke();
        ctx.fillRect(x - 17, y + 8, 39, 6); ctx.fillRect(x - 13, y + 120, 39, 6);
        ctx.beginPath(); ctx.moveTo(x + 4, y + 76); ctx.quadraticCurveTo(x + 58, y + 26, x + 60, y + 24); ctx.quadraticCurveTo(x + 49, y + 82, x + 4, y + 76); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, y + 102); ctx.quadraticCurveTo(x - 44, y + 82, x - 48, y + 68); ctx.quadraticCurveTo(x - 9, y + 67, x, y + 102); ctx.fill();
      }
    }
  } else if (kind === 'star') {
    stamp(320, 420, 300);
    ctx.fillStyle = gold; ctx.font = '39px Awesome, Georgia'; ctx.textAlign = 'center'; ctx.fillText('MAH JOY', 320, 720);
  } else if (kind === 'flower') {
    ctx.save(); ctx.translate(320, 435); ctx.lineWidth = 8;
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.ellipse(0, -110, 42, 82, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ring(0, 0, 45); ctx.restore();
  } else if (kind === 'three') {
    ring(320, 215, 74); ring(320, 440, 74); ring(320, 665, 74);
  } else if (kind === 'logo') {
    ctx.drawImage(logo, 100, 260, 440, 340);
    stamp(320, 170, 64); stamp(320, 710, 64);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; return texture;
}

function image(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}


const [motion,buffer,star,logo]=await Promise.all([
  fetch(asset('motion.json')).then(r=>{if(!r.ok)throw new Error('Motion metadata');return r.json();}),
  fetch(asset('motion.bin')).then(r=>{if(!r.ok)throw new Error('Motion data');return r.arrayBuffer();}),
  image(asset('star-mark.svg')),image(asset('tile-logo.svg'))
]);
const packed=new Int16Array(buffer);
const frames=Float32Array.from(packed,(v,i)=>v/(i%7<3?1024:32767));
if(motion.count!==144 || frames.length!==(motion.steps+1)*motion.count*7)throw new Error('Incomplete motion data');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
renderer.setClearColor('#f5e8f0');renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#f5e8f0');
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.03);
scene.environment=env.texture;scene.environmentIntensity=.75;room.dispose();pmrem.dispose();
const camera=new THREE.OrthographicCamera(-10,10,10,-10,.1,120);
camera.position.set(0,24,27);camera.lookAt(0,0,0);camera.updateMatrixWorld();
scene.add(new THREE.AmbientLight('#fff5f6',.65));
const key=new THREE.DirectionalLight('#fff5e9',3.2);key.position.set(-10,20,8);key.castShadow=true;
key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:.5,far:65});
key.shadow.bias=-.00035;key.shadow.normalBias=.035;scene.add(key);
const fill=new THREE.DirectionalLight('#d8d9ff',.85);fill.position.set(7,4,-3);scene.add(fill);
const floorGeometry=new THREE.PlaneGeometry(200,200);
const floor=new THREE.Mesh(floorGeometry,new THREE.MeshBasicMaterial({color:'#f5e8f0',toneMapped:false}));
floor.rotation.x=-Math.PI/2;floor.position.y=-2.2;scene.add(floor);
const shadow=new THREE.Mesh(floorGeometry,new THREE.ShadowMaterial({opacity:.13,depthWrite:false}));
shadow.rotation.x=-Math.PI/2;shadow.position.y=-2.195;shadow.receiveShadow=true;scene.add(shadow);
const geometry={base:new RoundedBoxGeometry(1.34,1.82,.55,3,.105),band:new RoundedBoxGeometry(1.349,1.829,.18,3,.085),front:new RoundedBoxGeometry(1.34,1.82,.30,3,.105),print:new THREE.PlaneGeometry(1.19,1.63)};
const ivory=new THREE.MeshPhysicalMaterial({color:'#fff9ec',roughness:.26,clearcoat:.55,clearcoatRoughness:.22});
const palettes=[{back:'#690d2b',band:'#cc80a5',ink:'#740f31'},{back:'#b3729d',band:'#9ec2e1',ink:'#865091'},{back:'#a5b1d5',band:'#e8b0c7',ink:'#84619b'}];
const kinds=['star','dots','bamboo','logo','flower','three'];
const batches=kinds.map((kind,i)=>{
 const p=palettes[i%3],n=24;
 const meshes=[
  new THREE.InstancedMesh(geometry.base,new THREE.MeshPhysicalMaterial({color:p.back,roughness:.27,clearcoat:.8}),n),
  new THREE.InstancedMesh(geometry.band,new THREE.MeshPhysicalMaterial({color:p.band,roughness:.32,clearcoat:.5}),n),
  new THREE.InstancedMesh(geometry.front,ivory,n),
  new THREE.InstancedMesh(geometry.print,new THREE.MeshBasicMaterial({map:makeFace(kind,p.ink,star,logo),transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1}),n)
 ];
 meshes.forEach((m,k)=>{m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.castShadow=k<3;m.receiveShadow=k<3;scene.add(m);});return meshes;
});
const poses=new Float64Array(144*7),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),matrix=new THREE.Matrix4(),local=new THREE.Matrix4(),worldMatrix=new THREE.Matrix4(),view=new THREE.Vector3();
function sample(time) {
 const at=clamp(time*motion.fps,0,motion.steps),a=Math.floor(at),b=Math.min(motion.steps,a+1),t=at-a;
 for(let i=0;i<144;i++) {
  const x=(a*144+i)*7,y=(b*144+i)*7,o=i*7;
  for(let j=0;j<3;j++)poses[o+j]=frames[x+j]*(1-t)+frames[y+j]*t;
  const sign=frames[x+3]*frames[y+3]+frames[x+4]*frames[y+4]+frames[x+5]*frames[y+5]+frames[x+6]*frames[y+6]<0?-1:1;
  let norm=0;for(let j=3;j<7;j++){poses[o+j]=frames[x+j]*(1-t)+sign*frames[y+j]*t;norm+=poses[o+j]**2;}
  norm=Math.sqrt(norm);for(let j=3;j<7;j++)poses[o+j]/=norm;
 }
}
function render() {
 frameId=0;if(!active||document.hidden)return;
 progress+= (targetProgress-progress)*.19;
 if(Math.abs(targetProgress-progress)<.0002)progress=targetProgress;
 const time=motion.duration*smooth(.09,.91,progress);sample(time);
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let i=0;i<144;i++) {
  const o=i*7;pos.set(poses[o],poses[o+1],poses[o+2]);quat.set(poses[o+3],poses[o+4],poses[o+5],poses[o+6]);matrix.compose(pos,quat,scale);
  const batch=batches[i%6],slot=Math.floor(i/6);
  for(let k=0;k<4;k++){local.makeTranslation(0,0,k===2?.2:k===3?.355:0);worldMatrix.multiplyMatrices(matrix,local);batch[k].setMatrixAt(slot,worldMatrix);}
  view.copy(pos).applyMatrix4(camera.matrixWorldInverse);
  minX=Math.min(minX,view.x-1.3);maxX=Math.max(maxX,view.x+1.3);minY=Math.min(minY,view.y-1.3);maxY=Math.max(maxY,view.y+1.3);
 }
 batches.flat().forEach(m=>m.instanceMatrix.needsUpdate=true);
 const w=host.clientWidth,h=host.clientHeight,mobile=mobileQuery.matches;
 const arrival=smooth(.55,.84,progress),left=mobile?.04:.39-arrival*.32,right=mobile?.96:.97;
 const top=mobile?.34:.16+arrival*.09,bottom=mobile?.87:.90;
 const u=Math.max((maxX-minX)/((right-left)*w),(maxY-minY)/((bottom-top)*h));
 const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
 camera.left=cx-(left+right)/2*w*u;camera.right=camera.left+w*u;
 camera.top=cy+(top+bottom)/2*h*u;camera.bottom=camera.top-h*u;camera.updateProjectionMatrix();
 const intro=1-smooth(.15,.39,progress);
 $('.mj-dragon-intro').style.opacity=intro;$('.mj-dragon-intro').style.visibility=intro>.01?'visible':'hidden';
 $('.mj-dragon-intro').setAttribute('aria-hidden',String(intro<.1));
 $('.mj-dragon-arrival').style.opacity=arrival;$('.mj-dragon-arrival').style.visibility=arrival>.01?'visible':'hidden';
 $('.mj-dragon-arrival').setAttribute('aria-hidden',String(arrival<.1));
 $('.mj-dragon-replay').hidden=progress<.85;
 $('.mj-dragon-progress span').style.transform=`scaleX(${progress})`;
 let played=0;if(time>lastTime)for(const impact of motion.impacts)if(impact.time>lastTime&&impact.time<=time){diagnostics.impacts++;if(played++<3)sound.impact(impact.strength,impact.tile);}
 lastTime=time;diagnostics.progress=Number(progress.toFixed(4));
 renderer.render(scene,camera);
 if(progress!==targetProgress)requestFrame();
}
function requestFrame(){if(!frameId&&active&&!document.hidden)frameId=requestAnimationFrame(render);}
function updateScroll(){
 const rect=section.getBoundingClientRect();
 const pinTop=mobileQuery.matches?64:72;
 section.classList.toggle('is-pinned',rect.top<=pinTop && rect.bottom>pinTop+stage.offsetHeight);
 section.classList.toggle('is-finished',rect.bottom<=pinTop+stage.offsetHeight);
 targetProgress=clamp((pinTop-rect.top)/Math.max(1,section.offsetHeight-stage.offsetHeight),0,1);requestFrame();
}
function resize(){renderer.setPixelRatio(Math.min(devicePixelRatio,mobileQuery.matches?1.4:1.7));renderer.setSize(host.clientWidth,host.clientHeight,false);updateScroll();}
const observer=new IntersectionObserver(entries=>{active=entries[0].isIntersecting;if(active){updateScroll();requestFrame();}else if(frameId){cancelAnimationFrame(frameId);frameId=0;}},{rootMargin:'100px'});observer.observe(section);
new ResizeObserver(resize).observe(host);window.addEventListener('scroll',updateScroll,{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frameId);frameId=0;}else requestFrame();});
$('.mj-dragon-replay').addEventListener('click',()=>section.scrollIntoView({behavior:'smooth',block:'start'}));
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();active=false;cancelAnimationFrame(frameId);section.classList.remove('is-enhanced');host.hidden=true;});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches){active=false;section.classList.remove('is-enhanced');}else{section.classList.add('is-enhanced');active=true;resize();}});
section.classList.add('is-ready');diagnostics.ready=true;resize();
}
