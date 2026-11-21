/** DOM overlay: HUD, menus, hangar, level-up cards, banners and floating text. */
import type { AudioEngine } from '../core/Audio';
import type { Input } from '../core/Input';
import type { SaveData, Settings } from '../core/Save';
import type { Game, RunSummary } from '../game/Game';
import type { Enemy } from '../game/types';
import { PERKS, PERK_BY_ID, type ChoiceId, type PerkId, type PerkTiers } from '../game/perks';
import { POWERUP_BY_ID, type PowerUpId } from '../game/powerups';
import { xpToNext } from '../game/progression';
import { SHIPS, SHIP_ORDER, type ShipId } from '../game/ships';
import { UPGRADES, upgradeCost } from '../game/upgrades';
import type { Stage } from '../render/Stage';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US');

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

type Screen = 'title' | 'hangar' | 'levelup' | 'pause' | 'gameover' | 'controls';

interface Floater {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  life: number;
  max: number;
  active: boolean;
}

export class UI {
  private game!: Game;
  private screens: Record<Screen, HTMLElement>;
  private hud = $('hud');
  private floaterLayer = $('floaters');
  private floaters: Floater[] = [];
  private labelEls: HTMLDivElement[] = [];
  private bannerTimer = 0;
  private toastTimer = 0;
  private cache = new Map<string, string>();
  private creditsAnim: { from: number; to: number; t: number } | null = null;
  private bossEnemy: Enemy | null = null;
  private controlsReturn: Screen | null = null;

  constructor(
    private stage: Stage,
    private audio: AudioEngine,
    private input: Input,
  ) {
    this.screens = {
      title: $('title'),
      hangar: $('hangar'),
      levelup: $('levelup'),
      pause: $('pause'),
      gameover: $('gameover'),
      controls: $('controls'),
    };
    const fl = $('floaters');
    for (let i = 0; i < 32; i++) {
      const el = document.createElement('div');
      el.className = 'floater';
      fl.appendChild(el);
      this.floaters.push({ el, x: 0, y: 0, z: 0, life: 0, max: 1, active: false });
    }
    const lb = $('labels');
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'plabel';
      lb.appendChild(el);
      this.labelEls.push(el);
    }

