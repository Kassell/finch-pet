import type * as finch from 'finch';

export interface VisibilitySnapshot {
  desired: boolean;
  revision: number;
}

/**
 * 桌宠可见性的单一状态源。
 * desired 表示用户意图，窗口实例是否已经创建由 WindowCoordinator 单独负责。
 */
export class PetVisibilityController {
  private desired = false;
  private revision = 0;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly storage: finch.Storage,
    private readonly onDidChange: (snapshot: VisibilitySnapshot) => void,
  ) {}

  get snapshot(): VisibilitySnapshot {
    return { desired: this.desired, revision: this.revision };
  }

  async restore(available: boolean): Promise<boolean> {
    const stored = await this.storage.get<boolean>('window.visible');
    this.desired = available && stored !== false;
    this.revision += 1;
    this.onDidChange(this.snapshot);
    if (!available && stored !== false) await this.set(false);
    return this.desired;
  }

  set(desired: boolean): Promise<void> {
    this.desired = desired;
    this.revision += 1;
    this.onDidChange(this.snapshot);
    // 快速连续开关时严格保持写入顺序，最终持久化最后一次用户意图。
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.storage.set('window.visible', desired));
    return this.writeQueue;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}
