import type { CanvasInitArgs, CanvasPointerEvent } from "../platform/finch-canvas.js";
import type { HostToCanvasMessage } from "../../shared/protocol.js";

export interface GameViewport {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/** 通用场景契约；Engine 不知道任何具体场景名称。 */
export interface Scene {
  readonly id: string;
  enter(previous?: string): void;
  exit(next?: string): void;
  resize(width: number, height: number): void;
  update(dt: number): void;
  render(): void;
  pointer(event: CanvasPointerEvent): void;
  contextMenu?(x: number, y: number): boolean;
  message(message: HostToCanvasMessage): void;
  keyDown?(key: string): boolean;
  wheel?(deltaY: number): boolean;
  blur?(): void;
  dispose(): void;
}

export interface SceneFactoryContext {
  readonly viewport: GameViewport;
  readonly initialData: unknown;
  switchScene(scene: string): void;
}

export type SceneFactory = (context: SceneFactoryContext) => Scene;

/** 固定步长更新 + 独立渲染的轻量 2D 游戏引擎。 */
export class Game {
  private viewport!: GameViewport;
  private initialData: unknown;
  private active: Scene | undefined;
  private activeId = "";
  private accumulator = 0;
  private readonly fixedStepMs: number;
  private readonly factories = new Map<string, SceneFactory>();
  private readonly scenes = new Map<string, Scene>();

  constructor(options: { updatesPerSecond?: number } = {}) {
    this.fixedStepMs = 1000 / Math.max(1, options.updatesPerSecond ?? 60);
  }

  get currentSceneId(): string { return this.activeId; }

  register(id: string, factory: SceneFactory): this {
    if (!id.trim()) throw new Error("scene id is required");
    if (this.factories.has(id)) throw new Error(`scene is already registered: ${id}`);
    this.factories.set(id, factory);
    return this;
  }

  init(args: CanvasInitArgs, initialScene: string): void {
    this.viewport = { canvas: args.canvas, context: args.ctx2d, width: args.width, height: args.height };
    this.initialData = args.initialData;
    this.switchScene(initialScene);
  }

  switchScene(id: string): void {
    if (this.activeId === id && this.active) return;
    const previous = this.activeId || undefined;
    this.active?.exit(id);
    this.activeId = id;
    this.accumulator = 0;
    this.active = this.scene(id);
    this.active.resize(this.viewport.width, this.viewport.height);
    this.active.enter(previous);
    this.active.render();
  }

  resize(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
    this.active?.resize(width, height);
    this.active?.render();
  }

  frame(dt: number): void {
    if (!this.active) return;
    if (dt <= 0) { this.active.render(); return; }
    this.accumulator += Math.min(dt, 250);
    while (this.accumulator >= this.fixedStepMs) {
      this.active.update(this.fixedStepMs);
      this.accumulator -= this.fixedStepMs;
    }
    this.active.render();
  }

  pointer(event: CanvasPointerEvent): void { this.active?.pointer(event); }
  contextMenu(x: number, y: number): boolean { return this.active?.contextMenu?.(x, y) ?? false; }
  message(message: HostToCanvasMessage): void { this.active?.message(message); }
  keyDown(key: string): boolean { return this.active?.keyDown?.(key) ?? false; }
  wheel(deltaY: number): boolean { return this.active?.wheel?.(deltaY) ?? false; }
  blur(): void { this.active?.blur?.(); }

  dispose(): void {
    for (const scene of this.scenes.values()) scene.dispose();
    this.scenes.clear();
    this.active = undefined;
    this.activeId = "";
    this.accumulator = 0;
  }

  private scene(id: string): Scene {
    const existing = this.scenes.get(id);
    if (existing) return existing;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`scene is not registered: ${id}`);
    const scene = factory({ viewport: this.viewport, initialData: this.initialData, switchScene: (next) => this.switchScene(next) });
    if (scene.id !== id) throw new Error(`scene id mismatch: expected ${id}, received ${scene.id}`);
    this.scenes.set(id, scene);
    return scene;
  }
}
