# Grove Design System

A warm, organic design language for a macOS-native Git worktree manager. Light mode only, glass-morphism cards on a gradient canvas.

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

Standalone sizes outside the scale: `0.92rem` (sidebar branch name), `1.3rem` (detail heading).

### Radius Scale

| Token | Value | Usage |
|---|---|---|
| `--radius-xs` | `6px` | Topbar tabs, close buttons, tiny controls |
| `--radius-sm` | `8px` | Menu items, compact elements, hook steps, file rows |
| `--radius-md` | `12px` | List items, toasts, alerts, tool rows |
| `--radius-lg` | `16px` | Panels, log streams |
| `--radius-xl` | `20px` | Cards |
| `--radius-2xl` | `24px` | Modals |
| `--radius-full` | `999px` | Pill buttons, badges |

### Font Stack

| Token | Stack |
|---|---|
| `--font-mono` | `"SF Mono", "JetBrains Mono", monospace` |

---

## Color Palette

### Base Colors

| Token | Value | Usage |
|---|---|---|
| `--ink` | `#10212e` | Primary text, headings |
| `--ink-strong` | `rgba(16, 33, 46, 0.88)` | Brand text, emphasis |
| `--ink-secondary` | `rgba(16, 33, 46, 0.68)` | Body copy, descriptions |
| `--ink-tertiary` | `rgba(16, 33, 46, 0.45)` | Muted labels, placeholders, timestamps |
| `--ink-faint` | `rgba(16, 33, 46, 0.18)` | Disabled text |

### Accent Colors

| Token | Value | Usage |
|---|---|---|
| `--teal` | `#2e6b63` | Primary accent — focus rings, active states, links |
| `--teal-bg` | `rgba(46, 107, 99, 0.10)` | Active selection background |
| `--teal-border` | `rgba(46, 107, 99, 0.25)` | Active item border |
| `--teal-focus` | `rgba(46, 107, 99, 0.70)` | Input focus border |

### Semantic Colors

| Token | Value | Usage |
|---|---|---|
| `--success` | `#185b46` | Success text |
| `--success-bg` | `rgba(49, 143, 114, 0.15)` | Success toast/badge background |
| `--success-border` | `rgba(49, 143, 114, 0.25)` | Success toast border |
| `--danger` | `#8e2319` | Error/danger text |
| `--danger-bg` | `rgba(197, 61, 46, 0.12)` | Error toast/badge/button background |
| `--danger-border` | `rgba(197, 61, 46, 0.20)` | Error banner border |
| `--warning` | `#8a5400` | Warning text |
| `--warning-bg` | `rgba(255, 204, 112, 0.32)` | Warning badge background |
| `--amber-bg` | `rgba(255, 211, 142, 0.28)` | Pill / tag background |
| `--amber-text` | `#784b00` | Pill / tag text |
| `--purple` | `#5842ba` | PR badges, commit author |
| `--purple-bg` | `rgba(88, 66, 186, 0.12)` | PR badge background |

### Surface Colors

| Token | Value | Usage |
|---|---|---|
| `--surface-page` | `linear-gradient(180deg, #f7f3ea 0%, #e8eef4 100%)` with radial overlays | Page background (warm → cool gradient) |
| `--surface-card` | `rgba(255, 255, 255, 0.74)` | Card / panel backgrounds |
| `--surface-topbar` | `rgba(247, 243, 234, 0.72)` | Topbar (glass-morphism with `backdrop-filter: blur(28px)`) |
| `--surface-modal` | `rgba(254, 251, 246, 0.98)` | Modal / slide-out panel |
| `--surface-hover` | `rgba(16, 33, 46, 0.05)` | Hover state on interactive rows |
| `--surface-subtle` | `rgba(16, 33, 46, 0.04)` | Subtle row backgrounds |
| `--border-default` | `rgba(16, 33, 46, 0.10)` | Card/panel borders |
| `--border-faint` | `rgba(16, 33, 46, 0.06)` | Internal dividers |
| `--border-strong` | `rgba(16, 33, 46, 0.12)` | Input borders |

---

## Typography

### Font Stacks

