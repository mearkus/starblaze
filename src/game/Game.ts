/**
 * The simulation: run lifecycle, player, weapons, collisions, scoring, waves, level-ups and
 * power-ups. Rendering reads this state through View; UI is driven through the UI class.
 */
import { AudioEngine } from '../core/Audio';
import { Input } from '../core/Input';
import { SpatialHash } from '../core/SpatialHash';
import { writeSave, type SaveData } from '../core/Save';
import { TAU, chance, clamp, damp, dampAngle, dist2, pick, rand, weightedPick } from '../core/math';
import type { Stage } from '../render/Stage';
import type { Fx } from '../render/Fx';
import type { UI } from '../ui/UI';
import { View } from '../render/View';
import { updateEnemy } from './ai';
import { ARENA, COMBO_TIME, DASH_SPEED_MUL, DASH_TIME, MAX_ENEMIES, MAX_ENEMY_BULLETS, PLAYER_RADIUS } from './config';
import { ENEMIES, SPAWNABLE, type EnemyKind } from './enemies';
import { PERK_BY_ID, rollPerks, type ChoiceId, type PerkId, type PerkTiers } from './perks';
import { POWERUPS, POWERUP_BY_ID, type PowerUpId } from './powerups';
import { comboMultiplier, creditsForRun, xpToNext } from './progression';
import { SHIPS } from './ships';
import { computeStats, type PlayerStats } from './stats';
import type { Bullet, Enemy, EnemyBullet, Missile, PendingSpawn, Pickup, Shockwave } from './types';
import { UPGRADE_BY_ID, canBuy, upgradeCost, type UpgradeId } from './upgrades';
import { bossHp, buildWave, type SpawnGroup, type WavePlan } from './waves';

export type GameState = 'title' | 'hangar' | 'playing' | 'levelup' | 'paused' | 'gameover';

export interface Player {
  x: number;
  z: number;
  vx: number;
  vz: number;
  angle: number;
  aim: number;
  bank: number;
  hull: number;
  shield: number;
  shieldT: number;
  invuln: number;
  dashT: number;
  dashCd: number;
  dashX: number;
  dashZ: number;
  bombs: number;
  fireT: number;
  missileT: number;
  novaT: number;
  droneFireT: number;
  level: number;
  xp: number;
  alive: boolean;
  thrust: number;
}

export interface RunSummary {
  score: number;
  wave: number;
  level: number;
  kills: number;
  maxCombo: number;
  time: number;
  credits: number;
  bosses: number;
  newHigh: boolean;
}

const COLORS_ATTRACT = [0xff4a2a, 0xff2ad4, 0x35d4ff, 0x7dff3a, 0xffcc22, 0x9d6bff, 0xff8a1a];

export class Game {
  state: GameState = 'title';
  readonly view: View;
  readonly fx: Fx;
  stats: PlayerStats;
  perks: PerkTiers = {};
  autofire = true;

  player: Player = this.freshPlayer();
  enemies: Enemy[] = [];
  bullets: Bullet[] = [];
  eBullets: EnemyBullet[] = [];
  missiles: Missile[] = [];
  pickups: Pickup[] = [];
  spawns: PendingSpawn[] = [];
  shockwaves: Shockwave[] = [];
  drones: { x: number; z: number }[] = [];
  powerTimers: Partial<Record<PowerUpId, number>> = {};
  boss: Enemy | null = null;
  reticle: { x: number; z: number } | null = null;

  wave = 0;
  plan: WavePlan | null = null;
  waveTime = 0;
  groupIdx = 0;
  waveBreak = 0;
  score = 0;
  combo = 0;
  comboTimer = 0;
  maxCombo = 0;
  kills = 0;
  bossesKilled = 0;
  wavesCleared = 0;
  runTime = 0;
  pendingLevelUps = 0;
  choices: ChoiceId[] = [];
  choiceFocus = 0;

  private hash = new SpatialHash<Enemy>(8);
  private nextId = 1;
  private timeScale = 1;
  private slowT = 0;
  private hitStopT = 0;
  private deathT = 0;
  private attractT = 0;
  private droneAngle = 0;
  private pickupChain = 0;
  private lastPickup = 0;
  private timers: { t: number; fn: () => void }[] = [];
  private seenKinds = new Set<EnemyKind>();
  realTime = 0;

