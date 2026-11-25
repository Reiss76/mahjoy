import {writeFile} from 'node:fs/promises';
import {getMotion} from './physics.mjs';
const profiles={},chunks=[];let offset=0;
for(const [name,mobile] of [['desktop',false],['mobile',true]]){
 const motion=await getMotion(mobile);
 const packed=Int16Array.from(motion.frames,(v,i)=>Math.round(v*(i%7<3?1024:32767)));
 chunks.push(packed);profiles[name]={...motion,frames:undefined,offset};offset+=packed.length;
}
const packed=new Int16Array(offset);let at=0;
for(const chunk of chunks){packed.set(chunk,at);at+=chunk.length;}
await writeFile(new URL('../../assets/dragon/motion.bin',import.meta.url),new Uint8Array(packed.buffer));
await writeFile(new URL('../../assets/dragon/motion.json',import.meta.url),JSON.stringify({version:2,encoding:'int16-position1024-quaternion32767',profiles}));
console.log({desktop:profiles.desktop.count,mobile:profiles.mobile.count,bytes:packed.byteLength});