| Token | Stack | Usage |
|---|---|---|
| (`:root`) | `"Avenir Next", "Segoe UI", sans-serif` | All UI text |
| (serif) | `"Iowan Old Style", "Georgia", serif` | Feature headings (h2), detail branch name |
| `--font-mono` | `"SF Mono", "JetBrains Mono", monospace` | Code, paths, diffs, brand name |

### Type Scale

Use the CSS custom property tokens defined in the Design Tokens section above. The system has exactly **4 sizes** plus 2 outliers:

| Token | Size | Usage |
|---|---|---|
| `--text-2xs` | `0.65rem` | Micro hints |
| `--text-xs` | `0.7rem` | Badges, timestamps, meta labels, step numbers |
| `--text-sm` | `0.78rem` | Captions, subtle text, small buttons |
| `--text-base` | `0.85rem` | Body, buttons, inputs, section headings |
| (standalone) | `0.92rem` | Sidebar worktree branch name |
| (standalone) | `1.3rem` | Detail panel branch heading |

**Rule**: Never introduce a new font size. If it doesn't fit one of these 4 tokens, use the nearest.

### Font Weight

Only **3 weights** are used. Never introduce others:

| Weight | Usage |
|---|---|
| `400` | Body text, default UI, inputs, menu items, toast |
| `600` | Labels, buttons, emphasized secondary text, PR links |
| `700` | Headings, brand, section headings, badges, branch names |

### Line Height

Global `line-height: 1.5`. Mono blocks use `1.55` for readability.

---

## Spacing

All spacing uses a **2px base grid**, with common stops at:

| Token | Value | Usage |
|---|---|---|
| `--space-2` | `2px` | List item gap, tight sibling spacing |
| `--space-4` | `4px` | Inline gaps, menu padding |
| `--space-6` | `6px` | Form label gap, small stack gaps |
| `--space-8` | `8px` | Button gaps, flex row gaps |
| `--space-10` | `10px` | Input padding (vertical), list item padding |
| `--space-12` | `12px` | Grid gaps, section gaps |
| `--space-14` | `14px` | Stack gap, input padding (horizontal) |
| `--space-16` | `16px` | Panel inner padding, section spacing |
| `--space-20` | `20px` | Content area padding, detail gap |
| `--space-24` | `24px` | Main padding, modal padding |
| `--space-28` | `28px` | Detail panel horizontal padding |

---

## Border Radius

Use the CSS custom property tokens defined in the Design Tokens section. See that table for the full scale (`--radius-xs` through `--radius-full`).

---

## Shadows

| Name | Value | Usage |
|---|---|---|
| `shadow-card` | `0 24px 60px rgba(16, 33, 46, 0.08)` | Card elevation |
| `shadow-modal` | `0 32px 90px rgba(16, 33, 46, 0.26)` | Modal overlay |
| `shadow-menu` | `0 8px 24px rgba(16, 33, 46, 0.15)` | Context menus, dropdowns |
| `shadow-panel` | `-8px 0 40px rgba(16, 33, 46, 0.18)` | Slide-out panel |
| `shadow-brand` | `0 2px 6px rgba(16, 33, 46, 0.12)` | Brand icon `drop-shadow` |

---

## Buttons

All buttons use `border: 0; border-radius: 999px; cursor: pointer`. Hover lifts with `translateY(-1px)`. Disabled: `opacity: 0.55; cursor: not-allowed; no lift`.

### Variants

| Variant | Class | Background | Text Color | Usage |
|---|---|---|---|---|
| **Primary** | `.primary-button` | `linear-gradient(120deg, #0f2433, #2d7268)` | `#ffffff` | Main CTA — save, create, confirm |
| **Ghost** | `.ghost-button` | `rgba(16, 33, 46, 0.07)` | `#10212e` | Secondary actions — cancel, open, browse |
| **Danger** | `.danger-button` | `rgba(176, 46, 34, 0.12)` | `#8e2319` | Destructive actions — delete, remove |

### Sizes

Only **2 button size tiers** exist. All three variants use identical padding/font-size at each tier:

| Size | Padding | Font Size | Class | Usage |
|---|---|---|---|---|
| **Default** | `9px 16px` | `var(--text-base)` | (base class) | Standard buttons |
| **Small** | `5px 12px` | `var(--text-sm)` | `.btn-sm` | Inline actions, topbar, hooks, settings controls |

