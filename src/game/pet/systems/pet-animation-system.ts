import type { PetState, PlayMode } from "../../../shared/protocol.js";
import { STATES, normalizeState } from "../assets/sprite.js";

export type AnimationSource = "system" | "mouse" | "agent";

export interface PlayAnimationOptions {
  source?: AnimationSource;
  transientMs?: number;
  playMode?: PlayMode;
}

export interface PetAnimationSnapshot {
  state: PetState;
  owner: AnimationSource;
  playMode: PlayMode;
  frameIndex: number;
}

/** 桌宠动画 System：独占动画状态、优先级、帧时钟与瞬态生命周期。 */
export class PetAnimationSystem {
  private currentState: PetState = "idle";
  private currentOwner: AnimationSource = "system";
  private currentMode: PlayMode = "loop";
  private currentFrame = 0;
  private frameAccumMs = 0;
  private transientUntil = 0;
  private mouseActionUntil = 0;
  private agentActionUntil = 0;
  private agentControlled = false;

  constructor(
    private readonly fps: number,
    private readonly frameCountForRow: (row: number) => number,
    private readonly cancelMouseAction: () => void,
  ) {}

  get snapshot(): PetAnimationSnapshot {
    return {
      state: this.currentState,
      owner: this.currentOwner,
      playMode: this.currentMode,
      frameIndex: this.currentFrame,
    };
  }

  play(next: unknown, options: PlayAnimationOptions = {}, now = performance.now()): boolean {
    const state = normalizeState(next);
    const source = options.source ?? "system";
    if (source === "mouse" && this.isAgentActive(now)) return false;
    if (source === "agent") this.cancelMouseAction();

    this.currentState = state;
    this.currentOwner = source;
    this.currentFrame = 0;
    this.frameAccumMs = 0;
    const transientMs = typeof options.transientMs === "number" ? options.transientMs : 0;
    const requested = options.playMode === "once" || options.playMode === "freeze" ? options.playMode : null;
    this.currentMode = requested && state !== "idle" ? requested : "loop";
    const row = (STATES[state] || STATES.idle).row;
    const onceMs = this.currentMode === "once" ? this.frameCountForRow(row) * (1000 / this.fps) : 0;
    this.transientUntil = transientMs > 0 ? now + transientMs : 0;

    if (source === "agent") {
      this.agentControlled = state !== "idle";
      this.agentActionUntil = state !== "idle" && transientMs > 0 ? now + transientMs : 0;
      this.mouseActionUntil = 0;
    } else if (source === "mouse") {
      this.mouseActionUntil = state !== "idle" ? now + (onceMs || transientMs || 0) : 0;
    } else if (state === "idle") {
      this.mouseActionUntil = 0;
      this.agentActionUntil = 0;
      this.agentControlled = false;
      this.currentMode = "loop";
    }
    return true;
  }

  update(dtMs: number, now = performance.now()): void {
    if (this.transientUntil && now > this.transientUntil) this.play("idle", { source: this.currentOwner }, now);
    const row = (STATES[this.currentState] || STATES.idle).row;
    const frameCount = this.frameCountForRow(row);
    const frameMs = 1000 / this.fps;
    this.frameAccumMs += dtMs;
    while (this.frameAccumMs >= frameMs) {
      this.frameAccumMs -= frameMs;
      if (this.currentFrame >= frameCount - 1) {
        if (this.currentMode === "once") {
          this.play("idle", { source: this.currentOwner }, now);
          break;
        }
        if (this.currentMode === "freeze") break;
      }
      this.currentFrame = this.currentMode === "loop"
        ? (this.currentFrame + 1) % frameCount
        : Math.min(this.currentFrame + 1, frameCount - 1);
    }
  }

  isAgentActive(now = performance.now()): boolean {
    if (!this.agentControlled || this.currentState === "idle") return false;
    return !this.agentActionUntil || now < this.agentActionUntil;
  }

  isMouseActive(now = performance.now()): boolean {
    return this.mouseActionUntil > now;
  }

  clearMouseAction(): void { this.mouseActionUntil = 0; }
}
