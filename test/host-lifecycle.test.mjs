import assert from 'node:assert/strict';
import test from 'node:test';
import { PetVisibilityController } from '../dist/host/application/visibility-controller.js';
import { CanvasWindowCoordinator } from '../dist/host/application/window-coordinator.js';

class MemoryStorage {
  values = new Map();
  writes = [];
  async get(key) { return this.values.get(key); }
  async set(key, value) {
    await new Promise((resolve) => setTimeout(resolve, value ? 4 : 1));
    this.values.set(key, value);
    this.writes.push([key, value]);
  }
}

const fakeWindow = (id) => ({ id, disposeCount: 0, dispose() { this.disposeCount += 1; } });

test('可见性快速切换按操作顺序持久化最后状态', async () => {
  const storage = new MemoryStorage();
  const changes = [];
  const visibility = new PetVisibilityController(storage, (snapshot) => changes.push(snapshot));
  await Promise.all([visibility.set(true), visibility.set(false), visibility.set(true)]);
  assert.equal(visibility.snapshot.desired, true);
  assert.equal(storage.values.get('window.visible'), true);
  assert.deepEqual(storage.writes.map((entry) => entry[1]), [true, false, true]);
  assert.equal(changes.at(-1).desired, true);
});

test('窗口协调器合并并发创建', async () => {
  const coordinator = new CanvasWindowCoordinator();
  let creates = 0;
  const factory = async () => {
    creates += 1;
    await Promise.resolve();
    return fakeWindow('one');
  };
  const [first, second] = await Promise.all([coordinator.ensure(factory), coordinator.ensure(factory)]);
  assert.equal(creates, 1);
  assert.equal(first, second);
  assert.equal(coordinator.current, first);
});

test('旧窗口迟到的释放事件不会清理新窗口', () => {
  const coordinator = new CanvasWindowCoordinator();
  const oldWindow = fakeWindow('old');
  const nextWindow = fakeWindow('next');
  coordinator.adopt(oldWindow);
  coordinator.adopt(nextWindow);
  assert.equal(coordinator.release(oldWindow), false);
  assert.equal(coordinator.current, nextWindow);
  assert.equal(coordinator.release(nextWindow), true);
  assert.equal(coordinator.current, undefined);
});

test('隐藏会取消尚未完成的窗口创建', async () => {
  const coordinator = new CanvasWindowCoordinator();
  let resolveWindow;
  const opening = coordinator.ensure(() => new Promise((resolve) => { resolveWindow = resolve; }));
  coordinator.disposeCurrent();
  const created = fakeWindow('late');
  resolveWindow(created);
  await assert.rejects(opening, /cancelled/);
  assert.equal(coordinator.current, undefined);
  assert.equal(created.disposeCount, 1);
});

test('主动销毁先清空引用且幂等', () => {
  const coordinator = new CanvasWindowCoordinator();
  const window = fakeWindow('one');
  coordinator.adopt(window);
  coordinator.disposeCurrent();
  coordinator.disposeCurrent();
  assert.equal(coordinator.current, undefined);
  assert.equal(window.disposeCount, 1);
});