  constructor(
    readonly stage: Stage,
    readonly audio: AudioEngine,
    readonly input: Input,
    readonly ui: UI,
    readonly save: SaveData,
  ) {
    this.fx = stage.fx;
    this.fx.shakeEnabled = save.settings.shake;
    this.view = new View(stage);
    this.stats = computeStats(save.selectedShip, save.upgrades, {});
    this.view.setShip(save.selectedShip, this.stats.projectiles);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'playing' || this.state === 'levelup')) this.pause();
    });
  }

  private freshPlayer(): Player {
    return {
      x: 0, z: 0, vx: 0, vz: 0, angle: -Math.PI / 2, aim: -Math.PI / 2, bank: 0,
      hull: 100, shield: 30, shieldT: 0, invuln: 0, dashT: 0, dashCd: 0, dashX: 0, dashZ: 0,
      bombs: 1, fireT: 0, missileT: 1, novaT: 3, droneFireT: 0.5, level: 1, xp: 0, alive: true, thrust: 0,
    };
  }

  persist(): void {
    writeSave(window.localStorage, this.save);
  }

  // ------------------------------------------------------------------ lifecycle

  goTitle(): void {
    this.state = 'title';
    this.stage.mode = 'title';
    this.clearWorld();
    this.audio.intensity = 0;
    this.player = this.freshPlayer();
    this.view.setShip(this.save.selectedShip, computeStats(this.save.selectedShip, this.save.upgrades, {}).projectiles);
    this.ui.showTitle(this.save);
  }

  goHangar(): void {
    this.state = 'hangar';
    this.stage.mode = 'hangar';
    this.clearWorld();
    this.audio.intensity = 0;
    this.player = this.freshPlayer();
    this.refreshHangarShip();
    this.ui.showHangar(this.save);
  }

  private refreshHangarShip(): void {
    const s = computeStats(this.save.selectedShip, this.save.upgrades, {});
    this.view.setShip(this.save.selectedShip, s.projectiles);
  }

  startRun(): void {
    this.clearWorld();
    this.perks = {};
    this.stats = computeStats(this.save.selectedShip, this.save.upgrades, this.perks);
    const p = (this.player = this.freshPlayer());
    p.hull = this.stats.maxHull;
    p.shield = this.stats.maxShield;
    p.bombs = this.stats.startBombs;
    p.invuln = 1.5;
    this.wave = 0;
    this.plan = null;
    this.waveBreak = 1.4;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.kills = 0;
    this.bossesKilled = 0;
    this.wavesCleared = 0;
    this.runTime = 0;
    this.pendingLevelUps = 0;
    this.powerTimers = {};
    this.timeScale = 1;
    this.slowT = 0;
    this.deathT = 0;
    this.seenKinds.clear();
    this.state = 'playing';
    this.stage.mode = 'play';
    this.audio.intensity = 1;
    this.view.setShip(this.save.selectedShip, this.stats.projectiles);
    this.fx.shockwave(0, 0, SHIPS[this.save.selectedShip].color, 24, 0.8, 3);
    this.ui.showHud(this);
    this.ui.updatePerks(this.perks);
  }

  private clearWorld(): void {
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.eBullets.length = 0;
    this.missiles.length = 0;
    this.pickups.length = 0;
    this.spawns.length = 0;
    this.shockwaves.length = 0;
    this.drones.length = 0;
    this.timers.length = 0;
    this.boss = null;
    this.fx.clear();
    this.stage.warp = 0;
    this.ui.bossBar(null);
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'levelup') return;
    this.resumeState = this.state;
    this.state = 'paused';
    this.ui.showPause(this.save.settings, this.autofire);
  }

  private resumeState: GameState = 'playing';

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.resumeState;
    this.ui.hidePause();
  }

  quitRun(): void {
    this.ui.hidePause();
    if (this.player.alive && this.runTime > 0) this.finishRun();
    else this.goTitle();
  }

  // ------------------------------------------------------------------ hangar actions

  buyUpgrade(id: UpgradeId): boolean {
    const def = UPGRADE_BY_ID[id];
    const lvl = this.save.upgrades[id] ?? 0;
    if (!canBuy(def, lvl, this.save.credits)) {
      this.audio.denied();
      return false;
    }
    this.save.credits -= upgradeCost(def, lvl);
    this.save.upgrades[id] = lvl + 1;
    this.persist();
    this.audio.buy();
    this.refreshHangarShip();
    this.fx.shockwave(0, 0, SHIPS[this.save.selectedShip].color, 12, 0.6, 2.5);
    this.fx.sparks(0, 0, SHIPS[this.save.selectedShip].color, 40, undefined, 20);
    return true;
  }

  selectShip(id: keyof typeof SHIPS): boolean {
    const def = SHIPS[id];
    if (!this.save.unlockedShips.includes(id)) {
      if (this.save.credits < def.cost) {
        this.audio.denied();
        return false;
      }
      this.save.credits -= def.cost;
      this.save.unlockedShips.push(id);
      this.audio.buy();
    } else {
      this.audio.ui();
    }
    this.save.selectedShip = id;
    this.persist();
    this.refreshHangarShip();
    this.fx.shockwave(0, 0, def.color, 14, 0.7, 3);
    return true;
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.realTime += dt;
    const input = this.input;
    input.poll();
    if (input.consume('mute')) {
      const s = this.save.settings;
      const on = !(s.music || s.sfx);
      s.music = on;
      s.sfx = on;
      this.audio.applySettings(s);
      this.persist();
      this.ui.toast(on ? 'Sound on' : 'Sound muted');
    }
    if (input.consume('autofire') && (this.state === 'playing' || this.state === 'paused')) {
      this.autofire = !this.autofire;
      this.ui.toast(this.autofire ? 'Auto-fire ON' : 'Auto-fire OFF — hold mouse to shoot');
    }

    let fxDt = dt;
    switch (this.state) {
      case 'title':
        this.attract(dt);
        if (input.consume('confirm')) this.ui.click('launch');
        break;
      case 'hangar':
        if (input.consume('pause')) this.goTitle();
        if (input.consume('confirm')) this.ui.click('launch');
        break;
      case 'playing':
        if (input.consume('pause')) {
          this.pause();
          fxDt = 0;
          break;
        }
        fxDt = this.simulate(dt);
        break;
      case 'levelup':
        fxDt = dt * 0.15;
        this.levelUpInput();
        break;
      case 'paused':
        fxDt = 0;
        if (input.consume('pause')) this.resume();
        break;
      case 'gameover':
        fxDt = this.simulate(dt);
        if (input.consume('confirm')) this.ui.click('retry');
        break;
    }

    const p = this.player;
    this.stage.warp = damp(this.stage.warp, (this.powerTimers.timewarp ?? 0) > 0 ? 1 : 0, 4, dt);
    this.stage.update(fxDt, p.x, p.z, this.audio.beat());
    this.view.sync(this, dt, fxDt);
    if (this.state === 'playing' || this.state === 'levelup' || this.state === 'paused') this.ui.updateHud(this);
    input.endFrame();
  }

  private attract(dt: number): void {
    this.attractT -= dt;
    if (this.attractT <= 0) {
      this.attractT = rand(0.25, 0.7);
      const x = rand(-48, 48);
      const z = rand(-28, 22);
      if (Math.hypot(x, z) > 10) this.fx.explosion(x, z, pick(COLORS_ATTRACT), rand(0.8, 2.6));
    }
  }

  private levelUpInput(): void {
    const i = this.input;
    if (i.consume('one')) this.choosePerk(0);
    else if (i.consume('two')) this.choosePerk(1);
    else if (i.consume('three')) this.choosePerk(2);
    else if (i.consume('confirm')) this.choosePerk(this.choiceFocus);
    else {
      if (i.consume('left')) this.choiceFocus = (this.choiceFocus + this.choices.length - 1) % this.choices.length;
      if (i.consume('right')) this.choiceFocus = (this.choiceFocus + 1) % this.choices.length;
      this.ui.focusChoice(this.choiceFocus);
    }
  }

  /** Runs one simulation step. Returns the scaled dt used, for effects. */
  private simulate(realDt: number): number {
    if (this.hitStopT > 0) {
      this.hitStopT -= realDt;
      return realDt * 0.05;
    }
    if (this.slowT > 0) this.slowT -= realDt;
    else this.timeScale = damp(this.timeScale, 1, 6, realDt);
    const dt = realDt * this.timeScale;
    const p = this.player;
    this.runTime += p.alive ? dt : 0;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }

    if (p.alive) {
      this.updatePlayer(dt);
      this.updateWeapons(dt);
    }
    const edt = dt * ((this.powerTimers.timewarp ?? 0) > 0 ? 0.35 : 1);
    for (const e of this.enemies) if (e.alive) updateEnemy(this, e, edt);
    this.rebuildHash();
    this.separate();
    this.updateBullets(dt);
    this.updateMissiles(dt);
    this.updateDrones(dt);
    if (p.alive) this.collidePlayer();
    this.updateEnemyBullets(edt);
    this.updateShockwaves(dt);
    this.updatePickups(dt);
    this.updateSpawns(dt);
    if (p.alive) this.updateWaves(dt);
    this.updatePowerTimers(dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);

    if (!p.alive && this.state === 'playing') {
      this.deathT -= realDt;
      if (this.deathT <= 0) this.finishRun();
    }
    return dt;
  }

  // ------------------------------------------------------------------ player

  private updatePlayer(dt: number): void {
    const p = this.player;
    const s = this.stats;
    const mv = this.input.move();

    if (this.input.consume('dash') && p.dashCd <= 0) this.dash(mv.x, mv.y);
    if (this.input.consume('bomb')) this.bomb();

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashX * s.speed * DASH_SPEED_MUL;
      p.vz = p.dashZ * s.speed * DASH_SPEED_MUL;
      this.fx.particles.emit({
        count: 3, x: p.x, z: p.z, y: 0.6, spread: 1.2, speed: [0, 2], life: [0.2, 0.35], size: [1.2, 2.2],
        sizeEnd: 0.2, color: this.view.shipGlow, drag: 2,
      });
    } else {
      p.vx = damp(p.vx, mv.x * s.speed, s.accel, dt);
      p.vz = damp(p.vz, mv.y * s.speed, s.accel, dt);
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const mx = ARENA.halfW - 1.5;
    const mz = ARENA.halfH - 1.5;
    if (Math.abs(p.x) > mx) {
      p.x = Math.sign(p.x) * mx;
      p.vx *= -0.3;
    }
    if (Math.abs(p.z) > mz) {
      p.z = Math.sign(p.z) * mz;
      p.vz *= -0.3;
    }

    const aim = this.input.aim();
    this.reticle = null;
    if (aim?.kind === 'point') {
      const gp = this.stage.screenToGround(aim.clientX, aim.clientY);
      if (gp) {
        this.reticle = gp;
        if (dist2(gp.x, gp.z, p.x, p.z) > 1) p.aim = Math.atan2(gp.z - p.z, gp.x - p.x);
      }
    } else if (aim?.kind === 'dir') {
      p.aim = Math.atan2(aim.y, aim.x);
    } else {
      // Touch / keyboard-only: auto-aim at the closest threat, else face the direction of travel.
      const t = this.nearestEnemy(p.x, p.z, 75);
      if (t) p.aim = Math.atan2(t.z - p.z, t.x - p.x);
      else if (Math.hypot(mv.x, mv.y) > 0.2) p.aim = Math.atan2(mv.y, mv.x);
    }
    p.angle = dampAngle(p.angle, p.aim, 28, dt);

    const speed = Math.hypot(p.vx, p.vz);
    p.thrust = damp(p.thrust, Math.min(1, speed / s.speed), 6, dt);
    const lateral = -Math.sin(p.angle) * p.vx + Math.cos(p.angle) * p.vz;
    p.bank = damp(p.bank, clamp(-lateral / s.speed, -1, 1) * 0.65, 8, dt);

    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    if (p.shieldT > 0) p.shieldT -= dt;
    else p.shield = Math.min(s.maxShield, p.shield + s.shieldRegen * dt);
  }

  private dash(mx: number, my: number): void {
    const p = this.player;
    let dx = mx;
    let dz = my;
    const l = Math.hypot(dx, dz);
    if (l < 0.2) {
      dx = Math.cos(p.angle);
      dz = Math.sin(p.angle);
    } else {
      dx /= l;
      dz /= l;
    }
    p.dashX = dx;
    p.dashZ = dz;
    p.dashT = DASH_TIME;
    p.dashCd = this.stats.dashCooldown;
    p.invuln = Math.max(p.invuln, DASH_TIME + 0.12);
    this.audio.dash();
    this.fx.rings.spawn(p.x, p.z, 1, 6, 0.3, this.view.shipGlow);
    this.stage.kick(1.5);
  }

  bomb(): void {
    const p = this.player;
    if (!p.alive) return;
    if (p.bombs <= 0) {
      this.audio.denied();
      this.ui.toast('No bombs left');
      return;
    }
    p.bombs--;
    this.addShockwave(p.x, p.z, 90, 120, this.stats.bombDamage, this.stats.bombDamage * 0.5, true, 0xffffff);
    this.fx.shockwave(p.x, p.z, 0x9fe8ff, 90, 0.75, 2.2);
    this.fx.rings.spawn(p.x, p.z, 1, 60, 0.5, this.view.color(SHIPS[this.save.selectedShip].color, 1.4));
    this.fx.particles.emit({
      count: 220, x: p.x, z: p.z, y: 1, speed: [40, 120], up: [0, 10], life: [0.4, 0.9], size: [0.5, 1.1],
      color: this.view.shipGlow, drag: 2.2,
    });
    this.fx.flash(p.x, p.z, 0xbfefff, 700);
    this.fx.shake(0.9);
    this.stage.flash = 0.22;
    this.stage.kick(7);
    this.slowmo(0.35, 0.35);
    this.audio.bomb();
    p.invuln = Math.max(p.invuln, 1.0);
  }

  damagePlayer(amount: number, sx: number, sz: number): void {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || p.dashT > 0) return;
    let d = amount;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, d);
      p.shield -= absorbed;
      d -= absorbed;
      this.view.shieldFlash = 1;
      this.audio.shieldHit();
    }
    p.shieldT = this.stats.shieldDelay;
    p.invuln = 0.75;
    this.fx.sparks(p.x, p.z, d > 0 ? 0xff3b3b : 0x55ddff, 26, Math.atan2(p.z - sz, p.x - sx), 30);
    this.fx.shake(d > 0 ? 0.45 : 0.2);
    this.stage.kick(1.5);
    if (d > 0) {
      p.hull -= d;
      this.stage.hurt = Math.min(1, 0.45 + d / 40);
      this.audio.playerHit();
      if (this.combo >= 10) this.ui.floater(p.x, 3, p.z, 'COMBO LOST', 'bad');
      this.combo = 0;
      this.comboTimer = 0;
    }
    if (p.hull <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    const p = this.player;
    p.alive = false;
    p.hull = 0;
    const c = SHIPS[this.save.selectedShip].color;
    this.fx.explosion(p.x, p.z, c, 5);
    this.later(0.15, () => this.fx.explosion(p.x + 2, p.z - 1, 0xbfefff, 3));
    this.later(0.3, () => this.fx.explosion(p.x - 2, p.z + 1, SHIPS[this.save.selectedShip].accent, 4));
    this.audio.bigBoom();
    this.slowmo(0.25, 1.2);
    this.stage.flash = 0.3;
    this.fx.shake(1);
    this.deathT = 2.4;
    this.audio.intensity = 0;
    this.ui.bossBar(null);
  }

  private finishRun(): void {
    const credits = creditsForRun(this.score, this.wavesCleared, this.bossesKilled, this.stats.creditMul);
    const s = this.save;
    const newHigh = this.score > s.highScore;
    s.credits += credits;
    s.highScore = Math.max(s.highScore, this.score);
    s.bestWave = Math.max(s.bestWave, this.wave);
    s.totalKills += this.kills;
    s.runs += 1;
    this.persist();
    this.state = 'gameover';
    this.audio.intensity = 0;
    this.ui.showGameOver({
      score: this.score,
      wave: this.wave,
      level: this.player.level,
      kills: this.kills,
      maxCombo: this.maxCombo,
      time: this.runTime,
      credits,
      bosses: this.bossesKilled,
      newHigh,
    }, s);
  }

  // ------------------------------------------------------------------ weapons

  private updateWeapons(dt: number): void {
    const p = this.player;
    const s = this.stats;
    const od = (this.powerTimers.overdrive ?? 0) > 0;
    const firing = this.autofire || this.input.firing();
    const interval = s.fireInterval / (od ? 2 : 1);
    p.fireT -= dt;
    if (firing) {
      let guard = 0;
      while (p.fireT <= 0 && guard++ < 4) {
        this.fireVolley(od);
        p.fireT += interval;
      }
    } else if (p.fireT < 0) p.fireT = 0;

    if (s.missiles > 0) {
      p.missileT -= dt;
      if (p.missileT <= 0 && this.enemies.length > 0) {
        p.missileT = s.missileInterval;
        this.launchMissiles(s.missiles);
      }
    }

    if ((this.perks.nova ?? 0) > 0) {
      p.novaT -= dt;
      if (p.novaT <= 0) {
        p.novaT = s.novaInterval;
        this.addShockwave(p.x, p.z, s.novaRadius, 55, s.novaDamage, s.novaDamage, true, 0x7ff0ff);
        this.fx.shockwave(p.x, p.z, 0x4fdcff, s.novaRadius, s.novaRadius / 55 + 0.15, 2.5);
        this.audio.nova();
      }
    }
  }

  private fireVolley(od: boolean): void {
    const p = this.player;
    const s = this.stats;
    const spreadPU = (this.powerTimers.spread ?? 0) > 0;
    const n = s.projectiles + (spreadPU ? 3 : 0);
    const spreadA = spreadPU ? 0.16 : s.spread;
    const ca = Math.cos(p.angle);
    const sa = Math.sin(p.angle);
    for (let i = 0; i < n; i++) {
      const off = i - (n - 1) / 2;
      const fan = n > 2 ? off * spreadA : off * 0.02;
      const lateral = n > 2 ? off * 0.55 : off * 2.3;
      const x = p.x + ca * 2.4 - sa * lateral;
      const z = p.z + sa * 2.4 + ca * lateral;
      this.spawnBolt(x, z, p.angle + fan, od, false);
    }
    for (let k = 0; k < s.rearGuns; k++) {
      const a = p.angle + Math.PI + (s.rearGuns > 1 ? (k === 0 ? -0.22 : 0.22) : 0);
      this.spawnBolt(p.x - ca * 2, p.z - sa * 2, a, od, false);
    }
    this.fx.particles.emit({
      count: 3, x: p.x + ca * 2.8, z: p.z + sa * 2.8, y: 0.6, speed: [4, 14], dir: p.angle, arc: 0.9,
      life: [0.05, 0.12], size: [0.8, 1.4], color: this.view.shipGlow, drag: 6,
    });
    this.audio.shoot(od ? 1.25 : rand(0.95, 1.05));
  }

  private spawnBolt(x: number, z: number, a: number, hot: boolean, drone: boolean): void {
    const s = this.stats;
    const crit = Math.random() < s.critChance;
    const sp = s.bulletSpeed * (drone ? 0.85 : 1);
    this.bullets.push({
      x, z,
      vx: Math.cos(a) * sp + this.player.vx * 0.25,
      vz: Math.sin(a) * sp + this.player.vz * 0.25,
      angle: a,
      life: 0.85,
      damage: (drone ? s.droneDamage * 0.6 : s.damage) * (hot ? 1.3 : 1) * (crit ? s.critMul : 1),
      radius: 0.6 * s.bulletSize * (hot ? 1.3 : 1) * (crit ? 1.25 : 1),
      pierce: s.pierce,
      crit,
      hits: [],
      hot,
      drone,
    });
  }

  private launchMissiles(n: number): void {
    const p = this.player;
    const targets = this.nearestEnemies(p.x, p.z, n, 90);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const a = p.angle + side * (1.3 + 0.18 * Math.floor(i / 2)) + Math.PI * 0.15 * -side;
      this.missiles.push({
        x: p.x, z: p.z, vx: Math.cos(a) * 22, vz: Math.sin(a) * 22, angle: a, speed: 22, life: 3.2,
        target: targets.length ? targets[i % targets.length] : null, damage: this.stats.missileDamage,
      });
    }
    this.audio.missile();
  }

  nearestEnemy(x: number, z: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxDist * maxDist;
    for (const e of this.enemies) {
      if (!e.alive || e.age < 0.3) continue;
      const d = dist2(x, z, e.x, e.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  nearestEnemies(x: number, z: number, n: number, maxDist: number): Enemy[] {
    const md2 = maxDist * maxDist;
    const list = this.enemies
      .filter((e) => e.alive && dist2(x, z, e.x, e.z) < md2)
      .sort((a, b) => dist2(x, z, a.x, a.z) - dist2(x, z, b.x, b.z));
    return list.slice(0, n);
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (const e of this.enemies) if (e.alive) this.hash.insert(e, e.x, e.z, e.radius);
  }

  private separate(): void {
    const seen = new Set<number>();
    for (const e of this.enemies) {
      if (!e.alive || e.kind === 'boss') continue;
      seen.clear();
      this.hash.query(e.x, e.z, e.radius, (o) => {
        if (o === e || !o.alive || seen.has(o.id)) return;
        seen.add(o.id);
        const dx = e.x - o.x;
        const dz = e.z - o.z;
        const min = (e.radius + o.radius) * 0.9;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.25;
          const w = o.kind === 'boss' ? 2 : 1;
          e.x += (dx / d) * push * w;
          e.z += (dz / d) * push * w;
        }
      });
    }
  }

  private updateBullets(dt: number): void {
    const bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && (Math.abs(b.x) > ARENA.halfW || Math.abs(b.z) > ARENA.halfH)) {
        dead = true;
        this.fx.sparks(clamp(b.x, -ARENA.halfW, ARENA.halfW), clamp(b.z, -ARENA.halfH, ARENA.halfH), 0x55e0ff, 3, b.angle + Math.PI, 14);
      }
      if (!dead) {
        let hit: Enemy | null = null;
        this.hash.query(b.x, b.z, b.radius, (e) => {
          if (!e.alive || b.hits.includes(e.id)) return;
          const r = e.radius + b.radius;
          if (dist2(b.x, b.z, e.x, e.z) < r * r) {
            hit = e;
            return true;
          }
        });
        if (hit) {
          const e = hit as Enemy;
          this.fx.sparks(b.x, b.z, b.crit ? 0xffd34a : e.def.color, b.crit ? 8 : 4, b.angle + Math.PI, 20);
          this.damageEnemy(e, b.damage, b.angle, b.crit ? 2 : 1);
          if (!b.drone && this.stats.chainChance > 0 && Math.random() < this.stats.chainChance) this.chainLightning(e);
          if (b.pierce > 0) {
            b.pierce--;
            b.hits.push(e.id);
          } else dead = true;
        }
      }
      if (dead) {
        bs[i] = bs[bs.length - 1];
        bs.pop();
      }
    }
  }

  private chainLightning(from: Enemy): void {
    let cur = from;
    const hit = new Set<number>([from.id]);
    for (let k = 0; k < this.stats.chainTargets; k++) {
      let best: Enemy | null = null;
      let bd = 16 * 16;
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e.id)) continue;
        const d = dist2(cur.x, cur.z, e.x, e.z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) break;
      this.fx.lightning(cur.x, cur.z, best.x, best.z, 0x8fd0ff);
      hit.add(best.id);
      this.damageEnemy(best, this.stats.chainDamage, 0, 0);
      cur = best;
    }
    this.audio.zap();
  }

  private updateMissiles(dt: number): void {
    const ms = this.missiles;
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      m.life -= dt;
      if (!m.target || !m.target.alive) m.target = this.nearestEnemies(m.x, m.z, 1, 80)[0] ?? null;
      if (m.target) {
        const want = Math.atan2(m.target.z - m.z, m.target.x - m.x);
        m.angle = dampAngle(m.angle, want, 4 + (3.2 - m.life) * 3, dt);
      }
      m.speed = Math.min(80, m.speed + 95 * dt);
      m.vx = Math.cos(m.angle) * m.speed;
      m.vz = Math.sin(m.angle) * m.speed;
      m.x += m.vx * dt;
      m.z += m.vz * dt;
      this.fx.exhaust(m.x - Math.cos(m.angle) * 0.6, 0.8, m.z - Math.sin(m.angle) * 0.6, 0, 0, 0xff8a3a, 0.9);
      let boom = m.life <= 0 || Math.abs(m.x) > ARENA.halfW || Math.abs(m.z) > ARENA.halfH;
      if (!boom) {
        this.hash.query(m.x, m.z, 1, (e) => {
          if (!e.alive) return;
          const r = e.radius + 0.8;
          if (dist2(m.x, m.z, e.x, e.z) < r * r) {
            boom = true;
            return true;
          }
        });
      }
      if (boom) {
        this.fx.explosion(m.x, m.z, 0xff7a2a, 0.9);
        this.audio.explode(0.6);
        const r = 5;
        for (const e of this.enemies) {
          if (!e.alive) continue;
          const rr = r + e.radius;
          if (dist2(m.x, m.z, e.x, e.z) < rr * rr) this.damageEnemy(e, m.damage, Math.atan2(e.z - m.z, e.x - m.x), 1.5);
        }
        ms[i] = ms[ms.length - 1];
        ms.pop();
      }
    }
  }

  private updateDrones(dt: number): void {
    const n = this.player.alive ? this.stats.drones : 0;
    this.drones.length = n;
    if (n === 0) return;
    const p = this.player;
    this.droneAngle += dt * 2.3;
    const r = 5.2;
    for (let i = 0; i < n; i++) {
      const a = this.droneAngle + (i / n) * TAU;
      const d = (this.drones[i] ??= { x: 0, z: 0 });
      d.x = p.x + Math.cos(a) * r;
      d.z = p.z + Math.sin(a) * r;
      this.hash.query(d.x, d.z, 1.2, (e) => {
        if (!e.alive || e.droneHitT > 0) return;
        const rr = e.radius + 0.9;
        if (dist2(d.x, d.z, e.x, e.z) < rr * rr) {
          e.droneHitT = 0.3;
          this.damageEnemy(e, this.stats.droneDamage, a, 1);
          this.fx.sparks(d.x, d.z, 0x9ff6ff, 6);
        }
      });
    }
    p.droneFireT -= dt;
    if (p.droneFireT <= 0) {
      p.droneFireT = 0.7;
      for (const d of this.drones) {
        const t = this.nearestEnemies(d.x, d.z, 1, 42)[0];
        if (t) this.spawnBolt(d.x, d.z, Math.atan2(t.z - d.z, t.x - d.x), false, true);
      }
    }
  }

  private addShockwave(x: number, z: number, maxR: number, speed: number, damage: number, bossDamage: number, clears: boolean, color: number): void {
    this.shockwaves.push({ x, z, r: 0, speed, maxR, damage, bossDamage, clearsBullets: clears, hit: new Set(), color });
  }

  private updateShockwaves(dt: number): void {
    const ws = this.shockwaves;
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = ws[i];
      w.r += w.speed * dt;
      if (w.damage > 0) {
        for (const e of this.enemies) {
          if (!e.alive || w.hit.has(e.id)) continue;
          const rr = w.r + e.radius;
          if (dist2(w.x, w.z, e.x, e.z) <= rr * rr) {
            w.hit.add(e.id);
            const a = Math.atan2(e.z - w.z, e.x - w.x);
            this.damageEnemy(e, e.kind === 'boss' ? w.bossDamage : w.damage, a, 6);
          }
        }
      }
      if (w.clearsBullets) {
        const eb = this.eBullets;
        const r2 = w.r * w.r;
        for (let j = eb.length - 1; j >= 0; j--) {
          const b = eb[j];
          if (dist2(w.x, w.z, b.x, b.z) <= r2) {
            if (j % 2 === 0) this.fx.sparks(b.x, b.z, b.color, 3);
            if (chance(0.15)) this.score += 10;
            eb[j] = eb[eb.length - 1];
            eb.pop();
          }
        }
      }
      if (w.r >= w.maxR) {
        ws[i] = ws[ws.length - 1];
        ws.pop();
      }
    }
  }

  // ------------------------------------------------------------------ enemies

  damageEnemy(e: Enemy, dmg: number, angle: number, knock: number): void {
    if (!e.alive) return;
    e.hp -= dmg;
    e.flash = 1;
    if (e.kind !== 'boss') {
      const k = knock * (e.kind === 'bulwark' ? 0.3 : 1.2);
      e.vx += Math.cos(angle) * k;
      e.vz += Math.sin(angle) * k;
    }
    this.audio.hit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    e.alive = false;
    this.kills++;
    const def = e.def;
    const size = e.kind === 'boss' ? 7 : def.radius * 0.75 * (e.elite ? 1.5 : 1);
    this.fx.explosion(e.x, e.z, def.color, size);
    if (e.elite) {
      this.fx.explosion(e.x, e.z, 0xffd34a, size * 0.7);
      this.hitStop(0.05);
    }
    this.audio.explode(size);

    this.combo++;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (this.combo % 10 === 0) {
      const m = comboMultiplier(this.combo);
      this.ui.floater(this.player.x, 4, this.player.z, `${this.combo} COMBO  x${m}`, 'combo');
      this.audio.combo(this.combo / 10);
    }
    const gained = this.addScore(def.score * (e.elite ? 3 : 1));
    if (e.elite || def.score >= 800) this.ui.floater(e.x, 2, e.z, `+${gained.toLocaleString()}`, e.elite ? 'elite' : 'score');

    let xp = def.xp * (e.elite ? 5 : 1);
    if (e.kind === 'mite' && Math.random() < 0.4) xp = 0;
    this.dropXp(e.x, e.z, xp);

    const p = this.player;
    if (p.alive && this.stats.killHeal > 0) p.hull = Math.min(this.stats.maxHull, p.hull + this.stats.killHeal);

    if (e.kind === 'boss') {
      for (let i = 0; i < 3; i++) this.dropPower(e.x + rand(-4, 4), e.z + rand(-4, 4));
      this.bossDefeated(e);
    } else if (e.elite || Math.random() < def.dropChance * (1 + this.wave * 0.03)) {
      this.dropPower(e.x, e.z);
    }

    if (e.kind === 'bulwark') {
      const hpMul = this.plan?.hpMul ?? 1;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + rand(0, 1);
        const child = this.addEnemy('darter', e.x + Math.cos(a) * 2.5, e.z + Math.sin(a) * 2.5, false, hpMul * 0.6, this.plan?.speedMul ?? 1);
        child.vx = Math.cos(a) * 25;
        child.vz = Math.sin(a) * 25;
      }
    }
  }

  private addScore(base: number): number {
    const mult = comboMultiplier(this.combo) * ((this.powerTimers.multiplier ?? 0) > 0 ? 2 : 1);
    const v = Math.round(base * mult);
    this.score += v;
    return v;
  }

  addEnemy(kind: EnemyKind, x: number, z: number, elite: boolean, hpMul: number, speedMul: number): Enemy {
    const def = ENEMIES[kind];
    const scale = elite ? 1.35 : 1;
    const hp = (kind === 'boss' ? bossHp(this.wave) : def.hp * hpMul) * (elite ? 3.5 : 1);
    const e: Enemy = {
      id: this.nextId++, kind, def, x, z, vx: 0, vz: 0,
      angle: Math.atan2(this.player.z - z, this.player.x - x), spin: Math.random() * TAU,
      hp, maxHp: hp, radius: def.radius * scale, scale, elite, speedMul: speedMul * (elite ? 1.1 : 1),
      age: 0, timer: rand(0.6, 2.0), timer2: 0, state: 0, aimX: 0, aimZ: 0, flash: 0, charge: 0,
      droneHitT: 0, burst: 0, burstT: 0, phase: 0, seed: Math.random() * 100, alive: true,
    };
    if (kind === 'boss') {
      e.angle = Math.PI / 2;
      e.timer = 4;
      this.boss = e;
    }
    this.enemies.push(e);
    return e;
  }

  enemyShoot(x: number, z: number, angle: number, speed: number, big: boolean, color: number): void {
    if (this.eBullets.length >= MAX_ENEMY_BULLETS) return;
    this.eBullets.push({
      x, z, vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, life: 7,
      radius: big ? 0.95 : 0.55, damage: big ? 16 : 10, big, age: 0, color,
    });
    this.audio.enemyShoot();
  }

  bossPhase(e: Enemy): void {
    this.fx.explosion(e.x, e.z, 0xff2a4a, 3.5);
    this.fx.shockwave(e.x, e.z, 0xff2a4a, 40, 0.8, 3);
    this.addShockwave(e.x, e.z, 40, 70, 0, 0, false, 0xff2a4a);
    this.audio.warn();
    this.ui.banner('DREADNOUGHT ENRAGED', e.phase === 2 ? 'FINAL PHASE' : 'PHASE 2', 'boss');
    this.fx.shake(0.5);
  }

  bossSummon(e: Enemy, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + e.spin;
      const x = e.x + Math.cos(a) * 11;
      const z = e.z + Math.sin(a) * 11;
      this.queueSpawn(x, z, i % 2 === 0 ? 'darter' : 'mite', false, 0.6);
    }
  }

  private bossDefeated(e: Enemy): void {
    this.boss = null;
    this.bossesKilled++;
    this.ui.bossBar(null);
    this.slowmo(0.2, 1.6);
    this.hitStop(0.12);
    this.stage.flash = 0.25;
    this.stage.kick(8);
    this.fx.shake(1);
    this.audio.bigBoom();
    this.eBullets.length = 0;
    for (let i = 0; i < 8; i++) {
      this.later(0.12 * i, () => {
        this.fx.explosion(e.x + rand(-8, 8), e.z + rand(-8, 8), pick([0xff2a4a, 0xffa01a, 0xff5ad8]), rand(2, 3.5));
        this.audio.explode(3);
      });
    }
    this.later(1.1, () => {
      this.fx.explosion(e.x, e.z, 0xffd34a, 7);
      this.fx.shockwave(e.x, e.z, 0xffd34a, 120, 1.4, 2);
    });
    const bonus = 10000 * Math.max(1, Math.round(this.wave / 5));
    this.score += bonus;
    this.ui.banner('DREADNOUGHT DESTROYED', `+${bonus.toLocaleString()} BONUS`, 'win');
    if (this.plan) this.groupIdx = this.plan.groups.length;
    for (const o of this.enemies) if (o.alive && o !== e) this.later(rand(0.2, 1.2), () => o.alive && this.damageEnemy(o, 1e6, 0, 0));
    this.audio.intensity = 1;
  }

  // ------------------------------------------------------------------ pickups

  private dropXp(x: number, z: number, xp: number): void {
    let left = xp;
    const vals = [20, 5, 1];
    let guard = 0;
    while (left > 0 && guard++ < 30) {
      const v = vals.find((k) => k <= left) ?? 1;
      left -= v;
      const a = Math.random() * TAU;
      const sp = rand(4, 14);
      this.pickups.push({
        kind: 'xp', x, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, value: v, power: null,
        life: 22, age: 0, magnet: false, seed: Math.random() * 10,
      });
    }
  }

  private dropPower(x: number, z: number): void {
    const def = weightedPick(POWERUPS, (p) => p.weight);
    if (!def) return;
    this.pickups.push({
      kind: 'power', x, z, vx: rand(-4, 4), vz: rand(-4, 4), value: 0, power: def.id,
      life: 14, age: 0, magnet: false, seed: Math.random() * 10,
    });
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    const ps = this.pickups;
    const range = this.stats.magnetRange;
    for (let i = ps.length - 1; i >= 0; i--) {
      const k = ps[i];
      k.age += dt;
      k.life -= dt;
      if (k.life <= 0) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const dx = p.x - k.x;
      const dz = p.z - k.z;
      const d = Math.hypot(dx, dz) || 1;
      if (p.alive && !k.magnet && d < (k.kind === 'xp' ? range : range * 0.5 + 2)) k.magnet = true;
      if (k.magnet && p.alive) {
        const sp = 30 + Math.min(60, k.age * 25);
        k.vx = damp(k.vx, (dx / d) * sp, 10, dt);
        k.vz = damp(k.vz, (dz / d) * sp, 10, dt);
      } else {
        k.vx *= Math.exp(-3 * dt);
        k.vz *= Math.exp(-3 * dt);
      }
      k.x += k.vx * dt;
      k.z += k.vz * dt;
      k.x = clamp(k.x, -ARENA.halfW + 1, ARENA.halfW - 1);
      k.z = clamp(k.z, -ARENA.halfH + 1, ARENA.halfH - 1);
      if (p.alive && d < 2.2) {
        if (k.kind === 'xp') this.collectXp(k);
        else if (k.power) this.applyPowerUp(k.power);
        ps[i] = ps[ps.length - 1];
        ps.pop();
      }
    }
  }

  private collectXp(k: Pickup): void {
    this.pickupChain = this.realTime - this.lastPickup < 0.4 ? this.pickupChain + 1 : 0;
    this.lastPickup = this.realTime;
    this.audio.pickup(this.pickupChain);
    const col = k.value >= 20 ? 0xffc23a : k.value >= 5 ? 0x4dff8a : 0x4fd8ff;
    this.fx.particles.emit({
      count: 4, x: k.x, z: k.z, y: 0.8, speed: [3, 8], life: [0.15, 0.3], size: [0.4, 0.8], color: this.view.color(col, 3), drag: 4,
    });
    this.gainXp(k.value * this.stats.xpMul);
  }

  private gainXp(v: number): void {
    const p = this.player;
    p.xp += v;
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      this.pendingLevelUps++;
    }
    if (this.pendingLevelUps > 0 && this.state === 'playing' && p.alive) this.openLevelUp();
  }

  private openLevelUp(): void {
    const p = this.player;
    this.state = 'levelup';
    this.choices = rollPerks(this.perks, 3);
    this.choiceFocus = 0;
    this.ui.showLevelUp(this.choices, this.perks, p.level);
    this.audio.levelUp();
    this.fx.shockwave(p.x, p.z, 0xffd34a, 26, 0.9, 3);
    this.fx.particles.emit({
      count: 120, x: p.x, z: p.z, y: 1, speed: [10, 40], up: [5, 25], life: [0.6, 1.2], size: [0.5, 1.2],
      color: this.view.color(0xffd34a, 4), drag: 2, gravity: 15,
    });
    this.stage.kick(3);
  }

  choosePerk(i: number): void {
    if (this.state !== 'levelup') return;
    const id = this.choices[i];
    if (!id) return;
    const p = this.player;
    const prev = this.stats;
    if (id === 'field_repair') {
      p.hull = Math.min(prev.maxHull, p.hull + prev.maxHull * 0.4);
    } else if (id === 'score_cache') {
      this.score += 2500 * Math.max(1, this.wave);
    } else {
      const pid = id as PerkId;
      this.perks[pid] = (this.perks[pid] ?? 0) + 1;
      this.stats = computeStats(this.save.selectedShip, this.save.upgrades, this.perks);
      const s = this.stats;
      if (pid === 'nanoplate') p.hull = s.maxHull;
      else p.hull = Math.min(s.maxHull, p.hull + Math.max(0, s.maxHull - prev.maxHull));
      if (pid === 'aegis') p.shield = s.maxShield;
      if (pid === 'ordnance') p.bombs = Math.min(9, p.bombs + 1);
      if (s.projectiles !== prev.projectiles) this.view.setShip(this.save.selectedShip, s.projectiles);
      if (pid === 'nova') p.novaT = 0.5;
      if (pid === 'missiles') p.missileT = 0.3;
    }
    this.audio.powerup();
    this.ui.floater(p.x, 4, p.z, PERK_BY_ID[id].name.toUpperCase(), 'perk');
    this.ui.updatePerks(this.perks);
    this.pendingLevelUps--;
    this.ui.hideLevelUp();
    if (this.pendingLevelUps > 0) {
      this.openLevelUp();
      return;
    }
    this.state = 'playing';
    // Breathing room: blow away nearby bullets.
    this.addShockwave(p.x, p.z, 24, 80, 0, 0, true, 0xffd34a);
    this.fx.shockwave(p.x, p.z, 0xffd34a, 24, 0.45, 2.5);
    p.invuln = Math.max(p.invuln, 1);
  }

  private applyPowerUp(id: PowerUpId): void {
    const def = POWERUP_BY_ID[id];
    const p = this.player;
    const s = this.stats;
    if (def.duration > 0) {
      this.powerTimers[id] = Math.min(def.duration * 2, Math.max(0, this.powerTimers[id] ?? 0) + def.duration);
    }
    switch (id) {
      case 'shield':
        p.shield = s.maxShield;
        p.invuln = Math.max(p.invuln, 2.5);
        this.view.shieldFlash = 1;
        break;
      case 'repair':
        p.hull = Math.min(s.maxHull, p.hull + s.maxHull * 0.35);
        break;
      case 'bomb':
        p.bombs = Math.min(9, p.bombs + 1);
        break;
      case 'magnet':
        for (const k of this.pickups) if (k.kind === 'xp') k.magnet = true;
        break;
      default:
        break;
    }
    this.audio.powerup();
    this.ui.floater(p.x, 4, p.z, def.name, 'power', def.color);
    this.fx.shockwave(p.x, p.z, def.color, 14, 0.5, 3);
    this.fx.sparks(p.x, p.z, def.color, 30, undefined, 26);
  }

  private updatePowerTimers(dt: number): void {
    for (const k of Object.keys(this.powerTimers) as PowerUpId[]) {
      const v = (this.powerTimers[k] ?? 0) - dt;
      if (v <= 0) delete this.powerTimers[k];
      else this.powerTimers[k] = v;
    }
  }

  // ------------------------------------------------------------------ collisions with player

  private collidePlayer(): void {
    const p = this.player;
    const dashing = p.dashT > 0;
    this.hash.query(p.x, p.z, PLAYER_RADIUS + 1, (e) => {
      if (!e.alive) return;
      const r = e.radius + PLAYER_RADIUS * 0.9;
      if (dist2(p.x, p.z, e.x, e.z) >= r * r) return;
      const a = Math.atan2(e.z - p.z, e.x - p.x);
      if (dashing) {
        if (e.droneHitT <= 0) {
          e.droneHitT = 0.25;
          this.damageEnemy(e, 30 * this.stats.damageMul, a, 8);
          this.fx.sparks(e.x, e.z, 0xffffff, 10);
        }
        return;
      }
      if (p.invuln > 0) return;
      this.damagePlayer(e.def.contact, e.x, e.z);
      if (e.kind !== 'boss') this.damageEnemy(e, 50, a, 14);
    });
  }

  private updateEnemyBullets(dt: number): void {
    const p = this.player;
    const eb = this.eBullets;
    const pr = PLAYER_RADIUS;
    for (let i = eb.length - 1; i >= 0; i--) {
      const b = eb[i];
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.life -= dt;
      b.age += dt;
      let dead = b.life <= 0 || Math.abs(b.x) > ARENA.halfW + 2 || Math.abs(b.z) > ARENA.halfH + 2;
      if (!dead && p.alive) {
        const r = pr + b.radius * 0.8;
        if (dist2(b.x, b.z, p.x, p.z) < r * r && p.invuln <= 0 && p.dashT <= 0) {
          this.damagePlayer(b.damage, b.x - b.vx, b.z - b.vz);
          dead = true;
        }
      }
      if (dead) {
        eb[i] = eb[eb.length - 1];
        eb.pop();
      }
    }
  }

  // ------------------------------------------------------------------ waves & spawning

  private updateWaves(dt: number): void {
    if (this.waveBreak > 0) {
      this.waveBreak -= dt;
      if (this.waveBreak <= 0) this.startWave(this.wave + 1);
      return;
    }
    const plan = this.plan;
    if (!plan) return;
    this.waveTime += dt;
    while (this.groupIdx < plan.groups.length && plan.groups[this.groupIdx].at <= this.waveTime) {
      this.spawnGroup(plan.groups[this.groupIdx++], plan);
    }
    const allSpawned = this.groupIdx >= plan.groups.length;
    if (allSpawned && this.enemies.length === 0 && this.spawns.length === 0) this.completeWave();
    else if (!plan.boss && allSpawned && this.waveTime > plan.duration + 25) this.completeWave();
  }

  private startWave(n: number): void {
    this.wave = n;
    const plan = (this.plan = buildWave(n));
    this.waveTime = 0;
    this.groupIdx = 0;
    if (plan.boss) {
      this.ui.banner('WARNING', 'DREADNOUGHT APPROACHING', 'boss');
      this.audio.warn();
      this.audio.intensity = 2;
    } else {
      const fresh = SPAWNABLE.filter((k) => ENEMIES[k].minWave === n && !this.seenKinds.has(k));
      const sub = fresh.length ? `NEW CONTACT: ${fresh.map((k) => ENEMIES[k].name.toUpperCase()).join(', ')}` : 'INCOMING';
      this.ui.banner(`WAVE ${n}`, sub, 'wave');
      this.audio.intensity = 1;
    }
  }

  private completeWave(): void {
    this.wavesCleared++;
    const bonus = 500 * this.wave;
    this.score += bonus;
    if (!this.plan?.boss) this.ui.banner(`WAVE ${this.wave} CLEARED`, `+${bonus.toLocaleString()}`, 'clear');
    this.waveBreak = this.plan?.boss ? 4.5 : 2.5;
    this.plan = null;
  }

  private spawnGroup(g: SpawnGroup, plan: WavePlan): void {
    const p = this.player;
    this.seenKinds.add(g.kind);
    if (g.kind === 'boss') {
      const x = clamp(p.x, -ARENA.halfW + 12, ARENA.halfW - 12);
      const z = -ARENA.halfH + 6;
      this.spawns.push({ x, z, kind: 'boss', elite: false, t: 2.2, hpMul: 1, speedMul: 1 });
      this.fx.rings.spawn(x, z, 20, 2, 2.2, this.view.color(0xff2a4a, 2));
      return;
    }
    const room = MAX_ENEMIES - this.enemies.length - this.spawns.length;
    const count = Math.min(g.count, room);
    if (count <= 0) return;
    const pts: { x: number; z: number }[] = [];
    if (g.formation === 'ring') {
      const r = 24;
      const off = Math.random() * TAU;
      for (let i = 0; i < count; i++) {
        const a = off + (i / count) * TAU;
        pts.push(this.clampSpawn(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r));
      }
    } else if (g.formation === 'line') {
      const c = this.spawnPoint(30, 46);
      const ang = Math.atan2(c.z - p.z, c.x - p.x) + Math.PI / 2;
      for (let i = 0; i < count; i++) {
        const o = (i - (count - 1) / 2) * 4.5;
        pts.push(this.clampSpawn(c.x + Math.cos(ang) * o, c.z + Math.sin(ang) * o));
      }
    } else if (g.formation === 'cluster') {
      const c = this.spawnPoint(28, 48);
      for (let i = 0; i < count; i++) pts.push(this.clampSpawn(c.x + rand(-5, 5), c.z + rand(-5, 5)));
    } else {
      for (let i = 0; i < count; i++) pts.push(this.spawnPoint(24, 52));
    }
    pts.forEach((pt, i) => this.queueSpawn(pt.x, pt.z, g.kind, g.elite && i === 0, 1.0 + i * 0.04, plan.hpMul, plan.speedMul));
  }

  private queueSpawn(x: number, z: number, kind: EnemyKind, elite: boolean, t: number, hpMul = this.plan?.hpMul ?? 1, speedMul = this.plan?.speedMul ?? 1): void {
    this.spawns.push({ x, z, kind, elite, t, hpMul, speedMul });
    this.fx.rings.spawn(x, z, 5 * (elite ? 1.5 : 1), 0.5, t, this.view.color(elite ? 0xffd34a : ENEMIES[kind].color, 1.3));
  }

  private clampSpawn(x: number, z: number): { x: number; z: number } {
    return { x: clamp(x, -ARENA.halfW + 5, ARENA.halfW - 5), z: clamp(z, -ARENA.halfH + 5, ARENA.halfH - 5) };
  }

  private spawnPoint(minD: number, maxD: number): { x: number; z: number } {
    const p = this.player;
    for (let i = 0; i < 14; i++) {
      // Most enemies come from above, so threats read top-to-bottom on a portrait screen.
      const a = Math.random() < 0.65 ? -Math.PI / 2 + rand(-1.25, 1.25) : Math.random() * TAU;
      const d = rand(minD, maxD);
      const pt = this.clampSpawn(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
      if (dist2(pt.x, pt.z, p.x, p.z) > minD * minD * 0.55) return pt;
    }
    return this.clampSpawn(-Math.sign(p.x || 1) * ARENA.halfW, -Math.sign(p.z || 1) * ARENA.halfH);
  }

  private updateSpawns(dt: number): void {
    const ss = this.spawns;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i];
      s.t -= dt;
      const col = s.elite ? 0xffd34a : ENEMIES[s.kind].color;
      this.fx.portal(s.x, s.z, col, 0);
      if (s.t <= 0) {
        ss[i] = ss[ss.length - 1];
        ss.pop();
        if (!this.player.alive && s.kind !== 'boss') continue;
        const e = this.addEnemy(s.kind, s.x, s.z, s.elite, s.hpMul, s.speedMul);
        this.fx.warpIn(s.x, s.z, col, e.radius);
        if (s.kind === 'boss') {
          this.fx.explosion(s.x, s.z, 0xff2a4a, 4);
          this.fx.shake(0.6);
          this.ui.bossBar(e);
        }
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  private slowmo(scale: number, t: number): void {
    this.timeScale = Math.min(this.timeScale, scale);
    this.slowT = Math.max(this.slowT, t);
  }

  private hitStop(t: number): void {
    this.hitStopT = Math.max(this.hitStopT, t);
  }

  private later(t: number, fn: () => void): void {
    this.timers.push({ t, fn });
  }
}
