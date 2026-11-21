# starblaze

Top-down 3D arcade space shooter with huge particle effects, level ups, power-ups and ship upgrades.

## Stack
TypeScript + Three.js (WebGL) + Vite, tested with Vitest, linted with ESLint (typescript-eslint). Node 22.

## Commands
<!-- Fill in the real commands once they exist. Claude reads these before building or testing. -->
- Install: `npm install`
- Test: `npm test`
- Lint/format: `npm run lint` (ESLint + `tsc --noEmit`)
- Run: `npm run dev`
- Build: `npm run build` (output in `dist/`, relative base so it works on GitHub Pages)

## Conventions
- Keep changes small and focused; one concern per PR.
- Write or update tests alongside behavior changes.
- Don't commit secrets. Use environment variables, documented in README.md.
- Update this file when commands or architecture change.

## Game conventions
- **Portrait-first.** Design and test for a phone held upright (390×844) first; desktop shows the
  same game in a centred portrait column (`#frame`, max aspect `MAX_ASPECT` in `src/game/config.ts`).
  UI sizes use container units (`cqw`/`cqh`) of the frame. Touch = floating stick + auto-aim.
- **No asset files.** Models, textures (shaders) and audio are procedural. Keep it that way unless
  there's a strong reason.
- Keep tunable numbers in the definition files (`enemies.ts`, `perks.ts`, `upgrades.ts`, `ships.ts`,
  `powerups.ts`, `waves.ts`, `stats.ts`) and cover pure logic with tests in `tests/`.
- Additive effects stack fast: check big moments (bombs, boss kills) don't white out the screen.

## Architecture notes
- `src/main.ts` boots `Stage` (renderer), `AudioEngine`, `Input`, `UI` and `Game`, then runs the
  frame loop (with adaptive resolution). `window.__starblaze` exposes the game for smoke tests.
- `src/game/Game.ts` is the simulation and state machine (`title`, `hangar`, `playing`, `levelup`,
  `paused`, `gameover`). Enemy behaviour is in `ai.ts`; wave schedules come from `waves.ts`.
- `src/render/Stage.ts` owns the camera rig, bloom/chromatic post chain, floor and background.
  `Fx.ts` holds particles, debris, shockwave rings and flash lights. `View.ts` syncs game state into
  instanced meshes each frame (constant draw calls). `models.ts` builds all geometry.
- `src/ui/UI.ts` drives the DOM overlay defined in `index.html`; styles in `src/style.css`.
- Progress persists in `localStorage` (`src/core/Save.ts`, key `starblaze.save.v1`).
