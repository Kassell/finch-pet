import type { CanvasDisplayInfo } from "./finch-canvas.js";

/** Scene 使用的窗口端口，隔离 Finch Canvas bridge。 */
export interface CanvasPlatform {
  readonly canSetPosition: boolean;
  setPosition(x: number, y: number): void;
  setClickThrough(value: boolean): void;
  getDisplays(): CanvasDisplayInfo[];
}

/** 唯一直接访问 finch.window 的 Canvas 平台适配器。 */
export class FinchCanvasPlatform implements CanvasPlatform {
  get canSetPosition(): boolean {
    return typeof finch.window?.setPosition === "function";
  }

  setPosition(x: number, y: number): void {
    finch.window?.setPosition(x, y);
  }

  setClickThrough(value: boolean): void {
    finch.window?.setClickThrough(value);
  }

  getDisplays(): CanvasDisplayInfo[] {
    return finch.window?.getDisplays() ?? [];
  }
}
