# 桌宠不可见：日志采集

本次新增日志统一带 `[pet-display]` 前缀，使用 Finch 的 `ctx.logger.info/warn`，不另建日志文件。

## 发给故障用户

1. 安装包含本次日志改动的版本，并重新加载 Finch Pet。
2. 打开 Finch 的小程序/插件日志，选择 Finch Pet；保留 info 与 warn 级别。
3. 若菜单显示“隐藏桌宠”，先点击隐藏，再点击“显示桌宠”。
4. 等待至少 20 秒。若仍不可见，复制从 `activate` 开始的 `[pet-display]` 日志，说明点击时间、是否使用多显示器、系统缩放比例。不要发送无关聊天日志。
5. 反馈前自行检查日志是否包含不愿分享的设备或路径信息；错误摘要可能含本地路径。

## 开发侧判读

- `activate` / `app-info`：操作系统内核版本、架构、宠物扩展版本和 Finch 版本。Win10 与 Win11 的内核版本都可能以 10.0 开头，需结合 build 和用户说明判断。
- `visibility-restored`：宠物库是否有可用宠物、启动后期望的显示状态。
- `tool-install-complete`：聊天工具完成安装；`desired=false, hasWindow=false` 表示安装后仍未请求显示。
- `catalog-install-complete`：画廊完成安装，即将请求显示。
- `show-request` → `create-start` → `create-options` → `window-created` → `window-ready` → `show-issued`：宿主显示链路。已有窗口则记录 `show-existing`。
- `create-options`：保存及迁移后的坐标、画布尺寸、窗口选项、精灵 data URL 的长度（不记录内容）。没有保存坐标时 JSON 中对应字段会省略。
- `canvas-init` → `sprite-loaded` → `first-frame`：画布初始化、图片解码、首次宠物 drawImage 调用成功。含画布像素尺寸、DPR、屏幕尺寸、位置和绘制范围。`first-frame` 只证明 Canvas 绘制调用成功，不能证明 GPU/桌面合成最终可见。
- `sprite-error`：图片解码失败；应优先检查宠物资源。
- `ready-pending`：等待就绪已超过 10 秒，包含最后收到的画布阶段。
- `first-frame-pending`：窗口 ready 后 15 秒仍未收到首帧回执。可能是图片、绘制、窗口隐藏或回执链路问题，不能仅凭这一条认定 GPU 故障。
- `ready-failed` / `show-failed` / `initialize-failed` / `catalog-install-or-show-failed`：对应失败阶段和有限长度错误摘要。
- `window-disposed`：窗口关闭时最后阶段与是否收到首帧。

日志不逐帧输出、不记录拖动轨迹、图片数据、气泡或聊天内容，不自动上传。超时只告警，不改变既有显示行为。
