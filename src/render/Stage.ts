import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ARENA } from '../game/config';
import { clamp, damp } from '../core/math';
import { Background } from './Background';
import { Floor } from './Floor';
import { Fx } from './Fx';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCA: { value: 0.0015 },
    uTime: { value: 0 },
    uWarp: { value: 0 },
    uHurt: { value: 0 },
    uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uCA;
    uniform float uTime;
    uniform float uWarp;
    uniform float uHurt;
    uniform float uFlash;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uCA * (1.0 + r2 * 6.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.75, 0.7, 1.45), uWarp * 0.6);
      col += vec3(1.0, 0.05, 0.12) * uHurt * smoothstep(0.05, 0.35, r2) * 1.2;
      col += vec3(1.0, 0.95, 0.9) * uFlash;
      col *= 1.0 - smoothstep(0.12, 0.55, r2) * 0.55;
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.02;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export type CameraMode = 'play' | 'title' | 'hangar';

/** Owns the renderer, camera, post-processing chain and world-space effects. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly final: ShaderPass;
  readonly floor: Floor;
  readonly background: Background;
  readonly fx: Fx;
  readonly fov = 46;

  mode: CameraMode = 'title';
  time = 0;
  private camPos = new THREE.Vector3(0, 80, 40);
  private camLook = new THREE.Vector3();
  private fovKick = 0;
  private baseDist = 70;
  private visHalfW = 25;
  private visHalfH = 35;
  private shakeSeed = Math.random() * 100;
  private width = 1;
  private height = 1;
  readonly mobile = window.matchMedia('(pointer: coarse)').matches;
  private maxPixelRatio: number;
  hurt = 0;
  flash = 0;
  warp = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    // Phones have 3x screens; rendering at 1.5x keeps bloom and particles smooth.
    this.maxPixelRatio = Math.min(window.devicePixelRatio, this.mobile ? 1.5 : 1.75);
    this.renderer.setPixelRatio(this.maxPixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x020108);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;

    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 1, 8000);

    const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x2a0a3a, 0.9);
    const key = new THREE.DirectionalLight(0xdfe8ff, 2.2);
    key.position.set(-30, 80, 40);
    const rim = new THREE.DirectionalLight(0xff4fd8, 1.4);
    rim.position.set(40, 20, -60);
    this.scene.add(hemi, key, rim);

    this.background = new Background();
    this.scene.add(this.background.group);
    this.floor = new Floor(ARENA.halfW, ARENA.halfH);
    this.scene.add(this.floor.group);
    this.fx = new Fx(this.scene, this.floor);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.mobile ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.95, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Lowers render resolution (adaptive quality). Returns false when already at the floor. */
  degrade(): boolean {
    const pr = this.renderer.getPixelRatio();
    if (pr <= 0.8) return false;
    this.renderer.setPixelRatio(Math.max(0.8, pr - 0.25));
    this.resize();
    return true;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    (this.final.uniforms.uRes.value as THREE.Vector2).set(w * pr, h * pr);
    this.fx.particles.setViewport(h * pr, this.fov);
    this.background.setViewport(h * pr, this.fov);
    // Portrait framing: show at least ~48 units across and ~70 units of depth on any screen.
    const t = Math.tan((this.fov * Math.PI) / 360) * 2;
    const aspect = w / h;
    this.baseDist = Math.max(68 / t, 44 / (t * aspect));
    this.visHalfH = (this.baseDist * t) / 2;
    this.visHalfW = this.visHalfH * aspect;
  }

  kick(amount: number): void {
    this.fovKick = Math.min(8, this.fovKick + amount);
  }

  update(dt: number, focusX: number, focusZ: number, beat: number): void {
    this.time += dt;
    const fx = this.fx;
    fx.update(dt);

    // Camera rig.
    const desired = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.mode === 'play') {
      // Follow the ship, but stop near the walls so the view never drifts far outside the arena.
      const rx = Math.max(0, ARENA.halfW - this.visHalfW * 0.8);
      const rz = Math.max(0, ARENA.halfH - this.visHalfH * 0.75);
      const lx = clamp(focusX, -rx, rx);
      // Look slightly below the ship so it sits above the thumb-zone HUD.
      const lz = clamp(focusZ + this.visHalfH * 0.12, -rz, rz);
      look.set(lx, 0, lz);
      desired.set(lx, this.baseDist * 0.93, lz + this.baseDist * 0.36);
    } else if (this.mode === 'title') {
      const a = this.time * 0.05;
      look.set(Math.sin(a) * 4, 0, Math.cos(a * 0.7) * 4);
      desired.set(Math.sin(a) * 12, 62, 46 + Math.cos(a) * 6);
    } else {
      // Ship sits in the top third of the portrait frame, above the hangar panel.
      look.set(0, 0, 7.5);
      desired.set(-2.5, 16, 22);
    }
    const k = this.mode === 'play' ? 6 : 2.5;
    this.camPos.x = damp(this.camPos.x, desired.x, k, dt);
    this.camPos.y = damp(this.camPos.y, desired.y, k, dt);
    this.camPos.z = damp(this.camPos.z, desired.z, k, dt);
    this.camLook.x = damp(this.camLook.x, look.x, k, dt);
    this.camLook.y = damp(this.camLook.y, look.y, k, dt);
    this.camLook.z = damp(this.camLook.z, look.z, k, dt);

    const trauma = fx.trauma;
    const s = trauma * trauma;
    const t = this.time * 32 + this.shakeSeed;
    const ox = s * 2.4 * (Math.sin(t * 1.13) + Math.sin(t * 2.31) * 0.5);
    const oz = s * 2.4 * (Math.sin(t * 1.71 + 3.1) + Math.sin(t * 2.97) * 0.5);
    this.camera.position.set(this.camPos.x + ox, this.camPos.y, this.camPos.z + oz);
    this.camera.lookAt(this.camLook.x + ox * 0.6, this.camLook.y, this.camLook.z + oz * 0.6);
    this.camera.rotateZ(s * 0.05 * Math.sin(t * 0.9));
    fx.trauma = Math.max(0, trauma - dt * 1.6);

    this.fovKick = damp(this.fovKick, 0, 5, dt);
    const fov = this.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const u = this.final.uniforms;
    u.uTime.value = this.time;
    u.uCA.value = 0.001 + s * 0.005 + this.hurt * 0.003;
    u.uHurt.value = this.hurt;
    u.uFlash.value = this.flash;
    u.uWarp.value = this.warp;

    this.floor.update(dt, focusX, focusZ, beat, fx.flashes.lights);
    this.background.update(dt, this.time);
  }

  render(): void {
    this.composer.render();
  }

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();

  /** Projects a screen (client) point onto the deck plane (y = 0). Works outside the frame too. */
  screenToGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, this.hit) ? { x: this.hit.x, z: this.hit.z } : null;
  }

  private v = new THREE.Vector3();
  /** Projects a world point to pixel coordinates inside the game frame. */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.v.set(x, y, z).project(this.camera);
    return {
      x: (this.v.x * 0.5 + 0.5) * this.width,
      y: (-this.v.y * 0.5 + 0.5) * this.height,
      visible: this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2,
    };
  }
}
