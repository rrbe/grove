# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React 19 + TypeScript frontend. `src/App.tsx` holds the main screen state, while `src/lib/api.ts` is the single wrapper layer around Tauri `invoke()` calls and `src/lib/types.ts` mirrors Rust-side models. `src-tauri/src/` contains the desktop backend: `lib.rs` registers commands, `actions.rs` handles worktree operations, `git.rs` shells out to `git`, `config.rs` manages `.grove/*.toml`, and `store.rs` persists app state. Treat `dist/` and `src-tauri/target/` as generated output.

## Build, Test, and Development Commands

Use `pnpm install` to install frontend dependencies. Run `pnpm tauri:dev` for the full desktop app and `pnpm build` for a frontend-only type-check and production build. Backend verification lives under Rust: `cd src-tauri && cargo test` runs unit tests, and `cd src-tauri && cargo clippy` is the preferred lint pass. These commands were validated in this checkout.

## Coding Style & Naming Conventions

Follow the existing style rather than introducing new patterns. TypeScript uses 2-space indentation, semicolons, PascalCase for components and types, and camelCase for functions, state, and Tauri payload fields. Keep frontend IPC definitions in `src/lib/api.ts` and shared TS shapes in `src/lib/types.ts`. Rust follows standard `rustfmt` formatting, `snake_case` names, and `#[serde(rename_all = "camelCase")]` for structs crossing the JS bridge.

## Testing Guidelines

Backend tests are inline Rust unit tests placed in `mod tests` blocks inside the relevant module files such as `src-tauri/src/git.rs`, `config.rs`, and `actions.rs`. Add tests next to the behavior you change. There is currently no dedicated frontend test harness, so at minimum run `pnpm build` after UI or API changes and `cargo test` after backend edits.

## Commit & Pull Request Guidelines

This exported checkout does not include `.git` metadata, so local history conventions cannot be inspected directly. Use short, imperative commit subjects such as `Add launcher approval retry` and keep each commit focused. PRs should explain the user-visible change, note any config or command-safety impact, link the relevant issue, and include screenshots or short recordings for UI updates.
