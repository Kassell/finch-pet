# Finch Pet 运行时架构

## 产品模型

Finch Pet 由两个相互独立的界面层组成：

```text
Canvas Runtime
├── Pet                         桌面宠物
└── App                         当前运行的一个 Canvas 应用
    ├── flappy-bird             现有小游戏
    ├── home                    未来的首页/房间 App
    └── ...                     其他小游戏

Webview AppPanel
└── pet-catalog                 Petdex 响应式画廊与安装界面
```

Pet 与 Canvas App 共享同一个浮动 `CanvasWindow` 并保持互斥；Petdex 画廊使用独立的 Finch `appPanel`，不会占用或关闭桌宠窗口。`home` 不是强制中间层，而是未来的普通 Canvas App。

## 项目结构

```text
src/
├── game/                       纯 ctx2d 游戏 Runtime
│   ├── core/
│   │   ├── game.ts             固定步长循环、互斥 Scene 生命周期
│   │   └── app-registry.ts     内置 App 注册、校验与安装
│   ├── pet/
│   │   ├── pet-scene.ts        Pet Scene 协调器
│   │   ├── systems/            动画、气泡、alpha 命中
│   │   ├── physics/            拖拽、惯性与跨屏约束
│   │   ├── rendering/          Pet ctx2d Renderer
│   │   ├── assets/             spritesheet 解析
│   │   └── ui/                 气泡布局与菜单
│   ├── apps/
│   │   └── flappy-bird/        自包含小游戏 App
│   ├── input/                  DOM → Runtime 输入适配
│   ├── platform/               Finch Canvas/Window bridge
│   ├── systems/                Runtime 共享 System
│   └── main.ts                 Game、Pet、App 的唯一组合根
├── host/                       Finch 扩展与操作系统集成
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   └── platform/finch/
├── webview/
│   ├── pet-catalog.html        AppPanel 页面入口
│   ├── pet-catalog.css         Finch 主题响应式样式
│   └── pet-catalog.ts          Webview Bridge 与 DOM 交互
├── shared/
│   ├── protocol.ts             Host ↔ Canvas Runtime 协议
│   └── catalog-webview-protocol.ts  Host ↔ 画廊 Webview 协议
└── index.ts                    Finch 发布入口
```

## Runtime 规则

- Pet 和 App 使用同一个互斥 Scene Runtime，不会同时更新或渲染。
- `pet` 是 Runtime 内建 Scene，不属于 AppRegistry。
- 所有 App 通过 `AppRegistry` 注册，Runtime 不硬编码 App 列表。
- `gameMode { active: true, appId }` 直接启动目标 App；初始化也可通过 `initialAppId` 直接进入 App。
- `gameMode { active: false }` 返回 Pet。
- 未传 `appId` 时为兼容旧 Host，默认启动 `flappy-bird`。
- 未注册的 `appId` 必须失败，不允许静默打开错误 App。

## 生命周期

```text
exit(current) → resize(next) → enter(next) → render(next)
                         ↓
              update(fixedDt) → render
```

- Runtime 使用固定步长更新，并限制单帧累计时间。
- 更新和渲染分离。
- Pointer、Context Menu、Keyboard、Blur 只路由到当前 Pet/App。
- Runtime 销毁时统一释放所有已创建内容。

## Pet Systems

`PetScene` 是协调器，不再独占所有业务状态：

- `PetAnimationSystem`：状态优先级、播放模式、帧推进、瞬态恢复。
- `PetBubbleSystem`：文本、会话、动作和过期时钟。
- `PetHitTestSystem`：离屏 Canvas、sprite alpha 缓存和命中判断。
- `VisualTransitionSystem`：Pet/App 共享视觉过渡。
- `physics/drag.ts`：拖拽物理、惯性与显示器边界纯函数。

后续可继续抽离 `PetDragSystem` 与 `PetRenderSystem`，但不会改变 Pet/App 互斥模型。

## Host 边界

Host 不运行游戏规则，只负责：

- CanvasWindow 显示、隐藏、尺寸、位置和层级。
- 用户显示意图与窗口竞态。
- Pet 包、注册表、导入、Storage 与 MCP。
- 创建 Petdex AppPanel，并通过 Webview Bridge 同步目录、安装状态和已安装标记。
- 将目标 `appId` 原样传给 Runtime。
- 加载 App 专属 Host 资源；例如仅 Flappy Bird 加载其音频。

Host 与 Canvas Runtime 只依赖 `src/shared/protocol.ts`；Host 与画廊只依赖 `src/shared/catalog-webview-protocol.ts`。Canvas Scene 和 Webview 页面都不直接调用 Host 模块。

## 新增 App

新增 App 时：

1. 创建 `src/game/apps/<app-id>/`。
2. 实现 Scene 生命周期；App 内部可以继续拥有自己的 entities/systems/scenes。
3. 在 `src/game/main.ts` 向 `AppRegistry` 注册。
4. Host 或 Pet 使用该 `appId` 直接启动。

未来增加 `home` 时，它与 `flappy-bird` 完全平级，不要求所有 App 必须经由 home 启动。
