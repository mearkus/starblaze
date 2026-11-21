import * as THREE from 'three';

const RIPPLES = 16;
const LIGHTS = 6;

const VERT = /* glsl */ `
  #define RIPPLES ${RIPPLES}
  uniform float uTime;
  uniform vec4 uRip[RIPPLES];
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float wave = 0.0;
    vec2 push = vec2(0.0);
    for (int i = 0; i < RIPPLES; i++) {
      vec4 r = uRip[i];
      float age = uTime - r.z;
      if (r.w <= 0.0 || age < 0.0 || age > 1.8) continue;
      float radius = age * 58.0;
      vec2 d = wp.xz - r.xy;
      float dist = length(d);
      float k = (dist - radius) / 4.0;
      float w = exp(-k * k) * r.w * (1.0 - age / 1.8);
      wave += w;
      push += (dist > 0.001 ? d / dist : vec2(0.0)) * w;
    }
    wp.y += wave * 1.6;
    wp.xz += push * 1.1;
    vWorld = wp.xyz;
    vWave = wave;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  #define LIGHTS ${LIGHTS}
  uniform float uTime;
  uniform float uBeat;
  uniform vec2 uPlayer;
  uniform vec2 uArena;
  uniform vec3 uTint;
  uniform vec3 uEdge;
  uniform vec3 uLightPos[LIGHTS];
  uniform vec3 uLightCol[LIGHTS];
  varying vec3 vWorld;
  varying float vWave;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hexDist(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
  vec4 hexCoords(vec2 uv) {
    const vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, uv - gv);
  }

  void main() {
    vec2 p = vWorld.xz / 2.6;
    vec4 hc = hexCoords(p);
    float e = 0.5 - hexDist(hc.xy);
    float fw = fwidth(e);
    float line = 1.0 - smoothstep(0.0, fw * 1.5 + 0.015, e);
    float glowLine = exp(-e * 18.0);
    float rnd = hash(hc.zw);

    vec3 col = uTint * (line * 0.055 + glowLine * 0.01);
    // A few cells breathe on their own, others light up on the beat.
    float pulse = step(0.94, rnd) * (0.5 + 0.5 * sin(uTime * 1.7 + rnd * 50.0));
    col += uTint * pulse * 0.025;
    col += uTint * step(0.985, fract(rnd * 7.31)) * uBeat * 0.12;

    // Light pooling around the player ship.
    float pd = length(vWorld.xz - uPlayer);
    col += uTint * (line * 0.22 + 0.01) * exp(-pd * 0.12);

    // Explosion lights.
    for (int i = 0; i < LIGHTS; i++) {
      float d = length(vWorld.xz - uLightPos[i].xz);
      vec3 lc = uLightCol[i] / (1.0 + d * d * 0.03);
      col += lc * (line * 0.6 + 0.015);
    }

    // Shockwave ripples.
    float wv = min(vWave, 1.5);
    col += vec3(0.55, 0.8, 1.0) * wv * (line * 0.9 + glowLine * 0.15 + 0.03);

    // Arena boundary.
    vec2 q = abs(vWorld.xz) - uArena;
    float outside = max(q.x, q.y);
    col += uEdge * exp(-abs(outside) * 0.45) * 0.35 * (0.6 + 0.4 * sin(uTime * 3.0 + vWorld.x * 0.1 + vWorld.z * 0.1));
    if (outside > 0.0) col *= exp(-outside * 0.06) * 0.35;

    col *= 1.0 + uBeat * 0.3;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const WALL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uEdge;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 2.2);
    float stripes = 0.55 + 0.45 * sin(vUv.x * 220.0 - uTime * 4.0);
    float scan = 0.7 + 0.3 * sin(vUv.y * 30.0 + uTime * 6.0);
    gl_FragColor = vec4(uEdge * fade * stripes * scan * 0.22, 1.0);
  }
`;
const WALL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Glass energy deck with a hex grid that ripples from shockwaves and pools explosion light. */
export class Floor {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private wallMat: THREE.ShaderMaterial;
  private rip: THREE.Vector4[];
  private ripCursor = 0;
  time = 0;

  constructor(halfW: number, halfH: number) {
    const margin = 70;
    const geo = new THREE.PlaneGeometry((halfW + margin) * 2, (halfH + margin) * 2, 220, 150);
    geo.rotateX(-Math.PI / 2);
    this.rip = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uRip: { value: this.rip },
        uPlayer: { value: new THREE.Vector2() },
        uArena: { value: new THREE.Vector2(halfW, halfH) },
        uTint: { value: new THREE.Color(0.1, 0.36, 1.0) },
        uEdge: { value: new THREE.Color(0.2, 0.9, 1.6) },
        uLightPos: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector3()) },
        uLightCol: { value: Array.from({ length: LIGHTS }, () => new THREE.Color(0, 0, 0)) },
      },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.y = -0.4;
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.group.add(mesh);

    // Force-field walls around the arena.
    this.wallMat = new THREE.ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      uniforms: { uTime: { value: 0 }, uEdge: this.material.uniforms.uEdge },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const h = 5;
    const mk = (len: number, x: number, z: number, rotY: number) => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(len, h), this.wallMat);
      w.position.set(x, h / 2 - 0.4, z);
      w.rotation.y = rotY;
      this.group.add(w);
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.25, 0.25),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 2.4) }),
      );
      rail.position.set(x, 0, z);
      rail.rotation.y = rotY;
      this.group.add(rail);
    };
    mk(halfW * 2, 0, -halfH, 0);
    mk(halfW * 2, 0, halfH, 0);
    mk(halfH * 2, -halfW, 0, Math.PI / 2);
    mk(halfH * 2, halfW, 0, Math.PI / 2);
  }

  ripple(x: number, z: number, strength: number): void {
    const r = this.rip[this.ripCursor];
    this.ripCursor = (this.ripCursor + 1) % RIPPLES;
    r.set(x, z, this.time, strength);
  }

  update(dt: number, playerX: number, playerZ: number, beat: number, lights: THREE.PointLight[]): void {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uBeat.value = beat;
    (u.uPlayer.value as THREE.Vector2).set(playerX, playerZ);
    const lp = u.uLightPos.value as THREE.Vector3[];
    const lc = u.uLightCol.value as THREE.Color[];
    for (let i = 0; i < LIGHTS; i++) {
      const l = lights[i];
      if (!l) continue;
      lp[i].copy(l.position);
      lc[i].copy(l.color).multiplyScalar(l.intensity / 2600);
    }
    this.wallMat.uniforms.uTime.value = this.time;
  }

  setTint(tint: THREE.Color, edge: THREE.Color): void {
    (this.material.uniforms.uTint.value as THREE.Color).copy(tint);
    (this.material.uniforms.uEdge.value as THREE.Color).copy(edge);
  }
}
