/** Procedural geometry for every ship, enemy, projectile and pickup. No external assets. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ShipId } from '../game/ships';
import { SHIPS } from '../game/ships';
import type { EnemyKind } from '../game/enemies';

type Pt = [number, number];

/** Flat shape in (forward, lateral) extruded upward and centred on y=0. */
function slab(points: Pt[], depth: number, bevel = 0.08): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -depth / 2, 0);
  return g;
}

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x, -y] as Pt).reverse();

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    return g;
  });
  const out = mergeGeometries(prepared, false);
  if (!out) throw new Error('mergeGeometries failed');
  out.computeBoundingSphere();
  return out;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry => g.translate(x, y, z);
/** Cylinder lying along the X axis. */
const tube = (r0: number, r1: number, len: number, seg = 12) =>
  new THREE.CylinderGeometry(r1, r0, len, seg).rotateZ(-Math.PI / 2);

export const hdr = (hex: number, k: number): THREE.Color => new THREE.Color(hex).multiplyScalar(k);

export function makeMaterials(color: number, accent: number) {
  return {
    hull: new THREE.MeshStandardMaterial({ color: 0xc2cad8, metalness: 0.85, roughness: 0.32 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x161b2a, metalness: 0.75, roughness: 0.32 }),
    accent: new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.3, emissive: color, emissiveIntensity: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x050a14, metalness: 0.2, roughness: 0.05, emissive: color, emissiveIntensity: 0.9 }),
    glow: new THREE.MeshBasicMaterial({ color: hdr(color, 4) }),
    accentGlow: new THREE.MeshBasicMaterial({ color: hdr(accent, 4) }),
    flame: new THREE.MeshBasicMaterial({
      color: hdr(accent, 3),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  };
}

export interface ShipModel {
  group: THREE.Group;
  /** Root that banks/rolls; child of group. */
  body: THREE.Group;
  flames: THREE.Mesh[];
  /** Local-space exhaust positions. */
  exhaust: THREE.Vector3[];
  materials: ReturnType<typeof makeMaterials>;
}

function barrelOffsets(n: number, spacing: number): number[] {
  const out: number[] = [];
  const odd = n % 2 === 1;
  if (odd) out.push(0);
  const pairs = Math.floor(n / 2);
  for (let i = 0; i < pairs; i++) {
    const k = odd ? i + 1 : i + 0.5;
    out.push(k * spacing, -k * spacing);
  }
  return out;
}

