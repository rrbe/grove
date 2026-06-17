# Grove

一个管理 Git Worktree 的 macOS 桌面应用 —— 从 Worktree 一键启动编辑器、终端和 AI
编程助手，并通过生命周期 Hooks 自动完成环境准备。

[English](./README.md) | 中文

## 界面

![Grove](./docs/screenshot.png)

## 功能

- **Worktree 管理** —— 扫描、创建、删除 Worktree，显示 dirty / ahead / behind /
  prunable / locked 状态。支持新分支、已有本地分支、远程分支三种创建模式，自动生成
  随机分支名并填充目标路径。
- **启动器** —— 内置 Terminal、Ghostty、iTerm2、VS Code、Cursor、Claude CLI、
  Codex CLI、Gemini CLI 启动器，也支持自定义启动器。
- **Hooks** —— 6 个生命周期事件，在 Worktree 创建 / 启动 / 删除时自动安装依赖、
  复制配置文件、触发启动器。详见 [docs/hooks.md](./docs/hooks.md)。
- **CLI** —— 提供 `grove` 命令（类似 VS Code 的 `code`），在终端中管理 Worktree、
  Hooks 和配置。详见 [docs/cli.md](./docs/cli.md)。
- **GitHub PR 集成** —— 通过 `gh` CLI 自动查询并缓存关联的 Pull Request。
- **单实例** —— 多次 `grove open` 复用同一个运行中的应用窗口。
- **i18n** —— 中文（默认）和英文。

## 文档

- [CLI 参考](./docs/cli.md) —— 所有 `grove` 子命令、参数与示例
- [Hooks](./docs/hooks.md) —— 生命周期事件、步骤类型、模板变量
- [配置](./docs/configuration.md) —— 配置层级、设置项、存储位置

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Rust (Tauri 2)，通过系统 `git` CLI 交互

## 快速开始

```bash
pnpm install        # 安装前端依赖
pnpm build          # 前端类型检查 + 打包
pnpm tauri:dev      # 开发模式运行
pnpm tauri:dist     # 打 dmg 包
cd src-tauri && cargo test    # Rust 测试
cd src-tauri && cargo clippy  # Rust lint
```

## License

MIT
