/**
 * 气泡纯逻辑:placement 策略 + 文本折行 + 盒子/尾巴布局。
 *
 * 本模块不绘制、不持有状态,接口按"锚点空间"抽象(给定宠物锚点与可用空间,
 * 返回气泡几何)。将来气泡迁到独立子窗口时,策略与布局可整体复用,只换消费者。
 */
export type BubblePlacement = "top-left" | "top-right" | "side-left" | "side-right";

/** 头顶气泡最大占高:3 行文本 + 按钮区 + 尾巴,用于判断何时该切到侧边气泡。 */
export const TOP_BUBBLE_MAX_RISE = 96;
/** placement 切换滞回,防止在阈值线附近拖动时来回抖动。 */
const PLACEMENT_HYSTERESIS = 16;

export const BUBBLE_FONT = '13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
export const BUBBLE_ACTION_FONT = '12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';

export interface PlacementArgs {
  current: BubblePlacement;
  /** 宠物中心 X(屏幕坐标)。 */
  petCenterX: number;
  /** 宠物绘制盒顶边 Y(屏幕坐标)。 */
  petTopY: number;
  /** 可用空间顶边(workArea top,避开菜单栏)。 */
  topBoundary: number;
  displayLeft: number;
  displayWidth: number;
}

/**
 * 左右按半屏划分:宠物在左半屏气泡朝右,右半屏朝左;
 * 头顶气泡锚定宠物头顶向上展开,只有它会被屏幕顶裁切时才切到侧边。
 * 两个维度都带滞回。
 */
export function chooseBubblePlacement(args: PlacementArgs): BubblePlacement {
  const currentOnRight = args.current === "top-right" || args.current === "side-right";
  const currentOnSide = args.current === "side-left" || args.current === "side-right";
  const midX = args.displayLeft + args.displayWidth / 2;
  const placeOnRight = currentOnRight
    ? args.petCenterX < midX + PLACEMENT_HYSTERESIS
    : args.petCenterX < midX - PLACEMENT_HYSTERESIS;
  const clearance = args.petTopY - args.topBoundary;
  const nearTop = currentOnSide
    ? clearance < TOP_BUBBLE_MAX_RISE + PLACEMENT_HYSTERESIS
    : clearance < TOP_BUBBLE_MAX_RISE - PLACEMENT_HYSTERESIS;
  if (!nearTop) return placeOnRight ? "top-right" : "top-left";
  return placeOnRight ? "side-right" : "side-left";
}

/** 气泡布局需要的宠物锚点(画布坐标)。 */
export interface PetAnchor {
  x: number;
  y: number;
  drawW: number;
  drawH: number;
  bounce: number;
}

export interface BubbleLayoutParams {
  /** 仅用于 measureText 的 2D 上下文(字体由本函数设置,调用方需自行 save/restore)。 */
  measure: CanvasRenderingContext2D;
  text: string;
  placement: BubblePlacement;
  pet: PetAnchor;
  canvasWidth: number;
  canvasHeight: number;
  /** 气泡动作按钮;存在时气泡不跟随 bounce,label 非空时渲染按钮。 */
  action?: { label: string } | null;
}

export interface BubbleActionLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface BubbleLayout {
  placement: BubblePlacement;
  x: number;
  y: number;
  boxW: number;
  boxH: number;
  lines: string[];
  lineHeight: number;
  paddingX: number;
  textAreaH: number;
  tailSize: number;
  tailTipX: number;
  tailTipY: number;
  action: BubbleActionLayout | null;
}

export function layoutBubble(params: BubbleLayoutParams): BubbleLayout {
  const { measure: c, text, placement, pet, canvasWidth: w, canvasHeight: h, action } = params;
  c.font = BUBBLE_FONT;
  const paddingX = 12;
  const lineHeight = 17;
  const actionLabel = action?.label || "";
  const hasAction = !!action && !!actionLabel;
  let actionW = 0;
  if (hasAction) {
    const previousFont = c.font;
    c.font = BUBBLE_ACTION_FONT;
    actionW = Math.max(52, c.measureText(actionLabel).width + 18);
    c.font = previousFont;
  }
  const tailSize = 8;
  const sideRight = placement === "side-right";
  const sideLeft = placement === "side-left";
  const topRight = placement === "top-right";
  const sidePlacement = sideRight || sideLeft;
  const bubbleGap = 6;
  const bubbleLeft = sideRight
    ? Math.max(102, Math.min(w - 108, pet.x + pet.drawW + bubbleGap))
    : topRight
      ? Math.max(102, Math.min(w - 108, pet.x + pet.drawW * 0.52))
      : 0;
  const bubbleRight = sideLeft
    ? Math.max(108, Math.min(w - 102, pet.x - bubbleGap))
    : topRight
      ? 0
      : Math.max(108, Math.min(w - 102, pet.x + pet.drawW * 0.48));
  const availableBoxW = sideRight || topRight ? w - bubbleLeft - 12 : bubbleRight - 12;
  const maxBoxW = Math.min(hasAction ? 240 : 220, availableBoxW);
  const minBoxW = Math.min(maxBoxW, hasAction ? 150 : 88);
  const boxW = Math.min(
    Math.max(c.measureText(text).width + paddingX * 2, minBoxW),
    maxBoxW,
  );
  const textMaxW = boxW - paddingX * 2;

  const lines: string[] = [];
  let line = "";
  let truncated = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const candidate = line + char;
    if (char !== "\n" && (line === "" || c.measureText(candidate).width <= textMaxW)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = char === "\n" ? "" : char;
    if (lines.length === 3) {
      truncated = index < text.length;
      break;
    }
  }
  if (lines.length < 3 && line) lines.push(line);
  if (!lines.length) lines.push("");
  if (truncated) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && c.measureText(`${last}…`).width > textMaxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }

  const textAreaH = lines.length * lineHeight + 16;
  const actionAreaH = hasAction ? 24 : 0;
  const boxH = textAreaH + actionAreaH;
  const verticalOffset = action ? 0 : pet.bounce;
  const x = sideRight || topRight ? bubbleLeft : bubbleRight - boxW;
  const boxRight = x + boxW;
  let y: number;
  let tailTipX: number;
  let tailTipY: number;
  if (sidePlacement) {
    const sideAnchorY = pet.y + pet.drawH * 0.28;
    y = Math.max(8, Math.min(h - boxH - 8, sideAnchorY - boxH / 2));
    tailTipX = sideRight ? x - tailSize : boxRight + tailSize;
    tailTipY = Math.max(y + 14, Math.min(y + boxH - 14, sideAnchorY));
  } else {
    // 头顶气泡锚定宠物头顶(不含 bounce/breathe 的静态顶边),宠物缩放后自动跟随。
    const petBoxTop = h - pet.drawH - 14;
    tailTipY = petBoxTop + 6 - Math.max(0, verticalOffset);
    tailTipX = topRight ? x + 20 : boxRight - 20;
    y = Math.max(8, tailTipY - tailSize - boxH);
  }

  const actionLayout: BubbleActionLayout | null = hasAction
    ? {
        x: x + boxW - 10 - actionW,
        y: y + textAreaH - 2,
        width: actionW,
        height: 22,
        label: actionLabel,
      }
    : null;

  return {
    placement,
    x,
    y,
    boxW,
    boxH,
    lines,
    lineHeight,
    paddingX,
    textAreaH,
    tailSize,
    tailTipX,
    tailTipY,
    action: actionLayout,
  };
}
