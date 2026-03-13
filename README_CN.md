# Grove

macOS 优先的 Tauri 2 桌面应用，用于管理 Git Worktree。

## 功能

- **工作树扫描** — 使用 `git worktree list --porcelain` 解析所有工作树，显示 dirty / ahead / behind / prunable / locked 状态
- **创建工作树** — 支持新分支、已有本地分支、远程分支三种模式，分支下拉选择，自动生成随机分支名，自动填充目标路径
- **删除工作树** — 流式执行日志，支持预览和执行 `git worktree prune`
- **一键启动** — 支持 Terminal、Ghostty、iTerm2、VS Code、Cursor、Claude CLI、Codex CLI、Gemini CLI
- **GitHub PR 集成** — 通过 `gh` CLI 自动查询并缓存关联的 Pull Request
- **项目钩子** — 支持 pre-create、post-create、post-start、post-scan 等生命周期钩子
- **冷启动预热** — 自动复制忽略文件（`.env`、`.npmrc`），生成确定性端口
- **审批机制** — 项目定义的 shell 命令需一次性授权，指纹持久化存储
- **中英双语** — 默认中文界面，可一键切换英文

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Rust (Tauri 2)，通过系统 `git` CLI 交互
- **IPC**: Rust 结构体 `camelCase` 序列化，前端 `invoke<T>()` 调用

## 快速开始

```bash
pnpm install        # 安装前端依赖
pnpm tauri:dev      # 开发模式运行
pnpm build          # 前端类型检查 + 打包
cd src-tauri && cargo test    # Rust 测试
cd src-tauri && cargo clippy  # Rust lint
```

## 项目结构

```
src/                    # React 前端
  App.tsx               # 主组件（Master-Detail 布局）
  lib/
    api.ts              # Tauri invoke 封装
    types.ts            # TypeScript 类型定义
    i18n.tsx            # 国际化上下文
    branch-name-gen.ts  # 随机分支名生成
  locales/
    zh-CN.ts            # 中文翻译
    en.ts               # 英文翻译
  styles.css            # 全局样式

src-tauri/src/          # Rust 后端
  lib.rs                # Tauri 命令注册（全部 async）
  git.rs                # Git CLI 交互（worktree、status、branch、fetch）
  config.rs             # 配置加载与合并
  models.rs             # Serde 数据结构
  actions.rs            # 创建/删除/启动/钩子执行
  store.rs              # 持久化存储（~/.grove/store.json）
```

## 配置

应用状态存储在 `~/.grove/store.json`（最近仓库、审批记录、各仓库工作树目录设置、默认终端等）。

各仓库可选在根目录放置 `.grove/config.toml` 定义项目配置，`.grove/local.toml` 用于本地覆盖（建议加入 `.gitignore`）。

## 许可

MIT
