/**
 * Canvas 段全局 `finch` API 类型声明。
 *
 * 这是 canvasWindowService 的 shell HTML 注入的运行时桥(见
 * src/main/services/canvasWindowService.ts 的 buildShellHtml),与 host 段的
 * `finch` 模块(finch.d.ts)是两套不同的 API。仅声明 finch-pet 用到的部分。
 */

export interface CanvasDisplayInfo {
  id: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
}

export interface FinchCanvasWindowApi {
  setAlwaysOnTop(value: boolean): void;
  setPosition(x: number, y: number): void;
  getDisplays(): CanvasDisplayInfo[];
  setClickThrough(value: boolean): void;
  close(): void;
}

export interface CanvasInitArgs {
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  initialData: unknown;
}

export interface CanvasPointerEvent {
  type: "down" | "move" | "up";
  x: number;
  y: number;
  button?: number;
  screenX?: number;
  screenY?: number;
}

export interface CanvasDefinition {
  init?(args: CanvasInitArgs): void;
  frame?(dt: number): void;
  resize?(width: number, height: number): void;
  onPointer?(e: CanvasPointerEvent): void;
  onMessage?(msg: unknown): void;
}

export interface FinchCanvasApi {
  postMessage(message: unknown): void;
  window?: FinchCanvasWindowApi;
  canvas: { define(definition: CanvasDefinition): void };
}

declare global {
  const finch: FinchCanvasApi;
}
