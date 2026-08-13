/** 轻量 Flappy Bird 游戏，仅依赖 Canvas 2D。 */
import type { CanvasStrings } from "../src/protocol.js";

/** 状态栏独立于 9:16 游戏内容区，不计入游戏画面高度。 */
const STATUS_BAR_HEIGHT = 56;
const CLOSE_BUTTON_SIZE = 32;
const CLOSE_BUTTON_RIGHT = 12;

interface PipePair {
  x: number;
  gapY: number;
  scored: boolean;
}

export class FlappyBirdGame {
  private width = 0;
  private height = 0;
  private birdY = 0;
  private velocity = 0;
  private elapsed = 0;
  private spawnElapsed = 0;
  private score = 0;
  private best = 0;
  private phase: "ready" | "playing" | "over" = "ready";
  private pipes: PipePair[] = [];
  private closeHovered = false;
  private closePressed = false;
  private closePressStartedAt = 0;
  private closePressX = 0;
  private closePressY = 0;
  private closePressMoved = false;
  private playPressed = false;
  private playPressPhase: "ready" | "playing" | "over" = "ready";
  private playPressStartedAt = 0;
  private playPressX = 0;
  private playPressY = 0;
  private playPressMoved = false;

  constructor(
    private readonly onExit: () => void,
    private strings: CanvasStrings,
  ) {}

  setStrings(strings: CanvasStrings): void {
    this.strings = strings;
  }

