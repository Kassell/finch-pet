/**
 * pet — Canvas 段编排层。
 *
 * 唯一接触 `finch` 桥的模块:持有全部运行状态,把 sprite 解析(sprite.ts)、
 * 气泡策略与布局(bubble.ts)、纯绘制(draw.ts)、右键菜单(context-menu.ts)
 * 组装成 finch.canvas.define 的生命周期实现。
 *
 * 由 esbuild 打包为扩展根部的 pet-canvas.js(单文件 IIFE)注入 canvas shell。
 */
import type { CanvasInitArgs, CanvasPointerEvent } from "./finch-canvas.js";
import {
  isHostToCanvasMessage,
  type BubbleAction,
  type CanvasToHostMessage,
  type PetState,
  type PlayMode,
} from "../src/protocol.js";
import {
  BASE_FRAME_HEIGHT,
  BASE_FRAME_WIDTH,
  COLUMNS,
  ROWS,
  STATES,
  detectFrameCounts,
  detectVisibleContentBoundsByRow,
  normalizeState,
  spriteFrameSize,
  type VisibleBounds,
} from "./sprite.js";
import { chooseBubblePlacement, layoutBubble, type BubbleActionLayout, type BubblePlacement } from "./bubble.js";
import { drawLoading, drawPetFrame, paintBubble } from "./draw.js";
import { PetContextMenu } from "./context-menu.js";
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
} from "./drag.js";

const DEBUG_BACKGROUND = false;
const DEBUG_DYNAMIC_PASSTHROUGH = true;
/** 统一播放速度;每行动画实际帧数由图片透明像素探测决定,最多 8 帧。 */
const FPS = 8;
/** 宠物整体大小调节系数(1 = 原始基准框大小),与图片分辨率无关;气泡尺寸不受影响,锚点自动跟随。 */
const PET_SIZE_RATIO = 0.7;

const postToHost = (message: CanvasToHostMessage): void => finch.postMessage(message);

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

interface PetInitialData {
  layout?: { expandedHeight?: number; petCenterX?: number };
  pet?: { displayName?: string; name?: string; finch?: { scale?: number } };
  petName?: string;
  defaultState?: string;
  message?: string;
  spriteDataUrl?: string;
  initialClickThrough?: boolean;
}

class PetCanvasApp {
  private canvas!: HTMLCanvasElement;
  private c!: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private t = 0;

  private image: HTMLImageElement | undefined;
  private loaded = false;
  private error = "";
  private frameCounts: number[] = Array.from({ length: ROWS }, () => COLUMNS);
  private visibleContentBoundsByRow: VisibleBounds[] = Array.from(
    { length: ROWS },
    () => ({ x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT }),
  );

  private state: PetState = "idle";
  private stateOwner: StateSource = "system";
  private playMode: PlayMode = "loop";
  private frameIndex = 0;
  private frameAccum = 0;
  private transientUntil = 0;
  private mouseActionUntil = 0;
  private agentActionUntil = 0;
  private agentControlled = false;

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

  private bubbleText = "";
  private bubbleUntil = 0;
  private bubblePersistent = false;
  private bubbleSessionId: string | null = null;
  private bubbleAction: BubbleAction | null = null;
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

  private hitCanvas: HTMLCanvasElement | undefined;
  private hitCtx: CanvasRenderingContext2D | null = null;
  private readonly contextMenu = new PetContextMenu(() => postToHost({ type: "exitPet" }));
  private domPointerInstalled = false;

