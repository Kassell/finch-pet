# `canvasWindowService.ts` 改造实施规格

> 交接对象：Finch Desktop Agent
> 来源项目：finch-pet
> 边界：本文只要求修改 Finch Desktop 的 CanvasWindow 公共能力及其实现；不要把 finch-pet 的游戏业务移入 Desktop。

## 1. 背景与目标

finch-pet 现在使用一个 CanvasWindow 承载两类互斥内容：

```text
Runtime
├── Pet
└── App（当前只运行一个，例如 flappy-bird；未来有 home 等）
```

Pet → App 切换时，同一个原生窗口需要改变尺寸、位置、置顶层级和 click-through；App → Pet 时恢复。Runtime 内部使用固定步长更新、Scene 生命周期和 `dispose()` 清理。

当前 Finch CanvasWindow 生命周期与原子更新能力不足，finch-pet 被迫维护：

- `CanvasWindowCoordinator` 的创建代次与迟到事件隔离；
- `gameTransitioning`、`transitionGeneration` 等防竞态状态；
- 连续 `setAlwaysOnTop → setSize → setPosition`；
- Canvas 内高频 `setPosition` 拖动和位置看门狗；
- 销毁后的本地防御逻辑。

目标不是删除扩展侧全部状态，而是让公共 API 具备可靠、可测试的生命周期语义，使扩展不需要防御 Desktop 内部对象已销毁异常。

## 2. 当前复现与根因方向

已观察到错误：

```text
TypeError: Object has been destroyed
at flushSummary(...canvasWindowService.js)
```

典型时序：

```text
Host CanvasWindow.dispose()
  → BrowserWindow.destroy()
  → 同步触发 closed
  → cleanupRecord()
  → flushSummary()
  → 再读取已 destroyed 的 BrowserWindow/webContents
```

请在 Finch Desktop 仓库中核对实际实现，不要只按上述推测改名。重点搜索：

- `canvasWindowService.ts`
- `buildShellHtml`
- `cleanupRecord`
- `flushSummary`
- `BrowserWindow.destroy()` / `close()`
- `webContents.isDestroyed()`
- `__finchCanvasDispose`
- `onDidDispose`

## 3. P0：统一窗口记录状态机

每个 CanvasWindow record 必须拥有显式状态，而不是通过 `BrowserWindow` 是否存在推断：

```ts
export type CanvasWindowState =
  | 'creating'
  | 'ready'
  | 'visible'
  | 'hidden'
  | 'disposing'
  | 'disposed';
```

建议 record 至少包含：

```ts
interface CanvasWindowRecord {
  id: string;
  extensionId: string;
  state: CanvasWindowState;
  window?: BrowserWindow;
  ready: Deferred<void>;
  disposePromise?: Promise<void>;
  didEmitDispose: boolean;
  shellDisposeSent: boolean;
  listeners: DisposableStore;
  pendingMessages: unknown[];
  lastKnownBounds?: Rectangle;
  lastKnownVisible: boolean;
}
```

### 状态约束

- `disposed` 为终态，不允许回到其他状态。
- `dispose()` 在任何状态都合法。
- `creating → disposing` 必须取消后续 load/ready 提交，窗口不能“复活”。
- 所有原生事件处理器进入时先检查 record 状态。
- 注册表中的 record 是状态真值；禁止在销毁流程后半段重新从 `BrowserWindow` 推导状态。

## 4. P0：幂等、单路径销毁

所有关闭来源必须收敛到同一个 `disposeRecord(record, reason)`：

```ts
async function disposeRecord(
  record: CanvasWindowRecord,
  reason: 'host' | 'canvas' | 'native' | 'extension' | 'shutdown' | 'replace',
): Promise<void> {
  if (record.state === 'disposed') return;
  if (record.disposePromise) return record.disposePromise;

  record.state = 'disposing';
  record.disposePromise = runDispose(record, reason);
  return record.disposePromise;
}
```

建议销毁顺序：