Action grid buttons are a **layout variant**, not a size tier — they use default font-size with `min-height: 58px`.

### Rules

- Use **one primary button** per visible form/section. If two equally important actions exist, one should be ghost.
- Topbar CTA is NOT a primary-button — it uses `.topbar-new-btn` with small size.
- Buttons in `.modal-actions` are right-aligned with `gap: 12px`.
- Action grid buttons use `border-radius: var(--radius-md); min-height: 58px` (not pill radius).
- **Never introduce a new button size tier.** Only Default and Small exist.
- **Never use inline `style` for padding/fontSize on buttons.** Add `.btn-sm` instead.

---

## Form Controls

Always use the `<Input>`, `<Textarea>`, `<Select>` components from `src/components/FormControls.tsx` instead of native elements.

### Input / Select

| Property | Value |
|---|---|
| Width | `100%` |
| Padding | `8px 12px` |
| Border | `1px solid rgba(16, 33, 46, 0.12)` |
| Border Radius | `var(--radius-sm)` (8px) |
| Background | `rgba(250, 252, 255, 0.88)` |
| Focus | Border changes to `rgba(46, 107, 99, 0.70)` |
| Transition | `border-color 140ms ease` |

### Textarea

Same as Input, plus:
- `resize: vertical`
- `min-height: 140px` (default), `56px` (compact, e.g. hook script)

### Labels

`.field-label`: `font-size: 0.85rem; color: rgba(16, 33, 46, 0.8); gap: 6px` between label text and control.

---

## Toast

Fixed at `bottom: 24px; right: 24px`. Auto-dismiss after 3 seconds. Click to dismiss early.

| Property | Value |
|---|---|
| Padding | `10px 18px` |
| Border Radius | `12px` |
| Font Size | `0.85rem` |
| Font Weight | `500` |
| Z-Index | `9999` |
| Animation | Slide up 200ms on enter, fade out 300ms at 2.7s |

### Variants

| Variant | Background | Text | Border |
|---|---|---|---|
| `toast-success` | `rgba(49, 143, 114, 0.15)` | `#185b46` | `rgba(49, 143, 114, 0.25)` |
| `toast-error` | `rgba(197, 61, 46, 0.15)` | `#8e2319` | `rgba(197, 61, 46, 0.25)` |

### Rules

- Prefix with `✓` (success) or `✗` (error).
- Keep message under ~60 characters.
- Only one toast visible at a time — new toast replaces the old one.

---

## Badges

Pill-shaped status indicators: `border-radius: 999px; font-size: 0.68rem; font-weight: 700; padding: 3px 9px`.

| Variant | Class | Background | Text |
|---|---|---|---|
| Neutral | `.badge-neutral` | `rgba(16, 33, 46, 0.08)` | inherited |
| Warning | `.badge-warning` | `rgba(255, 204, 112, 0.32)` | `#8a5400` |
| Danger | `.badge-danger` | `rgba(197, 61, 46, 0.14)` | `#8b251a` |
| Good | `.badge-good` | `rgba(49, 143, 114, 0.16)` | `#185b46` |
| PR | `.pr-badge` | `rgba(88, 66, 186, 0.12)` | `#5842ba` |
| Tab count | `.topbar-tab-badge` | `rgba(46, 107, 99, 0.12)` | `rgba(46, 107, 99, 0.8)` |

---

## Cards & Panels

### Card (`.card`)

- Background: `rgba(255, 255, 255, 0.74)`
- Border: `1px solid rgba(16, 33, 46, 0.10)`
- Radius: `20px`
- Shadow: `0 24px 60px rgba(16, 33, 46, 0.08)`
- Padding: `18px`

### Modal (`.modal-card`)

- Background: `rgba(254, 251, 246, 0.98)`
- Radius: `24px`
- Shadow: `0 32px 90px rgba(16, 33, 46, 0.26)`
- Padding: `24px`
- Max-height: `80vh` with scroll
- Backdrop: `rgba(16, 33, 46, 0.32)`

### Slide-out Panel (`.create-modal-panel`)