  private format(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.phase === "ready") this.birdY = STATUS_BAR_HEIGHT + (height - STATUS_BAR_HEIGHT) * 0.43;
  }

  reset(): void {
    this.birdY = STATUS_BAR_HEIGHT + (this.height - STATUS_BAR_HEIGHT) * 0.43;
    this.velocity = 0;
    this.elapsed = 0;
    this.spawnElapsed = 0;
    this.score = 0;
    this.phase = "ready";
    this.pipes = [];
  }

  flap(): void {
    // 结束态只能由一次新的完整短按重开，不能被同一按压的重复 down 重置。
    if (this.phase === "over") return;
    if (this.phase === "ready") this.phase = "playing";
    this.velocity = -410;
  }

  keyDown(key: string): boolean {
    if (key === "Escape") {
      this.onExit();
      return true;
    }
    if (key === " " || key === "Spacebar" || key === "ArrowUp" || key.toLowerCase() === "w") {
      if (this.phase === "over") this.reset();
      this.flap();
      return true;
    }
    return false;
  }

  isDragHandle(x: number, y: number): boolean {
    return y >= 0
      && y <= STATUS_BAR_HEIGHT
      && !this.isCloseButtonPoint(x, y);
  }

  isCloseButtonPoint(x: number, y: number): boolean {
    const buttonX = this.width - CLOSE_BUTTON_RIGHT - CLOSE_BUTTON_SIZE;
    const buttonY = (STATUS_BAR_HEIGHT - CLOSE_BUTTON_SIZE) / 2;
    return x >= buttonX
      && x <= buttonX + CLOSE_BUTTON_SIZE
      && y >= buttonY
      && y <= buttonY + CLOSE_BUTTON_SIZE;
  }

  cursorAt(x: number, y: number): "grab" | "pointer" | "default" {
    if (this.isCloseButtonPoint(x, y)) return "pointer";
    if (this.isDragHandle(x, y)) return "grab";
    return "default";
  }

  pointerDown(x: number, y: number): void {
    if (this.isDragHandle(x, y)) return;
    if (this.isCloseButtonPoint(x, y)) {
      this.closePressed = true;
      this.closeHovered = true;
      this.closePressStartedAt = performance.now();
      this.closePressX = x;
      this.closePressY = y;
      this.closePressMoved = false;
      return;
    }
    if (this.playPressed) return;
    this.playPressed = true;
    this.playPressPhase = this.phase;
    this.playPressStartedAt = performance.now();
    this.playPressX = x;
    this.playPressY = y;
    this.playPressMoved = false;
    if (this.phase !== "over") this.flap();
  }

  pointerMove(x: number, y: number): void {
    this.closeHovered = this.isCloseButtonPoint(x, y);
    if (this.closePressed && Math.hypot(x - this.closePressX, y - this.closePressY) > 6)
      this.closePressMoved = true;
    if (this.playPressed && Math.hypot(x - this.playPressX, y - this.playPressY) > 6)
      this.playPressMoved = true;
  }

  pointerUp(x: number, y: number): void {
    if (this.closePressed) {
      const isShortClick = performance.now() - this.closePressStartedAt <= 500;
      const shouldClose = isShortClick && !this.closePressMoved && this.isCloseButtonPoint(x, y);
      this.closePressed = false;
      this.closeHovered = this.isCloseButtonPoint(x, y);
      if (shouldClose) this.onExit();
      return;
    }
    this.closeHovered = this.isCloseButtonPoint(x, y);
    if (!this.playPressed) return;
    const shouldRestart = this.playPressPhase === "over"
      && this.phase === "over"
      && !this.playPressMoved
      && performance.now() - this.playPressStartedAt <= 500;
    this.playPressed = false;
    this.playPressMoved = false;
    if (shouldRestart) {
      this.reset();
      this.flap();
    }
  }

  cancelPointer(): void {
    this.closePressed = false;
    this.closeHovered = false;
    this.closePressMoved = false;
    this.playPressed = false;
    this.playPressMoved = false;
  }

  frame(ctx: CanvasRenderingContext2D, dtMs: number): void {
    const dt = Math.min(0.034, Math.max(0, dtMs / 1000));
    this.elapsed += dt;
    if (this.phase === "playing") this.update(dt);
    this.paint(ctx);
  }

  private update(dt: number): void {
    const birdX = this.width * 0.3;
    const pipeWidth = 68;
    const contentHeight = this.height - STATUS_BAR_HEIGHT;
    const gap = Math.max(138, Math.min(166, contentHeight * 0.25));
    const floorY = this.height - 72;

    this.velocity += 1120 * dt;
    this.birdY += this.velocity * dt;
    const ceilingY = STATUS_BAR_HEIGHT + 14;
    if (this.birdY < ceilingY) {
      this.birdY = ceilingY;
      if (this.velocity < 0) this.velocity = 0;
    }
    this.spawnElapsed += dt;
    if (this.spawnElapsed >= 1.45) {
      this.spawnElapsed -= 1.45;
      const margin = gap / 2 + 72;
      const range = Math.max(1, floorY - margin * 2);
      this.pipes.push({ x: this.width + 20, gapY: margin + Math.random() * range, scored: false });
    }

    for (const pipe of this.pipes) {
      pipe.x -= 176 * dt;
      if (!pipe.scored && pipe.x + pipeWidth < birdX) {
        pipe.scored = true;
        this.score += 1;
        this.best = Math.max(this.best, this.score);
      }
    }
    this.pipes = this.pipes.filter((pipe) => pipe.x + pipeWidth > -8);

    const bird = { left: birdX - 17, right: birdX + 17, top: this.birdY - 14, bottom: this.birdY + 14 };
    const hitPipe = this.pipes.some((pipe) => {
      const overlapsX = bird.right > pipe.x && bird.left < pipe.x + pipeWidth;
      return overlapsX && (bird.top < pipe.gapY - gap / 2 || bird.bottom > pipe.gapY + gap / 2);
    });
    if (hitPipe || bird.bottom >= floorY) {
      this.phase = "over";
      this.best = Math.max(this.best, this.score);
    }
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    const w = this.width;
    const h = this.height;
    const floorY = h - 72;
    const birdX = w * 0.3;
    const contentHeight = h - STATUS_BAR_HEIGHT;
    const gap = Math.max(138, Math.min(166, contentHeight * 0.25));

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#78d7f5");
    sky.addColorStop(0.72, "#d8f5ef");
    sky.addColorStop(1, "#f7e6a7");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this.paintCloud(ctx, (w - (this.elapsed * 18) % (w + 120)) + 30, 130, 0.9);
    this.paintCloud(ctx, (w - (this.elapsed * 11 + 230) % (w + 160)) + 50, 214, 0.65);

    for (const pipe of this.pipes) this.paintPipe(ctx, pipe.x, pipe.gapY, gap, floorY);

    ctx.fillStyle = "#8bd34f";
    ctx.fillRect(0, floorY, w, 18);
    ctx.fillStyle = "#62ad3e";
    ctx.fillRect(0, floorY + 12, w, 8);
    ctx.fillStyle = "#e9ca72";
    ctx.fillRect(0, floorY + 20, w, h - floorY - 20);
    ctx.fillStyle = "rgba(166, 119, 47, 0.18)";
    for (let x = -20; x < w + 20; x += 38) ctx.fillRect(x, floorY + 34, 20, 4);

    if (this.phase !== "ready") {
      const angle = Math.max(-0.48, Math.min(1.15, this.velocity / 620));
      this.paintBird(ctx, birdX, this.birdY, angle);
    }

    if (this.phase !== "ready") this.paintScore(ctx);
    else this.paintReadyScreen(ctx, floorY);
    if (this.best > 0) this.paintBestScore(ctx);

    this.paintStatusBar(ctx);
    if (this.phase === "over")
      this.paintCard(
        ctx,
        this.strings.gameOver,
        `${this.format(this.strings.gameResult, { score: this.score, best: this.best })}\n${this.strings.gameRestartHint}`,
      );
  }

  private paintPipe(ctx: CanvasRenderingContext2D, x: number, gapY: number, gap: number, floorY: number): void {
    const width = 68;
    const topBottom = gapY - gap / 2;
    const bottomTop = gapY + gap / 2;
    const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, "#4bbd48");
    gradient.addColorStop(0.45, "#9be15d");
    gradient.addColorStop(1, "#2f9639");
    ctx.fillStyle = gradient;
    ctx.strokeStyle = "#267a31";
    ctx.lineWidth = 3;
    ctx.fillRect(x, STATUS_BAR_HEIGHT, width, topBottom - STATUS_BAR_HEIGHT - 18);
    ctx.strokeRect(x, STATUS_BAR_HEIGHT - 3, width, topBottom - STATUS_BAR_HEIGHT - 15);
    ctx.fillRect(x - 6, topBottom - 26, width + 12, 26);
    ctx.strokeRect(x - 6, topBottom - 26, width + 12, 26);
    ctx.fillRect(x, bottomTop + 18, width, floorY - bottomTop - 18);
    ctx.strokeRect(x, bottomTop + 18, width, floorY - bottomTop - 15);
    ctx.fillRect(x - 6, bottomTop, width + 12, 26);
    ctx.strokeRect(x - 6, bottomTop, width + 12, 26);
  }

  private paintBird(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Finch 的轮廓是圆润头背与后掠尾部，而不是传统 Flappy Bird 的椭圆球体。
    const bodyGradient = ctx.createLinearGradient(-17, -16, 16, 14);
    bodyGradient.addColorStop(0, "#9ae9d0");
    bodyGradient.addColorStop(0.52, "#58c9a7");
    bodyGradient.addColorStop(1, "#29987b");
    ctx.fillStyle = bodyGradient;
    ctx.strokeStyle = "#226f60";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-25, 9);
    ctx.bezierCurveTo(-16, 4, -13, -8, -5, -14);
    ctx.bezierCurveTo(2, -20, 14, -18, 19, -9);
    ctx.bezierCurveTo(25, 1, 18, 14, 7, 17);
    ctx.bezierCurveTo(-5, 21, -16, 16, -25, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 白色脸腹形成 Finch 图标最明显的水滴形留白。
    ctx.fillStyle = "#fffdf9";
    ctx.beginPath();
    ctx.moveTo(5, -14);
    ctx.bezierCurveTo(15, -14, 20, -7, 19, 2);
    ctx.bezierCurveTo(18, 12, 10, 17, 1, 16);
    ctx.bezierCurveTo(-6, 15, -9, 10, -7, 4);
    ctx.bezierCurveTo(-4, -4, -1, -11, 5, -14);
    ctx.closePath();
    ctx.fill();

    // 深青后掠翅与尾羽让飞行方向和品牌剪影更清晰。
    const wingGradient = ctx.createLinearGradient(-24, 0, 4, 14);
    wingGradient.addColorStop(0, "#155e53");
    wingGradient.addColorStop(1, "#2fa584");
    ctx.fillStyle = wingGradient;
    ctx.beginPath();
    ctx.moveTo(-24, 8);
    ctx.bezierCurveTo(-14, 8, -8, 2, -3, -4);
    ctx.bezierCurveTo(-2, 7, 2, 12, 8, 15);
    ctx.bezierCurveTo(-5, 19, -17, 15, -24, 8);
    ctx.closePath();
    ctx.fill();

    // 暖橙色短喙与绿色主体形成自然对比。
    ctx.fillStyle = "#f2a33a";
    ctx.strokeStyle = "#a96120";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(18, -7);
    ctx.lineTo(27, -3);
    ctx.lineTo(18, 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#202827";
    ctx.beginPath();
    ctx.arc(11, -8, 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(10.2, -8.8, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private paintCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.beginPath();
    ctx.arc(0, 10, 23, 0, Math.PI * 2);
    ctx.arc(27, 0, 31, 0, Math.PI * 2);
    ctx.arc(60, 12, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private paintScore(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.fillStyle = "#fff";
    ctx.font = '800 42px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif';
    ctx.strokeText(String(this.score), this.width / 2, STATUS_BAR_HEIGHT + 38);
    ctx.fillText(String(this.score), this.width / 2, STATUS_BAR_HEIGHT + 38);
  }

  private paintBestScore(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    const label = this.format(this.strings.gameBest, { best: this.best });
    ctx.strokeText(label, this.width - 16, STATUS_BAR_HEIGHT + 24);
    ctx.fillText(label, this.width - 16, STATUS_BAR_HEIGHT + 24);
  }

  private paintReadyScreen(ctx: CanvasRenderingContext2D, floorY: number): void {
    const titleY = STATUS_BAR_HEIGHT + (floorY - STATUS_BAR_HEIGHT) * 0.28;
    const titleGradient = ctx.createLinearGradient(0, titleY - 34, 0, titleY + 28);
    titleGradient.addColorStop(0, "#fff7a8");
    titleGradient.addColorStop(0.48, "#ffd348");
    titleGradient.addColorStop(1, "#f59b28");

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '900 43px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif';
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(37,73,68,0.3)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 6;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#fffdf0";
    ctx.strokeText(this.strings.gameTitle, this.width / 2, titleY);
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#a76022";
    ctx.strokeText(this.strings.gameTitle, this.width / 2, titleY);
    ctx.fillStyle = titleGradient;
    ctx.fillText(this.strings.gameTitle, this.width / 2, titleY);
    ctx.restore();

    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 4.2);
    ctx.save();
    ctx.globalAlpha = 0.42 + pulse * 0.58;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    ctx.fillStyle = "#385f5b";
    ctx.fillText(this.strings.gameStartHint, this.width / 2, floorY - 34);
    ctx.restore();
  }

  private paintStatusBar(ctx: CanvasRenderingContext2D): void {
    const buttonX = this.width - CLOSE_BUTTON_RIGHT - CLOSE_BUTTON_SIZE;
    const buttonY = (STATUS_BAR_HEIGHT - CLOSE_BUTTON_SIZE) / 2;

    ctx.fillStyle = "rgba(255,255,255,0.84)";
    ctx.fillRect(0, 0, this.width, STATUS_BAR_HEIGHT);
    ctx.fillStyle = "rgba(37,66,65,0.1)";
    ctx.fillRect(0, STATUS_BAR_HEIGHT - 1, this.width, 1);

    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#203f3d";
    ctx.font = '700 15px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    ctx.fillText(this.strings.gameHeader, this.width / 2, STATUS_BAR_HEIGHT / 2);

    const pressedInside = this.closePressed && this.closeHovered;
    const buttonScale = pressedInside ? 0.9 : 1;
    const centerX = buttonX + CLOSE_BUTTON_SIZE / 2;
    const centerY = buttonY + CLOSE_BUTTON_SIZE / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(buttonScale, buttonScale);
    ctx.translate(-centerX, -centerY);
    ctx.fillStyle = pressedInside
      ? "rgba(32,63,61,0.2)"
      : this.closeHovered ? "rgba(32,63,61,0.13)" : "rgba(32,63,61,0.07)";
    ctx.beginPath();
    ctx.roundRect(buttonX, buttonY, CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE / 2);
    ctx.fill();
    ctx.strokeStyle = pressedInside ? "#122c2a" : "#203f3d";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(buttonX + 11, buttonY + 11);
    ctx.lineTo(buttonX + 21, buttonY + 21);
    ctx.moveTo(buttonX + 21, buttonY + 11);
    ctx.lineTo(buttonX + 11, buttonY + 21);
    ctx.stroke();
    ctx.restore();
  }

  private paintCard(
    ctx: CanvasRenderingContext2D,
    title: string,
    subtitle: string,
  ): void {
    const cardWidth = Math.min(330, this.width - 48);
    const lines = subtitle.split("\n");
    const cardHeight = lines.length > 1 ? 132 : 112;
    const x = (this.width - cardWidth) / 2;
    const contentHeight = this.height - STATUS_BAR_HEIGHT;
    const y = STATUS_BAR_HEIGHT + contentHeight * 0.2;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = "rgba(45,82,75,0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardWidth, cardHeight, 22);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#294b48";
    ctx.font = '800 25px -apple-system, BlinkMacSystemFont, "SF Pro Rounded", sans-serif';
    ctx.fillText(title, this.width / 2, y + 34);
    ctx.fillStyle = "#56736f";
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    lines.forEach((line, index) => ctx.fillText(line, this.width / 2, y + 70 + index * 24));
  }
}
