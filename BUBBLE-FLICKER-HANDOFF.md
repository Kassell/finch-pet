# Finch Pet 气泡闪帧处理记录

状态:固定窗口方案已落地,等待重新构建并导入后的回归冒烟。

## 问题与结论

`finch-pet` 使用单个透明 `BrowserWindow + Canvas` 同时绘制宠物和气泡。旧实现会在气泡从头顶切到侧边时,把窗口高度在 `480 × 184` 与 `480 × 260` 之间动态切换。macOS 透明窗口执行 `setBounds()` 时可能重建 compositor surface,导致宠物动画出现一瞬间闪帧。

当前方案不再动态改变窗口尺寸:Canvas Window 始终为 `480 × 260`,宠物与气泡只在固定画布内部重新布局。这样气泡 placement 切换不触发窗口 surface 重建。

## 当前实现

- Host 创建固定 `480 × 260` Canvas Window,并使用 `allowOffscreen` 允许透明预留区越过 macOS 菜单栏。
- 宠物位置持久化继续按旧 compact 高度换算,兼容已有 `window.position` 数据。
- Canvas 根据浏览器 `Screen` 工作区、当前窗口位置和宠物可见像素盒选择 `top-left`、`top-right`、`side-left`、`side-right`。
- placement 带水平和垂直滞回,避免宠物在阈值附近拖动时来回切换。
- finch-pet Canvas 直接使用 `setPosition` 拖动窗口,并以宠物可见像素包围盒而不是透明窗口约束贴边。光标与惯性也由 finch-pet 自己管理。
- Host 与 Canvas 的业务消息统一声明在 `src/protocol.ts`,两端在进程边界使用同一联合类型与类型守卫。

主要文件:

- `src/pet-extension.ts`:固定窗口生命周期、位置迁移与持久化。
- `src/protocol.ts`:Host ↔ Canvas 消息协议唯一来源。
- `canvas/main.ts`:Canvas 状态和交互编排。
- `canvas/drag.ts`:拖拽速度、惯性衰减与屏幕边界。
- `canvas/bubble.ts`:气泡 placement 与布局纯逻辑。
- `src/main/services/canvasWindowService.ts`:保持通用 Canvas Window 实现,本轮只新增 `allowOffscreen` 开窗选项。

## 回归冒烟清单

重新构建并导入 finch-pet 后检查:

1. 宠物窗口可正常打开和关闭,重开后位置保持。
2. 拖动到屏幕左右半区时,气泡方向正确切换且无闪帧。
3. 拖动到菜单栏、屏幕侧边与 Dock 附近时,宠物主体不会被裁掉或跳位。
4. 拖拽超过阈值后光标变为 `grabbing`,松手立即恢复;慢拖基本原地停止,快速甩动有短距离惯性并在边界平滑停住。
5. 单击播放 waving,双击播放 jumping,拖拽与惯性阶段播放左右 running,完全停止后回到 idle。
6. 右键菜单可正常显示并退出宠物。
7. 会话运行时气泡可在思考、完成、等待确认之间切换;“打开会话”动作有效。
8. `pet_list`、`pet_select`、本地目录/zip/图片导入与宠物切换正常。

## 后续方向

Canvas Window 支持同一小工具多窗口后,可以把气泡迁移成跟随宠物窗口的独立子窗口。届时宠物窗口只覆盖宠物主体,气泡作为 popover 使用屏幕坐标定位;`canvas/bubble.ts` 的 placement 策略仍可复用。
