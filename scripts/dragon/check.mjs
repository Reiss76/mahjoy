import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleMotion, VISUAL_HALF_EXTENTS, LOCAL_CENTER_Z, FLOOR_Y } from './physics.mjs';
async function getMotion(){ const motion=JSON.parse(await readFile(new URL('../../assets/dragon/motion.json',import.meta.url))); const raw=await readFile(new URL('../../assets/dragon/motion.bin',import.meta.url));const packed=new Int16Array(raw.buffer,raw.byteOffset,raw.byteLength/2); motion.frames=Float32Array.from(packed,(v,i)=>v/(i%7<3?1024:32767));return motion; }

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function box(p, i, scale) {
  const o=i*7, x=p[o+3],y=p[o+4],z=p[o+5],w=p[o+6];
  const axes=[ [1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)], [2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)], [2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)] ];
  const half=VISUAL_HALF_EXTENTS.map(v=>v*scale);
  const center=[0,1,2].map(k=>p[o+k]+axes[2][k]*LOCAL_CENTER_Z*scale);
  const extent=[0,1,2].map(k=>half.reduce((s,h,i)=>s+h*Math.abs(axes[i][k]),0));
  return {center,axes,half,extent};
}
function overlap(a,b) {
  const delta=b.center.map((v,i)=>v-a.center[i]);
  if(delta.some((d,k)=>Math.abs(d)>a.extent[k]+b.extent[k]))return 0;
  const axes=[...a.axes,...b.axes,...a.axes.flatMap(x=>b.axes.map(y=>cross(x,y)))];
  let penetration=Infinity;
  for(const raw of axes) {
    const length=Math.hypot(...raw); if(length<1e-7)continue;
    const n=raw.map(v=>v/length);
    const radiusA=a.half.reduce((sum,h,i)=>sum+h*Math.abs(dot(a.axes[i],n)),0);
    const radiusB=b.half.reduce((sum,h,i)=>sum+h*Math.abs(dot(b.axes[i],n)),0);
    const amount=radiusA+radiusB-Math.abs(dot(delta,n));
    if(amount<=1e-5)return 0;
    penetration=Math.min(penetration,amount);
  }
  return penetration;
}

for(const mobile of [false]) {
  const motion=await getMotion(mobile), poses=new Float64Array(motion.count*7);
  let tested=0, floorGap=Infinity;
  const intersections=[];
  // Test all simulation frames AND the interpolated quarter-frames used by scroll.
  for(let step=0;step<=motion.steps*4;step++) {
    const time=step/(motion.fps*4); sampleMotion(motion,time,poses);
    const boxes=Array.from({length:motion.count},(_,i)=>box(poses,i,motion.scale));
    for(let i=0;i<boxes.length;i++) {
      const a=boxes[i];
      const bottom=a.center[1]-a.half.reduce((sum,h,k)=>sum+h*Math.abs(a.axes[k][1]),0);
      floorGap=Math.min(floorGap,bottom-FLOOR_Y);
      for(let j=i+1;j<boxes.length;j++) {
        tested++; const penetration=overlap(a,boxes[j]);
        if(penetration>0.0001&&intersections.length<6)intersections.push({time,i,j,penetration});
      }
    }
  }
  console.log(JSON.stringify({profile:mobile?'mobile':'desktop',pairsTested:tested,minimumFloorGap:floorGap,intersections,collisionEvents:motion.impacts.length}));
  assert.equal(intersections.length,0,'Visible tile bounds intersect');
  assert.ok(floorGap>=-0.0001,'A visible tile crosses the floor');
  const forward=sampleMotion(motion,2.7).slice(); sampleMotion(motion,5.6); sampleMotion(motion,.2);
  assert.deepEqual(sampleMotion(motion,2.7),forward,'Scroll seeking must be deterministic');
}
