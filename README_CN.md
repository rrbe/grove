# Grove

macOS 优先的 Tauri 2 桌面应用，用于管理 Git Worktree。

## 功能

- **工作树扫描** — 使用原生 `git worktree list --porcelain` 解析所有工作树
- **一键启动** — 支持 Terminal、VS Code、Cursor、Claude CLI、Codex CLI、Gemini CLI
- **GitHub PR 集成** — 通过 `gh` CLI 自动查询并缓存关联的 Pull Request
- **项目钩子** — 支持 pre-create、post-create、post-start 等生命周期钩子
- **冷启动预热** — 自动复制忽略文件、生成确定性端口
- **审批机制** — 项目定义的 shell 命令需一次性授权，指纹持久化存储
- **中英双语** — 默认中文界面，可一键切换英文

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Rust (Tauri 2)，通过系统 `git` CLI 交互
- **IPC**: Rust 结构体 `camelCase` 序列化，前端 `invoke<T>()` 调用

## 快速开始

```bash
# 安装前端依赖
pnpm install

# 开发模式运行（前端 + Rust 后端）
pnpm tauri:dev

# 仅构建前端（类型检查 + Vite 打包）
pnpm build

# 运行 Rust 后端测试
cd src-tauri && cargo test

# Rust 代码检查
cd src-tauri && cargo clippy
```

## 项目结构

```
src/                    # React 前端
  App.tsx               # 主组件（Master-Detail 布局）
  lib/
    api.ts              # Tauri invoke 封装
    types.ts            # TypeScript 类型定义
    i18n.tsx            # 国际化上下文
  locales/
    zh-CN.ts            # 中文翻译
    en.ts               # 英文翻译
  styles.css            # 全局样式

src-tauri/src/          # Rust 后端
  lib.rs                # Tauri 命令注册
  git.rs                # Git CLI 交互（worktree、status、PR 查询）
  config.rs             # 配置加载与合并
  models.rs             # Serde 数据结构
  actions.rs            # 创建/删除/启动/钩子执行
  store.rs              # 持久化存储（最近仓库、审批、PR 缓存）
```

## 配置

在仓库根目录创建 `.worktree-switcher/config.toml`：

```toml
[settings]
worktree-root = ".worktrees"
default-base-branch = "main"

[cold-start]
copy-files = [".env", ".env.local"]

[[cold-start.ports]]
name = "web"
base = 3000
env-var = "PORT"
url-template = "http://localhost:{port}"

[[launchers]]
id = "vscode"
name = "VS Code"
kind = "app"
app-or-cmd = "Visual Studio Code"

[[hooks]]
id = "install-deps"
event = "post-create"
type = "script"
run = "pnpm install"
```

本地覆盖配置放在 `.worktree-switcher/local.toml`（建议加入 `.gitignore`）。

## 许可

MIT
