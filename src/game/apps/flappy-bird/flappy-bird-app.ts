import type { CanvasPointerEvent } from "../../platform/finch-canvas.js";
import { FlappyBirdGame } from "./flappy-bird-game.js";
import type { CanvasStrings, CanvasToHostMessage, HostToCanvasMessage } from "../../../shared/protocol.js";
import type { GameViewport, Scene } from "../../core/game.js";
import { VisualTransitionSystem } from "../../systems/visual-transition.js";
import type { CanvasPlatform } from "../../platform/canvas-platform.js";

export interface FlappyBirdAppOptions {
  viewport: GameViewport;
  strings: CanvasStrings;
  post(message: CanvasToHostMessage): void;
  platform: CanvasPlatform;
}

/** 独立 Flappy Bird 场景：拥有自己的输入、更新、绘制、音频和窗口拖动状态。 */
export class FlappyBirdApp implements Scene {
  readonly id = "flappy-bird" as const;
  private readonly game: FlappyBirdGame;
  private dragging = false;
  private dragStartScreenX = 0;
  private dragStartScreenY = 0;
  private dragWindowX = 0;
  private dragWindowY = 0;
  private readonly transition = new VisualTransitionSystem();
  private pendingDt = 0;

  constructor(private readonly options: FlappyBirdAppOptions) {
    this.game = new FlappyBirdGame(() => options.post({
      type: "exitGame",
      x: window.screenX,
      y: window.screenY,
    }), options.strings);
  }

  enter(): void {
    this.dragging = false;
    this.options.viewport.canvas.style.cursor = "default";
    this.setClickThrough(false);
    this.game.resize(this.options.viewport.width, this.options.viewport.height);
    this.game.reset();
  }

  exit(): void {
    this.dragging = false;
    this.options.viewport.canvas.style.cursor = "default";
    this.game.cancelPointer();
    this.game.deactivate();
  }

  resize(width: number, height: number): void {
    this.game.resize(width, height);
  }

  update(dt: number): void { this.pendingDt += dt; }

  render(): void {
    const { context, width, height } = this.options.viewport;
    context.clearRect(0, 0, width, height);
    this.transition.begin(context, width, height);
    this.game.frame(context, this.pendingDt);
    this.pendingDt = 0;
    this.transition.end(context);
  }

  pointer(event: CanvasPointerEvent): void {
    this.setClickThrough(false);
    const screenX = typeof event.screenX === "number" ? event.screenX : window.screenX + event.x;
    const screenY = typeof event.screenY === "number" ? event.screenY : window.screenY + event.y;
    if (event.type === "down" && (event.button === undefined || event.button === 0)) {
      if (this.game.isDragHandle(event.x, event.y)) {
        this.dragging = true;
        this.dragStartScreenX = screenX;
        this.dragStartScreenY = screenY;
        this.dragWindowX = window.screenX;
        this.dragWindowY = window.screenY;
        this.options.viewport.canvas.style.cursor = "grabbing";
      } else {
        this.game.pointerDown(event.x, event.y);
      }
      return;
    }
    if (event.type === "move") {
      this.game.pointerMove(event.x, event.y);
      if (this.dragging) {
        this.options.platform.setPosition(
          this.dragWindowX + screenX - this.dragStartScreenX,
          this.dragWindowY + screenY - this.dragStartScreenY,
        );
        this.options.viewport.canvas.style.cursor = "grabbing";
      } else {
        this.options.viewport.canvas.style.cursor = this.game.cursorAt(event.x, event.y);
      }
      return;
    }
    if (event.type === "up") {
      this.dragging = false;
      this.game.pointerUp(event.x, event.y);
      this.options.viewport.canvas.style.cursor = this.game.cursorAt(event.x, event.y);
    }
  }

  message(message: HostToCanvasMessage): void {
    if (message.type === "locale") {
      this.game.setStrings(message.strings);
    } else if (message.type === "gameMode" && message.soundUrls) {
      this.game.setSoundUrls(message.soundUrls);
    } else if (message.type === "visualTransition") {
      this.transition.apply(message);
    }
  }

  keyDown(key: string): boolean { return this.game.keyDown(key); }

  blur(): void {
    this.dragging = false;
    this.options.viewport.canvas.style.cursor = "default";
    this.game.cancelPointer();
  }

  dispose(): void { this.exit(); }

  private setClickThrough(value: boolean): void {
    this.options.platform.setClickThrough(value);
    this.options.post({ type: "hitTest", clickThrough: value });
  }
}
