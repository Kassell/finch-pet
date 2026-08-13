/** finch-pet 自己的拖拽物理与屏幕边界计算，不依赖主进程拖拽策略。 */

export const DRAG_THRESHOLD = 4;
export const DRAG_VELOCITY_SMOOTHING = 0.35;
export const INERTIA_MIN_SPEED = 0.06;
export const INERTIA_MAX_SPEED = 1.8;
export const INERTIA_DECAY_PER_MS = 0.0085;
export const INERTIA_MAX_DURATION_MS = 650;

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface Velocity extends Point {}

export interface ConstrainedPosition extends Point {
  blockedX: boolean;
  blockedY: boolean;
}

export interface DisplayArea {
  id: string;
  bounds: Rect;
  workArea: Rect;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function smoothVelocity(current: Velocity, delta: Point, dt: number): Velocity {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 80) return { x: 0, y: 0 };
  const rawX = delta.x / dt;
  const rawY = delta.y / dt;
  return {
    x: current.x * (1 - DRAG_VELOCITY_SMOOTHING) + rawX * DRAG_VELOCITY_SMOOTHING,
    y: current.y * (1 - DRAG_VELOCITY_SMOOTHING) + rawY * DRAG_VELOCITY_SMOOTHING,
  };
}

export function limitVelocity(velocity: Velocity): Velocity {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (speed <= INERTIA_MAX_SPEED || speed === 0) return velocity;
  const scale = INERTIA_MAX_SPEED / speed;
  return { x: velocity.x * scale, y: velocity.y * scale };
}

export function decayVelocity(velocity: Velocity, dt: number): Velocity {
  const decay = Math.exp(-INERTIA_DECAY_PER_MS * dt);
  return { x: velocity.x * decay, y: velocity.y * decay };
}

const right = (rect: Rect) => rect.x + rect.width;
const bottom = (rect: Rect) => rect.y + rect.height;

/**
 * 相邻显示器共享的垂直接缝 x 坐标（A 的右缘 = B 的左缘且纵向有重叠）。
 * macOS 上窗口矩形横跨接缝时 Electron setPosition 会随机错位（详见
 * docs/finch-pet-drag-inertia-plan.md），调用方用它让窗口贴缝停靠、避免横跨。
 */
export function verticalSeams(displays: DisplayArea[]): number[] {
  const seams = new Set<number>();
  for (const a of displays) {
    for (const b of displays) {
      if (a === b) continue;
      if (
        right(a.bounds) === b.bounds.x
        && a.bounds.y < bottom(b.bounds)
        && b.bounds.y < bottom(a.bounds)
      ) seams.add(b.bounds.x);
    }
  }
  return [...seams];
}

/** 左右与顶部使用 workArea，底部使用物理屏幕边界，允许覆盖底部 Dock。 */
const allowedRegion = (display: DisplayArea): Rect => ({
  x: display.workArea.x,
  y: display.workArea.y,
  width: display.workArea.width,
  height: Math.max(0, bottom(display.bounds) - display.workArea.y),
});

/** 判断一个矩形是否被多个显示器区域的联集完整覆盖。 */
function isCoveredByRegions(rect: Rect, regions: Rect[]): boolean {
  const xStops = [rect.x, right(rect)];
  for (const region of regions) {
    const leftEdge = Math.max(rect.x, region.x);
    const rightEdge = Math.min(right(rect), right(region));
    if (leftEdge < rightEdge) xStops.push(leftEdge, rightEdge);
  }
  const sortedX = [...new Set(xStops)].sort((a, b) => a - b);
  for (let index = 0; index < sortedX.length - 1; index += 1) {
    const startX = sortedX[index];
    const endX = sortedX[index + 1];
    if (endX <= startX) continue;
    const sampleX = (startX + endX) / 2;
    const intervals = regions
      .filter((region) => sampleX >= region.x && sampleX < right(region))
      .map((region) => ({ start: region.y, end: bottom(region) }))
      .sort((a, b) => a.start - b.start);
    let coveredUntil = rect.y;
    for (const interval of intervals) {
      if (interval.end <= coveredUntil) continue;
      if (interval.start > coveredUntil) break;
      coveredUntil = interval.end;
      if (coveredUntil >= bottom(rect)) break;
    }
    if (coveredUntil < bottom(rect)) return false;
  }
  return sortedX.length > 1;
}

/**
 * 把宠物可见内容限制在所有显示器的联合可见区域内。
 * 两块屏幕的内部接缝不是边界；只有整个多屏布局的真实外沿会夹紧。
 *
 * 提供 `previous`（上一个合法窗口位置）时按"撞墙滑行"处理：目标位置不合法就
 * 先尝试只走 X 或只走 Y，都不行则停在原地。这保证位置随指针连续变化，
 * 不会在两块屏幕高度差形成的台阶处瞬移或来回抖动。仅当 previous 缺失或
 * 本身不合法（如恢复的持久化位置已失效）时，才吸附到最近的合法位置救援。
 */
export function constrainWindowPosition(
  position: Point,
  contentBounds: Rect,
  displays: DisplayArea[],
  previous?: Point,
): ConstrainedPosition {
  const raw = { x: Math.round(position.x), y: Math.round(position.y) };
  const regions = displays.map(allowedRegion).filter((region) => region.width > 0 && region.height > 0);
  if (!regions.length) return { ...raw, blockedX: false, blockedY: false };
  const contentAt = (windowX: number, windowY: number): Rect => ({
    x: windowX + contentBounds.x,
    y: windowY + contentBounds.y,
    width: contentBounds.width,
    height: contentBounds.height,
  });
  const coveredAt = (windowX: number, windowY: number): boolean =>
    isCoveredByRegions(contentAt(windowX, windowY), regions);
  if (coveredAt(raw.x, raw.y)) {
    return { ...raw, blockedX: false, blockedY: false };
  }

  if (previous) {
    const prev = { x: Math.round(previous.x), y: Math.round(previous.y) };
    if (coveredAt(prev.x, prev.y)) {
      if (coveredAt(raw.x, prev.y)) return { x: raw.x, y: prev.y, blockedX: false, blockedY: true };
      if (coveredAt(prev.x, raw.y)) return { x: prev.x, y: raw.y, blockedX: true, blockedY: false };
      return { ...prev, blockedX: true, blockedY: true };
    }
  }

  const candidateX = new Set<number>([raw.x]);
  const candidateY = new Set<number>([raw.y]);
  for (const region of regions) {
    candidateX.add(Math.round(region.x - contentBounds.x));
    candidateX.add(Math.round(right(region) - contentBounds.x - contentBounds.width));
    candidateY.add(Math.round(region.y - contentBounds.y));
    candidateY.add(Math.round(bottom(region) - contentBounds.y - contentBounds.height));
  }

  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const x of candidateX) {
    for (const y of candidateY) {
      if (!isCoveredByRegions(contentAt(x, y), regions)) continue;
      const distance = (x - raw.x) ** 2 + (y - raw.y) ** 2;
      if (distance >= bestDistance) continue;
      best = { x, y };
      bestDistance = distance;
    }
  }

  if (!best) {
    const region = regions[0];
    best = {
      x: Math.round(clamp(raw.x, region.x - contentBounds.x, right(region) - contentBounds.x - contentBounds.width)),
      y: Math.round(clamp(raw.y, region.y - contentBounds.y, bottom(region) - contentBounds.y - contentBounds.height)),
    };
  }
  return { ...best, blockedX: best.x !== raw.x, blockedY: best.y !== raw.y };
}