  init({ canvas, ctx2d, width, height, initialData }: CanvasInitArgs): void {
    this.canvas = canvas;
    this.c = ctx2d;
    this.w = width;
    this.h = height;
    const data = (initialData || {}) as PetInitialData;
    const layout = data.layout || {};
    this.expandedHeight = typeof layout.expandedHeight === "number" ? layout.expandedHeight : height;
    this.fixedPetCenterX = typeof layout.petCenterX === "number" ? layout.petCenterX : 240;
    this.petAnchorX = this.fixedPetCenterX;
    this.displays = this.readDisplays();
    this.clickThrough = data.initialClickThrough === true;
    const pet = data.pet || {};
    this.petName = pet.displayName || pet.name || data.petName || "Pet";
    this.scale = pet.finch && typeof pet.finch.scale === "number" ? pet.finch.scale : 0.72;
    this.setState(data.defaultState || "idle");
    if (data.message) this.say(data.message, 1800);

    this.image = new Image();
    this.image.onload = () => {
      if (!this.image) return;
      this.frameCounts = detectFrameCounts(this.image);
      this.visibleContentBoundsByRow = detectVisibleContentBoundsByRow(this.image, this.frameCounts);
      this.loaded = true;
      this.error = "";
      this.validateRestingPosition();
    };
    this.image.onerror = () => {
      this.error = "spritesheet 加载失败";
    };
    this.image.src = data.spriteDataUrl || "";
    this.installDomPointerFallback();
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    // 跨到不同缩放比的屏幕时 devicePixelRatio 变化会触发 resize,shell 重设
    // canvas 尺寸已把画布清空;同步补画一帧,避免等到下一个 rAF 前闪白。
    this.frame(0);
  }

