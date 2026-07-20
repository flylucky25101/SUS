import Phaser from 'phaser';
import {
  SpriteAnimationTimeline,
  type SpriteAnimationMap,
  type SpriteAnimationName,
  type SpriteAnimationSnapshot,
} from './sprite-animation';

export interface SpriteDrawOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly flipX?: boolean;
  readonly alpha?: number;
  readonly depth?: number;
}

export interface SpriteAnimatorSnapshot extends SpriteAnimationSnapshot {
  readonly ready: boolean;
  readonly failed: boolean;
  readonly flipX: boolean;
}

let animatorSequence = 0;

export class SpriteAnimator {
  private readonly scene: Phaser.Scene;
  private readonly frameWidth: number;
  private readonly frameHeight: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly animations: SpriteAnimationMap;
  private readonly timeline: SpriteAnimationTimeline;
  private readonly textureKey: string;
  private sprite: Phaser.GameObjects.Image | null = null;
  private failed = false;
  private destroyed = false;
  private lastFlipX = false;

  constructor(
    scene: Phaser.Scene,
    imageUrl: string,
    frameWidth: number,
    frameHeight: number,
    animations: SpriteAnimationMap,
    columns = 8,
    rows = 6,
  ) {
    this.scene = scene;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.columns = columns;
    this.rows = rows;
    this.animations = animations;
    this.timeline = new SpriteAnimationTimeline(animations);
    this.textureKey = `player-spritesheet-${animatorSequence}`;
    animatorSequence += 1;
    this.load(imageUrl);
  }

  setAnimation(name: SpriteAnimationName, restart = false): boolean {
    return this.timeline.setAnimation(name, restart);
  }

  update(deltaTime: number): void {
    this.timeline.update(deltaTime);
  }

  draw(options: SpriteDrawOptions): boolean {
    if (this.sprite === null || this.failed || this.destroyed) return false;
    const snapshot = this.timeline.snapshot();
    const definition = this.animations[snapshot.name];
    const frame = definition.row * this.columns + snapshot.frame;
    this.lastFlipX = options.flipX ?? false;
    this.sprite
      .setFrame(frame)
      .setPosition(options.x, options.y)
      .setDisplaySize(options.width, options.height)
      .setFlipX(this.lastFlipX)
      .setAlpha(options.alpha ?? 1)
      .setDepth(options.depth ?? 4)
      .setVisible(true);
    return true;
  }

  hide(): void {
    this.sprite?.setVisible(false);
  }

  snapshot(): SpriteAnimatorSnapshot {
    return {
      ...this.timeline.snapshot(),
      ready: this.sprite !== null && !this.destroyed,
      failed: this.failed,
      flipX: this.lastFlipX,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.sprite?.destroy();
    this.sprite = null;
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
  }

  private load(imageUrl: string): void {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (this.destroyed) return;
      const expectedWidth = this.frameWidth * this.columns;
      const expectedHeight = this.frameHeight * this.rows;
      if (image.naturalWidth !== expectedWidth || image.naturalHeight !== expectedHeight) {
        this.failed = true;
        return;
      }
      const texture = this.scene.textures.addSpriteSheet(this.textureKey, image, {
        frameWidth: this.frameWidth,
        frameHeight: this.frameHeight,
        endFrame: this.columns * this.rows - 1,
      });
      if (texture === null) {
        this.failed = true;
        return;
      }
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.sprite = this.scene.add.image(0, 0, this.textureKey, 0).setOrigin(0.5, 1).setVisible(false);
    };
    image.onerror = () => {
      if (!this.destroyed) this.failed = true;
    };
    image.src = imageUrl;
  }
}
