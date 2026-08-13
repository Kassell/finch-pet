import type { CanvasPointerEvent } from "../platform/finch-canvas.js";
import type { Game } from "../core/game.js";

/** 浏览器事件适配层：Scene 只接收标准化输入，不注册全局 DOM 监听。 */
export class DomInputAdapter {
  private disposers: Array<() => void> = [];

  constructor(private readonly game: Game, private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    if (this.disposers.length) return;
    const target: HTMLElement | Window = this.canvas || document.getElementById("finch-canvas") || window;
    const listen = <K extends keyof WindowEventMap>(node: Window | HTMLElement, type: K, listener: (event: WindowEventMap[K]) => void, capture = true) => {
      node.addEventListener(type, listener as EventListener, capture);
      this.disposers.push(() => node.removeEventListener(type, listener as EventListener, capture));
    };
    const pointer = (type: CanvasPointerEvent["type"], event: MouseEvent): CanvasPointerEvent => ({
      type,
      x: event.clientX ?? 0,
      y: event.clientY ?? 0,
      screenX: event.screenX,
      screenY: event.screenY,
      button: event.button,
    });
    listen(target, "contextmenu", (event) => {
      const value = event as MouseEvent;
      if (!this.game.contextMenu(value.clientX, value.clientY)) return;
      value.preventDefault();
      value.stopPropagation();
    });
    listen(target, "pointerdown", (event) => {
      const value = event as PointerEvent;
      try { this.canvas.setPointerCapture(value.pointerId); } catch { /* shell 不支持时由 window pointerup 兜底。 */ }
      this.game.pointer(pointer("down", value));
    });
    listen(target, "pointermove", (event) => this.game.pointer(pointer("move", event as PointerEvent)));
    listen(window, "pointerup", (event) => {
      const value = event as PointerEvent;
      try { if (this.canvas.hasPointerCapture(value.pointerId)) this.canvas.releasePointerCapture(value.pointerId); } catch { /* 已自动释放。 */ }
      this.game.pointer(pointer("up", value));
    });
    listen(window, "keydown", (event) => {
      const value = event as KeyboardEvent;
      if (!this.game.keyDown(value.key)) return;
      value.preventDefault();
      value.stopPropagation();
    });
    listen(window, "blur", () => this.game.blur());
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}