export function buildShip(id: ShipId, barrels: number): ShipModel {
  const def = SHIPS[id];
  const m = makeMaterials(def.color, def.accent);
  const hull: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const accent: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const accentGlow: THREE.BufferGeometry[] = [];
  const engines: { x: number; y: number; z: number; r: number; len: number }[] = [];
  let barrelX = 0.9;
  let barrelSpacing = 1.15;

  if (id === 'falcon') {
    hull.push(slab([[3.4, 0], [1.2, 0.5], [-0.4, 0.78], [-1.8, 0.6], [-2.1, 0], [-1.8, -0.6], [-0.4, -0.78], [1.2, -0.5]], 0.55));
    dark.push(at(slab([[2.3, 0], [0.5, 0.28], [-1.7, 0.32], [-1.7, -0.32], [0.5, -0.28]], 0.25, 0.04), 0, 0.42, 0));
    const wing: Pt[] = [[0.9, 0.6], [-1.3, 3.0], [-2.0, 3.1], [-1.6, 0.6]];
    hull.push(slab(wing, 0.16), slab(mirror(wing), 0.16));
    accent.push(at(slab([[-0.2, 1.6], [-1.3, 3.0], [-2.0, 3.1], [-1.7, 1.6]], 0.08, 0.02), 0, 0.14, 0));
    accent.push(at(slab(mirror([[-0.2, 1.6], [-1.3, 3.0], [-2.0, 3.1], [-1.7, 1.6]]), 0.08, 0.02), 0, 0.14, 0));
    glass.push(at(new THREE.SphereGeometry(0.5, 20, 14).scale(1.6, 0.62, 0.72), 1.0, 0.42, 0));
    glow.push(at(new THREE.BoxGeometry(0.9, 0.12, 0.14), -1.7, 0.05, 3.08), at(new THREE.BoxGeometry(0.9, 0.12, 0.14), -1.7, 0.05, -3.08));
    glow.push(at(new THREE.BoxGeometry(2.6, 0.06, 0.07), 0.2, 0.31, 0.48), at(new THREE.BoxGeometry(2.6, 0.06, 0.07), 0.2, 0.31, -0.48));
    engines.push({ x: -1.95, y: 0.1, z: 0.55, r: 0.34, len: 1.2 }, { x: -1.95, y: 0.1, z: -0.55, r: 0.34, len: 1.2 });
  } else if (id === 'wraith') {
    hull.push(slab([[3.9, 0], [1.0, 0.38], [-1.0, 0.52], [-2.2, 0.38], [-2.2, -0.38], [-1.0, -0.52], [1.0, -0.38]], 0.45));
    const wing: Pt[] = [[-1.4, 0.4], [0.7, 2.7], [0.25, 2.9], [-2.1, 0.55]];
    hull.push(slab(wing, 0.12), slab(mirror(wing), 0.12));
    const canard: Pt[] = [[2.3, 0.3], [1.4, 1.1], [1.1, 1.1], [1.5, 0.3]];
    accent.push(slab(canard, 0.1), slab(mirror(canard), 0.1));
    dark.push(at(slab([[1.2, 0], [-0.6, 0.6], [-2.0, 0.5], [-2.0, -0.5], [-0.6, -0.6]], 0.2, 0.04), 0, 0.33, 0));
    glass.push(at(new THREE.SphereGeometry(0.5, 20, 14).scale(2.1, 0.5, 0.55), 1.3, 0.3, 0));
    glow.push(at(new THREE.BoxGeometry(0.16, 0.12, 0.9), 0.45, 0.02, 2.75), at(new THREE.BoxGeometry(0.16, 0.12, 0.9), 0.45, 0.02, -2.75));
    glow.push(at(new THREE.BoxGeometry(3.0, 0.05, 0.06), 0.6, 0.25, 0.32), at(new THREE.BoxGeometry(3.0, 0.05, 0.06), 0.6, 0.25, -0.32));
    accentGlow.push(at(new THREE.BoxGeometry(0.06, 0.6, 0.06), -1.8, 0.45, 0));
    engines.push({ x: -2.3, y: 0.05, z: 0, r: 0.55, len: 1.4 });
    barrelX = 0.6;
    barrelSpacing = 0.95;
  } else {
    hull.push(slab([[3.0, 0], [2.2, 1.0], [-0.5, 1.4], [-2.4, 1.1], [-2.7, 0], [-2.4, -1.1], [-0.5, -1.4], [2.2, -1.0]], 0.9, 0.12));
    dark.push(at(slab([[2.0, 0], [1.4, 0.7], [-1.6, 0.8], [-1.9, 0], [-1.6, -0.8], [1.4, -0.7]], 0.3, 0.05), 0, 0.6, 0));
    hull.push(at(new THREE.BoxGeometry(3.4, 0.8, 1.0), -0.3, 0, 2.15), at(new THREE.BoxGeometry(3.4, 0.8, 1.0), -0.3, 0, -2.15));
    accent.push(at(new THREE.ConeGeometry(0.5, 1.0, 6).rotateZ(-Math.PI / 2), 1.9, 0, 2.15));
    accent.push(at(new THREE.ConeGeometry(0.5, 1.0, 6).rotateZ(-Math.PI / 2), 1.9, 0, -2.15));
    const wing: Pt[] = [[0.4, 2.5], [-1.2, 3.8], [-2.5, 3.8], [-2.3, 2.5]];
    hull.push(slab(wing, 0.2), slab(mirror(wing), 0.2));
    glass.push(at(new THREE.SphereGeometry(0.5, 20, 14).scale(1.4, 0.6, 1.0), 1.5, 0.62, 0));
    glow.push(at(new THREE.BoxGeometry(1.3, 0.12, 0.14), -1.85, 0.05, 3.85), at(new THREE.BoxGeometry(1.3, 0.12, 0.14), -1.85, 0.05, -3.85));
    glow.push(at(new THREE.BoxGeometry(2.8, 0.06, 0.08), -0.3, 0.42, 1.65), at(new THREE.BoxGeometry(2.8, 0.06, 0.08), -0.3, 0.42, -1.65));
    engines.push(
      { x: -2.8, y: 0.15, z: 0.6, r: 0.4, len: 1.0 },
      { x: -2.8, y: 0.15, z: -0.6, r: 0.4, len: 1.0 },
      { x: -2.1, y: 0, z: 2.15, r: 0.36, len: 0.8 },
      { x: -2.1, y: 0, z: -2.15, r: 0.36, len: 0.8 },
    );
    barrelX = 1.6;
    barrelSpacing = 0.9;
  }

  for (const z of barrelOffsets(Math.min(barrels, 7), barrelSpacing)) {
    dark.push(at(tube(0.09, 0.12, 1.3, 8), barrelX + 0.5, 0.05, z));
    glow.push(at(new THREE.SphereGeometry(0.11, 8, 6), barrelX + 1.18, 0.05, z));
  }

  const flames: THREE.Mesh[] = [];
  const exhaust: THREE.Vector3[] = [];
  for (const e of engines) {
    dark.push(at(tube(e.r * 1.1, e.r, e.len, 14), e.x, e.y, e.z));
    accentGlow.push(at(tube(e.r * 0.8, e.r * 0.8, 0.06, 14), e.x - e.len / 2 - 0.02, e.y, e.z));
    const fg = new THREE.ConeGeometry(e.r * 0.8, 1, 12).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    const flame = new THREE.Mesh(fg, m.flame);
    flame.position.set(e.x - e.len / 2 - 0.05, e.y, e.z);
    flames.push(flame);
    exhaust.push(new THREE.Vector3(e.x - e.len / 2 - 0.4, e.y, e.z));
  }

  const body = new THREE.Group();
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (parts.length) body.add(new THREE.Mesh(merge(parts), mat));
  };
  add(hull, m.hull);
  add(dark, m.dark);
  add(accent, m.accent);
  add(glass, m.glass);
  add(glow, m.glow);
  add(accentGlow, m.accentGlow);
  for (const f of flames) body.add(f);

  const group = new THREE.Group();
  group.add(body);
  return { group, body, flames, exhaust, materials: m };
}

