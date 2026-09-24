import Phaser from 'phaser';
import './ui/styles.css';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { Settings } from './core/Settings';

Settings.load();

// Surface unexpected errors without crashing the page.
window.addEventListener('error', (e) => console.error('[Runtime error]', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[Unhandled promise]', e.reason));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#071526',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { antialias: true, powerPreference: 'high-performance', roundPixels: false },
  disableContextMenu: true,
  fps: { target: 60, min: 4, smoothStep: false },
  scene: [BootScene, MenuScene, GameScene],
});

(window as unknown as { __game: Phaser.Game }).__game = game;
