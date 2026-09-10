# ocx-dash

OpenCodex 增强仪表盘 — 本机 OpenCodex 代理的额度可视化面板。

Tauri 桌面小窗应用，始终置顶显示谷歌反重力（Google Antigravity）的 Gemini / Claude 实时额度。

## 功能

- 从本机 OpenCodex (/api/provider-quotas) 读取各 Provider 实时额度
- 圆弧转盘直观展示 5 小时与每周额度的剩余百分比
- 按 Gemini / Claude 分组，颜色随余量变化（绿 → 黄 → 红）
- 手动刷新 + 60 秒自动刷新
- 自适应系统浅色 / 深色主题
- 始终置顶的桌面小窗，可随时查看

## 使用

```bash
pnpm install
pnpm dev
```

首次启动会要求输入 OpenCodex Admin Token（位于 ~/.opencodex/admin-api-token）。

## 构建

```bash
pnpm build
```

## 界面来源

转盘式仪表盘设计移植自 dsh-hub 的谷歌反重力管理面板 (features/agy/client.tsx)。

