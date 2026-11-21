import * as THREE from 'three';
import { TAU, rand } from '../core/math';
import { Batch } from './Instanced';
import { Particles } from './Particles';
import type { Floor } from './Floor';

const tmp = new THREE.Color();
const tmp2 = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/** Hot glowing shards that tumble, bounce on the deck and cool down. */
class Debris {
  readonly batch: Batch;
  private items: {
    x: number; y: number; z: number; vx: number; vy: number; vz: number;
    rx: number; ry: number; wr: number; wy: number; life: number; max: number; size: number; color: THREE.Color;
  }[] = [];

  constructor(capacity: number) {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.batch = new Batch(geo, mat, capacity);
  }

  spawn(x: number, z: number, color: THREE.Color, count: number, power: number): void {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.batch.capacity) this.items.shift();
      const a = Math.random() * TAU;
      const sp = rand(6, 22) * power;
      const life = rand(0.8, 1.8);
      this.items.push({
        x, y: 1, z,
        vx: Math.cos(a) * sp, vy: rand(6, 20) * power, vz: Math.sin(a) * sp,
        rx: Math.random() * TAU, ry: Math.random() * TAU, wr: rand(-12, 12), wy: rand(-12, 12),
        life, max: life, size: rand(0.18, 0.55) * Math.sqrt(power), color: color.clone(),
      });
    }
  }

  update(dt: number): void {
    const b = this.batch;
    b.begin();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        continue;
      }
      d.vy -= 40 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < 0.2) {
        d.y = 0.2;
        d.vy = Math.abs(d.vy) * 0.4;
        d.vx *= 0.7;
        d.vz *= 0.7;
        d.wr *= 0.7;
      }
      d.rx += d.wr * dt;
      d.ry += d.wy * dt;
      const t = d.life / d.max;
      tmp.copy(d.color).multiplyScalar(0.4 + 4 * t * t);
      const s = d.size * Math.min(1, t * 3);
      b.add(d.x, d.y, d.z, d.ry, s, s, s, tmp, 0, d.rx);
    }
    b.end();
  }

  clear(): void {
    this.items.length = 0;
  }
}

const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;
    float band = smoothstep(0.72, 0.94, d) * (1.0 - smoothstep(0.94, 1.0, d));
    float fill = smoothstep(0.6, 0.95, d) * 0.05;
    gl_FragColor = vec4(vColor * (band * 1.2 + fill), 1.0);
  }
