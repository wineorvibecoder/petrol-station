# Škoda Pit Stop — DESIGN

The design system, as actually implemented in code. The canvas UI in `game.js`
reads from three token blocks (`COLORS`, `TYPE`, `MOTION` / `EASE`); `style.css`
mirrors the colour tokens in `:root`. This file documents them so future changes
stay on-system. Hex is the source of truth (widest canvas-2d support); OKLCH is
listed for the neutrals so the emerald tint is explicit.

## Strategy

- **Register:** brand (the look *is* the product). See `PRODUCT.md`.
- **Colour strategy:** Committed. One saturated identity — Škoda emerald green —
  carries the surface; electric green is the rare, high-impact accent. Station
  colours are a separate functional layer (a gameplay code), not part of the
  brand palette's expressive budget.
- **Theme:** dark. A player at a screen, leaning into an arcade moment; the
  emerald surface lets the painted scenery and electric-green accents glow.

## Colour (`COLORS` in game.js, `:root` in style.css)

Every neutral is tinted toward the emerald hue (~165°), low chroma, so the UI
feels cohesive with the brand without reading as "green text". No pure `#fff`
or `#000` anywhere.

### Brand greens
| Token | Hex | Role |
|---|---|---|
| `electric` | `#78faae` | accents, headings, +1, focus, highlight |
| `emerald` | `#0e3a2f` | canvas surface, panels, screen fade |
| `emeraldLine` | `#1c5c49` | unselected card borders |
| `emeraldDeep` | `#082019` | page background (CSS `--bg-dark`) |

### Tinted neutrals (≈ OKLCH, hue ~165, chroma ≤ 0.012)
| Token | Hex | ≈ OKLCH | Role |
|---|---|---|---|
| `textBright` | `#eef7f1` | `oklch(96% 0.010 165)` | near-white (was pure #fff) |
| `text` | `#e7ece9` | `oklch(93% 0.006 165)` | primary text |
| `textMuted` | `#cdd6d1` | `oklch(85% 0.008 165)` | leaderboard rows |
| `textDim` | `#97a39c` | `oklch(67% 0.008 165)` | hints, sub-labels |
| `surface` | `#1f2724` | `oklch(26% 0.010 165)` | lane fill A, menu card, name box |
| `surfaceAlt` | `#232b27` | `oklch(28% 0.010 165)` | lane fill B |
| `surfaceBox` | `#283029` | `oklch(30% 0.010 165)` | station fallback box |
| `surfaceSel` | `#2f3a2a` | `oklch(35% 0.018 150)` | selected menu card |

### Functional station / vehicle colours (gameplay code — hues fixed)
`fuelPetrol #d6453b` · `fuelDiesel #454b54` · `fuelCng #3a78c2` ·
`fuelElectric #4ba82e` · `fuelWash #7a5230` · `police #1f2d5a`.
`danger` reuses the petrol red for game-over / miss text.

### Effects & overlays
Emerald- or earth-tinted translucency only (no pure black/white alpha):
`overlay`, `hudBand`, `hudLine`, `stationBoxArt`, `mud`, `outline` /
`outlineStrong` (text outlines on the road), `laneGuide`, `hairline`,
`hintFaint`.

## Typography (`TYPE` + `font()` in game.js)

One family: **Hanken Grotesk** (SIL OFL stand-in for the proprietary Škoda Next),
stack `'Hanken Grotesk', 'Segoe UI', Arial, sans-serif`. Self-hosted as local
`.woff2` in `fonts/` (weights 400 / 600 / 700, each split latin + latin-ext for
Czech/German), registered via `@font-face` in `style.css`; the render loop waits
for `document.fonts.load` so canvas text never flashes from the fallback.

Hierarchy comes from size **and** weight, on a modular scale stepping ~1.27
(13 / 17 / 22 / 28 / 36 / 46). Weight policy: headings + HUD **700**, subheads
**600**, body **400**. `font(role[, weight])` builds the canvas string; pass a
weight only to override a role's default (e.g. HUD figures force 700).

| Role | Size / Weight | Used for |
|---|---|---|
| `display` | 46 / 700 | level-complete, game-over, you-finished |
| `h1` | 36 / 700 | how-to title, "choose mode", leaderboard title |
| `lead` | 28 / 600 | mode names, name-entry value (subhead) |
| `body` | 22 / 400 | primary lines, prompts, lives/timer |
| `label` | 22 / 600 | labels, notices, emphasised lines (subhead); HUD figures override to 700 |
| `caption` | 17 / 400 | secondary text, hints, blurbs |
| `small` | 13 / 400 | smallest sub-labels, hotkey hint |

`style.css` keeps the HTML header (`#hud h1` electric-green, `#instructions`
`--text-soft`) which sits above the canvas and inherits Hanken Grotesk from
`body`.

## Motion (`MOTION` + `EASE` in game.js)

Everything decelerates: exponential ease-out, never bounce or elastic.

- `EASE.outQuart / outQuint / outExpo` — normalised progress curves (0..1).
- `EASE.approach(cur, target, dt, rate)` — frame-rate-independent open-ended
  ease-out (decays remaining distance; the canvas analogue of ease-out-expo).
- `MOTION.laneRate 16` — vertical lane-hop ease-out (replaced 520 px/s linear).
- `MOTION.dockRate 13` — queue/dock shuffle ease-out (replaced 200 px/s linear).
- `MOTION.flashRise 30` / `flashLife 0.9` / `flashPop 0.3` — the +1 / miss text
  rises (ease-out-expo), holds then fades (ease-out-quart), and pops in scale.
- `MOTION.screenFade 0.24` — emerald fade-in on screen entry.

Decorative motion (screen fade, +1 pop) is skipped when `prefers-reduced-motion`
is set; functional motion (cars, feedback text) stays.

## Conventions

- No hex/rgba or `px` font literals in drawing code — only tokens.
- No em dashes (`—`) or `--` in UI copy or docs; colons, commas, periods,
  parentheses, or a middle dot (`·`) instead.
- Bump the `?v=` query on the `<script>` / `<link>` in `index.html` when
  shipping a build.