- Fixed right, full height
- Width: `min(480px, calc(100vw - 60px))`
- Same surface/padding as modal
- Shadow cast left: `-8px 0 40px rgba(16, 33, 46, 0.18)`
- Animate: `slideInRight 180ms ease-out`

---

## Alert Banner

`.alert-banner`: Error-only inline notification.

| Property | Value |
|---|---|
| Padding | `10px 14px` |
| Radius | `12px` |
| Background | `rgba(197, 61, 46, 0.10)` |
| Border | `1px solid rgba(197, 61, 46, 0.20)` |
| Text Color | `#8e2319` |
| Font Size | `0.85rem` |

Use `<Alert>` component from `src/components/Alert.tsx`. Dismissible via `×` button.

---

## Topbar Tabs

Compact rounded-pill tabs with subtle background fill. No divider lines between tabs — spacing alone separates them.

| Property | Value |
|---|---|
| Padding | `4px 10px` |
| Border Radius | `6px` |
| Gap between tabs | `4px` |
| Font | `0.76rem`, weight `500` |
| Color (default) | `rgba(16, 33, 46, 0.45)` |
| Color (hover) | `rgba(16, 33, 46, 0.72)`, bg `rgba(16, 33, 46, 0.05)` |
| Color (active) | `#10212e`, bg `rgba(16, 33, 46, 0.08)` |
| Color (disabled) | `rgba(16, 33, 46, 0.18)`, no hover bg |
| Transition | `color 140ms ease, background 140ms ease` |

### "New Worktree" Button

Not a primary-button. Uses its own subtle ghost style to match the topbar density:
- `font-size: 0.7rem; padding: 4px 10px; border-radius: 6px`
- `background: rgba(16, 33, 46, 0.08); color: rgba(16, 33, 46, 0.65)`
- Hover: `background: rgba(16, 33, 46, 0.13); color: #10212e`

### Rules

- No divider lines, no bottom indicators — tabs are differentiated by background fill only.
- Active tab uses **no font-weight change** to prevent width jitter during switching.
- Tab badges shrink proportionally (`14px` height, `0.6rem` font) to match the compact topbar.
- Brand icon `16px`, brand text `0.78rem`, separated from tabs by `20px` margin.

---

## Toggle Switch

| Property | Value |
|---|---|
| Size | `40px × 22px` |
| Track off | `rgba(16, 33, 46, 0.20)`, radius `11px` |
| Track on | `#34a853` |
| Thumb | `16px` circle, white, `box-shadow: 0 1px 3px rgba(0,0,0,0.15)` |
| Transition | `0.2s` |

---

## Transitions

| Usage | Duration | Easing |
|---|---|---|
| Button hover/bg/opacity | `140ms` | `ease` |
| Tab color/bg | `120ms` | `ease` |
| List item hover/border | `100ms` | `ease` |
| Toggle switch | `200ms` | default |
| Slide-out panel | `180ms` | `ease-out` |
| Toast enter | `200ms` | `ease` |
| Toast exit | `300ms` | `ease` |

---

## Layout Constants

| Token | Value |
|---|---|
| Topbar height | `38px` (aligns with macOS traffic light buttons) |
| Topbar left padding (macOS traffic lights) | `78px` |
| Main content padding | `24px 28px` |
| Sidebar width (worktrees) | `280px` |
| Max content width (repo/hooks views) | `640–680px` |
| Slide-out panel width | `min(480px, calc(100vw - 60px))` |
| Modal max width | `min(900px, 100%)` |
| Min app width | `860px` |

---

## Component Usage Rules

1. **Use existing components**: `Input`, `Textarea`, `Select` from `FormControls.tsx`; `ModalShell` for modals; `Alert` for error banners.
2. **One primary CTA** per visible form section.
3. **Glass-morphism** (`backdrop-filter: blur(28px)`) only on topbar. Cards use semi-transparent white.
4. **No dark mode** — light-only, warm-to-cool gradient background.
5. **Pill radius** (`999px`) for buttons and badges. `14px` for action-grid buttons and inputs. `20px+` for cards.
6. **Toast placement**: Always bottom-right, always one at a time.
7. **Modal dismiss**: Escape key + backdrop click. `canClose` prop controls both.
8. **Font pairing**: Serif for feature headings, sans-serif for UI, monospace for code/paths.