export interface EnemyGeo {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
}

export function enemyGeometry(kind: Exclude<EnemyKind, 'boss'>): EnemyGeo {
  switch (kind) {
    case 'darter':
      return {
        body: merge([
          new THREE.ConeGeometry(1.1, 3.2, 3).rotateZ(-Math.PI / 2).scale(1, 0.5, 1),
          slab([[-0.4, 0], [-1.6, 1.4], [-1.9, 1.3], [-1.2, 0]], 0.12),
          slab(mirror([[-0.4, 0], [-1.6, 1.4], [-1.9, 1.3], [-1.2, 0]]), 0.12),
        ]),
        glow: merge([
          at(new THREE.ConeGeometry(0.42, 1.5, 3).rotateZ(-Math.PI / 2), -0.3, 0.42, 0),
          at(new THREE.SphereGeometry(0.34, 10, 8), -1.65, 0, 0),
          at(new THREE.BoxGeometry(0.5, 0.1, 0.1), -1.75, 0.02, 1.35),
          at(new THREE.BoxGeometry(0.5, 0.1, 0.1), -1.75, 0.02, -1.35),
        ]),
      };
    case 'mite':
      return {
        body: merge([new THREE.TorusGeometry(0.7, 0.14, 4, 10).rotateX(Math.PI / 2)]),
        glow: merge([new THREE.OctahedronGeometry(0.55, 0).scale(1.2, 0.8, 1.2)]),
      };
    case 'lancer':
      return {
        body: merge([
          new THREE.OctahedronGeometry(1, 0).scale(2.3, 0.55, 0.85),
          slab([[0.2, 0.5], [-1.0, 1.6], [-1.5, 1.6], [-0.9, 0.5]], 0.14),
          slab(mirror([[0.2, 0.5], [-1.0, 1.6], [-1.5, 1.6], [-0.9, 0.5]]), 0.14),
        ]),
        glow: merge([
          at(new THREE.BoxGeometry(3.0, 0.1, 0.12), -0.1, 0.5, 0),
          at(new THREE.SphereGeometry(0.3, 10, 8), 2.25, 0, 0),
          at(new THREE.BoxGeometry(0.12, 0.12, 0.7), -1.3, 0.05, 1.55),
          at(new THREE.BoxGeometry(0.12, 0.12, 0.7), -1.3, 0.05, -1.55),
        ]),
      };
    case 'orbiter': {
      const pods: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        pods.push(at(new THREE.BoxGeometry(0.7, 0.55, 0.7).rotateY(-a), Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0));
      }
      return {
        body: merge([new THREE.TorusGeometry(2.0, 0.32, 8, 28).rotateX(Math.PI / 2), ...pods]),
        glow: merge([
          new THREE.IcosahedronGeometry(0.95, 0),
          new THREE.TorusGeometry(2.0, 0.08, 4, 28).rotateX(Math.PI / 2).translate(0, 0.3, 0),
        ]),
      };
    }
    case 'ram':
      return {
        body: merge([
          new THREE.BoxGeometry(2.4, 1.0, 1.9),
          at(new THREE.ConeGeometry(1.0, 1.8, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4), 2.1, 0, 0),
          at(new THREE.BoxGeometry(1.6, 0.4, 3.2), -0.5, -0.1, 0),
        ]),
        glow: merge([
          at(new THREE.SphereGeometry(0.32, 10, 8), -1.3, 0.1, 0.55),
          at(new THREE.SphereGeometry(0.32, 10, 8), -1.3, 0.1, -0.55),
          at(new THREE.BoxGeometry(2.2, 0.08, 0.1), 0.2, 0.54, 0),
          at(new THREE.BoxGeometry(0.1, 0.1, 3.2), -1.32, -0.1, 0),
        ]),
      };
    case 'bulwark':
      return {
        body: merge([
          new THREE.CylinderGeometry(3.0, 3.4, 1.4, 6),
          at(new THREE.CylinderGeometry(1.8, 2.4, 0.7, 6), 0, 0.9, 0),
        ]),
        glow: merge([
          at(new THREE.TorusGeometry(2.75, 0.14, 4, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6), 0, 0.72, 0),
          at(new THREE.IcosahedronGeometry(0.8, 0), 0, 1.45, 0),
        ]),
      };
  }
}

