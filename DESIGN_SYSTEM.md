# Grove Design System

A minimalist design language for a macOS-native Git worktree manager. Warm ink tones with a single teal accent, flat surfaces, and precise typography. Supports light and dark modes via `[data-theme="light"|"dark"]`. No gradients, no glass-morphism, no decorative shadows.

---

## Design Principles

1. **Restraint over decoration** — every visual element must earn its place
2. **Monochrome first** — use the accent color sparingly, only for interactive/active states
3. **Flat surfaces** — no gradients, no blur, no glass-morphism
4. **Borders over shadows** — thin borders are the primary visual separator
5. **Consistent typography** — sans-serif everywhere, monospace for code

---

## Design Tokens (CSS Custom Properties)

All values are defined as CSS custom properties in `:root`. Always use tokens instead of hardcoded values.

### Type Scale

| Token | Value | Usage |
|---|---|---|
| `--text-2xs` | `0.65rem` | Micro hints (launcher terminal hint) |
| `--text-xs` | `0.7rem` | Badges, step numbers, timestamps, meta labels |
| `--text-sm` | `0.78rem` | Captions, secondary text, small buttons |
| `--text-base` | `0.85rem` | Body text, buttons, inputs, section headings |

Standalone sizes outside the scale: `0.92rem` (sidebar branch name), `1.2rem` (detail heading).

### Radius Scale

| Token | Value | Usage |
|---|---|---|
| `--radius-xs` | `5px` | Tiny controls, close buttons |
| `--radius-sm` | `6px` | Menu items, compact elements, hook steps, file rows, sidebar tabs |
| `--radius-md` | `8px` | List items, toasts, alerts, tool rows |
| `--radius-lg` | `10px` | Panels, log streams |
| `--radius-xl` | `12px` | Cards, modals |
| `--radius-2xl` | `14px` | Large modals |
| `--radius-full` | `999px` | Pill buttons, badges |

### Font Stack

| Token | Stack | Usage |
|---|---|---|
| (`:root`) | `"Avenir Next", "Segoe UI", sans-serif` | All UI text |
| `--font-mono` | `"SF Mono", "JetBrains Mono", monospace` | Code, paths, diffs |

**No serif fonts.** All headings use the same sans-serif stack.

---

## Color Palette

### Base Colors (Light)

| Token | Value | Usage |
|---|---|---|
| `--ink` | `#1c1917` | Primary text |
| `--ink-strong` | `rgba(28, 25, 23, 0.9)` | Emphasis |
| `--ink-secondary` | `rgba(28, 25, 23, 0.6)` | Body copy, descriptions |
| `--ink-tertiary` | `rgba(28, 25, 23, 0.46)` | Muted labels, placeholders |
| `--ink-ghost` | `rgba(28, 25, 23, 0.3)` | Ghost elements |
| `--ink-faint` | `rgba(28, 25, 23, 0.15)` | Disabled text |

### Accent Color

| Token | Value | Usage |
|---|---|---|
| `--teal` | `#2e7a6e` | Primary accent — focus rings, active states |
| `--teal-bg` | `rgba(46, 122, 110, 0.08)` | Active selection background |
| `--teal-bg-strong` | `rgba(46, 122, 110, 0.15)` | Strong selection background |
| `--teal-border` | `rgba(46, 122, 110, 0.22)` | Active item border |
| `--teal-focus` | `rgba(46, 122, 110, 0.5)` | Input focus border |
| `--teal-muted` | `rgba(46, 122, 110, 0.6)` | Muted teal text |
| `--teal-hover` | `rgba(46, 122, 110, 0.82)` | Hover state |

Use teal **sparingly** — only for interactive states, active indicators, and focus rings.

### Semantic Colors

| Token | Value | Usage |
|---|---|---|
| `--success` | `#28735a` | Success text |
| `--danger` | `#a63828` | Error/danger text |
| `--warning` | `#7d6328` | Warning text |
| `--purple` | `#6258a0` | PR badges |

### Surfaces (Light)

| Token | Value | Usage |
|---|---|---|
| Page background | `#f8f6f3` | Solid warm background |
| `--surface-card` | `#fefdfb` | Card backgrounds |
| `--surface-topbar` | `#f7f5f2` | Topbar |
| `--surface-sidebar` | `#f3f1ee` | Sidebar, worktrees panel |
| `--surface-modal` | `#fefdfb` | Modals |
| `--surface-input` | `#fefdfb` | Input backgrounds |
| `--surface-warm` | `#f5f3f0` | Warm surface |
| `--surface-raised` | `#fefdfb` | Raised elements |
| `--surface-hover` | `rgba(28, 25, 23, 0.045)` | Hover states |
| `--surface-subtle` | `rgba(28, 25, 23, 0.025)` | Subtle backgrounds |
| `--surface-muted` | `rgba(28, 25, 23, 0.04)` | Muted backgrounds |
| `--surface-strong` | `rgba(28, 25, 23, 0.065)` | Strong backgrounds |
| `--surface-stronger` | `rgba(28, 25, 23, 0.1)` | Stronger backgrounds |

### Borders

| Token | Value | Usage |
|---|---|---|
| `--border-faint` | `rgba(28, 25, 23, 0.07)` | Internal dividers |
| `--border-default` | `rgba(28, 25, 23, 0.12)` | Card/panel borders, topbar, sidebar |
| `--border-strong` | `rgba(28, 25, 23, 0.16)` | Input borders |

---

## Shadows

Shadows are used **minimally**. Cards have no shadow. Only modals and menus cast subtle shadows.

