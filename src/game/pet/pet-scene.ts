/**
 * pet — Canvas 段编排层。
 *
 * 唯一接触 `finch` 桥的模块:持有全部运行状态,把 sprite 解析(sprite.ts)、
 * 气泡策略与布局(bubble.ts)、纯绘制(draw.ts)、右键菜单(context-menu.ts)
 * 组装成 finch.canvas.define 的生命周期实现。
 *
 * 由 esbuild 打包为扩展根部的 pet-canvas.js(单文件 IIFE)注入 canvas shell。
 */
import type { CanvasPointerEvent } from "../platform/finch-canvas.js";
import {
  type BubbleAction,
  type CanvasStrings,
  type CanvasToHostMessage,
  type HostToCanvasMessage,
  type PetState,
  type PlayMode,
} from "../../shared/protocol.js";
import {
  BASE_FRAME_HEIGHT,
  BASE_FRAME_WIDTH,
  COLUMNS,
  ROWS,
  STATES,
  detectFrameCounts,
  detectVisibleContentBoundsByRow,
  spriteFrameSize,
  type VisibleBounds,
} from "./assets/sprite.js";
import { chooseBubblePlacement, layoutBubble, type BubbleActionLayout, type BubblePlacement } from "./ui/bubble.js";
import { drawLoading, drawPetFrame, paintBubble } from "./rendering/pet-renderer.js";
import { PetContextMenu } from "./ui/context-menu.js";
import type { GameViewport, Scene } from "../core/game.js";
import { VisualTransitionSystem } from "../systems/visual-transition.js";
import { PetAnimationSystem } from "./systems/pet-animation-system.js";
import { PetBubbleSystem } from "./systems/pet-bubble-system.js";
import { PetHitTestSystem } from "./systems/pet-hit-test-system.js";
import type { CanvasPlatform } from "../platform/canvas-platform.js";
import {
  DRAG_THRESHOLD,
  INERTIA_MAX_DURATION_MS,
  INERTIA_MIN_SPEED,
  constrainWindowPosition,
  decayVelocity,
  limitVelocity,
  smoothVelocity,
  verticalSeams,
  type DisplayArea,
  type Point,
  type Rect,
  type Velocity,
} from "./physics/drag.js";

const DEBUG_BACKGROUND = false;
const DEBUG_DYNAMIC_PASSTHROUGH = true;
/** 统一播放速度;每行动画实际帧数由图片透明像素探测决定,最多 8 帧。 */
const FPS = 8;
/** 普通桌宠无需跟随显示器刷新率全量重绘；游戏和视觉过渡仍保持原始 rAF 频率。 */
const PET_RENDER_INTERVAL_MS = 1000 / 24;
/** 宠物整体大小调节系数(1 = 原始基准框大小),与图片分辨率无关;气泡尺寸不受影响,锚点自动跟随。 */
const PET_SIZE_RATIO = 0.7;
const GAME_WINDOW_WIDTH = 360;
/** 56px 独立状态栏 + 360×640 的 9:16 游戏内容区。 */
const GAME_WINDOW_HEIGHT = 696;
/** Canvas 即使由旧版 Host 启动也能完整显示的英文安全回退。 */
export const DEFAULT_CANVAS_STRINGS: CanvasStrings = {
  menuPlayGame: "Play",
  menuWave: "Wave",
  menuJump: "Jump",
  menuClosePet: "Close pet",
  gameHeader: "Flappy Finch",
  gameTitle: "FlappyFinch",
  gameStartHint: "Click / Space to fly",
  gameBest: "BEST {best}",
  gameOver: "Game Over",
  gameResult: "Score {score}  ·  Best {best}",
  gameRestartHint: "Click to play again",
  gameSoundOn: "Mute sound",
  gameSoundOff: "Play sound",
  loadingPet: "Loading pet…",
  spriteLoadFailed: "Failed to load spritesheet",
};

export interface PetSceneOptions {
  viewport: GameViewport;
  initialData: unknown;
  post(message: CanvasToHostMessage): void;
  platform: CanvasPlatform;
}


type StateSource = "system" | "mouse" | "agent";

interface SetStateOptions {
  source?: StateSource;
  transientMs?: number;
  playMode?: PlayMode;
}

interface PetDrawInfo {
  sx: number;
  sy: number;
  sourceW: number;
  sourceH: number;
  x: number;
  y: number;
  drawW: number;
  drawH: number;
  bounce: number;
}

export interface PetInitialData {
  layout?: { expandedHeight?: number; petCenterX?: number };
  pet?: { displayName?: string; name?: string; finch?: { scale?: number } };
  petName?: string;
  defaultState?: string;
  message?: string;
  spriteDataUrl?: string;
  initialClickThrough?: boolean;
  initialGameMode?: boolean;
  initialAppId?: string;
  strings?: CanvasStrings;
}

export class PetScene implements Scene {
  readonly id = "pet";
  private readonly transition = new VisualTransitionSystem();
  private readonly postToHost: (message: CanvasToHostMessage) => void;
  private canvas!: HTMLCanvasElement;
  private c!: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  /** 合并高刷新率显示器上的连续 rAF，降低透明窗口的清屏与合成开销。 */
  private pendingFrameMs = 0;

  private image: HTMLImageElement | undefined;
  private loaded = false;
  private firstFrameReported = false;
  private readonly diagnosticStartedAt = performance.now();
  private error = "";
  private frameCounts: number[] = Array.from({ length: ROWS }, () => COLUMNS);
  private visibleContentBoundsByRow: VisibleBounds[] = Array.from(
    { length: ROWS },
    () => ({ x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT }),
  );

