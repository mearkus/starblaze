import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * A rebuilt-every-frame instanced batch: begin(), add() each visible thing, end().
 * Keeps draw calls constant no matter how many enemies or bullets are on screen.
 */
export class Batch {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** Adds an instance. `yaw` rotates about Y, `pitch` about X, `roll` about Z (YXZ order). */
  add(
    x: number,
    y: number,
    z: number,
    yaw: number,
    sx: number,
    sy = sx,
    sz = sx,
    color?: THREE.Color | number,
    roll = 0,
    pitch = 0,
  ): void {
    if (this.count >= this.capacity) return;
    _e.set(pitch, yaw, roll);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(this.count, _m);
    if (color !== undefined) {
      if (typeof color === 'number') _c.setHex(color);
      else _c.copy(color);
      this.mesh.setColorAt(this.count, _c);
    }
    this.count++;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
