export interface SpriteFrameRect {
  sx: number;
  sy: number;
  sourceW: number;
  sourceH: number;
  x: number;
  y: number;
  drawW: number;
  drawH: number;
}

/** Sprite alpha 命中 System：管理离屏 Canvas 和当前帧 alpha 缓存。 */
export class PetHitTestSystem {
  private canvas: HTMLCanvasElement | undefined;
  private context: CanvasRenderingContext2D | null = null;
  private alpha: Uint8ClampedArray | null = null;
  private cachedRow = -1;
  private cachedFrame = -1;

  constructor(private readonly frameWidth: number, private readonly frameHeight: number) {}

  contains(
    image: HTMLImageElement,
    frame: SpriteFrameRect,
    row: number,
    frameIndex: number,
    x: number,
    y: number,
  ): boolean {
    if (x < frame.x || x > frame.x + frame.drawW || y < frame.y || y > frame.y + frame.drawH) return false;
    const localX = Math.floor(((x - frame.x) / frame.drawW) * this.frameWidth);
    const localY = Math.floor(((y - frame.y) / frame.drawH) * this.frameHeight);
    if (localX < 0 || localX >= this.frameWidth || localY < 0 || localY >= this.frameHeight) return false;
    try {
      this.ensureCanvas();
      if (!this.context) return true;
      if (!this.alpha || row !== this.cachedRow || frameIndex !== this.cachedFrame) {
        this.context.clearRect(0, 0, this.frameWidth, this.frameHeight);
        this.context.drawImage(
          image,
          frame.sx,
          frame.sy,
          frame.sourceW,
          frame.sourceH,
          0,
          0,
          this.frameWidth,
          this.frameHeight,
        );
        this.alpha = this.context.getImageData(0, 0, this.frameWidth, this.frameHeight).data;
        this.cachedRow = row;
        this.cachedFrame = frameIndex;
      }
      return this.alpha[(localY * this.frameWidth + localX) * 4 + 3] > 8;
    } catch {
      return true;
    }
  }

  invalidate(): void {
    this.alpha = null;
    this.cachedRow = -1;
    this.cachedFrame = -1;
  }

  private ensureCanvas(): void {
    if (this.canvas) return;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.frameWidth;
    this.canvas.height = this.frameHeight;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
  }
}
