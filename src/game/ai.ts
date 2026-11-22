/** Enemy behaviours. Each archetype reads the player position and steers / shoots. */
import { TAU, clamp, damp, dampAngle, rand } from '../core/math';
import { ARENA } from './config';
import type { Game } from './Game';
import type { Enemy } from './types';

function steer(e: Enemy, tx: number, tz: number, accel: number, dt: number): void {
  e.vx = damp(e.vx, tx, accel, dt);
  e.vz = damp(e.vz, tz, accel, dt);
}

export function updateEnemy(g: Game, e: Enemy, dt: number): void {
  if (dt <= 0) return;
  e.age += dt;
  e.flash = Math.max(0, e.flash - dt * 10);
  e.droneHitT -= dt;
  const p = g.player;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d;
  const nz = dz / d;
  const sp = e.def.speed * e.speedMul;
  const toPlayer = Math.atan2(dz, dx);

  switch (e.kind) {
    case 'darter': {
      const wob = Math.sin(e.age * 3 + e.seed) * 0.35;
      steer(e, (nx - nz * wob) * sp, (nz + nx * wob) * sp, 2.2, dt);
      e.angle = Math.atan2(e.vz, e.vx);
      break;
    }
    case 'mite': {
      const wob = Math.sin(e.age * 5 + e.seed) * 0.8;
      steer(e, (nx - nz * wob) * sp, (nz + nx * wob) * sp, 3.5, dt);
      e.spin += dt * 8;
      e.angle = e.spin;
      break;
    }
    case 'lancer': {
      const radial = d > 30 ? 1 : d < 19 ? -1 : 0;
      e.timer2 -= dt;
      if (e.timer2 <= 0) {
        e.state = e.state === 1 ? -1 : 1;
        e.timer2 = rand(2.2, 4);
      }
      steer(e, (nx * radial - nz * e.state * 0.75) * sp, (nz * radial + nx * e.state * 0.75) * sp, 2, dt);
      e.angle = dampAngle(e.angle, toPlayer, 6, dt);
      e.timer -= dt;
      e.charge = e.timer < 0.5 ? clamp(1 - e.timer / 0.5, 0, 1) : Math.max(0, e.charge - dt * 4);
      if (e.timer <= 0 && d < 65) {
        e.burst = e.elite ? 5 : 3;
        e.timer = e.elite ? 1.5 : 2.1;
      }
      if (e.burst > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          e.burstT = 0.11;
          e.burst--;
          // Lead the target a little.
          const lead = d / 32;
          const a = Math.atan2(p.z + p.vz * lead * 0.5 - e.z, p.x + p.vx * lead * 0.5 - e.x);
          g.enemyShoot(e.x + Math.cos(e.angle) * 2.2, e.z + Math.sin(e.angle) * 2.2, a, 32, false, e.def.color);
        }
      }
      break;
    }
    case 'orbiter': {
      const want = 22;
      const radial = clamp((d - want) / 8, -1, 1);
      steer(e, (nx * radial - nz * 0.7) * sp, (nz * radial + nx * 0.7) * sp, 1.5, dt);
      e.spin += dt * 1.6;
      e.angle = e.spin;
      e.timer -= dt;
      e.charge = e.timer < 0.6 ? clamp(1 - e.timer / 0.6, 0, 1) : Math.max(0, e.charge - dt * 4);
      if (e.timer <= 0) {
        const n = e.elite ? 16 : 10;
        const off = e.spin;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * TAU;
          g.enemyShoot(e.x + Math.cos(a) * 2.4, e.z + Math.sin(a) * 2.4, a, 17, false, e.def.color);
        }
        e.timer = e.elite ? 2.0 : 2.8;
      }
      break;
    }
    case 'ram': {
      e.timer -= dt;
      if (e.state === 0) {
        steer(e, nx * sp, nz * sp, 2, dt);
        e.angle = dampAngle(e.angle, toPlayer, 5, dt);
        e.charge = Math.max(0, e.charge - dt * 3);
        if (d < 30 && e.timer <= 0) {
          e.state = 1;
          e.timer = e.elite ? 0.55 : 0.8;
        }
      } else if (e.state === 1) {
        steer(e, 0, 0, 6, dt);
        if (e.timer > 0.25) {
          e.aimX = nx;
          e.aimZ = nz;
        }
        e.angle = dampAngle(e.angle, Math.atan2(e.aimZ, e.aimX), 12, dt);
        e.charge = clamp(1 - e.timer / 0.8, 0, 1);
        if (e.timer <= 0) {
          e.state = 2;
          e.timer = 0.65;
          g.fx.sparks(e.x, e.z, e.def.color, 12, Math.atan2(-e.aimZ, -e.aimX), 30);
        }
      } else if (e.state === 2) {
        const cs = sp * 6.5;
        e.vx = e.aimX * cs;
        e.vz = e.aimZ * cs;
        e.charge = 1;
        g.fx.exhaust(e.x - e.aimX * 1.5, 0.6, e.z - e.aimZ * 1.5, -e.aimX * 10, -e.aimZ * 10, e.def.color, 1.6);
        if (e.timer <= 0) {
          e.state = 3;
          e.timer = 1.0;
        }
      } else {
        steer(e, 0, 0, 3, dt);
        e.charge = Math.max(0, e.charge - dt * 2);
        if (e.timer <= 0) {
          e.state = 0;
          e.timer = rand(0.6, 1.6);
        }
      }
      break;
    }
    case 'bulwark': {
      steer(e, nx * sp, nz * sp, 1, dt);
      e.spin += dt * 0.6;
      e.angle = e.spin;
      e.timer -= dt;
      e.charge = e.timer < 0.7 ? clamp(1 - e.timer / 0.7, 0, 1) : Math.max(0, e.charge - dt * 3);
      if (e.timer <= 0) {
        const n = e.elite ? 12 : 6;
        for (let i = 0; i < n; i++) {
          const a = e.spin + (i / n) * TAU;
          g.enemyShoot(e.x + Math.cos(a) * 3.4, e.z + Math.sin(a) * 3.4, a, 13, true, e.def.color);
        }
        e.timer = 3.4;
      }
      break;
    }
    case 'boss':
      updateBoss(g, e, dt, toPlayer);
      break;
  }

  e.x += e.vx * dt;
  e.z += e.vz * dt;

  const mx = ARENA.halfW - e.radius;
  const mz = ARENA.halfH - e.radius;
  if (e.x < -mx) {
    e.x = -mx;
    e.vx = Math.abs(e.vx) * 0.4;
    if (e.state === 2 && e.kind === 'ram') e.timer = 0;
  } else if (e.x > mx) {
    e.x = mx;
    e.vx = -Math.abs(e.vx) * 0.4;
    if (e.state === 2 && e.kind === 'ram') e.timer = 0;
  }
  if (e.z < -mz) {
    if (e.kind !== 'boss' || e.age > 4) {
      e.z = -mz;
      e.vz = Math.abs(e.vz) * 0.4;
    }
    if (e.state === 2 && e.kind === 'ram') e.timer = 0;
  } else if (e.z > mz) {
    e.z = mz;
    e.vz = -Math.abs(e.vz) * 0.4;
    if (e.state === 2 && e.kind === 'ram') e.timer = 0;
  }
}

