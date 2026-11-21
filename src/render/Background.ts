import * as THREE from 'three';

const NEBULA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const NEBULA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  void main() {
    vec2 p = vUv * 7.0;
    float t = uTime * 0.012;
    vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
    float n = fbm(p + 3.0 * q);
    float m = fbm(p * 1.7 - q * 2.0 + 11.0);
    vec3 col = mix(uA, uB, smoothstep(0.25, 0.85, n));
    col = mix(col, uC, smoothstep(0.55, 0.95, m) * 0.7);
    float dens = smoothstep(0.32, 0.95, n) * 0.85 + 0.05;
    col *= dens;
    // Distant dust stars.
    vec2 sp = vUv * 900.0;
    float s = hash(floor(sp));
    float star = step(0.9975, s) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
    col += vec3(0.9, 0.95, 1.2) * star * 1.4;
    float vign = smoothstep(0.75, 0.2, length(vUv - 0.5));
    gl_FragColor = vec4(col * vign, 1.0);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  varying float vTw;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTw = 0.6 + 0.4 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 40.0);
    vSeed = aSeed;
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const STAR_FRAG = /* glsl */ `
  varying float vTw;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 3.0);
    vec3 col = mix(vec3(0.6, 0.75, 1.4), vec3(1.4, 0.9, 0.7), step(0.8, vSeed));
    gl_FragColor = vec4(col * a * vTw * 1.6, 1.0);
  }
`;

const PLANET_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  void main() {
    vObj = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const PLANET_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLight;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.5, 71.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  void main() {
    vec3 p = normalize(vObj);
    float bands = sin(p.y * 22.0 + noise(p * 4.0 + uTime * 0.02) * 5.0) * 0.5 + 0.5;
    float storms = noise(p * 9.0 + vec3(uTime * 0.01, 0.0, 0.0));
    vec3 base = mix(vec3(0.16, 0.05, 0.28), vec3(0.85, 0.35, 0.55), bands * 0.8);
    base = mix(base, vec3(1.0, 0.7, 0.5), smoothstep(0.65, 0.9, storms) * 0.5);
    float diff = clamp(dot(vN, normalize(uLight)), 0.0, 1.0);
    float fres = pow(1.0 - clamp(dot(vN, vView), 0.0, 1.0), 3.0);
    vec3 col = base * (0.03 + diff * 0.55) + vec3(0.5, 0.4, 1.6) * fres * (0.25 + diff * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;
const ATMO_FRAG = /* glsl */ `
  uniform vec3 uLight;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vObj;
  void main() {
    float rim = pow(1.0 - abs(dot(vN, vView)), 2.5);
    float lit = 0.35 + 0.65 * clamp(dot(vN, normalize(uLight)) + 0.4, 0.0, 1.0);
    gl_FragColor = vec4(vec3(0.45, 0.35, 1.5) * rim * lit * 0.8, 1.0);
  }
`;

/** Deep-space backdrop beneath the glass deck: nebula, star layers and a gas giant. */
export class Background {
  readonly group = new THREE.Group();
  private nebula: THREE.ShaderMaterial;
  private stars: THREE.ShaderMaterial;
  private planet: THREE.Mesh;
  private planetMat: THREE.ShaderMaterial;
  private rocks: THREE.InstancedMesh;
  private rockData: { x: number; y: number; z: number; s: number; rx: number; ry: number; w: number }[] = [];

  constructor() {
    this.nebula = new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uA: { value: new THREE.Color(0.02, 0.01, 0.06) },
        uB: { value: new THREE.Color(0.22, 0.05, 0.42) },
        uC: { value: new THREE.Color(0.0, 0.35, 0.55) },
      },
      depthWrite: false,
    });
    const neb = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.nebula);
    neb.rotation.x = -Math.PI / 2;
    neb.position.y = -1400;
    neb.renderOrder = -10;
    this.group.add(neb);

    // Star layers at varying depth for parallax.
    const N = 5000;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const depth = Math.pow(Math.random(), 1.6);
      pos[i * 3] = (Math.random() - 0.5) * 1400 * (0.5 + depth);
      pos[i * 3 + 1] = -25 - depth * 420;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1000 * (0.5 + depth);
      size[i] = (0.25 + Math.random() * 0.6) * (1 + depth * 3.5);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.stars = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const pts = new THREE.Points(g, this.stars);
    pts.frustumCulled = false;
    pts.renderOrder = -9;
    this.group.add(pts);

    // Gas giant far below the deck.
    const light = new THREE.Vector3(-0.6, 0.7, 0.4);
    this.planetMat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: { uTime: { value: 0 }, uLight: { value: light } },
    });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(150, 64, 48), this.planetMat);
    this.planet.position.set(900, -1250, -520);
    this.planet.rotation.z = 0.35;
    this.group.add(this.planet);
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(164, 48, 32),
      new THREE.ShaderMaterial({
        vertexShader: PLANET_VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: { uLight: { value: light } },
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
      }),
    );
    atmo.position.copy(this.planet.position);
    this.group.add(atmo);

    // Drifting asteroid field between the deck and the stars.
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2840, roughness: 0.85, metalness: 0.2, flatShading: true });
    const R = 70;
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, R);
    for (let i = 0; i < R; i++) {
      this.rockData.push({
        x: (Math.random() - 0.5) * 420,
        y: -30 - Math.random() * 90,
        z: (Math.random() - 0.5) * 300,
        s: 1 + Math.random() * 4,
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        w: (Math.random() - 0.5) * 0.4,
      });
    }
    this.rocks.frustumCulled = false;
    this.group.add(this.rocks);
    this.updateRocks(0);
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  private updateRocks(dt: number): void {
    for (let i = 0; i < this.rockData.length; i++) {
      const r = this.rockData[i];
      r.rx += r.w * dt;
      r.ry += r.w * 0.7 * dt;
      r.x += dt * 1.5;
      if (r.x > 210) r.x = -210;
      this.e.set(r.rx, r.ry, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(r.x, r.y, r.z), this.q, this.s.set(r.s, r.s * 0.8, r.s));
      this.rocks.setMatrixAt(i, this.m);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.stars.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(dt: number, time: number): void {
    this.nebula.uniforms.uTime.value = time;
    this.stars.uniforms.uTime.value = time;
    this.planetMat.uniforms.uTime.value = time;
    this.planet.rotation.y += dt * 0.01;
    this.updateRocks(dt);
  }
}