| Name | Value | Usage |
|---|---|---|
| `shadow-card` | `none` | Cards use borders, not shadows |
| `shadow-modal` | `0 8px 32px rgba(28, 25, 23, 0.14)` | Modal overlay |
| `shadow-menu` | `0 4px 16px rgba(28, 25, 23, 0.12)` | Context menus |
| `shadow-panel` | `-2px 0 16px rgba(28, 25, 23, 0.1)` | Slide-out panel |

---

## Buttons

All buttons use `border: 0; border-radius: 999px; cursor: pointer`. Disabled: `opacity: 0.55; cursor: not-allowed`.

### Variants

| Variant | Class | Background | Text Color | Usage |
|---|---|---|---|---|
| **Primary** | `.primary-button` | `#2e7a6e` (solid flat) | `#fefdfb` | Main CTA — save, create, confirm |
| **Ghost** | `.ghost-button` | `rgba(28, 25, 23, 0.055)` | `var(--ink)` | Secondary actions — cancel, open |
| **Danger** | `.danger-button` | `rgba(180, 58, 46, 0.1)` | `#a63828` | Destructive actions — delete, remove |

### Sizes

| Size | Padding | Font Size | Class |
|---|---|---|---|
| **Default** | `9px 16px` | `var(--text-base)` | (base class) |
| **Small** | `5px 12px` | `var(--text-sm)` | `.btn-sm` |

### Rules

- Use **one primary button** per visible form/section.
- **No gradients** on any button.
- Buttons in `.modal-actions` are right-aligned with `gap: 12px`.
- Action grid buttons use `border-radius: var(--radius-md); min-height: 58px`.

---

## Form Controls

Always use `<Input>`, `<Textarea>`, `<Select>` from `src/components/FormControls.tsx`.

| Property | Value |
|---|---|
| Border | `1px solid var(--border-strong)` |
| Border Radius | `var(--radius-sm)` |
| Background | `#fefdfb` (light) / `#201e1c` (dark) |
| Focus | Border changes to `var(--teal-focus)` |

---

## Cards & Panels

### Card (`.card`)

- Background: `#fefdfb`
- Border: `1px solid var(--border-default)`
- Radius: `var(--radius-xl)` (12px)
- Shadow: **none**
- Padding: `18px`

### Modal (`.modal-card`)

- Background: `#fefdfb`
- Border: `1px solid var(--border-default)`
- Radius: `var(--radius-xl)` (12px)
- Shadow: `0 8px 32px rgba(28, 25, 23, 0.14)`
- Padding: `24px`

### Slide-out Panel

- Fixed right, full height
- Width: `min(480px, calc(100vw - 60px))`
- Shadow: `-2px 0 16px rgba(28, 25, 23, 0.1)`

---

## Launcher Icons

All launcher icons use a simple, uniform background:

- **Default**: `var(--surface-muted)` with `var(--border-default)` border
- **Dark-themed launchers** (cursor, terminal, ghostty, iterm2, warp, opencode): `#1c1917` background

No per-launcher gradients. No decorative shadows or glows.

---

## Topbar

| Property | Value |
|---|---|
| Height | `38px` |
| Background | `var(--surface-topbar)` (solid, no blur) |
| Border | `1px solid var(--border-default)` |
| Left padding (macOS) | `78px` |

**No backdrop-filter.** No glass-morphism.

---

## Typography

### Font Weights

| Weight | Usage |
|---|---|
| `400` | Body text |
| `500` | Primary button text |
| `600` | Labels, buttons, emphasis |
| `700` | Headings, badges, branch names |

### Line Height

| Value | Usage |
|---|---|
| `1.5` | Global default |
| `1.55` | Mono blocks |

---

## Spacing

2px base grid. Common stops: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28px.

---

## Transitions

| Target | Duration | Easing |
|---|---|---|
| Button hover/bg/opacity | `140ms` | `ease` |
| List item hover/border | `100ms` | `ease` |
| Slide-out panel | `180ms` | `ease-out` |
| Toggle switch | `200ms` | — |
| Toast enter | `200ms` | `ease` |
| Toast exit | `300ms` | `ease` |

---

## Toast

- Fixed position: `bottom: 24px; right: 24px`
- Auto-dismiss after 3 seconds
- One toast at a time
- Two variants: `toast-success` / `toast-error`
- Prefix with checkmark (success) or cross (error)

---

## Layout Constants

| Property | Value |
|---|---|
| Topbar height | `38px` |
| Topbar left padding (macOS) | `78px` |
| Sidebar width (worktrees) | `280px` |
| Max content width | `640-680px` |
| Slide-out panel width | `min(480px, calc(100vw - 60px))` |
| Modal max width | `min(900px, 100%)` |
| Min app width | `860px` |

---

## Component Usage Rules

1. **Use existing components**: `Input`, `Textarea`, `Select` from `FormControls.tsx`; `ModalShell` for modals; `Alert` for error banners.
2. **One primary CTA** per visible form section.
3. **No glass-morphism**, no `backdrop-filter: blur()`. All surfaces are solid.
4. **No gradients** anywhere — buttons, backgrounds, launcher icons are all flat.
5. **Dark mode supported** — Light / Dark / System via `[data-theme]`. All colors use CSS custom properties. Never hardcode colors.
6. **Pill radius** (`999px`) for buttons and badges. `var(--radius-xl)` for cards and modals.
7. **Toast placement**: bottom-right, one at a time, auto-dismiss 3s.
8. **Modal dismiss**: Escape key + backdrop click.
9. **Typography**: Sans-serif everywhere. No serif fonts.
