# starblaze

Top-down 3D arcade space shooter with huge particle effects, level ups, power-ups and ship upgrades.
Built **portrait-first**: hold your phone upright and fly with one thumb. On desktop it plays in a
vertical arcade-cabinet column.

**Play:** https://mearkus.github.io/starblaze/ (after GitHub Pages is enabled; see [Deploying](#deploying))

## Features

- **3D visuals:** procedural metallic ships lit by environment reflections, HDR bloom,
  chromatic aberration, a rippling hex-grid energy deck over a nebula, star layers, asteroids and a gas giant.
- **Big particle effects:** 26k-particle GPU pool, layered explosions (core flash, fireball, sparks,
  embers), tumbling hot debris, shockwave rings, dynamic explosion lights, lightning arcs.
- **Arcade loop:** waves that escalate, six enemy types plus gold elites, and a three-phase
  **Dreadnought** boss every 5th wave. Combo multiplier up to x8, screen shake, hit-stop and slow-mo.
- **Level ups:** collect XP crystals and pick 1 of 3 perks: homing missiles, orbital drones, chain
  lightning, nova pulses, rear guns, piercing rounds, shields and more (17 perks with tiers).
- **Power-ups:** Overdrive, Spread Shot, Score x2, Time Warp, Shield Burst, Repair, +Bomb, Magnet.
- **Ship upgrades:** earn credits every run and spend them in the Hangar on 10 permanent upgrades
  and two unlockable ships (Wraith, Bastion). Progress is saved in the browser.
- **Procedural audio:** every sound effect and the synthwave soundtrack are synthesised with WebAudio.
  No asset files.

## Controls

| | Touch (portrait) | Keyboard / mouse | Gamepad |
|---|---|---|---|
| Move | Drag anywhere (floating stick) | WASD / arrows | Left stick |
| Aim | Auto-aim (second finger aims manually) | Mouse, or arrows while moving with WASD | Right stick |
| Fire | Automatic | Automatic (`F` toggles, then hold mouse) | Automatic / RT |
| Dash | DASH button | Shift / right-click | B / LB |
| Bomb | BOMB button | Space | Y / RB |
| Pause | II button | Esc / P | Start |

## Getting started

```bash
npm install
npm run dev
```

Open the printed URL. On a phone on the same network, use `npm run dev -- --host`.

## Testing

```bash
npm test        # unit tests (perks, waves, stats, progression, save data, spatial hash)
npm run lint    # ESLint + TypeScript type check
npm run build   # production build into dist/
```

## Project structure

```
src/
  core/     math, input (touch/keyboard/mouse/gamepad), procedural audio, save data, spatial hash
  game/     Game loop and rules: enemies + AI, waves, perks, power-ups, stats, upgrades, ships
  render/   Three.js stage + post-processing, particles/effects, floor & background shaders, models, view sync
  ui/       DOM HUD, menus, hangar, level-up cards, banners and floating text
tests/      Vitest unit tests for the pure game logic
```

## Deploying

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to `main`.
Enable it once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The build uses a relative base path, so `dist/` also works on any static host.
