import * as THREE from 'three';
import { TAU } from '../core/math';

export interface EmitOptions {
  count: number;
  x: number;
  y?: number;
  z: number;
  /** Random position jitter radius. */
  spread?: number;
  speed: [number, number];
  /** Vertical speed range (towards camera). */
  up?: [number, number];
  life: [number, number];
  size: [number, number];
  /** Size multiplier reached at end of life (default 0.1). */
  sizeEnd?: number;
  color: THREE.Color;
  /** Colour at end of life (default: a darker copy of `color`). */
  colorEnd?: THREE.Color;
  /** Velocity damping per second (default 2). */
  drag?: number;
  gravity?: number;
  /** Centre direction (radians, XZ plane) and arc width for directional bursts. */
  dir?: number;
  arc?: number;
  vx?: number;
  vz?: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float soft = (1.0 - d);
    soft *= soft;
    float core = smoothstep(0.35, 0.0, d);
    gl_FragColor = vec4(vColor * (soft + core * 0.9), 1.0);
  }
`;

/**
 * CPU-simulated additive point particles. One draw call for the whole pool; a ring buffer
 * recycles the oldest particles when full.
 */
export class Particles {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private readonly n: number;
  private cursor = 0;
  private hi = 0;

  private px: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;

  private aPos: THREE.BufferAttribute;
  private aColor: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;

  constructor(capacity: number) {
    this.n = capacity;
    this.px = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.c0 = new Float32Array(capacity * 3);
    this.c1 = new Float32Array(capacity * 3);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aSize', this.aSize);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(o: EmitOptions): void {
    const y = o.y ?? 0.5;
    const spread = o.spread ?? 0;
    const drag = o.drag ?? 2;
    const grav = o.gravity ?? 0;
    const sizeEnd = o.sizeEnd ?? 0.1;
    const arc = o.arc ?? TAU;
    const dir = o.dir ?? 0;
    const c = o.color;
    const ce = o.colorEnd;
    for (let k = 0; k < o.count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      if (this.cursor > this.hi) this.hi = this.cursor;
      if (this.cursor === 0) this.hi = this.n;
      const i3 = i * 3;
      const a = dir + (Math.random() - 0.5) * arc;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const ra = Math.random() * TAU;
      const rr = Math.random() * spread;
      this.px[i3] = o.x + Math.cos(ra) * rr;
      this.px[i3 + 1] = y;
      this.px[i3 + 2] = o.z + Math.sin(ra) * rr;
      this.vel[i3] = Math.cos(a) * sp + (o.vx ?? 0);
      this.vel[i3 + 1] = o.up ? o.up[0] + Math.random() * (o.up[1] - o.up[0]) : 0;
      this.vel[i3 + 2] = Math.sin(a) * sp + (o.vz ?? 0);
      const l = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.life[i] = l;
      this.maxLife[i] = l;
      const s = o.size[0] + Math.random() * (o.size[1] - o.size[0]);
      this.s0[i] = s;
      this.s1[i] = s * sizeEnd;
      this.c0[i3] = c.r;
      this.c0[i3 + 1] = c.g;
      this.c0[i3 + 2] = c.b;
      if (ce) {
        this.c1[i3] = ce.r;
        this.c1[i3 + 1] = ce.g;
        this.c1[i3 + 2] = ce.b;
      } else {
        this.c1[i3] = c.r * 0.25;
        this.c1[i3 + 1] = c.g * 0.12;
        this.c1[i3 + 2] = c.b * 0.18;
      }
      this.drag[i] = drag;
      this.grav[i] = grav;
    }
  }

  update(dt: number): void {
    const pos = this.aPos.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const size = this.aSize.array as Float32Array;
    const hi = this.hi;
    for (let i = 0; i < hi; i++) {
      let l = this.life[i];
      if (l <= 0) {
        if (size[i] !== 0) size[i] = 0;
        continue;
      }
      l -= dt;
      this.life[i] = l;
      if (l <= 0) {
        size[i] = 0;
        continue;
      }
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      let vx = this.vel[i3] * damp;
      let vy = this.vel[i3 + 1] * damp - this.grav[i] * dt;
      const vz = this.vel[i3 + 2] * damp;
      const x = this.px[i3] + vx * dt;
      let y = this.px[i3 + 1] + vy * dt;
      const z = this.px[i3 + 2] + vz * dt;
      if (y < 0.05 && vy < 0) {
        // Skitter across the deck instead of falling through it.
        y = 0.05;
        vy = -vy * 0.35;
        vx *= 0.8;
      }
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy;
      this.vel[i3 + 2] = vz;
      this.px[i3] = x;
      this.px[i3 + 1] = y;
      this.px[i3 + 2] = z;
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;

      const t = 1 - l / this.maxLife[i];
      const fade = 1 - t * t;
      col[i3] = (this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t) * fade;
      col[i3 + 1] = (this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t) * fade;
      col[i3 + 2] = (this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t) * fade;
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
    }
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}
