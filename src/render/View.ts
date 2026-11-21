/** Mirrors game state into instanced meshes and the player/boss models every frame. */
import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { EnemyKind } from '../game/enemies';
import { POWERUP_BY_ID } from '../game/powerups';
import { SHIPS, type ShipId } from '../game/ships';
import { Batch } from './Instanced';
import { buildBoss, buildShip, enemyGeometry, geometries, hdr, shieldMaterial, type BossModel, type ShipModel } from './models';
import type { Stage } from './Stage';

type Kind = Exclude<EnemyKind, 'boss'>;
const KINDS: Kind[] = ['darter', 'mite', 'lancer', 'orbiter', 'ram', 'bulwark'];
const CAP: Record<Kind, number> = { darter: 160, mite: 160, lancer: 60, orbiter: 40, ram: 50, bulwark: 24 };

const additive = (color = 0xffffff) =>
  new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });

const WHITE = new THREE.Color(1, 1, 1);
const GOLD_TINT = new THREE.Color(1.9, 1.45, 0.55);
const BOSS_TINT = new THREE.Color(1.0, 0.16, 0.32);
const BOSS_EDGE = new THREE.Color(1.8, 0.25, 0.4);
const BASE_TINT = new THREE.Color(0.16, 0.42, 1.0);
const BASE_EDGE = new THREE.Color(0.2, 0.9, 1.6);

export class View {
  private enemy: Record<Kind, { body: Batch; glow: Batch }>;
  private bolt: Batch;
  private orbGlow: Batch;
  private orbCore: Batch;
  private missile: Batch;
  private drone: Batch;
  private droneRing: Batch;
  private gem: Batch;
  private powerCore: Batch;
  private powerShell: Batch;
  private telegraph: Batch;
  private halo: Batch;
  private all: Batch[] = [];
  ship!: ShipModel;
  private shipKey = '';
  private boss: BossModel;
  private shield: THREE.Mesh;
  private shieldMat: THREE.ShaderMaterial;
  private reticle: THREE.Group;
  private reticleMat: THREE.MeshBasicMaterial;
  shieldFlash = 0;
  readonly shipGlow = new THREE.Color();
  private t = 0;
  private temps = Array.from({ length: 6 }, () => new THREE.Color());
  private ti = 0;
  private c = new THREE.Color();
  private c2 = new THREE.Color();
  private v = new THREE.Vector3();
  private tint = BASE_TINT.clone();
  private edge = BASE_EDGE.clone();