1. 原子地将 record 标记为 `disposing`。
2. 从“可操作窗口”索引移除，阻止新控制调用。
3. 保存销毁前所需的摘要数据；此后不得再无保护读取 `BrowserWindow/webContents`。
4. 停止 Host → Canvas 新消息和输入转发。
5. 若 `webContents` 存活，发送 `__finchCanvasDispose`，给 shell 一个有界等待时间。
6. shell 停止 rAF、DOM 监听和消息监听，并 exactly-once 调用定义对象 `dispose()`。
7. 清理 service 注册的原生监听器。
8. 若窗口仍存活，再执行 `destroy()`；原生 `closed` 事件再次进入时只能复用同一 disposePromise。
9. 清理临时文件、session/summary 和 record。
10. 标记 `disposed`。
11. exactly-once 触发公开 `onDidDispose`。

### 强制保护

任何访问前都应检查：

```ts
const win = record.window;
if (!win || win.isDestroyed()) return;
const contents = win.webContents;
if (!contents || contents.isDestroyed()) return;
```

但不能只靠散落的 `isDestroyed()` 修补；核心要求仍是单路径状态机。

### 公共契约

- `CanvasWindow.dispose()` 重复调用不抛错。
- Canvas 调用 `finch.window.close()` 后，Host 再调用 `dispose()` 不抛错。
- extension reload、Finch shutdown、原生 closed 都只触发一次 `onDidDispose`。
- `onDidDispose` 触发时该窗口已不可操作，且已从 service 活跃索引移除。

## 5. P0：销毁后控制调用安全

以下方法在 `disposing/disposed` 后必须安全返回，不得产生 main-process uncaught exception：

```text
show
hide
setPosition
setSize
setBounds/update
setClickThrough
setAlwaysOnTop
postMessage
startDrag
```

推荐返回统一结果：

```ts
interface CanvasWindowOperationResult {
  ok: boolean;
  reason?: 'disposed' | 'not-ready' | 'unsupported';
}
```

若为兼容现有同步 API 暂不能改返回类型，至少 no-op + 结构化 debug warning；`postMessage()` 应 reject 一个可识别的 `CanvasWindowDisposedError`，不能泄漏 Electron 的 `Object has been destroyed`。

## 6. P0：Shell `dispose()` exactly-once

当前公共类型已出现 `CanvasDefinition.dispose?()`，请确保运行时实现与类型一致。

Shell 内建议：

```ts
let disposed = false;
let rafId = 0;
const cleanups: Array<() => void> = [];

function disposeCanvasRuntime() {
  if (disposed) return;
  disposed = true;
  if (rafId) cancelAnimationFrame(rafId);
  removeAllInputListeners();
  removeAllIpcListeners();
  definition?.dispose?.();
  definition = undefined;
}
```

要求：

- 先停止 rAF 和事件源，再调用用户 `dispose()`。
- `frame/resize/onPointer/onMessage` 在 disposed 后不得再触发。
- Host 销毁、Canvas close、页面 unload 三条路径共享 exactly-once guard。
- 用户 `dispose()` 抛错时记录错误，但继续完成原生窗口清理。

## 7. P1：ready 与创建取消

公开 API 建议增加：

```ts
interface CanvasWindow {
  readonly ready: Promise<void>;
  readonly state: CanvasWindowState;
  readonly visible: boolean;
}
```

`ready` 仅在以下条件都满足后 resolve：

1. BrowserWindow 创建完成；
2. shell HTML 已加载；
3. entry script 执行成功；
4. `finch.canvas.define` 已注册；
5. `init()` 已执行完成。

若创建期间 dispose/replace/load 失败，`ready` 应 reject 明确错误；不得 resolve 后再出现已取消窗口。

Host 在 ready 前调用 `postMessage()` 时，二选一并固定契约：

- 推荐：排队，ready 后按顺序发送；
- 或 reject `CanvasWindowNotReadyError`。

不得静默丢消息。

## 8. P1：原子窗口模式更新

finch-pet 当前切换调用：

```ts
win.setAlwaysOnTop(true, 'normal');
win.setSize(360, 696);
win.setPosition(centeredX, centeredY);
```

