import { clamp } from '../core/math';
import { EMPTY_COMMAND, type InputCommand } from '../core/types';
import type { GameSettings } from '../ui/settings';

type ActionButton = 'normal' | 'special' | 'jump' | 'dodge' | 'pause';

const KEY_BINDINGS: Readonly<Record<ActionButton, readonly string[]>> = Object.freeze({
  normal: ['KeyJ', 'KeyZ'],
  special: ['KeyK', 'KeyX'],
  jump: ['KeyL', 'KeyC', 'Space'],
  dodge: ['KeyI', 'ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
});

function containsAny(set: ReadonlySet<string>, values: readonly string[]): boolean {
  return values.some((value) => set.has(value));
}

function tryCapturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch (error: unknown) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
}

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly buttonPointers = new Map<number, ActionButton>();
  private readonly keyboardAbort = new AbortController();
  private touchAbort: AbortController | null = null;
  private stickPointerId: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private stickVector = { x: 0, y: 0 };
  private settings: GameSettings;
  private touchRoot: HTMLElement | null = null;
  private stickBase: HTMLElement | null = null;
  private stickKnob: HTMLElement | null = null;

  constructor(settings: GameSettings) {
    this.settings = settings;
    const signal = this.keyboardAbort.signal;
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
      this.keys.add(event.code);
    }, { signal });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), { signal });
    window.addEventListener('blur', () => this.releaseAll(), { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    }, { signal });
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
  }

  attachTouch(root: HTMLElement): void {
    this.detachTouch();
    this.touchRoot = root;
    this.touchAbort = new AbortController();
    const signal = this.touchAbort.signal;
    const zone = root.querySelector<HTMLElement>('[data-stick-zone]');
    this.stickBase = root.querySelector<HTMLElement>('[data-stick-base]');
    this.stickKnob = root.querySelector<HTMLElement>('[data-stick-knob]');
    if (zone !== null) {
      zone.addEventListener('pointerdown', (event) => this.startStick(event, zone), { signal });
      zone.addEventListener('pointermove', (event) => this.moveStick(event), { signal });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        zone.addEventListener(type, (event) => this.endStick(event), { signal });
      }
    }
    for (const element of root.querySelectorAll<HTMLElement>('[data-control]')) {
      const action = element.dataset.control;
      if (!isActionButton(action)) continue;
      element.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.buttonPointers.set(event.pointerId, action);
        element.classList.add('is-pressed');
        tryCapturePointer(element, event.pointerId);
      }, { signal });
      const release = (event: PointerEvent): void => {
        if (this.buttonPointers.get(event.pointerId) === action) this.buttonPointers.delete(event.pointerId);
        if (![...this.buttonPointers.values()].includes(action)) element.classList.remove('is-pressed');
      };
      element.addEventListener('pointerup', release, { signal });
      element.addEventListener('pointercancel', release, { signal });
      element.addEventListener('lostpointercapture', release, { signal });
    }
  }

  detachTouch(): void {
    this.touchAbort?.abort();
    this.touchAbort = null;
    this.releaseAll();
    this.touchRoot = null;
    this.stickBase = null;
    this.stickKnob = null;
  }

  getCommand(): InputCommand {
    const gamepad = this.readGamepad();
    const keyboardX = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const keyboardY = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
      - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
    const moveX = Math.abs(this.stickVector.x) > 0.08
      ? this.stickVector.x
      : keyboardX !== 0 ? keyboardX : gamepad.moveX;
    const moveY = Math.abs(this.stickVector.y) > 0.08
      ? this.stickVector.y
      : keyboardY !== 0 ? keyboardY : gamepad.moveY;
    return {
      moveX: clamp(moveX, -1, 1),
      moveY: clamp(moveY, -1, 1),
      normal: this.hasTouchButton('normal') || containsAny(this.keys, KEY_BINDINGS.normal) || gamepad.normal,
      special: this.hasTouchButton('special') || containsAny(this.keys, KEY_BINDINGS.special) || gamepad.special,
      jump: this.hasTouchButton('jump') || containsAny(this.keys, KEY_BINDINGS.jump) || gamepad.jump,
      dodge: this.hasTouchButton('dodge') || containsAny(this.keys, KEY_BINDINGS.dodge) || gamepad.dodge,
      pause: this.hasTouchButton('pause') || containsAny(this.keys, KEY_BINDINGS.pause) || gamepad.pause,
    };
  }

  releaseAll(): void {
    this.keys.clear();
    this.buttonPointers.clear();
    for (const element of this.touchRoot?.querySelectorAll<HTMLElement>('.control-button.is-pressed') ?? []) {
      element.classList.remove('is-pressed');
    }
    this.stickPointerId = null;
    this.stickVector = { x: 0, y: 0 };
    this.updateStickVisual();
  }

  destroy(): void {
    this.detachTouch();
    this.keyboardAbort.abort();
  }

  private hasTouchButton(action: ActionButton): boolean {
    return [...this.buttonPointers.values()].includes(action);
  }

  private startStick(event: PointerEvent, zone: HTMLElement): void {
    if (this.stickPointerId !== null) return;
    event.preventDefault();
    this.stickPointerId = event.pointerId;
    const rect = zone.getBoundingClientRect();
    this.stickCenter = this.settings.floatingStick
      ? { x: event.clientX, y: event.clientY }
      : { x: rect.left + rect.width * 0.38, y: rect.top + rect.height * 0.62 };
    tryCapturePointer(zone, event.pointerId);
    this.positionStickBase();
    this.moveStick(event);
  }

  private moveStick(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointerId) return;
    const radius = this.settings.stickSize * 0.42;
    const dx = event.clientX - this.stickCenter.x;
    const dy = event.clientY - this.stickCenter.y;
    const length = Math.hypot(dx, dy);
    const scale = length > radius ? radius / length : 1;
    const normalizedLength = Math.min(1, length / radius);
    const deadzone = 0.18;
    const response = normalizedLength <= deadzone ? 0 : (normalizedLength - deadzone) / (1 - deadzone);
    this.stickVector = length < 0.001 ? { x: 0, y: 0 } : { x: (dx / length) * response, y: (dy / length) * response };
    if (this.stickKnob !== null) this.stickKnob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  }

  private endStick(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointerId) return;
    this.stickPointerId = null;
    this.stickVector = { x: 0, y: 0 };
    this.updateStickVisual();
  }

  private positionStickBase(): void {
    if (this.stickBase === null) return;
    this.stickBase.style.left = `${this.stickCenter.x}px`;
    this.stickBase.style.top = `${this.stickCenter.y}px`;
    this.stickBase.classList.add('is-active');
  }

  private updateStickVisual(): void {
    if (this.stickKnob !== null) this.stickKnob.style.transform = 'translate(0, 0)';
    if (this.stickBase !== null) this.stickBase.classList.remove('is-active');
  }

  private readGamepad(): InputCommand {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads[0];
    if (pad === null || pad === undefined) return { ...EMPTY_COMMAND };
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    return {
      moveX: Math.abs(axisX) < 0.18 ? 0 : axisX,
      moveY: Math.abs(axisY) < 0.18 ? 0 : axisY,
      normal: pad.buttons[0]?.pressed ?? false,
      special: pad.buttons[2]?.pressed ?? false,
      jump: pad.buttons[1]?.pressed ?? false,
      dodge: pad.buttons[4]?.pressed ?? false,
      pause: pad.buttons[9]?.pressed ?? false,
    };
  }
}

function isActionButton(value: string | undefined): value is ActionButton {
  return value === 'normal' || value === 'special' || value === 'jump' || value === 'dodge' || value === 'pause';
}
