/**
 * Petdex spritesheet 解析(纯逻辑)。
 *
 * 约定大于配置:所有图片都按 Petdex 标准 spritesheet 处理:
 * 固定 8 列 × 9 行解析;192×208 只是最小/基准显示尺寸。
 * 可以使用更高清的等比例 spritesheet,实际源图每帧尺寸按图片宽高 / 8 / 9 自动计算,
 * 屏幕渲染尺寸与图片分辨率无关(见 main.ts 的渲染基准框)。
 *
 * 某些动作行可能少于 8 个有效帧,后面的格子是透明空帧,
 * 所以加载图片后扫描每一行动作的有效帧数,避免动画循环到空帧时闪烁。
 */
import type { PetState } from "../src/protocol.js";

export const BASE_FRAME_WIDTH = 192;
export const BASE_FRAME_HEIGHT = 208;
export const COLUMNS = 8;
export const ROWS = 9;

/** Petdex 官方状态行。 */
export const STATES: Record<PetState, { row: number }> = {
  idle: { row: 0 },
  "running-right": { row: 1 },
  "running-left": { row: 2 },
  waving: { row: 3 },
  jumping: { row: 4 },
  failed: { row: 5 },
  waiting: { row: 6 },
  running: { row: 7 },
  review: { row: 8 },
};

const STATE_NAMES = new Set(Object.keys(STATES));

export function normalizeState(value: unknown): PetState {
  if (typeof value !== "string") return "idle";
  const state = value.trim().toLowerCase();
  return STATE_NAMES.has(state) ? (state as PetState) : "idle";
}

export interface FrameSize {
  width: number;
  height: number;
}

export interface VisibleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function spriteFrameSize(image: Partial<HTMLImageElement>): FrameSize {
  const sourceWidth = image.naturalWidth || image.width || COLUMNS * BASE_FRAME_WIDTH;
  const sourceHeight = image.naturalHeight || image.height || ROWS * BASE_FRAME_HEIGHT;
  return {
    width: sourceWidth / COLUMNS,
    height: sourceHeight / ROWS,
  };
}

function frameHasVisiblePixels(image: HTMLImageElement, row: number, column: number): boolean {
  const frame = spriteFrameSize(image);
  const canvas = document.createElement("canvas");
  canvas.width = BASE_FRAME_WIDTH;
  canvas.height = BASE_FRAME_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;
  ctx.clearRect(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);
  ctx.drawImage(
    image,
    column * frame.width,
    row * frame.height,
    frame.width,
    frame.height,
    0,
    0,
    BASE_FRAME_WIDTH,
    BASE_FRAME_HEIGHT,
  );
  const pixels = ctx.getImageData(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT).data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 8) return true;
  }
  return false;
}

/** 每行动作的有效帧数(最多 8)。读像素失败时保持每行 8 帧兜底。 */
export function detectFrameCounts(image: HTMLImageElement): number[] {
  const counts = Array.from({ length: ROWS }, () => COLUMNS);
  try {
    for (let row = 0; row < ROWS; row += 1) {
      let lastVisible = -1;
      for (let column = 0; column < COLUMNS; column += 1) {
        if (frameHasVisiblePixels(image, row, column)) lastVisible = column;
      }
      counts[row] = Math.max(1, lastVisible + 1);
    }
  } catch {
    return Array.from({ length: ROWS }, () => COLUMNS);
  }
  return counts;
}

/** 每行动作的可见像素包围盒(基准帧坐标系),用于拖拽贴边约束。 */
export function detectVisibleContentBoundsByRow(
  image: HTMLImageElement,
  frameCounts: number[],
): VisibleBounds[] {
  const fallback = (): VisibleBounds => ({ x: 0, y: 0, width: BASE_FRAME_WIDTH, height: BASE_FRAME_HEIGHT });
  const frame = spriteFrameSize(image);
  const canvas = document.createElement("canvas");
  canvas.width = BASE_FRAME_WIDTH;
  canvas.height = BASE_FRAME_HEIGHT;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) return Array.from({ length: ROWS }, fallback);
  const bounds: VisibleBounds[] = [];
  try {
    for (let row = 0; row < ROWS; row += 1) {
      let minX = BASE_FRAME_WIDTH;
      let minY = BASE_FRAME_HEIGHT;
      let maxX = -1;
      let maxY = -1;
      const count = Math.max(1, Math.min(COLUMNS, frameCounts[row] || COLUMNS));
      for (let column = 0; column < count; column += 1) {
        c.clearRect(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT);
        c.drawImage(
          image,
          column * frame.width,
          row * frame.height,
          frame.width,
          frame.height,
          0,
          0,
          BASE_FRAME_WIDTH,
          BASE_FRAME_HEIGHT,
        );
        const pixels = c.getImageData(0, 0, BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT).data;
        for (let y = 0; y < BASE_FRAME_HEIGHT; y += 1) {
          for (let x = 0; x < BASE_FRAME_WIDTH; x += 1) {
            if (pixels[(y * BASE_FRAME_WIDTH + x) * 4 + 3] <= 8) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      bounds[row] = maxX < minX || maxY < minY
        ? fallback()
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
  } catch {
    return Array.from({ length: ROWS }, fallback);
  }
  return bounds;
}