返回 Pet 时反向调用。中间状态会触发多次 move/resize、白屏或位置持久化误判。

建议新增：

```ts
interface CanvasWindowUpdate {
  bounds?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  alwaysOnTop?: boolean;
  alwaysOnTopLevel?: 'normal' | 'floating';
  alwaysOnTopRelativeLevel?: number;
  clickThrough?: boolean;
  visible?: boolean;
}

interface CanvasWindow {
  update(options: CanvasWindowUpdate): Promise<void>;
}
```

实现要求：

- 在 main process 一次 IPC 中应用。
- bounds 使用单次 `BrowserWindow.setBounds(finalBounds)`。
- 同批更新内抑制中间 move/resize 事件，只公开最终状态事件。
- Promise 在原生窗口状态已提交后 resolve。
- 对 disposed record 安全返回/reject 明确错误。
- 不要求做跨窗口事务；只保证单个 CanvasWindow 原子更新。

## 9. P1：可见性与暂停/恢复

Host API：

```ts
readonly visible: boolean;
readonly onDidChangeVisibility: Event<boolean>;
```

Shell 生命周期：

```ts
suspend?(reason: 'hidden' | 'system' | 'sleep'): void;
resume?(reason: 'visible' | 'system' | 'wake'): void;
```

要求：

- visible 只在实际值变化时发事件。
- hide/minimize/system sleep 后暂停 rAF 或至少冻结 dt 基线。
- resume 第一帧不得携带休眠期间累计的巨大 dt。
- suspend/resume 与 dispose 串行；disposed 后绝不 resume。

## 10. P1：Canvas bridge 能力对齐

当前公开 API 文档已提到：

```text
finch.window.startDrag()
finch.window.setAlwaysOnTop(...)
finch.window.setPosition(...)
finch.window.getDisplays()
finch.window.setClickThrough(...)
finch.window.close()
```

请逐项确认 `canvasWindowService.ts` 的 shell bridge、preload/IPC allowlist 和公共类型一致。重点：

### `startDrag()`

- 如果运行时已实现，补齐 Canvas 侧正式类型并增加测试。
- 如果只在文档声明、运行时未实现，完成实现。
- 原生拖动期间保证最终 `pointerup`/drag end 可恢复状态。
- 跨屏和不同 DPR 下由系统原生拖动，不要求 App 高频 setPosition。

### `getDisplays()`

- 返回逻辑像素坐标，明确与 `screenX/screenY` 同一坐标系。
- 每项必须含稳定 id、bounds、workArea、scaleFactor（建议新增）。
- 多显示器负坐标必须保留。

### Pointer 事件

建议补齐：

```ts
interface CanvasPointerEvent {
  type: 'down' | 'move' | 'up' | 'cancel';
  pointerId: number;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  button: number;
  buttons: number;
  pointerType: string;
}
```

要求右键和普通 pointer 使用一致坐标源，click-through 切换期间不吞掉当前 `up/cancel`。

## 11. macOS Space 选项

finch-pet 创建窗口时使用：

```ts
hiddenInMissionControl: true,
visibleOnAllWorkspaces: true,
alwaysOnTopLevel: 'floating',
allowOffscreen: true,
```

请确认：

- 这些选项在 BrowserWindow ready 前应用；
- `visibleOnAllWorkspaces` 正确映射 `setVisibleOnAllWorkspaces`，是否包含 fullScreenAuxiliary 需在文档明确；
- App 模式切到 `normal` 层级、Pet 模式恢复 `floating` 时不丢失 Space 行为；
- 非 macOS 平台明确 no-op，不报错。

## 12. 兼容性与版本

- 保留现有 `show/hide/setPosition/setSize/setClickThrough/setAlwaysOnTop/postMessage/dispose`。
- 新增 `update/ready/state/visible/onDidChangeVisibility/suspend/resume` 时同步修改公共 `finch.d.ts` 和文档。
- shell bridge 新字段必须向后兼容旧 Canvas entry。
- 若 API 需要版本门槛，提升 Finch API/minVersion 并提供 capability 检测，避免扩展通过版本字符串猜测。