    document.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-toggle]');
      if (!target) return;
      if (target.dataset.action) this.click(target.dataset.action);
      if (target.dataset.toggle) this.toggle(target.dataset.toggle);
    });
    document.addEventListener('mouseover', (e) => {
      const b = (e.target as HTMLElement).closest('.screen button');
      if (b && !(b as HTMLButtonElement).disabled) this.audio.ui();
    });

    this.setupTouch();
  }

  bind(game: Game): void {
    this.game = game;
  }

  // ---------------------------------------------------------------- screens

  private show(screen: Screen | null): void {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('active', k === screen);
  }

  click(action: string): void {
    const g = this.game;
    this.audio.unlock();
    switch (action) {
      case 'launch':
      case 'retry':
        this.audio.ui();
        g.startRun();
        break;
      case 'hangar':
        this.audio.ui();
        g.goHangar();
        break;
      case 'title':
        this.audio.ui();
        g.goTitle();
        break;
      case 'controls':
        this.controlsReturn = g.state === 'paused' ? 'pause' : 'title';
        this.show('controls');
        break;
      case 'close-controls':
        this.show(this.controlsReturn ?? 'title');
        break;
      case 'resume':
        g.resume();
        break;
      case 'pause':
        g.pause();
        break;
      case 'quit':
        g.quitRun();
        break;
    }
  }

  private toggle(key: string): void {
    const g = this.game;
    const s = g.save.settings;
    if (key === 'autofire') g.autofire = !g.autofire;
    else if (key === 'music' || key === 'sfx' || key === 'shake') s[key] = !s[key];
    this.audio.applySettings(s);
    g.fx.shakeEnabled = s.shake;
    g.persist();
    this.audio.ui();
    this.renderToggles(s, g.autofire);
  }

  private renderToggles(s: Settings, autofire: boolean): void {
    const set = (k: string, label: string, on: boolean) => {
      const b = document.querySelector<HTMLButtonElement>(`[data-toggle="${k}"]`);
      if (b) {
        b.textContent = `${label}: ${on ? 'ON' : 'OFF'}`;
        b.classList.toggle('off', !on);
      }
    };
    set('music', 'MUSIC', s.music);
    set('sfx', 'SOUND FX', s.sfx);
    set('shake', 'SCREEN SHAKE', s.shake);
    set('autofire', 'AUTO-FIRE', autofire);
  }

  showTitle(save: SaveData): void {
    this.hud.classList.add('hidden');
    $('title-stats').innerHTML = `
      <div><span>HIGH SCORE</span><b>${fmt(save.highScore)}</b></div>
      <div><span>BEST WAVE</span><b>${save.bestWave}</b></div>
      <div><span>CREDITS</span><b>¤ ${fmt(save.credits)}</b></div>`;
    this.show('title');
  }

  showHangar(save: SaveData): void {
    this.hud.classList.add('hidden');
    this.renderHangar(save);
    this.show('hangar');
  }

  private renderHangar(save: SaveData): void {
    $('h-credits').textContent = fmt(save.credits);
    const ships = $('ships');
    ships.innerHTML = SHIP_ORDER.map((id) => {
      const d = SHIPS[id];
      const owned = save.unlockedShips.includes(id);
      const sel = save.selectedShip === id;
      const bar = (v: number, max: number) => `<div class="sbar"><i style="width:${Math.round((v / max) * 100)}%"></i></div>`;
      const btn = sel
        ? `<button disabled class="sel">ACTIVE</button>`
        : owned
          ? `<button data-ship="${id}">SELECT</button>`
          : `<button data-ship="${id}" class="${save.credits >= d.cost ? 'buy' : 'locked'}">¤ ${fmt(d.cost)}</button>`;
      return `<div class="ship ${sel ? 'selected' : ''}" style="--c:${hex(d.color)}">
        <div class="ship-name">${d.name}</div>
        <div class="ship-tag">${d.tagline}</div>
        <div class="ship-stats">
          <label>HULL</label>${bar(d.hull, 160)}
          <label>SPEED</label>${bar(d.speed, 46)}
          <label>FIREPOWER</label>${bar(d.damageMul * d.fireRateMul * d.projectiles, 4)}
        </div>
        ${btn}
      </div>`;
    }).join('');
    ships.querySelectorAll<HTMLButtonElement>('[data-ship]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.game.selectShip(b.dataset.ship as ShipId)) this.renderHangar(this.game.save);
      }),
    );

    const ups = $('upgrades');
    ups.innerHTML = UPGRADES.map((u) => {
      const lvl = save.upgrades[u.id] ?? 0;
      const maxed = lvl >= u.maxLevel;
      const cost = upgradeCost(u, lvl);
      const pips = Array.from({ length: u.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="upg ${maxed ? 'maxed' : ''}">
        <div class="upg-icon">${u.icon}</div>
        <div class="upg-body"><div class="upg-name">${u.name}</div><div class="upg-desc">${u.desc}</div><div class="pips">${pips}</div></div>
        <button data-upg="${u.id}" ${maxed ? 'disabled' : ''} class="${!maxed && save.credits >= cost ? 'buy' : 'locked'}">${maxed ? 'MAX' : `¤ ${fmt(cost)}`}</button>
      </div>`;
    }).join('');
    ups.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.game.buyUpgrade(b.dataset.upg as (typeof UPGRADES)[number]['id'])) this.renderHangar(this.game.save);
      }),
    );
  }

  showHud(g: Game): void {
    this.show(null);
    this.hud.classList.remove('hidden');
    this.cache.clear();
    this.updateHud(g);
  }

  showPause(s: Settings, autofire: boolean): void {
    this.renderToggles(s, autofire);
    this.show('pause');
  }

  hidePause(): void {
    this.show(this.game.state === 'levelup' ? 'levelup' : null);
  }

  showLevelUp(choices: ChoiceId[], perks: PerkTiers, level: number): void {
    $('lv-num').textContent = String(level);
    const cards = $('cards');
    cards.innerHTML = choices
      .map((id, i) => {
        const d = PERK_BY_ID[id];
        const tier = (perks[id as PerkId] ?? 0) as number;
        const finite = Number.isFinite(d.maxTier);
        const pips = finite
          ? Array.from({ length: d.maxTier }, (_, k) => `<i class="${k < tier ? 'on' : k === tier ? 'next' : ''}"></i>`).join('')
          : '';
        const isNew = finite && tier === 0;
        return `<button class="card kind-${d.kind}" data-card="${i}">
          <div class="card-key">${i + 1}</div>
          ${isNew ? '<div class="card-new">NEW</div>' : ''}
          <div class="card-icon">${d.icon}</div>
          <div class="card-name">${esc(d.name)}</div>
          <div class="card-kind">${d.kind.toUpperCase()}${finite ? ` · LV ${tier + 1}` : ''}</div>
          <div class="card-desc">${esc(d.desc)}</div>
          <div class="pips">${pips}</div>
        </button>`;
      })
      .join('');
    cards.querySelectorAll<HTMLButtonElement>('[data-card]').forEach((b) => {
      const i = Number(b.dataset.card);
      b.addEventListener('click', () => this.game.choosePerk(i));
      b.addEventListener('mouseenter', () => {
        this.game.choiceFocus = i;
        this.focusChoice(i);
      });
    });
    this.focusChoice(0);
    this.show('levelup');
  }

  focusChoice(i: number): void {
    document.querySelectorAll('#cards .card').forEach((c, k) => c.classList.toggle('focus', k === i));
  }

  hideLevelUp(): void {
    this.show(null);
  }

  showGameOver(r: RunSummary, save: SaveData): void {
    $('go-score').textContent = fmt(r.score);
    $('go-high').classList.toggle('hidden', !r.newHigh);
    const m = Math.floor(r.time / 60);
    const s = Math.floor(r.time % 60).toString().padStart(2, '0');
    $('go-stats').innerHTML = [
      ['WAVE', r.wave],
      ['LEVEL', r.level],
      ['KILLS', fmt(r.kills)],
      ['MAX COMBO', r.maxCombo],
      ['BOSSES', r.bosses],
      ['TIME', `${m}:${s}`],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
    $('go-total').textContent = fmt(save.credits);
    this.creditsAnim = { from: 0, to: r.credits, t: 0 };
    $('go-credits').textContent = '0';
    this.hud.classList.add('hidden');
    this.show('gameover');
  }

  // ---------------------------------------------------------------- HUD

  private set(id: string, text: string): void {
    if (this.cache.get(id) === text) return;
    this.cache.set(id, text);
    $(id).textContent = text;
  }

  private width(id: string, frac: number): void {
    const v = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    const key = `${id}:w`;
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    $(id).style.width = v;
  }

  updateHud(g: Game): void {
    const p = g.player;
    const s = g.stats;
    this.set('score', fmt(g.score));
    this.set('hi', fmt(Math.max(g.save.highScore, g.score)));
    this.set('wave', g.wave > 0 ? `WAVE ${g.wave}` : 'GET READY');
    this.set('level', String(p.level));
    this.set('bombs', String(p.bombs));
    this.set('hull-num', `${Math.ceil(p.hull)} / ${s.maxHull}`);
    this.width('hull-fill', p.hull / s.maxHull);
    this.width('shield-fill', s.maxShield > 0 ? p.shield / s.maxShield : 0);
    this.width('xp-fill', p.xp / xpToNext(p.level));
    this.width('dash-cd', p.dashCd / s.dashCooldown);
    $('ab-bomb').classList.toggle('empty', p.bombs <= 0);
    this.hud.classList.toggle('low', p.hull / s.maxHull < 0.3 && p.alive);

    const mult = g.combo >= 10 ? `x${Math.min(8, 1 + Math.floor(g.combo / 10) * 0.5)}` : '';
    this.set('combo', g.combo >= 3 ? `${g.combo} COMBO ${mult}` : '');
    const ce = $('combo');
    ce.style.setProperty('--t', String(Math.max(0, g.comboTimer / 2.6)));

    // Power-up timers.
    const keys = (Object.keys(g.powerTimers) as PowerUpId[]).sort();
    const sig = keys.join(',');
    const pw = $('powers');
    if (this.cache.get('powers') !== sig) {
      this.cache.set('powers', sig);
      pw.innerHTML = keys
        .map((k) => `<div class="pw" data-pw="${k}" style="--c:${hex(POWERUP_BY_ID[k].color)}"><span>${POWERUP_BY_ID[k].name}</span><i></i></div>`)
        .join('');
    }
    for (const k of keys) {
      const el = pw.querySelector<HTMLElement>(`[data-pw="${k}"] i`);
      if (el) el.style.width = `${((g.powerTimers[k] ?? 0) / POWERUP_BY_ID[k].duration) * 50}%`;
    }

    if (this.bossEnemy) {
      const b = this.bossEnemy;
      this.width('boss-fill', b.alive ? b.hp / b.maxHp : 0);
    }
  }

  updatePerks(perks: PerkTiers): void {
    $('perks').innerHTML = PERKS.filter((p) => (perks[p.id as PerkId] ?? 0) > 0)
      .map((p) => `<div class="perk kind-${p.kind}" title="${esc(p.name)}">${p.icon}<b>${perks[p.id as PerkId]}</b></div>`)
      .join('');
  }

  bossBar(e: Enemy | null): void {
    this.bossEnemy = e;
    $('boss').classList.toggle('hidden', !e);
    if (e) this.width('boss-fill', 1);
  }

  // ---------------------------------------------------------------- transient text

  banner(title: string, sub: string, style: string): void {
    const b = $('banner');
    b.className = '';
    void b.offsetWidth;
    b.className = `show ${style}`;
    b.querySelector('.b-title')!.textContent = title;
    b.querySelector('.b-sub')!.textContent = sub;
    this.bannerTimer = style === 'boss' ? 3.2 : 2.2;
  }

  toast(msg: string): void {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    this.toastTimer = 1.8;
  }

  floater(x: number, y: number, z: number, text: string, cls: string, color?: number): void {
    const f = this.floaters.find((q) => !q.active) ?? this.floaters[0];
    f.active = true;
    f.x = x;
    f.y = y;
    f.z = z;
    f.max = cls === 'score' ? 0.9 : 1.4;
    f.life = f.max;
    f.el.textContent = text;
    // Prefixed so floater styles never collide with HUD classes like .perk / .combo.
    f.el.className = `floater show fl-${cls}`;
    f.el.style.color = color !== undefined ? hex(color) : '';
  }

  syncLabels(list: { x: number; z: number; text: string; color: number }[]): void {
    for (let i = 0; i < this.labelEls.length; i++) {
      const el = this.labelEls[i];
      const it = list[i];
      if (!it || this.game.state === 'title' || this.game.state === 'hangar') {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      const s = this.stage.worldToScreen(it.x, 2.6, it.z);
      el.style.display = s.visible ? 'block' : 'none';
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      if (el.textContent !== it.text) el.textContent = it.text;
      el.style.color = hex(it.color);
    }
  }

  /** Per-frame animation of DOM effects. */
  tick(dt: number): void {
    for (const f of this.floaters) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        f.el.className = 'floater';
        continue;
      }
      const t = 1 - f.life / f.max;
      const s = this.stage.worldToScreen(f.x, f.y, f.z);
      // Keep text on screen and clear of the thumb-zone HUD.
      const fw = this.floaterLayer.clientWidth;
      const fh = this.floaterLayer.clientHeight;
      const half = Math.min(fw / 2 - 8, f.el.offsetWidth / 2 + 8);
      const x = Math.max(half, Math.min(fw - half, s.x));
      const y = Math.max(fh * 0.14, Math.min(fh * 0.7, s.y - 30)) - t * 50;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - t) * 2})`;
      f.el.style.opacity = String(t > 0.7 ? (1 - t) / 0.3 : 1);
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) $('banner').classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').classList.remove('show');
    }
    if (this.creditsAnim) {
      const a = this.creditsAnim;
      a.t = Math.min(1, a.t + dt / 1.2);
      const e = 1 - Math.pow(1 - a.t, 3);
      $('go-credits').textContent = fmt(a.from + (a.to - a.from) * e);
      if (a.t >= 1) this.creditsAnim = null;
    }
  }

  // ---------------------------------------------------------------- touch

  private setupTouch(): void {
    const markTouch = () => document.body.classList.toggle('touch', this.input.isTouch);
    markTouch();
    window.addEventListener('touchstart', markTouch, { passive: true });

    // The HUD ability panels are also the touch buttons (bottom-right thumb zone).
    const tap = (id: string, fn: () => void) => {
      const el = $(id);
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          fn();
        },
        { passive: false },
      );
      el.addEventListener('click', fn);
    };
    tap('ab-dash', () => this.input.trigger('dash'));
    tap('ab-bomb', () => this.input.trigger('bomb'));

    const frame = $('frame');
    const sticks = { move: $('stick-move'), aim: $('stick-aim') };
    this.input.onTouchStick = (which, s) => {
      const el = sticks[which];
      if (!s || this.game.state !== 'playing') {
        el.classList.remove('on');
        return;
      }
      const r = frame.getBoundingClientRect();
      el.classList.add('on');
      el.style.left = `${s.ox - r.left}px`;
      el.style.top = `${s.oy - r.top}px`;
      const dx = Math.max(-46, Math.min(46, s.x - s.ox));
      const dy = Math.max(-46, Math.min(46, s.y - s.oy));
      (el.firstElementChild as HTMLElement).style.transform = `translate(${dx}px, ${dy}px)`;
    };
  }
}
