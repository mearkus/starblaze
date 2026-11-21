/** Keyboard + mouse, gamepad (twin-stick) and touch (virtual sticks) input. */

export type Action = 'dash' | 'bomb' | 'pause' | 'confirm' | 'autofire' | 'mute' | 'left' | 'right' | 'one' | 'two' | 'three';

const KEY_ACTIONS: Record<string, Action> = {
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  Space: 'bomb',
  KeyE: 'bomb',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  KeyF: 'autofire',
  KeyM: 'mute',
  Digit1: 'one',
  Digit2: 'two',
  Digit3: 'three',
  Numpad1: 'one',
  Numpad2: 'two',
  Numpad3: 'three',
};

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export type Aim =
  | { kind: 'point'; clientX: number; clientY: number }
  | { kind: 'dir'; x: number; y: number }
  | null;

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;
  mouseDown = false;
  private mouseMoved = false;
  device: 'kbm' | 'pad' | 'touch' = 'kbm';
  private padButtons: boolean[] = [];
  private pad = { mx: 0, my: 0, ax: 0, ay: 0, fire: false };
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  isTouch = window.matchMedia('(pointer: coarse)').matches;
  onTouchStick?: (which: 'move' | 'aim', stick: Stick | null) => void;

  constructor(surface: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        const a = KEY_ACTIONS[e.code];
        if (a) this.pressed.add(a);
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.pressed.add('left');
        if (e.code === 'ArrowRight' || e.code === 'KeyD') this.pressed.add('right');
      }
      this.keys.add(e.code);
      this.device = 'kbm';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    // Pointer events filtered to real mice: phones synthesise mouse events after taps, which would
    // otherwise hijack auto-aim. Tracked window-wide so aiming works outside the portrait column.
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseMoved = true;
      this.device = 'kbm';
    });
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.pressed.add('dash');
      this.mouseMoved = true;
      this.device = 'kbm';
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = false;
    });
    window.addEventListener(
      'touchstart',
      () => {
        this.isTouch = true;
        this.device = 'touch';
        this.mouseMoved = false;
      },
      { passive: true, capture: true },
    );
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    const opts: AddEventListenerOptions = { passive: false };
    surface.addEventListener('touchstart', (e) => this.touch(e, 'start'), opts);
    surface.addEventListener('touchmove', (e) => this.touch(e, 'move'), opts);
    surface.addEventListener('touchend', (e) => this.touch(e, 'end'), opts);
    surface.addEventListener('touchcancel', (e) => this.touch(e, 'end'), opts);
  }

  private touch(e: TouchEvent, phase: 'start' | 'move' | 'end'): void {
    e.preventDefault();
    this.isTouch = true;
    this.device = 'touch';
    for (const t of Array.from(e.changedTouches)) {
      if (phase === 'start') {
        // First finger anywhere = floating move stick (one-thumb play with auto-aim).
        // A second finger becomes an optional aim stick.
        const s: Stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        if (!this.moveStick) {
          this.moveStick = s;
          this.onTouchStick?.('move', s);
        } else if (!this.aimStick) {
          this.aimStick = s;
          this.onTouchStick?.('aim', s);
        }
      } else {
        for (const which of ['move', 'aim'] as const) {
          const s = which === 'move' ? this.moveStick : this.aimStick;
          if (!s || s.id !== t.identifier) continue;
          if (phase === 'move') {
            s.x = t.clientX;
            s.y = t.clientY;
            this.onTouchStick?.(which, s);
          } else {
            if (which === 'move') this.moveStick = null;
            else this.aimStick = null;
            this.onTouchStick?.(which, null);
          }
        }
      }
    }
  }

  trigger(a: Action): void {
    this.pressed.add(a);
  }

  /** Polls the gamepad; call once per frame before reading input. */
  poll(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) {
      this.pad.mx = this.pad.my = this.pad.ax = this.pad.ay = 0;
      this.pad.fire = false;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    this.pad.mx = dz(gp.axes[0] ?? 0);
    this.pad.my = dz(gp.axes[1] ?? 0);
    this.pad.ax = dz(gp.axes[2] ?? 0);
    this.pad.ay = dz(gp.axes[3] ?? 0);
    const b = gp.buttons.map((x) => x.pressed);
    const edge = (i: number, a: Action) => {
      if (b[i] && !this.padButtons[i]) {
        this.pressed.add(a);
        this.device = 'pad';
      }
    };
    edge(0, 'confirm');
    edge(1, 'dash');
    edge(4, 'dash');
    edge(3, 'bomb');
    edge(5, 'bomb');
    edge(9, 'pause');
    edge(14, 'left');
    edge(15, 'right');
    this.pad.fire = !!(b[7] || b[6]);
    this.padButtons = b;
    if (this.pad.mx || this.pad.my || this.pad.ax || this.pad.ay) this.device = 'pad';
  }

  private wasdHeld(): boolean {
    const k = this.keys;
    return k.has('KeyW') || k.has('KeyA') || k.has('KeyS') || k.has('KeyD');
  }

  held(code: string): boolean {
    return this.keys.has(code);
  }

  consume(a: Action): boolean {
    if (this.pressed.has(a)) {
      this.pressed.delete(a);
      return true;
    }
    return false;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  /** Movement vector in screen space (x right, y down), length ≤ 1. */
  move(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    // WASD moves. If WASD isn't in use, the arrow keys move instead.
    const k = this.keys;
    const wasd = this.wasdHeld();
    if (k.has('KeyA') || (!wasd && k.has('ArrowLeft'))) x -= 1;
    if (k.has('KeyD') || (!wasd && k.has('ArrowRight'))) x += 1;
    if (k.has('KeyW') || (!wasd && k.has('ArrowUp'))) y -= 1;
    if (k.has('KeyS') || (!wasd && k.has('ArrowDown'))) y += 1;
    x += this.pad.mx;
    y += this.pad.my;
    if (this.moveStick) {
      const r = 46;
      x += Math.max(-1, Math.min(1, (this.moveStick.x - this.moveStick.ox) / r));
      y += Math.max(-1, Math.min(1, (this.moveStick.y - this.moveStick.oy) / r));
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  aim(): Aim {
    if (this.aimStick) {
      const dx = this.aimStick.x - this.aimStick.ox;
      const dy = this.aimStick.y - this.aimStick.oy;
      if (Math.hypot(dx, dy) > 8) return { kind: 'dir', x: dx, y: dy };
      return null;
    }
    if (this.device === 'pad' && (this.pad.ax || this.pad.ay)) return { kind: 'dir', x: this.pad.ax, y: this.pad.ay };
    // While WASD moves, the arrow keys aim (keyboard twin-stick).
    if (this.wasdHeld()) {
      let ax = 0;
      let ay = 0;
      if (this.keys.has('ArrowLeft')) ax -= 1;
      if (this.keys.has('ArrowRight')) ax += 1;
      if (this.keys.has('ArrowUp')) ay -= 1;
      if (this.keys.has('ArrowDown')) ay += 1;
      if (ax || ay) return { kind: 'dir', x: ax, y: ay };
    }
    if (this.mouseMoved && this.device === 'kbm') return { kind: 'point', clientX: this.mouseX, clientY: this.mouseY };
    return null;
  }

  firing(): boolean {
    return this.mouseDown || this.pad.fire || this.aimStick !== null;
  }
}