建议能力检测：

```ts
if (typeof win.update === 'function') {
  await win.update(...);
} else {
  // 旧版顺序调用 fallback
}
```

## 13. 测试要求

### Service 单元测试

1. `dispose()` 调用两次，用户 dispose 与公开事件各一次。
2. `closed` 在 `destroy()` 中同步重入，不重复 cleanup。
3. creating 状态立即 dispose，ready reject，窗口不复活。
4. Canvas `close()` 与 Host `dispose()` 竞态，最终一次 dispose。
5. extension reload 与 native closed 竞态，最终一次 dispose。
6. destroyed webContents 下 flush/summary 不抛错。
7. disposed 后所有控制方法不触发 Electron 对象访问。
8. ready 前 postMessage 按既定契约排队或明确 reject。
9. update 一次只公开最终 move/resize。
10. hide/show 只在真实变化时发 visibility。

### Shell 集成测试

1. rAF 运行中销毁：停止 rAF，用户 dispose 一次。
2. onPointer/onMessage 回调中关闭窗口：不再分发后续事件。
3. dispose 回调抛错：窗口仍被完整销毁。
4. suspend/resume 后首帧 dt 不包含暂停时长。
5. `startDrag/getDisplays/setClickThrough/close` 与公共类型一致。

### 端到端验收

1. 连续 Pet show → hide → show 100 次，无 `Object has been destroyed`。
2. 创建后立即 hide/dispose 100 次，无窗口复活和临时文件残留。
3. Pet → flappy-bird → Pet 连续切换 50 次，无白屏、闪烁和错误位置持久化。
4. Canvas 自行 close 后 Host `onDidDispose` 一次，随后 Host dispose 安全。
5. Finch reload/退出时 Runtime `dispose()` 一次，音频、timer、rAF 全停。
6. 多显示器（含负坐标、不同 DPR）拖动无跳变。
7. sleep/wake、锁屏、Space 切换后 visible 和 dt 正确。

## 14. 推荐提交拆分

按可回滚原子能力提交：

1. `fix(canvas-window): 统一幂等销毁状态机`
2. `fix(canvas-window): 保证 shell dispose 与事件 exactly-once`
3. `feat(canvas-window): 暴露 ready state 与 visibility 生命周期`
4. `feat(canvas-window): 支持原子 update 窗口模式`
5. `feat(canvas-window): 对齐拖动显示器与 pointer bridge`
6. `test(canvas-window): 补齐生命周期与模式切换回归测试`
7. `docs(api): 更新 CanvasWindow 公共契约`

## 15. 完成定义

只有同时满足以下条件才算完成：

- main process 不再出现 `TypeError: Object has been destroyed`；
- 所有关闭来源汇入同一状态机；
- Host `onDidDispose` 和 Canvas `dispose()` 均 exactly-once；
- creating/disposed 状态的调用有明确、安全语义；
- Pet/App 窗口模式可以原子更新；
- public `finch.d.ts`、shell bridge、IPC 与文档一致；
- 上述自动化测试通过；
- finch-pet 无需依赖 Desktop 私有模块。

## 16. finch-pet 对接位置

Agent 完成 Desktop API 后，finch-pet 侧主要改造点为：

- `src/host/application/window-coordinator.ts`
  - 使用 `ready/state` 简化创建取消；仍保留扩展侧 current identity 防迟到事件。
- `src/host/platform/finch/pet-extension.ts`
  - Pet/App 切换优先使用 `window.update()`；旧 API 保留 fallback。
  - 使用 `visible/onDidChangeVisibility` 校正 UI。
- `src/game/platform/canvas-platform.ts`
  - 优先暴露 `startDrag()`，逐步移除 App 内高频 setPosition。
- `src/game/platform/finch-canvas.d.ts`
  - 在正式 API 发布后对齐公共类型，避免本地猜测声明。

请勿直接修改 finch-pet 的 AppRegistry、Pet Systems 或游戏规则来规避 service 生命周期问题。
