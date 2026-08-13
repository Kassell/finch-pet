# Finch CanvasWindow API 改造清单

本文只描述 Finch Desktop 需要提供或修复的公共能力；Finch Pet 不依赖 Desktop 私有实现。

## P0 · 销毁生命周期必须安全且幂等

### 1. `CanvasWindow.dispose()` 幂等

- 重复调用不得抛错。
- 窗口已被用户或 Canvas 自身关闭后再次调用不得抛错。
- 销毁过程中不得访问已 destroyed 的 `BrowserWindow.webContents`。

当前复现：`BrowserWindow.destroy()` 同步触发 `closed → cleanupRecord → flushSummary`，随后读取已销毁对象，出现：

```text
TypeError: Object has been destroyed
at flushSummary(...canvasWindowService.js)
```

### 2. `CanvasWindow.onDidDispose` exactly-once

无论关闭来源是什么，都必须触发一次且仅一次：

- Host 调用 `dispose()`；
- Canvas 调用 `finch.window.close()`；
- Finch 停用/重载扩展；
- Finch 退出；
- 原生窗口被系统关闭。

事件触发前后应有明确契约：建议先从注册表移除并标记 disposed，再通知扩展。

### 3. 销毁后所有控制调用安全降级

`show/hide/setPosition/setSize/setClickThrough/postMessage/setAlwaysOnTop` 在窗口销毁后应：

- 返回明确结果或 no-op；
- 不得抛出未捕获异常；
- 可选输出结构化 warning。

## P0 · 可见性事件

建议增加：

```ts
readonly onDidChangeVisibility: Event<boolean>;
readonly visible: boolean;
```

要求：

- `show()`/`hide()`、系统隐藏、桌面恢复后状态一致；
- 事件只在实际值变化时触发；
- 扩展可用它校正菜单状态。

## P1 · Canvas 生命周期契约

### 4. 官方类型声明 `CanvasDefinition.dispose`

运行时已向 Canvas 发送 `__finchCanvasDispose` 并调用定义对象的 `dispose()`，公共类型应正式声明：

```ts
interface CanvasDefinition {
  init?(args: CanvasInitArgs): void;
  frame?(dt: number): void;
  resize?(width: number, height: number): void;
  onPointer?(event: CanvasPointerEvent): void;
  onMessage?(message: unknown): void;
  dispose?(): void;
}
```

并保证 `dispose()` 在 rAF/事件停止后 exactly-once 调用。

### 5. 暂停/恢复生命周期

建议增加：

```ts
suspend?(reason: 'hidden' | 'system' | 'sleep'): void;
resume?(reason: 'visible' | 'system' | 'wake'): void;
```

隐藏窗口时停止 rAF、音频和高频输入；恢复时允许 Scene 重建时钟基线，避免超大 `dt`。

## P1 · 原子窗口模式更新

当前游戏切换需要连续调用 `setSize → setPosition → setAlwaysOnTop`，中间状态可能产生闪烁和 move/resize 事件风暴。建议提供：

```ts
setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): void;
update(options: {
  bounds?: { x?: number; y?: number; width?: number; height?: number };
  alwaysOnTop?: boolean;
  alwaysOnTopLevel?: 'normal' | 'floating';
  clickThrough?: boolean;
}): Promise<void>;
```

要求单次原子应用，并在完成后统一触发最终 move/resize 事件。

## P1 · 创建/就绪状态

建议 `createCanvasWindow` 返回的窗口暴露：

```ts
readonly ready: Promise<void>;
readonly state: 'creating' | 'ready' | 'hidden' | 'disposed';
```

用途：

- 避免创建尚未完成时 show/hide/dispose 竞态；
- Host 可以等待 Canvas 初始化后再发送场景消息；
- 创建中 dispose 应取消 loadFile 并安全清理临时文件。

## P2 · 输入与窗口拖动

### 6. 官方窗口拖动 API

游戏状态栏目前自行计算 `screenX/screenY` 并调用 `setPosition`。建议提供：

```ts
finch.window.startDrag(): void;
```

由 Electron/系统完成原生拖动，减少高频 IPC、跨屏缩放误差和鼠标 capture 问题。

### 7. Pointer capture 与右键坐标一致性

- Canvas shell 的 `onPointer` 应支持 `pointerId`、按钮状态和可靠的 client/screen 坐标。
- 右键 `contextmenu` 与 shell pointer 事件应统一来源或提供去重 id。
- 透明穿透切换期间不得丢失当前 pointerup。

## 验收用例

1. 连续执行 show → hide → show 100 次，无异常且最终状态正确。
2. 创建尚未 ready 时立即 dispose，不出现窗口复活或临时文件残留。
3. Canvas 自行 close 后 Host 收到一次 `onDidDispose`。
4. Host dispose 后 Canvas `dispose()` 调用一次，之后 rAF、音频、timer 均停止。
5. 已销毁窗口上的所有方法不会导致 main process `uncaughtException`。
6. 游戏/桌宠模式原子切换无白屏、闪烁和中间位置持久化。
7. 睡眠、锁屏、切换 Space 后 visibility 与 Scene 时钟正确恢复。
