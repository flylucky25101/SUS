import Phaser from 'phaser';
import { GAME_CONFIG } from '../core/config';
import { ArenaScene, type ArenaLaunch } from './ArenaScene';

export class GameRenderer {
  readonly scene: ArenaScene;
  private readonly game: Phaser.Game;

  constructor(parent: HTMLElement, launch: ArenaLaunch) {
    this.scene = new ArenaScene(launch);
    const gameConfig: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#080b12',
      transparent: false,
      antialias: true,
      roundPixels: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%',
      },
      render: {
        powerPreference: 'high-performance',
        antialias: true,
        pixelArt: false,
      },
      scene: [this.scene],
      fps: {
        target: GAME_CONFIG.simulationHz,
        forceSetTimeOut: false,
        smoothStep: true,
      },
      banner: false,
    };
    Object.defineProperty(gameConfig, 'resolution', {
      value: Math.min(window.devicePixelRatio || 1, GAME_CONFIG.renderDprCap),
      enumerable: true,
    });
    this.game = new Phaser.Game(gameConfig);
  }

  destroy(): void {
    this.game.destroy(true, false);
  }
}
