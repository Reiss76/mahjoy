import {writeFile} from 'node:fs/promises';
import {getMotion} from './physics.mjs';
const motion=await getMotion(false);
// 90 fps with sub-millimetre quantization keeps the production download small.
const steps=motion.steps/2,frames=new Int16Array((steps+1)*motion.count*7);
for(let f=0;f<=steps;f++)for(let i=0;i<motion.count*7;i++)
 frames[f*motion.count*7+i]=Math.round(motion.frames[f*2*motion.count*7+i]*(i%7<3?1024:32767));
await writeFile(new URL('../../assets/dragon/motion.bin',import.meta.url),new Uint8Array(frames.buffer));
await writeFile(new URL('../../assets/dragon/motion.json',import.meta.url),JSON.stringify({...motion,fps:90,steps,frames:undefined,encoding:'int16-position1024-quaternion32767'}));
console.log({tiles:motion.count,frames:steps+1,bytes:frames.byteLength,impacts:motion.impacts.length});