  constructor(private stage: Stage) {
    const scene = stage.scene;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3b4260, metalness: 0.85, roughness: 0.3 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.enemy = {} as Record<Kind, { body: Batch; glow: Batch }>;
    for (const k of KINDS) {
      const g = enemyGeometry(k);
      this.enemy[k] = { body: this.mk(g.body, bodyMat, CAP[k]), glow: this.mk(g.glow, glowMat, CAP[k]) };
    }
    this.bolt = this.mk(geometries.bolt(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 1500);
    this.orbGlow = this.mk(geometries.orb(), additive(), 1000);
    this.orbCore = this.mk(geometries.orb(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 1000);
    this.missile = this.mk(geometries.missile(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 80);
    this.drone = this.mk(geometries.drone(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 12);
    this.droneRing = this.mk(geometries.droneRing(), new THREE.MeshStandardMaterial({ color: 0xc8d2e8, metalness: 0.9, roughness: 0.25 }), 12);
    this.gem = this.mk(geometries.gem(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 800);
    this.powerCore = this.mk(geometries.powerCore(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 40);
    this.powerShell = this.mk(geometries.powerShell(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 80);
    this.telegraph = this.mk(geometries.telegraph(), additive(), 60);
    this.halo = this.mk(geometries.halo(), additive(), 60);
    this.telegraph.mesh.renderOrder = 8;
    this.orbGlow.mesh.renderOrder = 11;

    this.boss = buildBoss();
    this.boss.group.visible = false;
    scene.add(this.boss.group);

    this.shieldMat = shieldMaterial();
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(3.1, 32, 20), this.shieldMat);
    this.shield.renderOrder = 12;
    scene.add(this.shield);

    this.reticleMat = additive(0x66ddff);
    this.reticle = new THREE.Group();
    this.reticle.add(new THREE.Mesh(new THREE.RingGeometry(1.0, 1.2, 40).rotateX(-Math.PI / 2), this.reticleMat));
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.14), this.reticleMat);
      const a = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 1.75, 0, Math.sin(a) * 1.75);
      tick.rotation.y = -a;
      this.reticle.add(tick);
    }
    this.reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.12, 12).rotateX(-Math.PI / 2), this.reticleMat));
    scene.add(this.reticle);
  }

  private mk(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): Batch {
    const b = new Batch(geo, mat, cap);
    this.stage.scene.add(b.mesh);
    this.all.push(b);
    return b;
  }

  /** HDR colour helper. Returns one of a few shared temporaries — copy if you keep it. */
  color(hex: number, k: number): THREE.Color {
    const c = this.temps[(this.ti = (this.ti + 1) % this.temps.length)];
    return c.setHex(hex).multiplyScalar(k);
  }

  setShip(id: ShipId, barrels: number): void {
    const key = `${id}:${barrels}`;
    if (key === this.shipKey) return;
    this.shipKey = key;
    if (this.ship) this.stage.scene.remove(this.ship.group);
    this.ship = buildShip(id, barrels);
    this.stage.scene.add(this.ship.group);
    this.shipGlow.copy(hdr(SHIPS[id].color, 3));
    this.reticleMat.color.copy(hdr(SHIPS[id].color, 1.6));
    (this.shieldMat.uniforms.uColor.value as THREE.Color).copy(hdr(SHIPS[id].color, 1.2));
  }

  sync(g: Game, dt: number, fxDt: number): void {
    this.t += dt;
    const t = this.t;
    for (const b of this.all) b.begin();
    const playing = g.state === 'playing' || g.state === 'levelup' || g.state === 'paused' || g.state === 'gameover';

    this.syncShip(g, dt, fxDt, playing);
    this.syncEnemies(g, t);
    this.syncProjectiles(g);
    this.syncPickups(g);

    for (const b of this.all) b.end();

    // Shift the deck colours to red while a boss is alive.
    const boss = !!g.boss;
    this.tint.lerp(boss ? BOSS_TINT : BASE_TINT, Math.min(1, dt * 1.5));
    this.edge.lerp(boss ? BOSS_EDGE : BASE_EDGE, Math.min(1, dt * 1.5));
    this.stage.floor.setTint(this.tint, this.edge);
  }

  private syncShip(g: Game, dt: number, fxDt: number, playing: boolean): void {
    const ship = this.ship;
    const p = g.player;
    const t = this.t;
    const grp = ship.group;
    let thrust: number;
    let visible = true;
    if (playing) {
      visible = p.alive;
      grp.position.set(p.x, 0.75 + Math.sin(t * 3) * 0.08, p.z);
      grp.rotation.set(0, -p.angle, 0);
      ship.body.rotation.x = p.bank;
      thrust = p.dashT > 0 ? 3 : 0.35 + p.thrust * 1.5;
      if (p.invuln > 0 && p.dashT <= 0 && Math.floor(t * 18) % 2 === 0 && p.invuln < 2) visible = false;
    } else if (g.state === 'hangar') {
      grp.position.set(0, 1.4 + Math.sin(t * 1.4) * 0.25, 0);
      grp.rotation.set(0, t * 0.45, 0);
      ship.body.rotation.x = Math.sin(t * 0.8) * 0.15;
      thrust = 0.8 + Math.sin(t * 2) * 0.2;
    } else {
      grp.position.set(0, 1.2 + Math.sin(t * 1.2) * 0.3, 0);
      grp.rotation.set(0, -(-Math.PI / 2 + Math.sin(t * 0.35) * 0.6), 0);
      ship.body.rotation.x = Math.sin(t * 0.7) * 0.25;
      thrust = 1;
    }
    grp.visible = visible;
    for (const f of ship.flames) {
      f.scale.set(thrust * (0.85 + Math.random() * 0.3), 1 + Math.random() * 0.1, 1 + Math.random() * 0.1);
    }

    if (visible && fxDt > 0) {
      grp.updateMatrixWorld(true);
      for (const e of ship.exhaust) {
        this.v.copy(e);
        ship.body.localToWorld(this.v);
        const bx = playing ? -Math.cos(p.angle) * 14 : 0;
        const bz = playing ? -Math.sin(p.angle) * 14 : 0;
        g.fx.exhaust(this.v.x, this.v.y, this.v.z, bx, bz, SHIPS[g.save.selectedShip].accent, 0.7 + thrust * 0.5);
      }
    }

    // Shield bubble.
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 2.5);
    const invulnPower = playing && p.invuln > 1;
    const a = Math.max(this.shieldFlash, invulnPower ? 0.55 : 0, playing && p.shield > 0 ? 0.05 : 0);
    this.shieldMat.uniforms.uAlpha.value = a;
    this.shieldMat.uniforms.uTime.value = t;
    this.shield.visible = visible && a > 0.01;
    this.shield.position.copy(grp.position);

    this.reticle.visible = g.state === 'playing' && p.alive && !!g.reticle;
    if (g.reticle) {
      this.reticle.position.set(g.reticle.x, 0.2, g.reticle.z);
      this.reticle.rotation.y = t * 1.5;
    }

    // Drones.
    for (const d of g.drones) {
      this.drone.add(d.x, 0.9, d.z, t * 3, 1, 1, 1, this.shipGlow);
      this.droneRing.add(d.x, 0.9, d.z, -t * 2, 1, 1, 1, WHITE);
    }
  }

  private syncEnemies(g: Game, t: number): void {
    const c = this.c;
    const c2 = this.c2;
    for (const e of g.enemies) {
      if (!e.alive) continue;
      const grow = Math.min(1, 0.25 + e.age * 4);
      if (e.kind === 'boss') continue;
      const b = this.enemy[e.kind];
      const s = e.scale * grow * 1.2;
      const y = 0.7 + Math.sin(t * 3 + e.seed) * 0.15;
      const yaw = -e.angle;
      // Body tint: elites gold, white flash on hit.
      if (e.elite) c.copy(GOLD_TINT);
      else c.copy(WHITE);
      if (e.flash > 0) c.lerp(c2.setScalar(3), e.flash * 0.7);
      b.body.add(e.x, y, e.z, yaw, s, s, s, c);
      c.setHex(e.elite ? 0xffd34a : e.def.color).multiplyScalar(3 * (1 + e.charge * 1.6));
      if (e.flash > 0) c.lerp(c2.setScalar(5), e.flash * 0.45);
      b.glow.add(e.x, y, e.z, yaw, s, s, s, c);
      if (e.elite) this.halo.add(e.x, 0.15, e.z, t * 2, e.radius * 1.35, 1, e.radius * 1.35, this.color(0xffd34a, 2.5));
      if (e.kind === 'ram' && e.state === 1) {
        const a = Math.atan2(e.aimZ, e.aimX);
        const pulse = 0.5 + 0.5 * Math.sin(t * 40);
        this.telegraph.add(e.x, 0.3, e.z, -a, 45, 1, 1.3 + e.charge, this.color(0xff5a2a, 0.35 + e.charge * 0.9 * pulse));
      }
    }

    const boss = g.boss;
    const bm = this.boss;
    bm.group.visible = !!boss && boss.alive;
    if (boss && boss.alive) {
      const grow = Math.min(1, 0.3 + boss.age * 0.6);
      bm.group.position.set(boss.x, 0.8 + Math.sin(t * 1.5) * 0.3, boss.z);
      bm.group.rotation.y = -boss.angle;
      bm.group.scale.setScalar(grow);
      bm.ring.rotation.y = boss.spin * 1.5 + boss.angle;
      const pulse = 1 + Math.sin(t * 6) * 0.08 + boss.charge * 0.35;
      bm.core.scale.setScalar(pulse);
      const phaseCol = boss.phase === 0 ? 0xff2a4a : boss.phase === 1 ? 0xff6a1a : 0xff1ad8;
      bm.coreMat.color.setHex(phaseCol).multiplyScalar(3 + boss.charge * 3).lerp(c2.setScalar(5), boss.flash * 0.2);
      bm.glowMat.color.setHex(phaseCol).multiplyScalar(2.4).lerp(c2.setScalar(4), boss.flash * 0.15);
    }
  }

  private syncProjectiles(g: Game): void {
    const c = this.c;
    for (const b of g.bullets) {
      if (b.crit) c.setRGB(6, 4.6, 1.3);
      else if (b.hot) c.setRGB(6.5, 2.4, 0.7);
      else if (b.drone) c.setRGB(1.5, 4.5, 5.5);
      else c.copy(this.shipGlow).multiplyScalar(1.3);
      const r = b.radius / 0.6;
      this.bolt.add(b.x, 0.75, b.z, -b.angle, 1 + (r - 1) * 0.5, r, r, c);
    }
    for (const b of g.eBullets) {
      const s = (b.big ? 1.7 : 1) * (1 + Math.sin(b.age * 22) * 0.1);
      this.orbGlow.add(b.x, 0.8, b.z, 0, s * 1.55, s * 1.55, s * 1.55, this.color(b.color, 1.6));
      this.orbCore.add(b.x, 0.8, b.z, 0, s * 0.72, s * 0.72, s * 0.72, c.setHex(b.color).multiplyScalar(1.2).lerp(WHITE, 0.6).multiplyScalar(3));
    }
    for (const m of g.missiles) this.missile.add(m.x, 0.8, m.z, -m.angle, 1, 1, 1, c.setRGB(6, 3, 1.2));
  }

  private syncPickups(g: Game): void {
    const c = this.c;
    const labels: { x: number; z: number; text: string; color: number }[] = [];
    for (const k of g.pickups) {
      if (k.life < 3 && Math.floor(k.life * 8) % 2 === 0) continue;
      const bob = 0.9 + Math.sin(k.age * 4 + k.seed) * 0.25;
      if (k.kind === 'xp') {
        if (k.value >= 20) c.setRGB(5, 3.4, 0.6);
        else if (k.value >= 5) c.setRGB(1, 5, 1.8);
        else c.setRGB(0.7, 3, 5.5);
        const s = (k.value >= 20 ? 1.7 : k.value >= 5 ? 1.35 : 1.1) * 1.3;
        this.gem.add(k.x, bob, k.z, k.age * 3 + k.seed, s, s, s, c);
      } else if (k.power) {
        const def = POWERUP_BY_ID[k.power];
        const pulse = 1 + Math.sin(k.age * 6) * 0.1;
        this.powerCore.add(k.x, bob + 0.3, k.z, k.age * 2, pulse, pulse, pulse, this.color(def.color, 3.5));
        this.powerShell.add(k.x, bob + 0.3, k.z, k.age * 1.7, 1, 1, 1, this.color(def.color, 2.2), 0, k.age * 2.3);
        this.powerShell.add(k.x, bob + 0.3, k.z, -k.age * 1.3, 0.8, 0.8, 0.8, this.color(def.color, 1.6), k.age * 1.9, 0);
        labels.push({ x: k.x, z: k.z, text: def.name, color: def.color });
      }
    }
    g.ui.syncLabels(labels);
  }
}