export interface BossModel {
  group: THREE.Group;
  ring: THREE.Group;
  core: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  coreMat: THREE.MeshBasicMaterial;
}

export function buildBoss(): BossModel {
  const m = makeMaterials(0xff2a4a, 0xffa01a);
  const hullParts = [
    new THREE.CylinderGeometry(5.5, 6.5, 2.4, 6).rotateY(Math.PI / 6),
    at(new THREE.CylinderGeometry(3.6, 4.6, 1.4, 6).rotateY(Math.PI / 6), 0, 1.8, 0),
    at(slab([[2, 3], [-3, 9], [-5.5, 9], [-3.5, 3]], 0.7), 0, 0, 0),
    at(slab(mirror([[2, 3], [-3, 9], [-5.5, 9], [-3.5, 3]]), 0.7), 0, 0, 0),
    at(new THREE.ConeGeometry(2.0, 4.5, 6).rotateZ(-Math.PI / 2), 7.2, 0, 0),
  ];
  const darkParts = [
    at(new THREE.BoxGeometry(5, 1.2, 2.0), -5.5, 0.2, 4.5),
    at(new THREE.BoxGeometry(5, 1.2, 2.0), -5.5, 0.2, -4.5),
    at(tube(0.9, 1.1, 2.5, 14), -6.5, 0.2, 2.0),
    at(tube(0.9, 1.1, 2.5, 14), -6.5, 0.2, -2.0),
  ];
  const glowParts = [
    at(new THREE.TorusGeometry(5.2, 0.16, 4, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6), 0, 1.25, 0),
    at(new THREE.BoxGeometry(6, 0.12, 0.2), -1, 0.4, 6.0),
    at(new THREE.BoxGeometry(6, 0.12, 0.2), -1, 0.4, -6.0),
    at(tube(0.85, 0.85, 0.1, 14), -7.8, 0.2, 2.0),
    at(tube(0.85, 0.85, 0.1, 14), -7.8, 0.2, -2.0),
  ];
  const group = new THREE.Group();
  group.add(new THREE.Mesh(merge(hullParts), m.dark));
  group.add(new THREE.Mesh(merge(darkParts), m.hull));
  group.add(new THREE.Mesh(merge(glowParts), m.glow));
  const coreMat = new THREE.MeshBasicMaterial({ color: hdr(0xff2a4a, 5) });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), coreMat);
  core.position.y = 3.0;
  group.add(core);

  const ring = new THREE.Group();
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.45, 8, 6).rotateX(Math.PI / 2), m.hull));
  const turretGeo = merge([new THREE.BoxGeometry(1.4, 1.2, 1.4), at(tube(0.2, 0.25, 1.6, 8), 1.2, 0.2, 0)]);
  const turretGlow = new THREE.SphereGeometry(0.35, 10, 8);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const t = new THREE.Mesh(turretGeo, m.dark);
    t.position.set(Math.cos(a) * 9.5, 0.6, Math.sin(a) * 9.5);
    t.rotation.y = -a;
    ring.add(t);
    const g = new THREE.Mesh(turretGlow, m.glow);
    g.position.set(Math.cos(a) * 9.5, 1.4, Math.sin(a) * 9.5);
    ring.add(g);
  }
  group.add(ring);
  return { group, ring, core, glowMat: m.glow, coreMat };
}

