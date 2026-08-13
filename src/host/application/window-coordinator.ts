import type * as finch from 'finch';

/**
 * CanvasWindow 生命周期协调器。
 * - current 是唯一窗口引用；
 * - ensure 合并并发创建；
 * - release 只释放匹配实例，屏蔽旧窗口迟到的 dispose 事件。
 */
export class CanvasWindowCoordinator {
  current: finch.CanvasWindow | undefined;
  private opening: Promise<finch.CanvasWindow> | undefined;
  private generation = 0;

  get exists(): boolean { return !!this.current; }

  async ensure(factory: () => Promise<finch.CanvasWindow>): Promise<finch.CanvasWindow> {
    if (this.current) return this.current;
    if (this.opening) return this.opening;
    const generation = this.generation;
    const task = factory();
    this.opening = task;
    try {
      const created = await task;
      if (generation !== this.generation) {
        created.dispose();
        throw new Error('canvas window opening was cancelled');
      }
      this.current = created;
      return created;
    } finally {
      if (this.opening === task) this.opening = undefined;
    }
  }

  adopt(window: finch.CanvasWindow): void {
    this.current = window;
  }

  isCurrent(window: finch.CanvasWindow): boolean {
    return this.current === window;
  }

  release(window: finch.CanvasWindow): boolean {
    if (!this.isCurrent(window)) return false;
    this.current = undefined;
    return true;
  }

  disposeCurrent(): finch.CanvasWindow | undefined {
    // 即使窗口尚未创建完成，也让当前代次的 ensure 结果失效。
    this.generation += 1;
    const current = this.current;
    this.current = undefined;
    current?.dispose();
    return current;
  }
}