`;

/** Expanding (or contracting) glowing rings lying on the deck. */
class Rings {
  readonly batch: Batch;
  private items: { x: number; z: number; y: number; r0: number; r1: number; life: number; max: number; color: THREE.Color }[] = [];

  constructor(capacity: number) {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.batch = new Batch(geo, mat, capacity);
    this.batch.mesh.renderOrder = 9;
  }

  spawn(x: number, z: number, r0: number, r1: number, life: number, color: THREE.Color, y = 0.3): void {
    if (this.items.length >= this.batch.capacity) this.items.shift();
    this.items.push({ x, z, y, r0, r1, life, max: life, color: color.clone() });
  }

  update(dt: number): void {
    const b = this.batch;
    b.begin();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const r = this.items[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.items[i] = this.items[this.items.length - 1];
        this.items.pop();
        continue;
      }
      const t = 1 - r.life / r.max;
      const e = 1 - Math.pow(1 - t, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      tmp.copy(r.color).multiplyScalar((1 - t) * (1 - t));
      b.add(r.x, r.y, r.z, 0, rad, 1, rad, tmp);
    }
    b.end();
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** A few pooled point lights that briefly light up ships and the deck around explosions. */
class Flashes {
  readonly lights: THREE.PointLight[] = [];
  private decay: number[] = [];

  constructor(scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 70, 1.6);
      l.position.set(0, 6, 0);
      scene.add(l);
      this.lights.push(l);
      this.decay.push(6);
    }
  }

  flash(x: number, z: number, color: THREE.Color, intensity: number, decay = 6): void {
    let best = 0;
    for (let i = 1; i < this.lights.length; i++) {
      if (this.lights[i].intensity < this.lights[best].intensity) best = i;
    }
    const l = this.lights[best];
    if (l.intensity > intensity) return;
    l.position.set(x, 6, z);
    l.color.copy(color);
    l.intensity = intensity;
    this.decay[best] = decay;
  }

  update(dt: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      if (l.intensity > 0) {
        l.intensity *= Math.exp(-this.decay[i] * dt);
        if (l.intensity < 1) l.intensity = 0;
      }
    }
  }

  clear(): void {
    for (const l of this.lights) l.intensity = 0;
  }
}

/** High-level effects facade used by gameplay code. */
export class Fx {
  readonly particles: Particles;
  readonly debris: Debris;
  readonly rings: Rings;
  readonly flashes: Flashes;
  /** Camera trauma added by effects; Stage reads and decays it. */
  trauma = 0;
  shakeEnabled = true;

  constructor(scene: THREE.Scene, private floor: Floor) {
    this.particles = new Particles(26000);
    this.debris = new Debris(700);
    this.rings = new Rings(160);
    this.flashes = new Flashes(scene, 6);
    scene.add(this.particles.points, this.debris.batch.mesh, this.rings.batch.mesh);
  }

  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.particles.update(dt);
    this.debris.update(dt);
    this.rings.update(dt);
    this.flashes.update(dt);
  }

  clear(): void {
    this.particles.clear();
    this.debris.clear();
    this.rings.clear();
    this.flashes.clear();
  }

  /** Big layered explosion. `size` ~1 for a small drone, ~3 for heavies, 6+ for bosses. */
  explosion(x: number, z: number, colorHex: number, size: number): void {
    const c = tmp2.setHex(colorHex);
    const p = this.particles;
    // Counts grow linearly up to size 3, then taper so boss blasts don't white out the screen.
    const k = Math.min(size, 3) + Math.max(0, size - 3) * 0.35;
    const sk = Math.sqrt(k);
    const hot = tmp.copy(c).lerp(WHITE, 0.45).multiplyScalar(3);
    // White-hot core flash.
    p.emit({ count: 2, x, z, y: 1.2, speed: [0, 2], life: [0.08, 0.14], size: [2.5 * k, 3.5 * k], sizeEnd: 1.3, color: WHITE.clone().multiplyScalar(1.6), colorEnd: hot, drag: 0 });
    // Fireball.
    p.emit({ count: Math.round(16 * k), x, z, y: 1, spread: 0.6 * size, speed: [3, 14 * sk + size], up: [0, 8], life: [0.3, 0.7], size: [1.2, 2.6 * sk], sizeEnd: 0.2, color: hot, colorEnd: c.clone().multiplyScalar(0.5), drag: 4 });
    // Fast sparks.
    p.emit({ count: Math.round(32 * k), x, z, y: 1, speed: [18, 48 * sk + size * 3], up: [-4, 16], life: [0.25, 0.8], size: [0.35, 0.8], sizeEnd: 0.1, color: tmp.copy(c).multiplyScalar(3.5).lerp(WHITE, 0.3), colorEnd: c.clone().multiplyScalar(0.8), drag: 3.2, gravity: 26 });
    // Lingering embers.
    p.emit({ count: Math.round(14 * k), x, z, y: 1.5, spread: size, speed: [1, 7 + size], up: [2, 10], life: [0.9, 1.9], size: [0.4, 0.9], sizeEnd: 0.2, color: c.clone().multiplyScalar(2.2), drag: 1.5, gravity: 4 });
    this.debris.spawn(x, z, c, Math.round(5 + 4 * k), Math.min(2.2, 0.7 + size * 0.25));
    this.rings.spawn(x, z, 0.5, 5 + 5 * size, 0.45 + 0.08 * size, c.clone().multiplyScalar(2.2));
    if (size >= 2.5) this.rings.spawn(x, z, 1, 9 + 6 * size, 0.8 + 0.08 * size, tmp.copy(c).lerp(WHITE, 0.5).multiplyScalar(1.1));
    this.flashes.flash(x, z, c, Math.min(500, 110 * size), 5);
    this.floor.ripple(x, z, Math.min(2, 0.3 * size));
    this.shake(0.06 * size);
  }

  /** Small impact sparks travelling roughly along `dir`. */
  sparks(x: number, z: number, colorHex: number, count: number, dir?: number, speed = 24): void {
    const c = tmp2.setHex(colorHex);
    this.particles.emit({
      count, x, z, y: 0.8, speed: [speed * 0.3, speed], up: [0, 6], life: [0.12, 0.35], size: [0.3, 0.7],
      color: tmp.copy(c).multiplyScalar(4).lerp(WHITE, 0.4), colorEnd: c.clone(), drag: 5, dir, arc: dir === undefined ? TAU : 1.6, gravity: 10,
    });
  }

  /** Converging particles + ring that warn an enemy is about to warp in. */
  portal(x: number, z: number, colorHex: number, t: number): void {
    const c = tmp2.setHex(colorHex);
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * TAU;
      const r = rand(3, 5);
      const life = 0.25;
      this.particles.emit({
        count: 1, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, y: 0.6,
        speed: [r / life, r / life], dir: a + Math.PI, arc: 0, life: [life, life], size: [0.5, 0.9], sizeEnd: 0.4,
        color: tmp.copy(c).multiplyScalar(3), drag: 0,
      });
    }
    if (t > 0) this.rings.spawn(x, z, 5, 0.5, Math.max(0.2, t), c.clone().multiplyScalar(1.2));
  }

  warpIn(x: number, z: number, colorHex: number, size: number): void {
    const c = tmp2.setHex(colorHex);
    this.particles.emit({ count: 14, x, z, y: 1, speed: [6, 20], life: [0.2, 0.45], size: [0.6, 1.4], color: tmp.copy(c).multiplyScalar(3).lerp(WHITE, 0.4), drag: 4 });
    this.rings.spawn(x, z, 0.5, 3 + size * 2, 0.35, c.clone().multiplyScalar(2));
  }

  shockwave(x: number, z: number, colorHex: number, r1: number, life: number, intensity = 3): void {
    const c = tmp2.setHex(colorHex);
    this.rings.spawn(x, z, 0.5, r1, life, c.clone().multiplyScalar(intensity));
    this.rings.spawn(x, z, 0.5, r1 * 0.75, life * 0.8, tmp.copy(c).lerp(WHITE, 0.6).multiplyScalar(intensity * 0.6));
    this.floor.ripple(x, z, Math.min(2.2, r1 / 14));
  }

  flash(x: number, z: number, colorHex: number, intensity: number): void {
    this.flashes.flash(x, z, tmp2.setHex(colorHex), intensity);
  }

  ripple(x: number, z: number, strength: number): void {
    this.floor.ripple(x, z, strength);
  }

  /** Jagged lightning bolt rendered as a dense trail of short-lived sparks. */
  lightning(x0: number, z0: number, x1: number, z1: number, colorHex: number): void {
    const c = tmp2.setHex(colorHex);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(4, Math.round(len / 1.2));
    const nx = -dz / (len || 1);
    const nz = dx / (len || 1);
    const hotC = tmp.copy(c).multiplyScalar(4).lerp(WHITE, 0.5);
    let off = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      off = i === 0 || i === steps ? 0 : off * 0.5 + rand(-1.2, 1.2);
      this.particles.emit({
        count: 2, x: x0 + dx * t + nx * off, z: z0 + dz * t + nz * off, y: 1, speed: [0, 2], life: [0.1, 0.2],
        size: [0.6, 1.0], sizeEnd: 0.5, color: hotC, colorEnd: c, drag: 0,
      });
    }
  }

  /** Engine exhaust puff. */
  exhaust(x: number, y: number, z: number, vx: number, vz: number, colorHex: number, size: number): void {
    this.particles.emit({
      count: 1, x, y, z, speed: [0, 1.5], vx, vz, life: [0.18, 0.32], size: [size * 0.8, size * 1.2], sizeEnd: 0.1,
      color: tmp.setHex(colorHex).multiplyScalar(3), drag: 3,
    });
  }
}
