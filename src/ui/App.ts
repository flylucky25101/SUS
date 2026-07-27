import { AudioSystem } from '../audio/audio';
import { GAME_CONFIG } from '../core/config';
import type {
  CombatEvent,
  Difficulty,
  FighterId,
  FighterInstanceId,
  MatchMode,
  MatchOptions,
  StageDefinition,
  WorldState,
} from '../core/types';
import { FIGHTERS, getFighter } from '../data/fighters';
import { STAGES, getStage } from '../data/stages';
import { InputManager } from '../input/input-manager';
import type { SpriteAnimatorSnapshot } from '../render/SpriteAnimator';
import { GameRenderer } from '../render/game';
import { applySettingsCss, loadSettings, saveSettings, type GameSettings } from './settings';
import { localized, roleLabel, t, type TranslationKey } from './i18n';

type Screen = 'loading' | 'onboarding' | 'title' | 'main' | 'shop' | 'fighters' | 'stages' | 'difficulty' | 'settings' | 'help' | 'game';
type SelectionMode = Exclude<MatchMode, 'debug'>;
type FighterSlot = 'p1' | 'p2';
type SettingsContext = 'menu' | 'pause' | 'game';

const INITIAL_RELEASE_STAGE_ID: StageDefinition['id'] = 'vector-spire';

interface MatchSelection {
  mode: SelectionMode;
  p1: FighterId | null;
  p2: FighterId | null;
  stageId: StageDefinition['id'] | null;
  difficulty: Difficulty;
}

interface HudRefs {
  p1Damage: HTMLElement;
  p2Damage: HTMLElement;
  p1Stocks: HTMLElement;
  p2Stocks: HTMLElement;
  timer: HTMLElement;
  stockLabel: HTMLElement;
  p1Cooldown: HTMLElement;
  p2Cooldown: HTMLElement;
  countdown: HTMLElement;
  frameData: HTMLElement | null;
  inputLog: HTMLElement | null;
  debugMetrics: HTMLElement | null;
  combatLog: HTMLElement | null;
}

interface DebugBridge {
  forceResult: (winner: FighterInstanceId) => void;
  getState: () => WorldState | null;
  getPlayerSpriteSnapshot: () => SpriteAnimatorSnapshot | null;
  getFighterSpriteSnapshot: (id: FighterInstanceId) => SpriteAnimatorSnapshot | null;
  getFighterVisualScale: () => number;
  isStageBackgroundReady: () => boolean;
  getAudioState: () => AudioContextState | 'uninitialized';
  releaseInputs: () => void;
}

declare global {
  interface Window {
    __RIFT_DEBUG__?: DebugBridge;
  }
}

function colorHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Required interface element is missing: ${selector}`);
  return element;
}

function isDifficulty(value: string | undefined): value is Difficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function isFighterId(value: string | undefined): value is FighterId {
  return value === 'kade' || value === 'mira' || value === 'bram' || value === 'suri' || value === 'juno' || value === 'orin';
}

function isStageId(value: string | undefined): value is StageDefinition['id'] {
  return value === 'vector-spire' || value === 'drift-garden';
}

export class RiftForgeApp {
  private readonly root: HTMLElement;
  private readonly eventAbort = new AbortController();
  private settings: GameSettings;
  private readonly audio: AudioSystem;
  private readonly input: InputManager;
  private screen: Screen = 'loading';
  private selection: MatchSelection = {
    mode: 'quick',
    p1: null,
    p2: null,
    stageId: null,
    difficulty: 'normal',
  };
  private activeFighterSlot: FighterSlot = 'p1';
  private renderer: GameRenderer | null = null;
  private hud: HudRefs | null = null;
  private manuallyPaused = false;
  private autoPausedByPortrait = false;
  private matchEnded = false;
  private settingsContext: SettingsContext = 'menu';
  private settingsReturnScreen: Screen = 'main';
  private combatLog: string[] = [];
  private toastTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    document.documentElement.lang = this.settings.language;
    applySettingsCss(this.settings);
    this.audio = new AudioSystem(this.settings);
    this.input = new InputManager(this.settings);
    const signal = this.eventAbort.signal;
    root.addEventListener('click', (event) => this.handleClick(event), { signal });
    root.addEventListener('input', (event) => this.handleInput(event), { signal });
    root.addEventListener('pointerdown', () => {
      void this.audio.unlock().then(undefined, (error: unknown) => this.reportAudioIssue(error));
    }, { signal, once: true });
    window.addEventListener('resize', () => this.handleOrientation(), { signal });
    window.addEventListener('orientationchange', () => this.handleOrientation(), { signal });
    document.addEventListener('visibilitychange', () => this.handleVisibility(), { signal });
  }

  start(): void {
    this.renderLoading();
    window.setTimeout(() => {
      if (this.settings.onboardingSeen) this.setScreen('title');
      else this.setScreen('onboarding');
    }, 360);
    this.registerServiceWorker();
  }

  destroy(): void {
    this.destroyGame();
    this.eventAbort.abort();
    this.input.destroy();
    this.audio.destroy();
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
  }

  private setScreen(screen: Screen): void {
    if (this.screen === 'game' && screen !== 'game') {
      this.destroyGame();
      this.resumeAudio();
    }
    this.screen = screen;
    this.renderScreen();
  }

  private renderScreen(): void {
    switch (this.screen) {
      case 'loading': this.renderLoading(); break;
      case 'onboarding': this.renderOnboarding(); break;
      case 'title': this.renderTitle(); break;
      case 'main': this.renderMainMenu(); break;
      case 'shop': this.renderShop(); break;
      case 'fighters': this.renderFighterSelect(); break;
      case 'stages': this.renderStageSelect(); break;
      case 'difficulty': this.renderDifficultySelect(); break;
      case 'settings': this.renderSettingsScreen(); break;
      case 'help': this.renderHelp(); break;
      case 'game': break;
    }
  }

  private shell(content: string, className = ''): string {
    return `<main class="app-screen ${className}">
      <div class="ambient ambient-a"></div><div class="ambient ambient-b"></div>
      ${content}
      <div class="toast" data-toast role="status"></div>
    </main>`;
  }

  private logo(compact = false): string {
    return `<div class="brand ${compact ? 'brand--compact' : ''}" aria-label="Rift Forge">
      <span class="brand-mark" aria-hidden="true"><i></i><b></b></span>
      <span class="brand-rift">RIFT</span><span class="brand-forge">FORGE</span>
    </div>`;
  }

  private topBar(title: string, backAction: string): string {
    return `<header class="top-bar">
      <button class="icon-button back-button" data-action="${backAction}" aria-label="${t(this.settings.language, 'back')}"><span aria-hidden="true"></span></button>
      ${this.logo(true)}
      <h1>${title}</h1>
      <button class="icon-button settings-button" data-action="open-settings" aria-label="${t(this.settings.language, 'settings')}"><span aria-hidden="true"></span></button>
    </header>`;
  }

  private renderLoading(): void {
    this.root.innerHTML = this.shell(`<section class="loading-screen">
      ${this.logo()}
      <div class="rift-loader" aria-hidden="true"><i></i><i></i><i></i></div>
      <p>${t(this.settings.language, 'loading')}</p>
    </section>`, 'loading-layout');
  }

  private renderOnboarding(): void {
    const language = this.settings.language;
    this.root.innerHTML = this.shell(`<section class="onboarding-panel">
      <div class="eyebrow">FIELD BRIEF / 01</div>
      ${this.logo(true)}
      <h1>${t(language, 'onboardingTitle')}</h1>
      <div class="brief-grid">
        <article><span class="brief-icon stick-icon" aria-hidden="true"><i></i></span><b>01</b><p>${t(language, 'onboardingMove')}</p></article>
        <article><span class="brief-icon attack-icon" aria-hidden="true"><i></i></span><b>02</b><p>${t(language, 'onboardingStrike')}</p></article>
        <article><span class="brief-icon survive-icon" aria-hidden="true"><i></i></span><b>03</b><p>${t(language, 'onboardingSurvive')}</p></article>
      </div>
      <button class="primary-button" data-action="finish-onboarding">${t(language, 'continue')}<span aria-hidden="true">›</span></button>
    </section>`, 'onboarding-layout');
  }

  private renderTitle(): void {
    this.root.innerHTML = this.shell(`<section class="title-screen">
      <div class="title-grid" aria-hidden="true"></div>
      <p class="eyebrow">MOBILE RIFT COMBAT // BUILD 01</p>
      ${this.logo()}
      <p class="title-sub">BREAK THE LINE · HOLD THE PLATFORM</p>
      <button class="start-prompt" data-action="enter-main"><span>${t(this.settings.language, 'tapToStart')}</span></button>
      <div class="title-footer"><span>OFFLINE READY</span><span>60 HZ CORE</span><span>v1.0</span></div>
    </section>`, 'title-layout');
  }

  private renderMainMenu(): void {
    const language = this.settings.language;
    this.root.innerHTML = this.shell(`<section class="main-menu">
      <header class="menu-brand-row">${this.logo(true)}<span class="status-chip"><i></i> LOCAL SYSTEM</span></header>
      <div class="menu-copy"><p class="eyebrow">CHOOSE OPERATION</p><h1>ENTER THE<br><em>RIFT.</em></h1></div>
      <nav class="menu-actions" aria-label="${t(language, 'mainMenu')}">
        <button class="menu-tile menu-tile--primary" data-action="quick"><span class="menu-index">01</span><strong>${t(language, 'quickMatch')}</strong><small>PLAYER // CPU · 3 STOCK</small><i aria-hidden="true"></i></button>
        <button class="menu-tile" data-action="training"><span class="menu-index">02</span><strong>${t(language, 'training')}</strong><small>FRAME LAB // INFINITE</small><i aria-hidden="true"></i></button>
        <button class="menu-tile menu-tile--shop" data-action="shop"><span class="menu-index">03</span><strong>${t(language, 'shop')}</strong><small>FIGHTERS // ARENAS // OWNED</small><i aria-hidden="true"></i></button>
        <button class="menu-tile" data-action="help"><span class="menu-index">04</span><strong>${t(language, 'howToPlay')}</strong><small>INPUT // RECOVERY</small><i aria-hidden="true"></i></button>
        <button class="menu-tile" data-action="open-settings"><span class="menu-index">05</span><strong>${t(language, 'settings')}</strong><small>ACCESS // AUDIO // UI</small><i aria-hidden="true"></i></button>
        <button class="menu-tile menu-tile--debug" data-action="debug"><span class="menu-index">DEV</span><strong>${t(language, 'aiDebug')}</strong><small>SEEDED AI // METRICS</small><i aria-hidden="true"></i></button>
      </nav>
      <aside class="menu-art" aria-hidden="true"><p>NO CROWN.<br>ONLY CONTROL.</p></aside>
    </section>`, 'menu-layout');
  }

  private renderShop(): void {
    const language = this.settings.language;
    const fighterCards = FIGHTERS.map((fighter) => `<button class="shop-card shop-fighter" style="--fighter:${colorHex(fighter.color)};--accent:${colorHex(fighter.accent)}" data-action="shop-preview" data-value="${fighter.id}">
      <span class="shop-owned">${t(language, 'owned')}</span>
      <span class="portrait portrait--${fighter.id}" aria-hidden="true"></span>
      <small>${roleLabel(language, fighter.role)}</small><strong>${fighter.name}</strong><span>${localized(language, fighter.epithet)}</span>
    </button>`).join('');
    const stageCards = STAGES.map((stage) => `<button class="shop-card shop-stage" data-action="shop-preview" data-value="${stage.id}">
      <span class="shop-owned">${t(language, 'owned')}</span>
      <span class="shop-stage-art shop-stage-art--${stage.id}" aria-hidden="true"></span>
      <small>${stage.competitive ? t(language, 'competitive') : t(language, 'casual')}</small><strong>${localized(language, stage.name)}</strong><span>${localized(language, stage.description)}</span>
    </button>`).join('');
    this.root.innerHTML = this.shell(`${this.topBar(t(language, 'shop'), 'back-main')}
      <section class="shop-screen">
        <header class="shop-heading"><p class="eyebrow">RIFT ARCHIVE // ALL ACCESS</p><h2>${t(language, 'shopTitle')}</h2><p>${t(language, 'shopSubtitle')}</p></header>
        <div class="shop-section"><h3>${t(language, 'fighterCollection')}</h3><div class="shop-grid shop-grid--fighters">${fighterCards}</div></div>
        <div class="shop-section"><h3>${t(language, 'stageCollection')}</h3><div class="shop-grid shop-grid--stages">${stageCards}</div></div>
      </section>`, 'shop-layout');
  }

  private renderFighterSelect(): void {
    const language = this.settings.language;
    const slotLabel = this.activeFighterSlot === 'p1' ? t(language, 'choosePilot') : t(language, 'chooseRival');
    const cards = FIGHTERS.map((fighter) => {
      const selected = this.selection.p1 === fighter.id || this.selection.p2 === fighter.id;
      const assigned = this.selection.p1 === fighter.id ? 'P1' : this.selection.p2 === fighter.id ? 'CPU' : '';
      return `<button class="fighter-card ${selected ? 'is-selected' : ''}" style="--fighter:${colorHex(fighter.color)};--accent:${colorHex(fighter.accent)}" data-action="select-fighter" data-value="${fighter.id}" data-testid="fighter-${fighter.id}" aria-pressed="${selected}">
        <span class="fighter-number">0${FIGHTERS.indexOf(fighter) + 1}</span>${assigned ? `<span class="fighter-assigned fighter-assigned--${assigned.toLowerCase()}">${assigned}</span>` : ''}
        <span class="portrait portrait--${fighter.id}" aria-hidden="true"></span>
        <span class="fighter-info">
          <span class="fighter-role">${roleLabel(language, fighter.role)}</span><strong>${fighter.name}</strong><small>${localized(language, fighter.epithet)}</small>
          <span class="stat-strip" aria-label="${localized(language, fighter.description)}">
            <i style="--stat:${fighter.budget.mobility * 10}%"></i><i style="--stat:${fighter.budget.survivability * 10}%"></i><i style="--stat:${fighter.budget.range * 10}%"></i>
          </span>
        </span>
      </button>`;
    }).join('');
    const canContinue = this.selection.p1 !== null && this.selection.p2 !== null;
    this.root.innerHTML = this.shell(`${this.topBar(t(language, 'selectFighters'), 'back-main')}
      <section class="selection-screen fighter-selection">
        <div class="selection-heading"><p class="eyebrow">LOADOUT // 01</p><h2>${slotLabel}</h2>
          <div class="slot-switcher">
            <button class="${this.activeFighterSlot === 'p1' ? 'active' : ''}" data-action="choose-slot" data-value="p1"><span>P1</span>${this.selection.p1 ? getFighter(this.selection.p1).name : '—'}</button>
            <button class="${this.activeFighterSlot === 'p2' ? 'active' : ''}" data-action="choose-slot" data-value="p2" data-testid="cpu-slot"><span>CPU // ${t(language, 'cpuAuto')}</span>${this.selection.p2 ? getFighter(this.selection.p2).name : t(language, 'cpuWaiting')}</button>
          </div>
          <p class="cpu-auto-hint">${t(language, 'cpuAutoHint')}</p>
        </div>
        <div class="fighter-grid">${cards}</div>
        <button class="primary-button selection-next" data-action="fighters-next" ${canContinue ? '' : 'disabled'}>${this.selection.mode === 'training' ? t(language, 'begin') : t(language, 'next')}<span aria-hidden="true">›</span></button>
      </section>`, 'selection-layout');
  }

  private renderStageSelect(): void {
    const language = this.settings.language;
    const cards = STAGES.map((stage) => `<button class="stage-card ${this.selection.stageId === stage.id ? 'is-selected' : ''}" data-action="select-stage" data-value="${stage.id}" data-testid="stage-${stage.id}" aria-pressed="${this.selection.stageId === stage.id}">
      <span class="stage-preview stage-preview--${stage.theme}" aria-hidden="true"><i class="platform-main"></i><i class="platform-a"></i><i class="platform-b"></i><b></b></span>
      <span class="stage-meta"><small>${stage.competitive ? t(language, 'competitive') : t(language, 'casual')}</small><strong>${localized(language, stage.name)}</strong><span>${localized(language, stage.description)}</span></span>
      <i class="selection-corner" aria-hidden="true"></i>
    </button>`).join('');
    this.root.innerHTML = this.shell(`${this.topBar(t(language, 'selectStage'), 'back-fighters')}
      <section class="selection-screen stage-selection"><div class="selection-heading"><p class="eyebrow">ARENA // 02</p><h2>${t(language, 'selectStage')}</h2></div>
        <div class="stage-grid">${cards}</div>
        <button class="primary-button selection-next" data-action="stages-next" ${this.selection.stageId === null ? 'disabled' : ''}>${this.selection.mode === 'training' ? t(language, 'begin') : t(language, 'next')}<span aria-hidden="true">›</span></button>
      </section>`, 'selection-layout');
  }

  private renderDifficultySelect(): void {
    const language = this.settings.language;
    const difficultyCards: readonly [Difficulty, TranslationKey, TranslationKey, string][] = [
      ['easy', 'easy', 'easyDesc', '34%'],
      ['normal', 'normal', 'normalDesc', '62%'],
      ['hard', 'hard', 'hardDesc', '88%'],
    ];
    this.root.innerHTML = this.shell(`${this.topBar(t(language, 'selectDifficulty'), 'back-fighters')}
      <section class="selection-screen difficulty-selection"><div class="selection-heading"><p class="eyebrow">CPU PROFILE // 03</p><h2>${t(language, 'selectDifficulty')}</h2></div>
        <div class="difficulty-grid">${difficultyCards.map(([id, label, description, meter]) => `<button class="difficulty-card ${this.selection.difficulty === id ? 'is-selected' : ''}" data-action="select-difficulty" data-value="${id}" aria-pressed="${this.selection.difficulty === id}">
          <span class="difficulty-code">${id === 'easy' ? 'E' : id === 'normal' ? 'N' : 'H'}</span><strong>${t(language, label)}</strong><small>${t(language, description)}</small><span class="difficulty-meter"><i style="width:${meter}"></i></span>
        </button>`).join('')}</div>
        <button class="primary-button selection-next" data-action="begin-match">${t(language, 'begin')}<span aria-hidden="true">›</span></button>
      </section>`, 'selection-layout');
  }

  private renderSettingsScreen(): void {
    this.settingsContext = 'menu';
    this.root.innerHTML = this.shell(`${this.topBar(t(this.settings.language, 'settings'), 'back-settings-origin')}
      <section class="settings-screen">${this.settingsPanel()}</section>`, 'settings-layout');
  }

  private settingsPanel(): string {
    const language = this.settings.language;
    return `<div class="settings-columns">
      <section><p class="eyebrow">${t(language, 'controlSurface')}</p>
        ${this.rangeSetting('stickSize', 'stickSize', this.settings.stickSize, 84, 132, 4)}
        ${this.rangeSetting('buttonSize', 'buttonSize', this.settings.buttonSize, 54, 72, 2)}
        ${this.rangeSetting('buttonOpacity', 'opacity', this.settings.buttonOpacity, 0.45, 1, 0.05)}
        ${this.toggleSettingMarkup('floatingStick', 'floatingStick', this.settings.floatingStick)}
        ${this.toggleSettingMarkup('leftHanded', 'leftHanded', this.settings.leftHanded)}
      </section>
      <section><p class="eyebrow">${t(language, 'sensoryAccess')}</p>
        ${this.rangeSetting('sfxVolume', 'sound', this.settings.sfxVolume, 0, 1, 0.05)}
        ${this.rangeSetting('musicVolume', 'music', this.settings.musicVolume, 0, 1, 0.05)}
        ${this.toggleSettingMarkup('haptics', 'vibration', this.settings.haptics)}
        ${this.toggleSettingMarkup('screenShake', 'shake', this.settings.screenShake)}
        ${this.toggleSettingMarkup('reducedMotion', 'reducedMotion', this.settings.reducedMotion)}
      </section>
      <section><p class="eyebrow">${t(language, 'worldSettings')}</p>
        ${this.toggleSettingMarkup('hazards', 'hazards', this.settings.hazards)}
        <div class="setting-row"><span>${t(language, 'language')}</span><div class="segmented"><button data-action="set-language" data-value="ko" class="${language === 'ko' ? 'active' : ''}">${t(language, 'korean')}</button><button data-action="set-language" data-value="en" class="${language === 'en' ? 'active' : ''}">${t(language, 'english')}</button></div></div>
        <button class="secondary-button fullscreen-setting" data-action="fullscreen">${t(language, 'fullscreen')}<i aria-hidden="true"></i></button>
      </section>
    </div>`;
  }

  private rangeSetting(key: string, label: TranslationKey, value: number, minimum: number, maximum: number, step: number): string {
    const display = maximum <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}px`;
    return `<label class="setting-row setting-range"><span>${t(this.settings.language, label)}<output data-output="${key}">${display}</output></span><input type="range" min="${minimum}" max="${maximum}" step="${step}" value="${value}" data-setting="${key}" aria-label="${t(this.settings.language, label)}"></label>`;
  }

  private toggleSettingMarkup(key: string, label: TranslationKey, value: boolean): string {
    return `<div class="setting-row"><span>${t(this.settings.language, label)}</span><button class="switch ${value ? 'is-on' : ''}" data-action="toggle-setting" data-value="${key}" role="switch" aria-checked="${value}"><i></i></button></div>`;
  }

  private renderHelp(): void {
    const language = this.settings.language;
    this.root.innerHTML = this.shell(`${this.topBar(t(language, 'howToPlay'), 'back-main')}
      <section class="help-screen">
        <div class="help-visual"><div class="help-stick"><i></i></div><div class="help-buttons"><i>A</i><i>S</i><i>J</i><i>EV</i></div></div>
        <div class="help-grid">
          <article><b>MOVE</b><strong>${t(language, 'controlsMove')}</strong><small>WASD / ARROWS</small></article>
          <article><b>ATK</b><strong>${t(language, 'controlsNormal')}</strong><small>J / Z</small></article>
          <article><b>SP</b><strong>${t(language, 'controlsSpecial')}</strong><small>K / X</small></article>
          <article><b>JMP</b><strong>${t(language, 'controlsJump')}</strong><small>L / C / SPACE</small></article>
          <article><b>EV</b><strong>${t(language, 'controlsDodge')}</strong><small>I / SHIFT</small></article>
        </div>
        <div class="impact-explainer"><span>18%</span><i></i><span>126%</span><p>${t(language, 'onboardingSurvive')}</p></div>
      </section>`, 'help-layout');
  }

  private beginSelection(mode: SelectionMode): void {
    this.selection = { mode, p1: null, p2: null, stageId: INITIAL_RELEASE_STAGE_ID, difficulty: 'normal' };
    this.activeFighterSlot = 'p1';
    this.setScreen('fighters');
  }

  private startGame(mode: MatchMode = this.selection.mode): void {
    const p1 = mode === 'debug' ? 'kade' : this.selection.p1;
    const p2 = mode === 'debug' ? 'suri' : this.selection.p2;
    const stageId = mode === 'debug' ? 'vector-spire' : this.selection.stageId;
    if (p1 === null || p2 === null || stageId === null) throw new Error('Cannot start a bout with an incomplete selection.');
    this.destroyGame();
    this.resumeAudio();
    this.screen = 'game';
    this.manuallyPaused = false;
    this.autoPausedByPortrait = false;
    this.matchEnded = false;
    this.combatLog = [];
    const seed = mode === 'debug' ? 1337 : Math.trunc(Date.now() % 0x7fff_ffff);
    const options: MatchOptions = {
      mode,
      stageId,
      fighterOne: p1,
      fighterTwo: p2,
      difficulty: mode === 'debug' ? 'hard' : this.selection.difficulty,
      seed,
      hazards: mode === 'debug' ? false : this.settings.hazards,
    };
    this.renderGameShell(options);
    this.updateVirtualLandscape();
    const parent = requiredElement<HTMLElement>(this.root, '[data-game-canvas]');
    const touchRoot = requiredElement<HTMLElement>(this.root, '[data-touch-root]');
    this.input.attachTouch(touchRoot);
    this.renderer = new GameRenderer(parent, {
      options,
      input: this.input,
      audio: this.audio,
      getSettings: () => this.settings,
      callbacks: {
        onReady: () => requiredElement<HTMLElement>(this.root, '[data-game-shell]').classList.add('is-ready'),
        onState: (state, fps, particles) => this.updateHud(state, fps, particles),
        onPauseRequest: () => this.pauseGame(),
        onResult: (state) => this.showResult(state),
        onCombatEvent: (event) => this.recordCombatEvent(event),
        onCountdown: (value) => this.updateCountdown(value),
      },
    });
    if (import.meta.env.MODE === 'test') {
      window.__RIFT_DEBUG__ = {
        forceResult: (winner) => this.renderer?.scene.forceResult(winner),
        getState: () => this.renderer?.scene.getWorld() ?? null,
        getPlayerSpriteSnapshot: () => this.renderer?.scene.getPlayerSpriteSnapshot() ?? null,
        getFighterSpriteSnapshot: (id) => this.renderer?.scene.getFighterSpriteSnapshot(id) ?? null,
        getFighterVisualScale: () => this.renderer?.scene.getFighterVisualScale() ?? 1,
        isStageBackgroundReady: () => this.renderer?.scene.isStageBackgroundReady() ?? false,
        getAudioState: () => this.audio.getContextState(),
        releaseInputs: () => this.input.releaseAll(),
      };
    }
    this.handleOrientation();
  }

  private renderGameShell(options: MatchOptions): void {
    const language = this.settings.language;
    const first = getFighter(options.fighterOne);
    const second = getFighter(options.fighterTwo);
    this.root.innerHTML = `<main class="game-shell" data-game-shell data-mode="${options.mode}">
      <div class="game-canvas" data-game-canvas></div>
      <div class="game-vignette" aria-hidden="true"></div>
      <header class="combat-hud">
        <section class="fighter-hud fighter-hud--p1" style="--fighter:${colorHex(first.color)}"><div class="hud-name"><span>P1</span><strong>${first.name}</strong></div><div class="stock-dots" data-hud-stocks="p1"></div><b class="damage-value" data-hud-damage="p1">0%</b><i class="cooldown-line" data-hud-cooldown="p1"></i></section>
        <div class="match-clock"><small data-stage-label>${getStage(options.stageId).name[language]}</small><time data-hud-timer>${options.mode === 'training' ? '∞' : '2:30'}</time><span data-hud-stock-label>${this.stockLabel(options.mode, false)}</span></div>
        <section class="fighter-hud fighter-hud--p2" style="--fighter:${colorHex(second.color)}"><div class="hud-name"><span>CPU</span><strong>${second.name}</strong></div><div class="stock-dots" data-hud-stocks="p2"></div><b class="damage-value" data-hud-damage="p2">0%</b><i class="cooldown-line" data-hud-cooldown="p2"></i></section>
      </header>
      <div class="countdown" data-countdown aria-live="assertive"></div>
      ${options.mode === 'training' ? this.trainingPanel() : ''}
      ${options.mode === 'debug' ? this.debugPanel(options.seed) : ''}
      <section class="touch-controls" data-touch-root aria-label="${t(language, 'touch')}">
        <div class="stick-zone" data-stick-zone><div class="stick-base" data-stick-base><i></i><span data-stick-knob></span></div></div>
        <div class="action-cluster">
          <button class="control-button control-normal" data-control="normal" aria-label="${t(language, 'controlsNormal')}"><b>ATK</b><span>A</span></button>
          <button class="control-button control-special" data-control="special" aria-label="${t(language, 'controlsSpecial')}"><b>SP</b><span>S</span></button>
          <button class="control-button control-jump" data-control="jump" aria-label="${t(language, 'controlsJump')}"><b>JMP</b><span>J</span></button>
          <button class="control-button control-dodge" data-control="dodge" aria-label="${t(language, 'controlsDodge')}"><b>EVADE</b><span>EV</span></button>
          <button class="control-pause" data-control="pause" aria-label="${t(language, 'pause')}"><i></i><i></i></button>
        </div>
      </section>
      <section class="rotation-gate" aria-label="${t(language, 'rotateTitle')}">
        <div class="rotate-device" aria-hidden="true"><i></i><b></b></div><p class="eyebrow">ORIENTATION LOCK</p><h1 data-rotate-title>${t(language, 'rotateTitle')}</h1><p data-rotate-body>${t(language, 'rotateBody')}</p>
        <div><button class="secondary-button" data-action="open-settings-game">${t(language, 'settings')}</button><button class="secondary-button" data-action="exit-game">${t(language, 'mainMenu')}</button></div>
      </section>
      <div class="game-overlay" data-game-overlay></div>
      <div class="toast" data-toast role="status"></div>
    </main>`;
    this.hud = {
      p1Damage: requiredElement(this.root, '[data-hud-damage="p1"]'),
      p2Damage: requiredElement(this.root, '[data-hud-damage="p2"]'),
      p1Stocks: requiredElement(this.root, '[data-hud-stocks="p1"]'),
      p2Stocks: requiredElement(this.root, '[data-hud-stocks="p2"]'),
      timer: requiredElement(this.root, '[data-hud-timer]'),
      stockLabel: requiredElement(this.root, '[data-hud-stock-label]'),
      p1Cooldown: requiredElement(this.root, '[data-hud-cooldown="p1"]'),
      p2Cooldown: requiredElement(this.root, '[data-hud-cooldown="p2"]'),
      countdown: requiredElement(this.root, '[data-countdown]'),
      frameData: this.root.querySelector('[data-frame-data]'),
      inputLog: this.root.querySelector('[data-input-log]'),
      debugMetrics: this.root.querySelector('[data-debug-metrics]'),
      combatLog: this.root.querySelector('[data-combat-log]'),
    };
  }

  private trainingPanel(): string {
    const language = this.settings.language;
    return `<aside class="training-panel">
      <div class="training-actions"><span>${t(language, 'trainingBehavior')}</span>
        <button class="active" data-action="training-behavior" data-value="stand">${t(language, 'stand')}</button><button data-action="training-behavior" data-value="move">${t(language, 'move')}</button><button data-action="training-behavior" data-value="attack">${t(language, 'attack')}</button>
        <button data-action="training-reset-damage">${t(language, 'resetDamage')}</button><button data-action="training-reset-position">${t(language, 'resetPosition')}</button>
        <button data-action="training-toggle" data-value="showHitboxes">${t(language, 'hitboxes')}</button><button data-action="training-toggle" data-value="showFrameData">${t(language, 'frameData')}</button><button data-action="training-toggle" data-value="showInputs">${t(language, 'inputLog')}</button>
      </div>
      <output class="frame-data" data-frame-data></output><output class="input-log" data-input-log></output>
    </aside>`;
  }

  private debugPanel(seed: number): string {
    const language = this.settings.language;
    return `<aside class="debug-panel"><div><span>${t(language, 'debugSeed')} <b>${seed}</b></span><span>${t(language, 'debugSpeed')}</span>${[1, 2, 4, 8].map((speed) => `<button class="${speed === 1 ? 'active' : ''}" data-action="debug-speed" data-value="${speed}">${speed}×</button>`).join('')}</div><output data-debug-metrics></output><ol data-combat-log></ol></aside>`;
  }

  private stockLabel(mode: MatchMode, suddenDeath: boolean): string {
    const count = mode === 'training' ? '∞' : String(suddenDeath ? 1 : GAME_CONFIG.startingStocks);
    return `${count} ${t(this.settings.language, 'lives')}`;
  }

  private updateHud(state: WorldState, fps: number, particles: number): void {
    const hud = this.hud;
    if (hud === null) return;
    const [first, second] = state.fighters;
    setText(hud.p1Damage, `${Math.round(first.damage)}%`);
    setText(hud.p2Damage, `${Math.round(second.damage)}%`);
    hud.p1Damage.classList.toggle('is-danger', first.damage >= 100);
    hud.p2Damage.classList.toggle('is-danger', second.damage >= 100);
    const infiniteStocks = state.options.mode === 'training';
    const firstStocks = infiniteStocks ? '<b aria-hidden="true">∞</b>' : `<i></i>`.repeat(Math.max(0, first.stocks));
    const secondStocks = infiniteStocks ? '<b aria-hidden="true">∞</b>' : `<i></i>`.repeat(Math.max(0, second.stocks));
    hud.p1Stocks.classList.toggle('is-infinite', infiniteStocks);
    hud.p2Stocks.classList.toggle('is-infinite', infiniteStocks);
    if (hud.p1Stocks.innerHTML !== firstStocks) hud.p1Stocks.innerHTML = firstStocks;
    if (hud.p2Stocks.innerHTML !== secondStocks) hud.p2Stocks.innerHTML = secondStocks;
    setText(hud.stockLabel, this.stockLabel(state.options.mode, state.inSuddenDeath));
    if (state.options.mode === 'training') {
      setText(hud.timer, '∞');
      hud.timer.classList.remove('is-critical');
    } else {
      const frames = state.inSuddenDeath ? state.suddenDeathFramesRemaining : state.timeFramesRemaining;
      const seconds = Math.ceil(frames / GAME_CONFIG.simulationHz);
      setText(hud.timer, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      hud.timer.classList.toggle('is-critical', seconds <= 20);
    }
    const firstDodge = 1 - clamp01(first.dodgeCooldownFrames / GAME_CONFIG.dodgeCooldownFrames);
    const secondDodge = 1 - clamp01(second.dodgeCooldownFrames / GAME_CONFIG.dodgeCooldownFrames);
    hud.p1Cooldown.style.transform = `scaleX(${firstDodge})`;
    hud.p2Cooldown.style.transform = `scaleX(${secondDodge})`;
    if (hud.frameData !== null && state.training.showFrameData) {
      const active = first.attack === null ? `${first.status.toUpperCase()} · T${state.tick}` : `${first.attack.moveId.split('.').at(-1)?.toUpperCase()} · F${first.attack.frame}`;
      setText(hud.frameData, `${active} · HITSTUN ${first.hitstunFrames} · INV ${first.invulnerabilityFrames}`);
      hud.frameData.classList.add('is-visible');
    } else hud.frameData?.classList.remove('is-visible');
    if (hud.inputLog !== null && state.training.showInputs) {
      const input = first.input.previous;
      setText(hud.inputLog, `X ${input.moveX.toFixed(2)} Y ${input.moveY.toFixed(2)} · ${input.normal ? 'ATK ' : ''}${input.special ? 'SP ' : ''}${input.jump ? 'JMP ' : ''}${input.dodge ? 'EV' : ''}`);
      hud.inputLog.classList.add('is-visible');
    } else hud.inputLog?.classList.remove('is-visible');
    if (hud.debugMetrics !== null) {
      setText(hud.debugMetrics, `FPS ${fps.toFixed(0)} · ${state.tick} TICK · ${state.projectiles.length + 2} ENT · ${particles} FX · ${state.fighters[0].hitsLanded + state.fighters[1].hitsLanded} HITS`);
    }
  }

  private updateCountdown(value: number): void {
    if (this.hud === null) return;
    if (value <= 0) {
      setText(this.hud.countdown, t(this.settings.language, 'break'));
      this.hud.countdown.classList.add('go');
      window.setTimeout(() => this.hud?.countdown.classList.add('is-hidden'), 520);
    } else {
      setText(this.hud.countdown, String(value));
      this.hud.countdown.classList.remove('is-hidden');
    }
  }

  private recordCombatEvent(event: CombatEvent): void {
    if (event.type === 'hit' || event.type === 'strong-hit' || event.type === 'ringout') this.pulseCombatUi(event);
    if (event.type !== 'hit' && event.type !== 'strong-hit' && event.type !== 'ringout' && event.type !== 'respawn') return;
    const line = `T${event.tick} ${event.actorId.toUpperCase()} ${event.type.toUpperCase()} ${event.moveId?.split('.').at(-1) ?? ''}`;
    this.combatLog.unshift(line);
    this.combatLog = this.combatLog.slice(0, 5);
    if (this.hud?.combatLog !== null && this.hud?.combatLog !== undefined) {
      this.hud.combatLog.innerHTML = this.combatLog.map((entry) => `<li>${entry}</li>`).join('');
    }
  }

  private pulseCombatUi(event: CombatEvent): void {
    const shell = this.root.querySelector<HTMLElement>('[data-game-shell]');
    if (shell === null) return;
    const impact = event.type === 'strong-hit' ? 'heavy' : event.type === 'ringout' ? 'ringout' : 'hit';
    const token = `${event.tick}-${event.actorId}-${impact}`;
    shell.removeAttribute('data-impact');
    void shell.offsetWidth;
    shell.dataset.impact = impact;
    shell.dataset.impactToken = token;
    window.setTimeout(() => {
      if (shell.dataset.impactToken !== token) return;
      shell.removeAttribute('data-impact');
      shell.removeAttribute('data-impact-token');
    }, impact === 'ringout' ? 390 : impact === 'heavy' ? 240 : 150);

    if (event.targetId === null || this.hud === null) return;
    const damage = event.targetId === 'p1' ? this.hud.p1Damage : this.hud.p2Damage;
    const panel = damage.closest<HTMLElement>('.fighter-hud');
    const travel = event.targetId === 'p1' ? -7 : 7;
    const duration = impact === 'heavy' ? 240 : 150;
    damage.getAnimations().forEach((animation) => animation.cancel());
    panel?.getAnimations().forEach((animation) => animation.cancel());
    damage.animate([
      { transform: 'translateX(0) scale(1)', filter: 'brightness(1)' },
      { transform: `translateX(${travel}px) scale(${impact === 'heavy' ? 1.28 : 1.16})`, filter: 'brightness(2.2)' },
      { transform: 'translateX(0) scale(1)', filter: 'brightness(1)' },
    ], { duration, easing: 'cubic-bezier(.2,.85,.25,1)' });
    panel?.animate([
      { transform: 'translate3d(0,0,0)' },
      { transform: `translate3d(${travel * 0.7}px,${impact === 'heavy' ? 2 : 0}px,0)` },
      { transform: 'translate3d(0,0,0)' },
    ], { duration, easing: 'cubic-bezier(.2,.8,.25,1)' });
  }

  private pauseGame(): void {
    if (this.renderer === null || this.matchEnded || this.screen !== 'game') return;
    if (this.manuallyPaused) {
      this.resumeGame();
      return;
    }
    this.manuallyPaused = true;
    this.renderer.scene.setPaused(true);
    this.input.releaseAll();
    this.renderPauseOverlay();
    void this.audio.suspend().then(undefined, (error: unknown) => this.reportAudioIssue(error));
  }

  private resumeGame(): void {
    if (this.renderer === null || this.matchEnded) return;
    this.manuallyPaused = false;
    this.clearGameOverlay();
    if (!this.isPortrait()) this.renderer.scene.setPaused(false);
    this.resumeAudio();
  }

  private renderPauseOverlay(): void {
    const overlay = this.gameOverlay();
    if (overlay === null) return;
    const language = this.settings.language;
    overlay.className = 'game-overlay is-visible';
    overlay.innerHTML = `<section class="pause-card"><p class="eyebrow">${t(language, 'simulationHalted')}</p><h1>${t(language, 'pause')}</h1><div class="pause-lines"><i></i><i></i></div>
      <button class="primary-button" data-action="resume">${t(language, 'resume')}<span aria-hidden="true">›</span></button>
      <button class="secondary-button" data-action="restart-match">${t(language, 'restart')}</button>
      <button class="secondary-button" data-action="open-settings-pause">${t(language, 'settings')}</button>
      <button class="text-button" data-action="exit-game">${t(language, 'mainMenu')}</button>
    </section>`;
  }

  private showResult(state: WorldState): void {
    this.matchEnded = true;
    this.manuallyPaused = false;
    this.input.releaseAll();
    const overlay = this.gameOverlay();
    if (overlay === null || state.result === null) return;
    const language = this.settings.language;
    const winner = state.result.winnerId === null ? null : state.fighters.find((fighter) => fighter.id === state.result?.winnerId);
    const definition = winner === undefined || winner === null ? null : getFighter(winner.definitionId);
    const winnerSide = winner === null || winner === undefined ? null : winner.id === 'p1' ? 'P1' : 'CPU';
    const reason = state.result.reason === 'stocks' ? t(language, 'reasonStocks')
      : state.result.reason === 'time' ? t(language, 'reasonTime')
        : state.result.reason === 'sudden-death' ? t(language, 'reasonSuddenDeath')
          : t(language, 'reasonDraw');
    const [first, second] = state.fighters;
    overlay.className = 'game-overlay is-visible result-overlay';
    overlay.innerHTML = `<section class="result-card" style="--winner:${definition === null ? '#c6d0dc' : colorHex(definition.color)}">
      <p class="eyebrow">${t(language, 'boutComplete')} // ${reason}</p><span class="result-sigil" aria-hidden="true"><i></i></span>
      <h1>${definition === null ? t(language, 'draw') : `${winnerSide} // ${definition.name} ${t(language, 'victory')}`}</h1>
      <div class="result-stats"><span><b>${Math.round(first.totalDamageDealt)}</b>P1 ${t(language, 'damageShort')}</span><span><b>${first.hitsLanded}</b>P1 ${t(language, 'hitsShort')}</span><span><b>${Math.round(second.totalDamageDealt)}</b>CPU ${t(language, 'damageShort')}</span><span><b>${second.hitsLanded}</b>CPU ${t(language, 'hitsShort')}</span></div>
      <div class="result-actions"><button class="primary-button" data-action="rematch">${t(language, 'rematch')}<span aria-hidden="true">›</span></button><button class="secondary-button" data-action="result-fighters">${t(language, 'fighterSelect')}</button><button class="text-button" data-action="exit-game">${t(language, 'mainMenu')}</button></div>
    </section>`;
  }

  private openGameSettings(context: SettingsContext): void {
    this.settingsContext = context;
    if (this.renderer !== null) this.renderer.scene.setPaused(true);
    const overlay = this.gameOverlay();
    if (overlay === null) return;
    overlay.className = 'game-overlay is-visible settings-overlay';
    overlay.innerHTML = `<section class="settings-modal"><header><p class="eyebrow">${t(this.settings.language, 'systemConfig')}</p><h1>${t(this.settings.language, 'settings')}</h1><button class="icon-button close-button" data-action="close-game-settings" aria-label="${t(this.settings.language, 'close')}"><i></i></button></header>${this.settingsPanel()}</section>`;
  }

  private clearGameOverlay(): void {
    const overlay = this.gameOverlay();
    if (overlay === null) return;
    overlay.className = 'game-overlay';
    overlay.innerHTML = '';
  }

  private gameOverlay(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>('[data-game-overlay]');
  }

  private handleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-action]');
    if (button === null || button.hasAttribute('disabled')) return;
    const action = button.dataset.action;
    const value = button.dataset.value;
    this.audio.play('select', 0.65);
    switch (action) {
      case 'finish-onboarding':
        this.settings.onboardingSeen = true;
        this.persistSettings();
        this.setScreen('title');
        break;
      case 'enter-main': this.setScreen('main'); break;
      case 'quick': this.beginSelection('quick'); break;
      case 'training': this.beginSelection('training'); break;
      case 'shop': this.setScreen('shop'); break;
      case 'help': this.setScreen('help'); break;
      case 'debug':
        void this.requestLandscapeOrientation();
        this.startGame('debug');
        break;
      case 'open-settings':
        this.settingsReturnScreen = this.screen;
        this.setScreen('settings');
        break;
      case 'back-settings-origin': this.setScreen(this.settingsReturnScreen); break;
      case 'back-main': this.setScreen('main'); break;
      case 'back-fighters': this.setScreen('fighters'); break;
      case 'back-stages': this.setScreen('stages'); break;
      case 'choose-slot':
        if (value === 'p1' || value === 'p2') {
          this.activeFighterSlot = value;
          this.renderFighterSelect();
        }
        break;
      case 'select-fighter':
        if (isFighterId(value)) {
          if (this.activeFighterSlot === 'p1') {
            this.selection.p1 = value;
            this.selection.p2 = this.pickAutomaticCpu(value);
          } else {
            this.selection.p2 = value;
          }
          this.activeFighterSlot = this.activeFighterSlot === 'p1' ? 'p2' : 'p1';
          this.renderFighterSelect();
        }
        break;
      case 'shop-preview':
        this.showToast(`${value?.toUpperCase() ?? 'CONTENT'} // ${t(this.settings.language, 'owned')}`);
        break;
      case 'fighters-next':
        if (this.selection.mode === 'training') {
          void this.requestLandscapeOrientation();
          this.startGame('training');
        } else {
          this.setScreen('difficulty');
        }
        break;
      case 'select-stage':
        if (isStageId(value)) {
          this.selection.stageId = value;
          this.renderStageSelect();
        }
        break;
      case 'stages-next':
        if (this.selection.mode === 'training') {
          void this.requestLandscapeOrientation();
          this.startGame('training');
        }
        else this.setScreen('difficulty');
        break;
      case 'select-difficulty':
        if (isDifficulty(value)) {
          this.selection.difficulty = value;
          this.renderDifficultySelect();
        }
        break;
      case 'begin-match':
        void this.requestLandscapeOrientation();
        this.startGame('quick');
        break;
      case 'toggle-setting': this.toggleSetting(value); break;
      case 'set-language': this.setLanguage(value); break;
      case 'fullscreen': void this.requestFullscreen(); break;
      case 'resume': this.resumeGame(); break;
      case 'restart-match': this.startGame(this.renderer?.scene.getWorld().options.mode ?? this.selection.mode); break;
      case 'rematch': this.startGame(this.renderer?.scene.getWorld().options.mode ?? this.selection.mode); break;
      case 'result-fighters': this.setScreen('fighters'); break;
      case 'exit-game': this.setScreen('main'); break;
      case 'open-settings-pause': this.openGameSettings('pause'); break;
      case 'open-settings-game': this.openGameSettings('game'); break;
      case 'close-game-settings': this.closeGameSettings(); break;
      case 'training-behavior': this.setTrainingBehavior(value, button); break;
      case 'training-reset-damage': this.renderer?.scene.resetDamage(); break;
      case 'training-reset-position': this.renderer?.scene.resetPositions(); break;
      case 'training-toggle': this.toggleTraining(value, button); break;
      case 'debug-speed': this.setDebugSpeed(value, button); break;
    }
  }

  private pickAutomaticCpu(player: FighterId): FighterId {
    const candidates = FIGHTERS.filter((fighter) => fighter.id !== player);
    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    if (selected === undefined) throw new Error('CPU auto-pick requires at least two fighters.');
    return selected.id;
  }

  private handleInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const key = event.target.dataset.setting;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    if (key === 'stickSize') this.settings.stickSize = value;
    else if (key === 'buttonSize') this.settings.buttonSize = value;
    else if (key === 'buttonOpacity') this.settings.buttonOpacity = value;
    else if (key === 'sfxVolume') this.settings.sfxVolume = value;
    else if (key === 'musicVolume') this.settings.musicVolume = value;
    else return;
    const output = this.root.querySelector<HTMLOutputElement>(`[data-output="${key}"]`);
    if (output !== null) output.textContent = key === 'stickSize' || key === 'buttonSize' ? `${Math.round(value)}px` : `${Math.round(value * 100)}%`;
    this.persistSettings();
  }

  private toggleSetting(key: string | undefined): void {
    if (key === 'floatingStick') this.settings.floatingStick = !this.settings.floatingStick;
    else if (key === 'leftHanded') this.settings.leftHanded = !this.settings.leftHanded;
    else if (key === 'haptics') this.settings.haptics = !this.settings.haptics;
    else if (key === 'screenShake') this.settings.screenShake = !this.settings.screenShake;
    else if (key === 'reducedMotion') this.settings.reducedMotion = !this.settings.reducedMotion;
    else if (key === 'hazards') this.settings.hazards = !this.settings.hazards;
    else return;
    this.persistSettings();
    this.rerenderSettings();
  }

  private setLanguage(value: string | undefined): void {
    if (value !== 'ko' && value !== 'en') return;
    this.settings.language = value;
    document.documentElement.lang = value;
    this.persistSettings();
    this.rerenderSettings();
  }

  private rerenderSettings(): void {
    if (this.screen === 'settings') this.renderSettingsScreen();
    else if (this.screen === 'game') {
      this.refreshGameLanguage();
      this.openGameSettings(this.settingsContext);
    }
  }

  private refreshGameLanguage(): void {
    const state = this.renderer?.scene.getWorld();
    if (state === undefined) return;
    const language = this.settings.language;
    const stageLabel = this.root.querySelector<HTMLElement>('[data-stage-label]');
    if (stageLabel !== null) setText(stageLabel, getStage(state.options.stageId).name[language]);
    if (this.hud !== null) setText(this.hud.stockLabel, this.stockLabel(state.options.mode, state.inSuddenDeath));
    const touchRoot = this.root.querySelector<HTMLElement>('[data-touch-root]');
    touchRoot?.setAttribute('aria-label', t(language, 'touch'));
    const controlLabels: ReadonlyArray<readonly [string, TranslationKey]> = [
      ['normal', 'controlsNormal'],
      ['special', 'controlsSpecial'],
      ['jump', 'controlsJump'],
      ['dodge', 'controlsDodge'],
      ['pause', 'pause'],
    ];
    for (const [control, key] of controlLabels) {
      this.root.querySelector<HTMLElement>(`[data-control="${control}"]`)?.setAttribute('aria-label', t(language, key));
    }
    const rotationGate = this.root.querySelector<HTMLElement>('.rotation-gate');
    rotationGate?.setAttribute('aria-label', t(language, 'rotateTitle'));
    const rotateTitle = this.root.querySelector<HTMLElement>('[data-rotate-title]');
    const rotateBody = this.root.querySelector<HTMLElement>('[data-rotate-body]');
    if (rotateTitle !== null) setText(rotateTitle, t(language, 'rotateTitle'));
    if (rotateBody !== null) setText(rotateBody, t(language, 'rotateBody'));
    const settingsButton = rotationGate?.querySelector<HTMLElement>('[data-action="open-settings-game"]');
    const menuButton = rotationGate?.querySelector<HTMLElement>('[data-action="exit-game"]');
    if (settingsButton !== null && settingsButton !== undefined) setText(settingsButton, t(language, 'settings'));
    if (menuButton !== null && menuButton !== undefined) setText(menuButton, t(language, 'mainMenu'));
  }

  private resumeAudio(): void {
    void this.audio.resume().then(undefined, (error: unknown) => this.reportAudioIssue(error));
  }

  private closeGameSettings(): void {
    if (this.settingsContext === 'pause') this.renderPauseOverlay();
    else {
      this.clearGameOverlay();
      if (!this.isPortrait() && !this.manuallyPaused && !this.matchEnded) this.renderer?.scene.setPaused(false);
    }
  }

  private setTrainingBehavior(value: string | undefined, button: HTMLElement): void {
    if (value !== 'stand' && value !== 'move' && value !== 'attack') return;
    this.renderer?.scene.setTrainingBehavior(value);
    for (const sibling of this.root.querySelectorAll<HTMLElement>('[data-action="training-behavior"]')) sibling.classList.remove('active');
    button.classList.add('active');
  }

  private toggleTraining(value: string | undefined, button: HTMLElement): void {
    if (value !== 'showHitboxes' && value !== 'showFrameData' && value !== 'showInputs') return;
    const active = !button.classList.contains('active');
    button.classList.toggle('active', active);
    this.renderer?.scene.setTrainingOverlay(value, active);
  }

  private setDebugSpeed(value: string | undefined, button: HTMLElement): void {
    const speed = Number(value);
    if (![1, 2, 4, 8].includes(speed)) return;
    this.renderer?.scene.setSimulationSpeed(speed);
    for (const sibling of this.root.querySelectorAll<HTMLElement>('[data-action="debug-speed"]')) sibling.classList.remove('active');
    button.classList.add('active');
  }

  private persistSettings(): void {
    saveSettings(this.settings);
    applySettingsCss(this.settings);
    this.audio.updateSettings(this.settings);
    this.input.updateSettings(this.settings);
  }

  private handleOrientation(): void {
    this.updateVirtualLandscape();
    if (this.screen !== 'game' || this.renderer === null || this.matchEnded) return;
    if (this.isPortrait()) {
      if (!this.manuallyPaused) this.autoPausedByPortrait = true;
      this.renderer.scene.setPaused(true);
      this.input.releaseAll();
    } else if (this.autoPausedByPortrait && !this.manuallyPaused && this.gameOverlay()?.classList.contains('is-visible') !== true) {
      this.autoPausedByPortrait = false;
      this.renderer.scene.setPaused(false);
    }
  }

  private handleVisibility(): void {
    if (!document.hidden || this.screen !== 'game' || this.matchEnded || this.manuallyPaused) return;
    this.pauseGame();
  }

  private isPortrait(): boolean {
    return window.innerHeight > window.innerWidth && !document.documentElement.classList.contains('virtual-landscape');
  }

  private updateVirtualLandscape(): void {
    const shouldRotate = this.screen === 'game'
      && window.innerHeight > window.innerWidth
      && (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
    document.documentElement.classList.toggle('virtual-landscape', shouldRotate);
  }

  private async requestLandscapeOrientation(): Promise<void> {
    const orientation = screen.orientation as (ScreenOrientation & {
      lock?: (value: 'landscape') => Promise<void>;
    }) | undefined;
    if (orientation?.lock === undefined) return;
    try {
      // Most mobile browsers only allow orientation locking from a user gesture
      // while fullscreen (installed PWAs can honor the manifest directly).
      if (import.meta.env.MODE !== 'test'
        && document.fullscreenElement === null
        && document.documentElement.requestFullscreen !== undefined) {
        await document.documentElement.requestFullscreen();
      }
      await orientation.lock('landscape');
    } catch {
      // Browser tabs (notably iOS Safari) can reject orientation locking.
      // The virtual-landscape layout remains active as a no-error fallback.
    }
  }

  private async requestFullscreen(): Promise<void> {
    if (document.fullscreenElement !== null) {
      await document.exitFullscreen();
      return;
    }
    if (document.documentElement.requestFullscreen === undefined) {
      this.showToast(this.settings.language === 'ko' ? '이 브라우저는 전체 화면을 지원하지 않습니다.' : 'Fullscreen is not supported by this browser.');
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
    } catch (error: unknown) {
      const message = error instanceof DOMException ? error.message : String(error);
      this.showToast(this.settings.language === 'ko' ? `전체 화면 요청이 거부되었습니다: ${message}` : `Fullscreen request declined: ${message}`);
    }
  }

  private showToast(message: string): void {
    const element = this.root.querySelector<HTMLElement>('[data-toast]');
    if (element === null) return;
    element.textContent = message;
    element.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), 3200);
  }

  private reportAudioIssue(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    document.documentElement.dataset.audioIssue = message;
  }

  private registerServiceWorker(): void {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('./sw.js').then(undefined, (error: unknown) => {
      document.documentElement.dataset.serviceWorkerIssue = error instanceof Error ? error.message : String(error);
    });
  }

  private destroyGame(): void {
    this.input.detachTouch();
    this.renderer?.destroy();
    this.renderer = null;
    this.hud = null;
    this.matchEnded = false;
    this.manuallyPaused = false;
    document.documentElement.classList.remove('virtual-landscape');
    delete window.__RIFT_DEBUG__;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