  private cancelMouseAction(): void {
    if (this.clickTimer) {
      clearTimeout(this.clickTimer);
      this.clickTimer = 0;
    }
    this.lastClickAt = 0;
    this.mouseActionUntil = 0;
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
    for (const seam of verticalSeams(this.displays)) {
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
    if (actualX !== this.lastAppliedX || y !== this.lastAppliedY) finch.window?.setPosition(actualX, y);
    this.lastAppliedX = actualX;
    this.lastAppliedY = y;
    this.lastAppliedAt = performance.now();
    this.watchdogUntil = this.lastAppliedAt + 800;
    this.ensurePositionWatchdog();
    if (anchorChanged) this.frame(0);
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
          finch.window?.setPosition(this.lastAppliedX, this.lastAppliedY);
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
    if (!finch.window || typeof finch.window.setPosition !== "function") return false;
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
    this.mouseActionUntil = 0;
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
    const state = normalizeState(next);
    const source: StateSource = opts && typeof opts.source === "string" ? opts.source : "system";
    const now = performance.now();
    if (source === "mouse" && this.isAgentAnimationActive(now)) return;
    if (source === "agent") this.cancelMouseAction();

    this.state = state;
    this.stateOwner = source;
    this.frameIndex = 0;
    this.frameAccum = 0;
    const transientMs = opts && typeof opts.transientMs === "number" ? opts.transientMs : 0;
    const reqMode = opts && (opts.playMode === "once" || opts.playMode === "freeze") ? opts.playMode : null;
    this.playMode = reqMode && state !== "idle" ? reqMode : "loop";
    const onceMs = this.playMode === "once"
      ? this.frameCountForRow((STATES[state] || STATES.idle).row) * (1000 / FPS)
      : 0;
    this.transientUntil = transientMs > 0 ? now + transientMs : 0;
    if (source === "agent") {
      this.agentControlled = state !== "idle";
      this.agentActionUntil = state !== "idle" && transientMs > 0 ? now + transientMs : 0;
      this.mouseActionUntil = 0;
    } else if (source === "mouse") {
      this.mouseActionUntil = state !== "idle" ? now + (onceMs || transientMs || 0) : 0;
    } else if (state === "idle") {
      this.mouseActionUntil = 0;
      this.agentActionUntil = 0;
      this.agentControlled = false;
      this.playMode = "loop";
    }
  }

  private isAgentAnimationActive(now?: number): boolean {
    if (!this.agentControlled || this.state === "idle") return false;
    if (!this.agentActionUntil) return true;
    return (typeof now === "number" ? now : performance.now()) < this.agentActionUntil;
  }

  private isMouseActionActive(now?: number): boolean {
    if (this.dragging || this.inertiaFrameId !== null) return true;
    return this.mouseActionUntil > (typeof now === "number" ? now : performance.now());
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
    this.displays = this.readDisplays();
    const constrained = constrainWindowPosition(
      { x: virtualX, y: virtualY },
      this.currentDragContentBounds(),
      this.displays,
    );
    if (constrained.x !== virtualX || constrained.y !== virtualY) {
      this.applyWindowPosition(constrained.x, constrained.y);
    }
  }

  private readDisplays(): DisplayArea[] {
    const fromBridge = finch.window && typeof finch.window.getDisplays === "function"
      ? finch.window.getDisplays()
      : [];
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
    if (typeof text !== "string" || !text.trim()) return;
    this.bubbleText = text.trim().slice(0, 36);
    this.bubblePersistent = persistent === true;
    const candidate = action as BubbleAction | undefined;
    this.bubbleAction =
      candidate && candidate.id === "open-session" && typeof candidate.sessionId === "string"
        ? candidate
        : null;
    this.updateBubblePlacement();
    this.bubbleSessionId = typeof sessionId === "string"
      ? sessionId
      : this.bubbleAction?.sessionId || null;
    const durationMs = typeof transientMs === "number" ? Math.max(5000, transientMs) : 5000;
    this.bubbleUntil = this.bubblePersistent ? 0 : performance.now() + durationMs;
  }

  private clearBubble(preserveLayout?: boolean): void {
    this.bubbleText = "";
    this.bubbleUntil = 0;
    this.bubblePersistent = false;
    this.bubbleSessionId = null;
    this.bubbleAction = null;
    this.bubbleActionBounds = null;
    this.bubbleButtonPressed = null;
    this.bubbleButtonHover = null;
    if (preserveLayout !== true) this.bubblePlacement = "top-left";
  }

  frame(dt: number): void {
    this.t += dt / 1000;
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);
    if (DEBUG_BACKGROUND) {
      c.save();
      c.fillStyle = "rgba(255, 0, 0, 0.28)";
      c.fillRect(0, 0, this.w, this.h);
      c.restore();
    }
    const now = performance.now();
    if (this.transientUntil && now > this.transientUntil)
      this.setState("idle", { source: this.stateOwner || "system" });
    if (!this.bubblePersistent && this.bubbleUntil && now > this.bubbleUntil) this.clearBubble();
    if (!this.loaded) {
      drawLoading(c, this.w, this.h, this.error || "加载宠物中…");
      return;
    }

    const spec = STATES[this.state] || STATES.idle;
    const frameMs = 1000 / FPS;
    const frameCount = this.frameCountForRow(spec.row);
    this.frameAccum += dt;
    while (this.frameAccum >= frameMs) {
      this.frameAccum -= frameMs;
      if (this.frameIndex >= frameCount - 1) {
        if (this.playMode === "once") {
          this.setState("idle", { source: this.stateOwner || "system" });
          break;
        }
        if (this.playMode === "freeze") break;
      }
      this.frameIndex = this.playMode === "loop"
        ? (this.frameIndex + 1) % frameCount
        : Math.min(this.frameIndex + 1, frameCount - 1);
    }

    const drawSpec = STATES[this.state] || STATES.idle;
    const drawInfo = this.currentPetDrawInfo(drawSpec.row, this.frameCountForRow(drawSpec.row));
    if (this.image) drawPetFrame(c, { image: this.image, ...drawInfo });
    this.drawBubble(drawInfo);
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
    const breathe = this.state === "idle" ? Math.sin(this.t * 3) * 2 : 0;
    const drawW = BASE_FRAME_WIDTH * baseScale;
    const drawH = BASE_FRAME_HEIGHT * baseScale;
    const x = (anchorX ?? this.petAnchorX) - drawW / 2;
    const y = this.h - drawH - 14 - bounce + breathe;
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
    const localX = Math.floor(((x - info.x) / info.drawW) * BASE_FRAME_WIDTH);
    const localY = Math.floor(((y - info.y) / info.drawH) * BASE_FRAME_HEIGHT);
    if (localX < 0 || localX >= BASE_FRAME_WIDTH || localY < 0 || localY >= BASE_FRAME_HEIGHT) return false;
    try {
      if (!this.hitCanvas) {
        this.hitCanvas = document.createElement("canvas");
        this.hitCanvas.width = BASE_FRAME_WIDTH;
        this.hitCanvas.height = BASE_FRAME_HEIGHT;
        this.hitCtx = this.hitCanvas.getContext("2d", { willReadFrequently: true });
      }
      if (!this.hitCtx) return true;
      this.hitCtx.clearRect(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);
      this.hitCtx.drawImage(
        this.image,
        info.sx,
        info.sy,
        info.sourceW,
        info.sourceH,
        0,
        0,
        BASE_FRAME_WIDTH,
        BASE_FRAME_HEIGHT,
      );
      return this.hitCtx.getImageData(localX, localY, 1, 1).data[3] > 8;
    } catch {
      return true;
    }
  }