export const geometries = {
  bolt: () => new THREE.CapsuleGeometry(0.2, 1.7, 2, 6).rotateZ(Math.PI / 2),
  orb: () => new THREE.IcosahedronGeometry(0.55, 1),
  missile: () =>
    merge([new THREE.ConeGeometry(0.22, 0.8, 6).rotateZ(-Math.PI / 2).translate(0.4, 0, 0), tube(0.2, 0.2, 0.7, 6)]),
  drone: () => new THREE.OctahedronGeometry(0.6, 0),
  droneRing: () => new THREE.TorusGeometry(0.85, 0.08, 4, 16).rotateX(Math.PI / 2),
  gem: () => new THREE.OctahedronGeometry(0.42, 0).scale(1, 1.4, 1),
  powerCore: () => new THREE.IcosahedronGeometry(0.75, 0),
  powerShell: () => new THREE.TorusGeometry(1.35, 0.1, 4, 24),
  telegraph: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0),
  halo: () => new THREE.TorusGeometry(1, 0.07, 4, 32).rotateX(Math.PI / 2),
};

const SHIELD_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    vPos = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const SHIELD_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vView)), 2.0);
    float bands = 0.6 + 0.4 * sin(vPos.y * 9.0 - uTime * 6.0);
    gl_FragColor = vec4(uColor * (f * 1.8 + 0.06) * bands * uAlpha, 1.0);
  }
`;

export function shieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SHIELD_VERT,
    fragmentShader: SHIELD_FRAG,
    uniforms: { uColor: { value: new THREE.Color(0.4, 1.2, 2.5) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
}
