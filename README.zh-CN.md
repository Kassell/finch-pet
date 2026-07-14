# Finch Pet

Finch 桌宠扩展。它可以在桌面上显示一个兼容 Petdex 的悬浮宠物，并根据 Finch Agent 的运行状态做出反馈。

首次显示桌宠前，需要先用 `pet_add` 导入一个宠物；也可以直接让 Finch 从 Petdex 页面链接、图片 URL、本地图片、文件夹或 zip 包添加宠物。

## 功能

- 显示或隐藏桌面悬浮宠物。
- 支持跨屏拖拽。
- 支持单击、双击、右键等基础互动。
- 支持显示短气泡消息。
- 可响应 Finch Agent 的运行状态，例如工作中、等待授权、失败、后台任务完成等。
- 支持从本地或远程来源导入 Petdex 兼容宠物。
- 可通过 Finch 工具管理当前选中的宠物。

## 支持的宠物来源

`pet_add` 支持：

- Petdex 页面链接，例如 `https://petdex.dev/pets/<slug>`
- 远程 `.webp` / `.png` spritesheet 图片 URL
- 本地 spritesheet 图片
- 本地 Petdex 宠物文件夹
- 本地 `.zip` 宠物包

spritesheet 会按固定 **8 列 × 9 行** 网格解析。基础帧尺寸是 192×208，但也支持同样网格结构的高清图。

## 工具

| 工具 | 说明 |
|---|---|
| `pet_show` | 显示当前选中的桌宠。 |
| `pet_hide` | 隐藏桌宠。 |
| `pet_list` | 列出可用宠物。 |
| `pet_select` | 按名称选择当前宠物。 |
| `pet_add` | 导入 Petdex 兼容宠物。 |
| `pet_remove` | 从本地存储中移除用户导入的宠物。 |
| `pet_set_state` | 播放 Petdex 动画状态。 |
| `pet_say` | 显示一条短气泡消息。 |

如果当前没有任何可用宠物，`pet_show` 和 `pet_list` 会提示先导入宠物。

## 权限

这个扩展需要：

- `filesystem: readwrite` — 保存导入的宠物，并读取本地宠物包。
- `network: true` — 从远程 Petdex 页面或图片 URL 导入宠物。
- `shell: true` — 在扩展运行时需要时打开本地文件或执行辅助动作。

## 开发

```bash
npm install
npm run build
```

`npm run build` 会从 `canvas/` 构建 Canvas 端脚本，并生成 `pet-canvas.js`。

## 许可证

本项目采用 [MIT License](LICENSE) 发布。