  private setPointerPassthrough(enabled: boolean): void {
    if (this.clickThrough === enabled) return;
    this.clickThrough = enabled;
    if (finch.window && typeof finch.window.setClickThrough === "function")
      finch.window.setClickThrough(enabled);
    postToHost({ type: "hitTest", clickThrough: enabled });
  }

  private updatePointerPassthrough(e: { x: number; y: number }): void {
    if (!DEBUG_DYNAMIC_PASSTHROUGH) return;
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
    this.contextMenu.show(x, y);
  }

  private installDomPointerFallback(): void {
    if (this.domPointerInstalled) return;
    this.domPointerInstalled = true;
    const target: HTMLElement | Window =
      this.canvas || document.getElementById("finch-canvas") || window;
    const toPointer = (type: CanvasPointerEvent["type"], e: MouseEvent): CanvasPointerEvent => ({
      type,
      x: typeof e.clientX === "number" ? e.clientX : 0,
      y: typeof e.clientY === "number" ? e.clientY : 0,
      screenX: typeof e.screenX === "number" ? e.screenX : undefined,
      screenY: typeof e.screenY === "number" ? e.screenY : undefined,
      button: typeof e.button === "number" ? e.button : 0,
    });
    const send = (type: CanvasPointerEvent["type"], e: MouseEvent) => {
      this.onPointer(toPointer(type, e));
    };
    target.addEventListener(
      "contextmenu",
      (e) => {
        const event = e as MouseEvent;
        event.preventDefault();
        event.stopPropagation();
        if (this.isPointOnPet(event.clientX, event.clientY))
          this.showContextMenu(event.clientX, event.clientY);
      },
      true,
    );
    target.addEventListener("pointerdown", (e) => send("down", e as MouseEvent), true);
    target.addEventListener("pointermove", (e) => send("move", e as MouseEvent), true);
    window.addEventListener("pointerup", (e) => send("up", e), true);
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") this.contextMenu.hide();
      },
      true,
    );
    if (!window.PointerEvent) {
      target.addEventListener("mousedown", (e) => send("down", e as MouseEvent), true);
      window.addEventListener("mouseup", (e) => send("up", e), true);
    }
  }

  private playSingleClick(): void {
    if (!this.canStartMouseAction()) return;
    this.setState("waving", { playMode: "once", source: "mouse" });
    postToHost({ type: "poke", state: this.state });
  }

  private playDoubleClick(): void {
    if (this.bubbleSessionId) {
      postToHost({ type: "openBubbleSession", sessionId: this.bubbleSessionId });
      this.clearBubble();
      return;
    }
    if (!this.canStartMouseAction()) return;
    this.setState("jumping", { playMode: "once", source: "mouse" });
    postToHost({ type: "poke", state: this.state });
  }

  onPointer(e: CanvasPointerEvent): void {
    if (e.type === "move") this.updatePointerPassthrough(e);

    if (e.type === "down") {
      if (typeof e.button === "number" && e.button === 2) {
        if (this.isPointOnPet(e.x, e.y)) this.showContextMenu(e.x, e.y);
        return;
      }
      this.contextMenu.hide();
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
      this.displays = this.readDisplays();
      this.clearDragIdleTimer();
      this.restoreDragCursor();
      return;
    }

    if (e.type === "move") {
      if (!this.dragging) {
        this.bubbleButtonHover = this.bubbleAction ? this.bubbleButtonAtPoint(e.x, e.y) : null;
        return;
      }
      this.contextMenu.hide();
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
          postToHost({ type: "bubbleAction", action: action.id, sessionId: action.sessionId });
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
        this.mouseActionUntil = 0;
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

  onMessage(raw: unknown): void {
    if (!isHostToCanvasMessage(raw)) return;
    const msg = raw;
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
    }
  }
}

const app = new PetCanvasApp();

finch.canvas.define({
  init: (args) => app.init(args),
  frame: (dt) => app.frame(dt),
  resize: (width, height) => app.resize(width, height),
  onPointer: (e) => app.onPointer(e),
  onMessage: (msg) => app.onMessage(msg),
});
