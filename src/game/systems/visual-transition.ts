import type { HostToCanvasMessage } from "../../shared/protocol.js";

export interface VisualTransform {
  opacity: number;
  scale: number;
  active: boolean;
}

/** 场景共享的视觉过渡 System，不依赖具体游戏或桌宠状态。 */
export class VisualTransitionSystem {
  private fromOpacity = 1;
  private toOpacity = 1;
  private fromScale = 1;
  private toScale = 1;
  private startedAt = 0;
  private durationMs = 0;

  apply(message: Extract<HostToCanvasMessage, { type: "visualTransition" }>): void {
    this.fromOpacity = message.fromOpacity;
    this.toOpacity = message.toOpacity;
    this.fromScale = message.fromScale;
    this.toScale = message.toScale;
    this.startedAt = performance.now();
    this.durationMs = Math.max(0, message.durationMs);
  }

  current(now = performance.now()): VisualTransform {
    const progress = this.durationMs > 0 ? Math.min(1, (now - this.startedAt) / this.durationMs) : 1;
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      opacity: this.fromOpacity + (this.toOpacity - this.fromOpacity) * eased,
      scale: this.fromScale + (this.toScale - this.fromScale) * eased,
      active: progress < 1,
    };
  }

  begin(context: CanvasRenderingContext2D, width: number, height: number): void {
    const transform = this.current();
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, transform.opacity));
    context.translate(width / 2, height / 2);
    context.scale(transform.scale, transform.scale);
    context.translate(-width / 2, -height / 2);
  }

  end(context: CanvasRenderingContext2D): void { context.restore(); }
}
