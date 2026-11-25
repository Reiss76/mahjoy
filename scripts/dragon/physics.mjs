import RAPIER from '@dimforge/rapier3d-compat';

export const FLOOR_Y = -2.2;
export const VISUAL_HALF_EXTENTS = [0.6745, 0.9145, 0.3185];
export const LOCAL_CENTER_Z = 0.0365;
const ready = RAPIER.init();
const profiles = new Map();

function quaternion(x, y, z) {
  const a = Math.cos(x / 2), b = Math.cos(y / 2), c = Math.cos(z / 2);
  const d = Math.sin(x / 2), e = Math.sin(y / 2), f = Math.sin(z / 2);
  return { x: d*b*c+a*e*f, y:a*e*c-d*b*f, z:a*b*f+d*e*c, w:a*b*c-d*e*f };
}

// Bake one rigid-body simulation. Scrolling samples these immutable transforms;
// rewinding and jumping never repositions one tile independently of its contacts.
export async function getMotion(mobile) {
  await ready;
  const key = mobile ? 'mobile' : 'desktop';
  if (profiles.has(key)) return profiles.get(key);
  const count = mobile ? 9 : 12, scale = mobile ? 0.91 : 1.02;
  const fps = 120, duration = 6, steps = duration * fps;
  const world = new RAPIER.World({ x:0, y:-5.6, z:0 });
  world.timestep = 1 / fps;
  world.integrationParameters.numSolverIterations = 12;
  world.integrationParameters.numInternalPgsIterations = 2;
  world.integrationParameters.maxCcdSubsteps = 8;
  world.integrationParameters.normalizedAllowedLinearError = 0.00005;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.15, 40).setTranslation(0, FLOOR_Y - 0.15, 0).setFriction(0.9).setRestitution(0.08));
  const queue = new RAPIER.EventQueue(true);
  const rows = count / 3;
  const colliderIndices = new Map();
  const bodies = Array.from({length:count}, (_, i) => {
    const row = Math.floor(i / 3), column = i % 3;
    const original = quaternion(-0.16 + Math.sin(i * 1.8) * .12, Math.cos(i * 2.1) * .13, Math.sin(i * 2.7) * .12);
    // Tilt the whole initial arrangement, including each body's orientation.
    // A shared rigid transform keeps the initial clearances intact.
    const angle = -0.10, s = Math.sin(angle / 2), c = Math.cos(angle / 2);
    const rotation = { x:c*original.x-s*original.y, y:c*original.y+s*original.x, z:c*original.z+s*original.w, w:c*original.w-s*original.z };
    const x = (column - 1) * (mobile ? 1.75 : 1.95);
    const y = (rows - 1 - row) * 2.25 - 0.6, centerY = (rows - 1) * 1.125 - .6;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x*Math.cos(angle)-(y-centerY)*Math.sin(angle), x*Math.sin(angle)+(y-centerY)*Math.cos(angle)+centerY, Math.sin(i * 2.3) * .22)
      .setRotation(rotation)
      .setLinvel(Math.sin(i * 2.3) * .20, 0, Math.cos(i * 1.7) * .28)
      .setAngvel({ x:-0.7 + Math.sin(i) * .13, y:Math.sin(i * 2) * .25, z:Math.cos(i * 1.7) * .28 })
      .setLinearDamping(0.35).setAngularDamping(0.5).setCcdEnabled(true));
    // This slightly conservative collider contains the complete printed tile,
    // including the layered back. It leaves room for solver/interpolation error.
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(
      (VISUAL_HALF_EXTENTS[0] + .025) * scale,
      (VISUAL_HALF_EXTENTS[1] + .025) * scale,
      (VISUAL_HALF_EXTENTS[2] + .025) * scale)
      .setTranslation(0, 0, LOCAL_CENTER_Z * scale)
      .setDensity(1).setFriction(.86).setRestitution(.10)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    colliderIndices.set(collider.handle, i);
    return body;
  });
  const frames = new Float32Array((steps + 1) * count * 7);
  const impacts = [], lastImpact = new Float32Array(count).fill(-10);
  const record = frame => bodies.forEach((body, i) => {
    const p = body.translation(), q = body.rotation(), o = (frame * count + i) * 7;
    frames.set([p.x,p.y,p.z,q.x,q.y,q.z,q.w], o);
  });
  record(0);
  for (let frame = 1; frame <= steps; frame++) {
    const speeds = bodies.map(body => { const v = body.linvel(); return Math.hypot(v.x,v.y,v.z); });
    world.step(queue);
    const time = frame / fps;
    queue.drainCollisionEvents((one, two, started) => {
      if (!started) return;
      const a = colliderIndices.get(one), b = colliderIndices.get(two);
      const i = a === undefined ? b : a;
      if (i === undefined || time - lastImpact[i] < .14) return;
      const speed = Math.max(speeds[a] || 0, speeds[b] || 0);
      if (speed < .6) return;
      lastImpact[i] = time;
      impacts.push({ time, tile:i, strength:Math.min(.95, .3 + speed / 9) });
    });
    record(frame);
  }
  world.free(); queue.free();
  const motion = { count, scale, fps, duration, steps, frames, impacts };
  profiles.set(key, motion);
  return motion;
}

export function sampleMotion(motion, time, target = new Float64Array(motion.count * 7)) {
  const at = Math.max(0, Math.min(motion.steps, time * motion.fps));
  const frame = Math.floor(at), next = Math.min(motion.steps, frame + 1), t = at - frame;
  for (let i = 0; i < motion.count; i++) {
    const a = (frame * motion.count + i) * 7, b = (next * motion.count + i) * 7, out = i * 7;
    for (let j = 0; j < 3; j++) target[out+j] = motion.frames[a+j] * (1-t) + motion.frames[b+j] * t;
    const dot = motion.frames[a+3]*motion.frames[b+3] + motion.frames[a+4]*motion.frames[b+4] + motion.frames[a+5]*motion.frames[b+5] + motion.frames[a+6]*motion.frames[b+6];
    const sign = dot < 0 ? -1 : 1;
    let length = 0;
    for (let j = 3; j < 7; j++) { const v = motion.frames[a+j]*(1-t) + sign*motion.frames[b+j]*t; target[out+j] = v; length += v*v; }
    length = Math.sqrt(length);
    for (let j = 3; j < 7; j++) target[out+j] /= length;
  }
  return target;
}
