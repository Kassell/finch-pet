import type { BubbleAction } from "../../../shared/protocol.js";

export interface PetBubbleSnapshot {
  text: string;
  persistent: boolean;
  sessionId: string | null;
  action: BubbleAction | null;
}

/** 气泡生命周期 System：独占内容、会话、动作和过期时钟。 */
export class PetBubbleSystem {
  private text = "";
  private until = 0;
  private persistent = false;
  private sessionId: string | null = null;
  private action: BubbleAction | null = null;

  get snapshot(): PetBubbleSnapshot {
    return {
      text: this.text,
      persistent: this.persistent,
      sessionId: this.sessionId,
      action: this.action,
    };
  }

  say(
    text: unknown,
    transientMs?: number,
    persistent?: boolean,
    action?: unknown,
    sessionId?: unknown,
    now = performance.now(),
  ): boolean {
    if (typeof text !== "string" || !text.trim()) return false;
    this.text = text.trim().slice(0, 36);
    this.persistent = persistent === true;
    const candidate = action as BubbleAction | undefined;
    this.action = candidate?.id === "open-session" && typeof candidate.sessionId === "string"
      ? candidate
      : null;
    this.sessionId = typeof sessionId === "string" ? sessionId : this.action?.sessionId ?? null;
    const durationMs = typeof transientMs === "number" ? Math.max(5000, transientMs) : 5000;
    this.until = this.persistent ? 0 : now + durationMs;
    return true;
  }

  update(now = performance.now()): boolean {
    if (this.persistent || !this.until || now <= this.until) return false;
    this.clear();
    return true;
  }

  clear(): void {
    this.text = "";
    this.until = 0;
    this.persistent = false;
    this.sessionId = null;
    this.action = null;
  }
}