/**
 * Dreadnought: three phases by remaining hull. Cycles bullet patterns (spiral, aimed fans,
 * ring bursts) and summons escorts once damaged.
 */
function updateBoss(g: Game, e: Enemy, dt: number, toPlayer: number): void {
  const frac = e.hp / e.maxHp;
  const phase = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
  if (phase > e.phase) {
    e.phase = phase;
    g.bossPhase(e);
  }
  const sp = e.def.speed * (1 + phase * 0.25);

  if (e.age < 3.2 && e.z < g.player.z - 30) {
    // Entrance: glide in from the top edge, stopping well short of the player.
    steer(e, 0, 14, 2, dt);
  } else {
    // Hover above the player, sweeping side to side like a vertical-shooter boss.
    const tx = clamp(g.player.x + Math.sin(e.age * 0.45) * 14, -ARENA.halfW + 10, ARENA.halfW - 10);
    const tz = clamp(g.player.z - 30 + Math.sin(e.age * 0.3) * 4, -ARENA.halfH + 9, ARENA.halfH - 24);
    const ddx = tx - e.x;
    const ddz = tz - e.z;
    const dl = Math.hypot(ddx, ddz) || 1;
    const k = Math.min(1, dl / 10);
    steer(e, (ddx / dl) * sp * k, (ddz / dl) * sp * k, 1.2, dt);
  }
  e.angle = dampAngle(e.angle, toPlayer, 1.4, dt);
  e.spin += dt * (0.5 + phase * 0.35);

  if (e.age < 2.5) return;

  const patterns = phase === 0 ? [0, 1] : phase === 1 ? [0, 2, 1, 3] : [2, 0, 3, 1];
  e.timer -= dt;
  if (e.timer <= 0) {
    // Move to the next pattern after a short wind-up.
    if (e.burst > 0) {
      e.burst = 0;
      e.timer = 0.8 - phase * 0.15;
      e.charge = 0;
    } else {
      e.state = (e.state + 1) % patterns.length;
      e.burst = 1;
      e.timer = 3.6;
      e.timer2 = 0;
      if (patterns[e.state] === 3) {
        g.bossSummon(e, 3 + phase);
        e.timer = 1.2;
      }
    }
  }
  if (e.burst === 0) {
    e.charge = Math.min(1, e.charge + dt * 2);
    return;
  }
  e.charge = Math.max(0, e.charge - dt * 3);
  const pat = patterns[e.state];
  e.timer2 -= dt;
  if (e.timer2 > 0) return;
  // Phase 1 is a warm-up: slower bullets and thinner patterns; phases 2-3 ramp up.
  const spd = phase === 0 ? 0.82 : 1 + phase * 0.18;
  if (pat === 0) {
    e.timer2 = phase === 2 ? 0.05 : phase === 1 ? 0.075 : 0.1;
    const arms = 2 + phase;
    const base = e.spin * 2.6;
    for (let k = 0; k < arms; k++) {
      const a = base + (k / arms) * TAU;
      g.enemyShoot(e.x + Math.cos(a) * 9.5, e.z + Math.sin(a) * 9.5, a, 19 * spd, false, 0xff3b5c);
    }
  } else if (pat === 1) {
    e.timer2 = phase === 2 ? 0.42 : phase === 1 ? 0.55 : 0.7;
    const n = 5 + phase * 2;
    for (let k = 0; k < n; k++) {
      const a = toPlayer + (k - (n - 1) / 2) * 0.12;
      g.enemyShoot(e.x + Math.cos(a) * 7.5, e.z + Math.sin(a) * 7.5, a, 27 * spd, k % 3 === 1, 0xff8a1a);
    }
  } else if (pat === 2) {
    e.timer2 = phase === 2 ? 0.7 : 0.9;
    const n = 22 + phase * 4;
    const off = (e.age * 7) % TAU;
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * TAU;
      g.enemyShoot(e.x + Math.cos(a) * 6, e.z + Math.sin(a) * 6, a, 16 * spd, true, 0xff2ad4);
    }
  }
}