  private readonly animation: PetAnimationSystem;
  private readonly bubble = new PetBubbleSystem();
  private readonly hitTest = new PetHitTestSystem(BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);

  private dragging = false;
  private dragMoved = false;
  private dragStartScreenX = 0;
  private dragStartScreenY = 0;
  private dragLastScreenX = 0;
  private dragLastScreenY = 0;
  private dragLastSampleAt = 0;
  private dragWindowX = 0;
  private dragWindowY = 0;
  private dragVelocity: Velocity = { x: 0, y: 0 };
  private dragContentBounds: Rect | null = null;
  private displays: DisplayArea[] = [];
  /** 显示器布局变化前可复用，避免拖拽期间每帧重复进行 O(n²) 接缝扫描。 */
  private displaySeams: number[] = [];
  private dragDirection: "" | "left" | "right" = "";
  private dragAnimationBlocked = false;
  private dragIdleTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private inertiaFrameId: number | null = null;
  private inertiaStartedAt = 0;
  private inertiaLastAt = 0;
  private lastAppliedX = 0;
  private lastAppliedY = 0;
  private lastAppliedAt = 0;
  private watchdogUntil = 0;
  private watchdogMisses = 0;
  private watchdogFrameId: number | null = null;
  private dragCursorActive = false;
  private dragCursorBefore = "";
  private lastClickAt = 0;
  private clickTimer: ReturnType<typeof setTimeout> | 0 = 0;

  private bubbleActionBounds: BubbleActionLayout | null = null;
  private bubbleButtonPressed: "action" | null = null;
  private bubbleButtonHover: "action" | null = null;
  private bubblePlacement: BubblePlacement = "top-left";

  private expandedHeight = 0;
  private fixedPetCenterX = 240;
  /** 实际绘制锚点（窗口坐标）。窗口贴缝停靠时偏离 fixedPetCenterX 以保持宠物绝对位置不变。 */
  private petAnchorX = 240;
  /** 贴缝滞回状态:宠物当前被按在哪条缝的哪一侧,完整越过缝才换边。 */
  private seamHold: { seam: number; side: "left" | "right" } | null = null;
  private scale = 0.72;
  private petName = "Pet";
  private clickThrough = false;
  private strings = DEFAULT_CANVAS_STRINGS;

  private readonly petMenu: PetContextMenu;

  constructor(private readonly options: PetSceneOptions) {
    this.canvas = options.viewport.canvas;
    this.c = options.viewport.context;
    this.w = options.viewport.width;
    this.h = options.viewport.height;
    this.postToHost = options.post;
    this.animation = new PetAnimationSystem(FPS, (row) => this.frameCountForRow(row), () => this.cancelMouseAction());
    this.petMenu = new PetContextMenu(
      () => this.requestGameOpen(),
      () => this.playSingleClick(),
      () => this.playJump(),
      () => this.postToHost({ type: "exitPet" }),
      this.strings,
    );
    this.load(options.initialData);
  }

  private get state(): PetState { return this.animation.snapshot.state; }
  private get stateOwner(): StateSource { return this.animation.snapshot.owner; }
  private get frameIndex(): number { return this.animation.snapshot.frameIndex; }
  private get bubbleText(): string { return this.bubble.snapshot.text; }
  private get bubblePersistent(): boolean { return this.bubble.snapshot.persistent; }
  private get bubbleSessionId(): string | null { return this.bubble.snapshot.sessionId; }
  private get bubbleAction(): BubbleAction | null { return this.bubble.snapshot.action; }

  private applyStrings(strings: CanvasStrings): void {
    this.strings = strings;
    this.petMenu.setStrings(strings);
    if (this.error) this.error = strings.spriteLoadFailed;
  }

  private load(initialData: unknown): void {
    const data = (initialData || {}) as PetInitialData;
    this.applyStrings(data.strings || DEFAULT_CANVAS_STRINGS);
    const layout = data.layout || {};
    this.expandedHeight = typeof layout.expandedHeight === "number" ? layout.expandedHeight : this.h;
    this.fixedPetCenterX = typeof layout.petCenterX === "number" ? layout.petCenterX : 240;
    this.petAnchorX = this.fixedPetCenterX;
    this.refreshDisplays();
    this.clickThrough = data.initialClickThrough === true;
    const pet = data.pet || {};
    this.petName = pet.displayName || pet.name || data.petName || "Pet";
    this.scale = pet.finch && typeof pet.finch.scale === "number" ? pet.finch.scale : 0.72;
    this.setState(data.defaultState || "idle");
    if (data.message) this.say(data.message, 1800);

    this.reportDiagnostic('canvas-init');
    this.image = new Image();
    this.image.onload = () => {
      if (!this.image) return;
      this.frameCounts = detectFrameCounts(this.image);
      this.visibleContentBoundsByRow = detectVisibleContentBoundsByRow(this.image, this.frameCounts);
      this.loaded = true;
      this.error = "";
      this.reportDiagnostic('sprite-loaded', {
        imageWidth: this.image.naturalWidth,
        imageHeight: this.image.naturalHeight,
      });
      this.validateRestingPosition();
    };
    this.image.onerror = () => {
      this.error = this.strings.spriteLoadFailed;
      this.reportDiagnostic('sprite-error');
    };
    this.image.src = data.spriteDataUrl || "";
  }

