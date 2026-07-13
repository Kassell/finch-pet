/**
 * 纯绘制函数:宠物帧、气泡(消费 bubble.ts 的布局结果)、loading 占位。
 * 不持有状态,不做几何决策。
 */
import { BUBBLE_ACTION_FONT, BUBBLE_FONT, type BubbleLayout } from "./bubble.js";

export function drawRoundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + radius, y);
  c.lineTo(x + w - radius, y);
  c.quadraticCurveTo(x + w, y, x + w, y + radius);
  c.lineTo(x + w, y + h - radius);
  c.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  c.lineTo(x + radius, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - radius);
  c.lineTo(x, y + radius);
  c.quadraticCurveTo(x, y, x + radius, y);
  c.closePath();
}

export interface PetFrameDrawArgs {
  image: HTMLImageElement;
  sx: number;
  sy: number;
  sourceW: number;
  sourceH: number;
  x: number;
  y: number;
  drawW: number;
  drawH: number;
}

export function drawPetFrame(c: CanvasRenderingContext2D, args: PetFrameDrawArgs): void {
  c.save();
  c.imageSmoothingEnabled = false;
  c.drawImage(
    args.image,
    args.sx,
    args.sy,
    args.sourceW,
    args.sourceH,
    args.x,
    args.y,
    args.drawW,
    args.drawH,
  );
  c.restore();
}

export interface BubblePaintState {
  hover: boolean;
  pressed: boolean;
}

export function paintBubble(
  c: CanvasRenderingContext2D,
  layout: BubbleLayout,
  buttonState: BubblePaintState,
): void {
  const { x, y, boxW, boxH, tailTipX, tailTipY, placement } = layout;
  const boxRight = x + boxW;
  c.save();
  c.font = BUBBLE_FONT;
  c.textBaseline = "middle";
  c.shadowColor = "rgba(0,0,0,0.18)";
  c.shadowBlur = 12;
  c.fillStyle = "rgba(255,255,255,0.94)";
  drawRoundRect(c, x, y, boxW, boxH, 14);
  c.fill();
  c.shadowColor = "transparent";
  c.shadowBlur = 0;
  c.beginPath();
  if (placement === "side-right") {
    c.moveTo(x + 1, tailTipY - 7);
    c.lineTo(tailTipX, tailTipY);
    c.lineTo(x + 1, tailTipY + 5);
  } else if (placement === "side-left") {
    c.moveTo(boxRight - 1, tailTipY - 7);
    c.lineTo(tailTipX, tailTipY);
    c.lineTo(boxRight - 1, tailTipY + 5);
  } else if (placement === "top-right") {
    c.moveTo(tailTipX - 3, y + boxH - 1);
    c.lineTo(tailTipX, tailTipY);
    c.lineTo(tailTipX + 9, y + boxH - 1);
  } else {
    c.moveTo(tailTipX - 9, y + boxH - 1);
    c.lineTo(tailTipX, tailTipY);
    c.lineTo(tailTipX + 3, y + boxH - 1);
  }
  c.closePath();
  c.fill();
  c.textAlign = "left";
  c.fillStyle = "#3a2f0b";
  layout.lines.forEach((text, index) => {
    c.fillText(text, x + layout.paddingX, y + 8 + layout.lineHeight / 2 + index * layout.lineHeight);
  });
  if (layout.action) {
    const action = layout.action;
    c.fillStyle = buttonState.pressed
      ? "rgba(44,126,78,0.26)"
      : buttonState.hover
        ? "rgba(44,126,78,0.20)"
        : "rgba(44,126,78,0.14)";
    drawRoundRect(c, action.x, action.y, action.width, action.height, 8);
    c.fill();
    c.font = BUBBLE_ACTION_FONT;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "#287a4b";
    c.fillText(action.label, action.x + action.width / 2, action.y + action.height / 2);
  }
  c.restore();
}

export function drawLoading(
  c: CanvasRenderingContext2D,
  width: number,
  height: number,
  message: string,
): void {
  c.save();
  c.fillStyle = "rgba(255,255,255,0.92)";
  c.beginPath();
  c.ellipse(width / 2, height / 2, 62, 42, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#3a2f0b";
  c.font = BUBBLE_FONT;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(message, width / 2, height / 2);
  c.restore();
}
