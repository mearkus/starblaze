import './style.css';
import { AudioEngine } from './core/Audio';
import { Input } from './core/Input';
import { browserStorage, loadSave } from './core/Save';
import { Game } from './game/Game';
import { Stage } from './render/Stage';
import { UI } from './ui/UI';

function boot(): void {
  const container = document.getElementById('game');
  if (!container) throw new Error('#game missing');

  let stage: Stage;
  try {
    stage = new Stage(container);
  } catch (err) {
    const boot = document.getElementById('boot');
    if (boot) boot.innerHTML = '<div class="boot-inner">WebGL is not available in this browser.</div>';
    throw err;
  }

  const save = loadSave(browserStorage());
  const audio = new AudioEngine();
  audio.applySettings(save.settings);
  const input = new Input(container);
  const ui = new UI(stage, audio, input);
  const game = new Game(stage, audio, input, ui, save);
  ui.bind(game);
  game.goTitle();

  // Browsers only allow audio after a user gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock);

  // Debug hook for automated smoke tests.
  (window as unknown as { __starblaze: Game }).__starblaze = game;

  // Adaptive quality: if gameplay runs below ~45 fps, step the render resolution down.
  const adaptive = !navigator.webdriver;
  let perfTime = 0;
  let perfFrames = 0;

  let last = performance.now();
  const frame = (now: number) => {
    const raw = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, raw);
    last = now;
    if (adaptive && game.state === 'playing' && raw < 0.25) {
      perfTime += raw;
      perfFrames++;
      if (perfTime > 2) {
        if (perfTime / perfFrames > 1 / 45) stage.degrade();
        perfTime = 0;
        perfFrames = 0;
      }
    }
    game.update(dt);
    ui.tick(dt);
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame((t) => {
    last = t;
    document.getElementById('boot')?.classList.add('gone');
    requestAnimationFrame(frame);
  });
}

boot();