  private reportDiagnostic(stage: 'canvas-init' | 'sprite-loaded' | 'sprite-error' | 'first-frame', extra: Record<string, number> = {}): void {
    // 只上报数值几何信息，不携带图片、气泡或会话内容。诊断失败不能影响绘制。
    try {
      this.postToHost({
        type: 'petDiagnostic', stage,
        metrics: {
          elapsedMs: Math.round(performance.now() - this.diagnosticStartedAt),
          x: window.screenX, y: window.screenY,
          width: this.w, height: this.h,
          pixelWidth: this.canvas.width, pixelHeight: this.canvas.height,
          dpr: window.devicePixelRatio || 1,
          hidden: document.hidden ? 1 : 0,
          screenWidth: window.screen.width, screenHeight: window.screen.height,
          displayCount: this.displays.length,
          scale: this.scale,
          ...extra,
        },
      });
    } catch { /* best-effort diagnostic */ }
  }

  enter(): void { this.setPointerPassthrough(this.clickThrough); }
  exit(): void { this.petMenu.hide(); }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.pendingFrameMs = Math.max(this.pendingFrameMs, PET_RENDER_INTERVAL_MS);
    // Engine 会在 resize 后同步 render，避免 Canvas 尺寸重设后的空白帧。
  }

  private cancelMouseAction(): void {
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = 0;
    }
    this.lastClickAt = 0;
    this.animation.clearMouseAction();
    this.clearDragIdleTimer();
    this.cancelInertia(false);
    this.restoreDragCursor();
    this.dragging = false;
    this.dragMoved = false;
    this.dragDirection = "";
    this.dragAnimationBlocked = false;
    this.dragContentBounds = null;
  }

  private clearDragIdleTimer(): void {
    if (!this.dragIdleTimer) return;
    clearTimeout(this.dragIdleTimer);
    this.dragIdleTimer = 0;
  }

  /**
   * 把"虚拟居中窗口"x（宠物锚点在 fixedPetCenterX 的连续模型）映射为实际窗口摆放。
   * macOS 上窗口矩形只要横跨两块屏幕的接缝,Electron setPosition 就会随机错位,
   * 所以宠物靠近接缝时让窗口整体停靠在缝的一侧,由绘制锚点偏移保持宠物绝对位置
   * 不变;只有宠物本体真正横跨接缝的短暂行程内才允许窗口横跨。
   */
  private resolveWindowPlacement(virtualX: number): { actualX: number; anchorX: number } {
    const width = this.w;
    if (!width) return { actualX: virtualX, anchorX: this.fixedPetCenterX };
    const spec = STATES[this.state] || STATES.idle;
    const info = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row), this.fixedPetCenterX);
    const petHalf = info.drawW / 2 + 16;
    const clampAnchor = (anchor: number) => Math.min(Math.max(anchor, petHalf), width - petHalf);
    const centerAbs = virtualX + this.fixedPetCenterX;
    for (const seam of this.displaySeams) {
      if (virtualX >= seam || virtualX + width <= seam) continue;
      // 滞回选边:初次进入按宠物中心所在侧;之后只有宠物能完整渲染到
      // 对面(中心越过缝一个半身位)才换边,缝上小幅抖动不会来回翻面。
      let side: "left" | "right" = this.seamHold?.seam === seam
        ? this.seamHold.side
        : centerAbs >= seam ? "right" : "left";
      if (side === "left" && centerAbs - petHalf >= seam) side = "right";
      else if (side === "right" && centerAbs + petHalf <= seam) side = "left";
      this.seamHold = { seam, side };
      // 窗口整体停靠在缝的一侧,绝不横跨;锚点被夹住时宠物就"挺"在缝沿。
      const actualX = side === "right" ? seam : seam - width;
      return { actualX, anchorX: clampAnchor(centerAbs - actualX) };
    }
    this.seamHold = null;
    return { actualX: virtualX, anchorX: this.fixedPetCenterX };
  }

  /**
   * 移窗并开启位置看门狗。x 为虚拟居中模型坐标,实际摆放经 resolveWindowPlacement
   * 贴缝停靠;锚点变化时同步重绘,保证宠物像素位置连续。看门狗在移窗后短时间内
   * 逐帧比对实际位置与模型(拖动中阈值宽、静止后收紧),偏差连续出现时重发纠正,
   * 兜底仍可能发生的 Electron 跨缝错位。
   */
  private applyWindowPosition(x: number, y: number): void {
    const { actualX, anchorX } = this.resolveWindowPlacement(x);
    const anchorChanged = anchorX !== this.petAnchorX;
    this.petAnchorX = anchorX;
    if (actualX !== this.lastAppliedX || y !== this.lastAppliedY) this.options.platform.setPosition(actualX, y);
    this.lastAppliedX = actualX;
    this.lastAppliedY = y;
    this.lastAppliedAt = performance.now();
    this.watchdogUntil = this.lastAppliedAt + 800;
    this.ensurePositionWatchdog();
    if (anchorChanged) {
      this.pendingFrameMs = Math.max(this.pendingFrameMs, PET_RENDER_INTERVAL_MS);
      this.render();
    }
  }

  private ensurePositionWatchdog(): void {
    if (this.watchdogFrameId !== null) return;
    const tick = (): void => {
      this.watchdogFrameId = null;
      const now = performance.now();
      if (now > this.watchdogUntil) {
        this.watchdogMisses = 0;
        return;
      }
      // 移窗进行中 window.screenX/Y 允许 1-2 帧滞后,阈值取远大于单帧最大位移的值;
      // 静止 250ms 后不应再有任何滞后,阈值收紧,纠正接缝处的小幅错位滞留。
      const quiet = now - this.lastAppliedAt > 250;
      const limitX = quiet ? 8 : 160;
      const limitY = quiet ? 8 : 80;
      const offX = Math.abs(window.screenX - this.lastAppliedX);
      const offY = Math.abs(window.screenY - this.lastAppliedY);
      if (offX > limitX || offY > limitY) {
        this.watchdogMisses += 1;
        if (this.watchdogMisses >= 2) {
          this.watchdogMisses = 0;
          this.options.platform.setPosition(this.lastAppliedX, this.lastAppliedY);
        }
      } else {
        this.watchdogMisses = 0;
      }
      this.watchdogFrameId = requestAnimationFrame(tick);
    };
    this.watchdogFrameId = requestAnimationFrame(tick);
  }

  private showDragCursor(): void {
    if (this.dragCursorActive) return;
    this.dragCursorBefore = this.canvas.style.cursor;
    this.canvas.style.cursor = "grabbing";
    this.dragCursorActive = true;
  }

  private restoreDragCursor(): void {
    if (!this.dragCursorActive) return;
    this.canvas.style.cursor = this.dragCursorBefore;
    this.dragCursorBefore = "";
    this.dragCursorActive = false;
  }

  private scheduleDragIdle(): void {
    this.clearDragIdleTimer();
    this.dragIdleTimer = setTimeout(() => {
      this.dragIdleTimer = 0;
      if ((!this.dragging && this.inertiaFrameId === null)
        || this.dragAnimationBlocked
        || this.isAgentAnimationActive()) return;
      this.dragDirection = "";
      if (this.stateOwner === "mouse") this.setState("idle", { source: "mouse" });
    }, 180);
  }

  private setDragDirectionFromVelocity(velocityX: number): void {
    if (this.dragAnimationBlocked || this.isAgentAnimationActive()) return;
    if (Math.abs(velocityX) < 0.04) {
      if (this.dragDirection) this.scheduleDragIdle();
      return;
    }
    this.clearDragIdleTimer();
    const direction = velocityX > 0 ? "right" : "left";
    if (direction === this.dragDirection) return;
    this.dragDirection = direction;
    this.setState(direction === "right" ? "running-right" : "running-left", { source: "mouse" });
  }

  private updateDragPosition(e: CanvasPointerEvent, now: number): void {
    if (!this.dragging || typeof e.screenX !== "number" || typeof e.screenY !== "number") return;
    const pointer = { x: e.screenX, y: e.screenY };
    const pointerDelta = {
      x: pointer.x - this.dragLastScreenX,
      y: pointer.y - this.dragLastScreenY,
    };
    const elapsed = now - this.dragLastSampleAt;
    const previousWindow = { x: this.dragWindowX, y: this.dragWindowY };
    const constrained = constrainWindowPosition(
      {
        x: previousWindow.x + pointerDelta.x,
        y: previousWindow.y + pointerDelta.y,
      },
      this.dragContentBounds || this.currentDragContentBounds(),
      this.displays,
      previousWindow,
    );
    this.dragWindowX = constrained.x;
    this.dragWindowY = constrained.y;
    this.dragLastScreenX = pointer.x;
    this.dragLastScreenY = pointer.y;
    this.dragLastSampleAt = now;

    const appliedDelta = {
      x: constrained.x - previousWindow.x,
      y: constrained.y - previousWindow.y,
    };
    let velocity = smoothVelocity(this.dragVelocity, appliedDelta, elapsed);
    if (constrained.blockedX) velocity = { ...velocity, x: 0 };
    if (constrained.blockedY) velocity = { ...velocity, y: 0 };
    this.dragVelocity = velocity;

    if (appliedDelta.x || appliedDelta.y) {
      this.applyWindowPosition(constrained.x, constrained.y);
      if (this.bubbleText) this.updateBubblePlacement({ x: this.lastAppliedX, y: this.lastAppliedY });
    }

    const totalDx = pointer.x - this.dragStartScreenX;
    const totalDy = pointer.y - this.dragStartScreenY;
    if (!this.dragMoved && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD) {
      this.dragMoved = true;
      this.showDragCursor();
    }
    if (this.dragMoved) this.setDragDirectionFromVelocity(velocity.x);
  }

  private startInertia(now: number): boolean {
    if (!this.options.platform.canSetPosition) return false;
    this.dragVelocity = limitVelocity(this.dragVelocity);
    if (Math.hypot(this.dragVelocity.x, this.dragVelocity.y) < INERTIA_MIN_SPEED) return false;
    this.inertiaStartedAt = now;
    this.inertiaLastAt = now;

    const tick = (frameNow: number): void => {
      if (this.inertiaFrameId === null) return;
      const elapsed = Math.min(32, Math.max(0, frameNow - this.inertiaLastAt));
      this.inertiaLastAt = frameNow;
      const previousWindow = { x: this.dragWindowX, y: this.dragWindowY };
      const constrained = constrainWindowPosition(
        {
          x: previousWindow.x + this.dragVelocity.x * elapsed,
          y: previousWindow.y + this.dragVelocity.y * elapsed,
        },
        this.dragContentBounds || this.currentDragContentBounds(),
        this.displays,
        previousWindow,
      );
      this.dragWindowX = constrained.x;
      this.dragWindowY = constrained.y;
      if (constrained.x !== previousWindow.x || constrained.y !== previousWindow.y) {
        this.applyWindowPosition(constrained.x, constrained.y);
        if (this.bubbleText) this.updateBubblePlacement({ x: this.lastAppliedX, y: this.lastAppliedY });
      }

      let velocity = decayVelocity(this.dragVelocity, elapsed);
      if (constrained.blockedX) velocity = { ...velocity, x: 0 };
      if (constrained.blockedY) velocity = { ...velocity, y: 0 };
      this.dragVelocity = velocity;
      this.setDragDirectionFromVelocity(velocity.x);

      const expired = frameNow - this.inertiaStartedAt >= INERTIA_MAX_DURATION_MS;
      const stopped = Math.hypot(velocity.x, velocity.y) < INERTIA_MIN_SPEED;
      if (expired || stopped) {
        this.cancelInertia(true);
        return;
      }
      this.inertiaFrameId = requestAnimationFrame(tick);
    };

    this.inertiaFrameId = requestAnimationFrame(tick);
    return true;
  }

  private settleDragAnimation(): void {
    this.clearDragIdleTimer();
    const shouldReturnToIdle = !this.dragAnimationBlocked
      && !this.isAgentAnimationActive()
      && this.stateOwner === "mouse";
    this.dragMoved = false;
    this.dragDirection = "";
    this.dragAnimationBlocked = false;
    this.dragContentBounds = null;
    this.animation.clearMouseAction();
    if (shouldReturnToIdle) this.setState("idle", { source: "mouse" });
  }

  private cancelInertia(settle: boolean): void {
    if (this.inertiaFrameId !== null) cancelAnimationFrame(this.inertiaFrameId);
    this.inertiaFrameId = null;
    this.inertiaStartedAt = 0;
    this.inertiaLastAt = 0;
    this.dragVelocity = { x: 0, y: 0 };
    if (settle) this.settleDragAnimation();
  }

  private setState(next: unknown, opts?: SetStateOptions): void {
    this.animation.play(next, opts);
  }

  private isAgentAnimationActive(now?: number): boolean {
    return this.animation.isAgentActive(now);
  }

  private isMouseActionActive(now?: number): boolean {
    if (this.dragging || this.inertiaFrameId !== null) return true;
    return this.animation.isMouseActive(typeof now === "number" ? now : performance.now());
  }

  private canStartMouseAction(now?: number): boolean {
    const t = typeof now === "number" ? now : performance.now();
    return !this.isAgentAnimationActive(t) && !this.isMouseActionActive(t);
  }

  private petConstraintBounds(state: PetState): Rect {
    const spec = STATES[state] || STATES.idle;
    // 约束在"虚拟居中窗口"坐标系里计算,锚点固定为 fixedPetCenterX。
    const info = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row), this.fixedPetCenterX);
    const visible = this.visibleContentBoundsByRow[spec.row]
      || { x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT };
    return {
      x: info.x + (visible.x / BASE_FRAME_WIDTH) * info.drawW,
      y: info.y + (visible.y / BASE_FRAME_HEIGHT) * info.drawH,
      width: (visible.width / BASE_FRAME_WIDTH) * info.drawW,
      height: (visible.height / BASE_FRAME_HEIGHT) * info.drawH,
    };
  }

  private currentDragContentBounds(): Rect {
    const states: PetState[] = this.dragAnimationBlocked
      ? [this.state]
      : [this.state, "running-left", "running-right"];
    const bounds = states.map((state) => this.petConstraintBounds(state));
    const left = Math.min(...bounds.map((item) => item.x));
    const top = Math.min(...bounds.map((item) => item.y));
    const right = Math.max(...bounds.map((item) => item.x + item.width));
    const bottom = Math.max(...bounds.map((item) => item.y + item.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /**
   * 校验静止位置:约束只在拖拽/惯性期间生效,若窗口带着失效的持久化位置启动
   * (如旧版本把宠物留在了菜单栏上),这里做一次性吸附救援,把宠物主体拉回
   * 所有屏幕的联合可见区域内。
   */
  private validateRestingPosition(): void {
    if (this.dragging || this.inertiaFrameId !== null) return;
    const virtualX = window.screenX + this.petAnchorX - this.fixedPetCenterX;
    const virtualY = window.screenY;
    this.refreshDisplays();
    const constrained = constrainWindowPosition(
      { x: virtualX, y: virtualY },
      this.currentDragContentBounds(),
      this.displays,
    );
    if (constrained.x !== virtualX || constrained.y !== virtualY) {
      this.applyWindowPosition(constrained.x, constrained.y);
    }
  }

  private refreshDisplays(): void {
    this.displays = this.readDisplays();
    this.displaySeams = verticalSeams(this.displays);
  }

  private readDisplays(): DisplayArea[] {
    const fromBridge = this.options.platform.getDisplays();
    const valid = fromBridge.filter((display) => {
      const values = [
        display.bounds.x,
        display.bounds.y,
        display.bounds.width,
        display.bounds.height,
        display.workArea.x,
        display.workArea.y,
        display.workArea.width,
        display.workArea.height,
      ];
      return values.every((value) => Number.isFinite(value))
        && display.bounds.width > 0
        && display.bounds.height > 0
        && display.workArea.width > 0
        && display.workArea.height > 0;
    });
    if (valid.length) return valid;

    // 兼容尚未提供 getDisplays() 的 Finch 运行时：保守地只约束当前屏幕。
    const current = window.screen as Screen & {
      left?: number;
      top?: number;
      availLeft?: number;
      availTop?: number;
    };
    const workX = typeof current.availLeft === "number" ? current.availLeft : 0;
    const workY = typeof current.availTop === "number" ? current.availTop : 0;
    const displayX = typeof current.left === "number" ? current.left : workX;
    const displayY = typeof current.top === "number" ? current.top : Math.min(0, workY);
    return [{
      id: "current",
      bounds: {
        x: displayX,
        y: displayY,
        width: current.width || window.innerWidth,
        height: current.height || window.innerHeight,
      },
      workArea: {
        x: workX,
        y: workY,
        width: current.availWidth || current.width || window.innerWidth,
        height: current.availHeight || current.height || window.innerHeight,
      },
    }];
  }

  private updateBubblePlacement(windowPosition?: Point): void {
    if (!this.bubbleText) return;
    const screenExtra = window.screen as Screen & {
      left?: number;
      top?: number;
      availLeft?: number;
      availTop?: number;
    };
    const displayLeft = typeof screenExtra.left === "number"
      ? screenExtra.left
      : typeof screenExtra.availLeft === "number" ? screenExtra.availLeft : 0;
    const displayTop = typeof screenExtra.top === "number"
      ? screenExtra.top
      : typeof screenExtra.availTop === "number" ? screenExtra.availTop : 0;
    const displayWidth = Number.isFinite(screenExtra.width) ? screenExtra.width : window.innerWidth;
    const topBoundary = typeof screenExtra.availTop === "number" ? screenExtra.availTop : displayTop;
    const windowX = windowPosition?.x ?? window.screenX;
    const windowY = windowPosition?.y ?? window.screenY;
    const spec = STATES[this.state] || STATES.idle;
    const petInfo = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row));
    this.bubblePlacement = chooseBubblePlacement({
      current: this.bubblePlacement,
      petCenterX: windowX + petInfo.x + petInfo.drawW / 2,
      petTopY: windowY + petInfo.y,
      topBoundary,
      displayLeft,
      displayWidth,
    });
  }

  private say(
    text: unknown,
    transientMs?: number,
    persistent?: boolean,
    action?: unknown,
    sessionId?: unknown,
  ): void {
    if (!this.bubble.say(text, transientMs, persistent, action, sessionId)) return;
    this.updateBubblePlacement();
  }

  private clearBubble(preserveLayout?: boolean): void {
    this.bubble.clear();
    this.bubbleActionBounds = null;
    this.bubbleButtonPressed = null;
    this.bubbleButtonHover = null;
    if (preserveLayout !== true) this.bubblePlacement = "top-left";
  }

  update(dt: number): void {
    this.pendingFrameMs += dt;
  }

  render(): void {
    const now = performance.now();
    const transitionActive = this.transition.current(now).active;
    if (!transitionActive && this.pendingFrameMs < PET_RENDER_INTERVAL_MS) return;
    const renderDt = this.pendingFrameMs;
    this.pendingFrameMs = 0;
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    this.transition.begin(c, this.w, this.h);
    if (DEBUG_BACKGROUND) {
      c.save();
      c.fillStyle = "rgba(255, 0, 0, 0.28)";
      c.fillRect(0, 0, this.w, this.h);
      c.restore();
    }
    this.animation.update(renderDt, now);
    if (this.bubble.update(now)) this.clearBubble();
    if (!this.loaded) {
      drawLoading(c, this.w, this.h, this.error || this.strings.loadingPet);
      c.restore();
      return;
    }

    const drawSpec = STATES[this.state] || STATES.idle;
    const drawInfo = this.currentPetDrawInfo(drawSpec.row, this.frameCountForRow(drawSpec.row));
    if (this.image) {
      drawPetFrame(c, { image: this.image, ...drawInfo });
      if (!this.firstFrameReported) {
        this.firstFrameReported = true;
        this.reportDiagnostic('first-frame', {
          drawX: drawInfo.x, drawY: drawInfo.y,
          drawWidth: drawInfo.drawW, drawHeight: drawInfo.drawH,
          sourceWidth: drawInfo.sourceW, sourceHeight: drawInfo.sourceH,
        });
      }
    }
    this.drawBubble(drawInfo);
    c.restore();
  }

  private frameCountForRow(row: number): number {
    const index = Math.max(0, Math.min(ROWS - 1, row));
    const count = this.frameCounts && this.frameCounts[index];
    return Number.isFinite(count) && count > 0 ? Math.min(COLUMNS, Math.max(1, count)) : COLUMNS;
  }

  private currentPetDrawInfo(row: number, frameCount?: number, anchorX?: number): PetDrawInfo {
    const safeFrameCount = frameCount || this.frameCountForRow(row);
    const safeFrameIndex = Math.min(this.frameIndex, safeFrameCount - 1);
    const frame = spriteFrameSize(this.image || {});
    const sx = safeFrameIndex * frame.width;
    const sy = Math.max(0, Math.min(ROWS - 1, row)) * frame.height;
    const maxPetW = this.w * 0.86;
    // 宠物尺寸以展开画布为基准,避免气泡出现或消失时宠物跟着缩放。
    const maxPetH = this.expandedHeight * 0.78;
    const baseScale =
      Math.min(maxPetW / BASE_FRAME_WIDTH, maxPetH / BASE_FRAME_HEIGHT) * this.scale * PET_SIZE_RATIO;
    const jumpDenominator = Math.max(1, safeFrameCount - 1);
    const bounce = this.state === "jumping"
      ? Math.sin((safeFrameIndex / jumpDenominator) * Math.PI) * 18
      : 0;
    const drawW = BASE_FRAME_WIDTH * baseScale;
    const drawH = BASE_FRAME_HEIGHT * baseScale;
    const x = (anchorX ?? this.petAnchorX) - drawW / 2;
    const y = this.h - drawH - 14 - bounce;
    return { sx, sy, sourceW: frame.width, sourceH: frame.height, x, y, drawW, drawH, bounce };
  }

  private drawBubble(petInfo: PetDrawInfo): void {
    if (!this.bubbleText || !petInfo) return;
    const c = this.c;
    c.save();
    const layout = layoutBubble({
      measure: c,
      text: this.bubbleText,
      placement: this.bubblePlacement,
      pet: petInfo,
      canvasWidth: this.w,
      canvasHeight: this.h,
      action: this.bubbleAction && this.bubbleAction.label
        ? { label: this.bubbleAction.label }
        : this.bubbleAction
          ? { label: "" }
          : null,
    });
    c.restore();
    this.bubbleActionBounds = layout.action;
    paintBubble(c, layout, {
      hover: this.bubbleButtonHover === "action",
      pressed: this.bubbleButtonPressed === "action",
    });
  }

  private bubbleButtonAtPoint(x: number, y: number): "action" | null {
    if (!this.bubbleAction) return null;
    const bounds = this.bubbleActionBounds;
    const contains = !!bounds
      && x >= bounds.x
      && x <= bounds.x + bounds.width
      && y >= bounds.y
      && y <= bounds.y + bounds.height;
    return contains ? "action" : null;
  }

  private isPointOnBubbleAction(x: number, y: number): boolean {
    return !!this.bubbleButtonAtPoint(x, y);
  }

  private isPointOnPet(x: number, y: number): boolean {
    if (!this.loaded || !this.image) return false;
    const spec = STATES[this.state] || STATES.idle;
    const info = this.currentPetDrawInfo(spec.row, this.frameCountForRow(spec.row));
    if (x < info.x || x > info.x + info.drawW || y < info.y || y > info.y + info.drawH) return false;
    const row = Math.max(0, Math.min(ROWS - 1, spec.row));
    const frameIndex = Math.min(this.frameIndex, this.frameCountForRow(row) - 1);
    return this.hitTest.contains(this.image, info, row, frameIndex, x, y);
  }

  private setPointerPassthrough(enabled: boolean): void {
    if (this.clickThrough === enabled) return;
    this.clickThrough = enabled;
    this.options.platform.setClickThrough(enabled);
    this.postToHost({ type: "hitTest", clickThrough: enabled });
  }

  private updatePointerPassthrough(e: { x: number; y: number }): void {
    if (!DEBUG_DYNAMIC_PASSTHROUGH) return;
    // DOM 菜单必须持续接收空白点击；打开期间禁止透明区重新穿透给系统。
    if (this.petMenu.isOpen) {
      this.setPointerPassthrough(false);
      return;
    }
    if (this.dragging || this.inertiaFrameId !== null) {
      this.setPointerPassthrough(false);
      return;
    }
    this.setPointerPassthrough(
      !this.isPointOnPet(e.x, e.y) && !this.isPointOnBubbleAction(e.x, e.y),
    );
  }

  private showContextMenu(x: number, y: number): void {
    this.setPointerPassthrough(false);
    this.petMenu.show(x, y);
  }

  private requestGameOpen(): void {
    const originalX = window.screenX;
    const originalY = window.screenY;
    const centerX = originalX + this.w / 2;
    const centerY = originalY + this.h / 2;
    const displays = this.readDisplays();
    const display = displays.find((item) =>
      centerX >= item.bounds.x
      && centerX < item.bounds.x + item.bounds.width
      && centerY >= item.bounds.y
      && centerY < item.bounds.y + item.bounds.height,
    ) || displays[0];
    const area = display?.workArea || {
      x: 0,
      y: 0,
      width: window.screen.availWidth,
      height: window.screen.availHeight,
    };
    this.postToHost({
      type: "enterGame",
      appId: "flappy-bird",
      originalX,
      originalY,
      centeredX: Math.round(area.x + (area.width - GAME_WINDOW_WIDTH) / 2),
      centeredY: Math.round(area.y + (area.height - GAME_WINDOW_HEIGHT) / 2),
    });
  }

  private playSingleClick(): void {
    if (!this.canStartMouseAction()) return;
    this.setState("waving", { playMode: "once", source: "mouse" });
    this.postToHost({ type: "poke", state: this.state });
  }

  private playJump(): void {
    if (!this.canStartMouseAction()) return;
    this.setState("jumping", { playMode: "once", source: "mouse" });
    this.postToHost({ type: "poke", state: this.state });
  }

  private playDoubleClick(): void {
    if (this.bubbleSessionId) {
      this.postToHost({ type: "openBubbleSession", sessionId: this.bubbleSessionId });
      this.clearBubble();
      return;
    }
    this.playJump();
  }

  contextMenu(x: number, y: number): boolean {
    if (!this.isPointOnPet(x, y)) return false;
    this.showContextMenu(x, y);
    return true;
  }

  pointer(e: CanvasPointerEvent): void {
    if (e.type === "move") this.updatePointerPassthrough(e);

    if (e.type === "down") {
      if (typeof e.button === "number" && e.button === 2) {
        if (this.isPointOnPet(e.x, e.y)) this.showContextMenu(e.x, e.y);
        return;
      }
      this.petMenu.hide();
      if (typeof e.button === "number" && e.button !== 0) return;
      if (this.inertiaFrameId !== null) this.cancelInertia(true);
      const bubbleButton = this.bubbleButtonAtPoint(e.x, e.y);
      if (bubbleButton) {
        this.bubbleButtonPressed = bubbleButton;
        this.setPointerPassthrough(false);
        return;
      }
      if (this.isMouseActionActive()) return;
      if (!this.isPointOnPet(e.x, e.y)) {
        this.setPointerPassthrough(true);
        return;
      }
      this.setPointerPassthrough(false);
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartScreenX = typeof e.screenX === "number" ? e.screenX : window.screenX + e.x;
      this.dragStartScreenY = typeof e.screenY === "number" ? e.screenY : window.screenY + e.y;
      this.dragLastScreenX = this.dragStartScreenX;
      this.dragLastScreenY = this.dragStartScreenY;
      this.dragLastSampleAt = performance.now();
      // 模型使用"虚拟居中窗口"坐标:实际窗口可能贴缝停靠,由锚点差还原。
      this.dragWindowX = window.screenX + this.petAnchorX - this.fixedPetCenterX;
      this.dragWindowY = window.screenY;
      this.dragVelocity = { x: 0, y: 0 };
      this.dragDirection = "";
      this.dragAnimationBlocked = this.isAgentAnimationActive();
      this.dragContentBounds = this.currentDragContentBounds();
      this.refreshDisplays();
      this.clearDragIdleTimer();
      this.restoreDragCursor();
      return;
    }

    if (e.type === "move") {
      if (!this.dragging) {
        this.bubbleButtonHover = this.bubbleAction ? this.bubbleButtonAtPoint(e.x, e.y) : null;
        return;
      }
      this.petMenu.hide();
      this.updateDragPosition(e, performance.now());
      return;
    }

    if (e.type === "up") {
      if (this.bubbleButtonPressed) {
        const pressedButton = this.bubbleButtonPressed;
        const shouldActivate = this.bubbleButtonAtPoint(e.x, e.y) === pressedButton;
        const action = this.bubbleAction;
        this.bubbleButtonPressed = null;
        if (shouldActivate && action) {
          this.postToHost({ type: "bubbleAction", action: action.id, sessionId: action.sessionId });
          this.clearBubble();
        }
        this.updatePointerPassthrough(e);
        return;
      }
      if (!this.dragging) return;
      const now = performance.now();
      this.updateDragPosition(e, now);
      this.dragging = false;
      this.clearDragIdleTimer();
      this.restoreDragCursor();

      if (this.dragMoved) {
        this.animation.clearMouseAction();
        if (!this.startInertia(now)) this.settleDragAnimation();
        this.updatePointerPassthrough(e);
        return;
      }

      this.dragContentBounds = null;
      this.dragVelocity = { x: 0, y: 0 };
      this.updatePointerPassthrough(e);

      if ((this.dragAnimationBlocked || this.isAgentAnimationActive()) && !this.bubbleSessionId) {
        this.dragAnimationBlocked = false;
        return;
      }
      this.dragAnimationBlocked = false;

      if (this.clickTimer && now - this.lastClickAt <= 320) {
        clearTimeout(this.clickTimer);
        this.clickTimer = 0;
        this.lastClickAt = 0;
        this.playDoubleClick();
        return;
      }

      this.lastClickAt = now;
      this.clickTimer = setTimeout(() => {
        this.clickTimer = 0;
        this.playSingleClick();
      }, 260);
    }
  }

  message(msg: HostToCanvasMessage): void {
    if (msg.type === "setState") {
      this.setState(msg.state, {
        transientMs: msg.transientMs,
        playMode: msg.playMode === "once" || msg.playMode === "freeze" ? msg.playMode : "loop",
        source: "agent",
      });
      if (msg.clearBubble) this.clearBubble(Boolean(msg.message));
      if (msg.message)
        this.say(msg.message, msg.transientMs || 2400, msg.persistent, msg.action, msg.sessionId);
    } else if (msg.type === "say") {
      this.say(msg.message, msg.transientMs || 2400, msg.persistent, msg.action, msg.sessionId);
    } else if (msg.type === "clearBubble") {
      this.clearBubble();
    } else if (msg.type === "config" && typeof msg.scale === "number") {
      this.scale = msg.scale;
    } else if (msg.type === "prepareGame") {
      this.requestGameOpen();
    } else if (msg.type === "locale") {
      this.applyStrings(msg.strings);
    } else if (msg.type === "visualTransition") {
      this.transition.apply(msg);
    } else if (msg.type === "gameMode" && msg.active) {
      this.cancelMouseAction();
      this.clearBubble();
      this.petMenu.hide();
      this.setPointerPassthrough(false);
    }
  }

  keyDown(key: string): boolean {
    if (key !== "Escape" || !this.petMenu.isOpen) return false;
    this.petMenu.hide();
    return true;
  }

  blur(): void {
    this.cancelMouseAction();
    this.petMenu.hide();
    this.setPointerPassthrough(true);
  }

  dispose(): void {
    this.cancelMouseAction();
    this.clearBubble();
    this.petMenu.hide();
    this.image = undefined;
  }
}
