# BLUD identity

BLUD is its own product. It does not borrow the visual language, the copy or the
integration set of VELNOR, Models by Vectolith or the framework it is built on.

## Name and voice

- Name: **BLUD**. Always uppercase. Never "Blud", never "BLUD Assistant".
- Voice: calm, direct, competent. Short sentences. No exclamation marks. No
  performed enthusiasm, no emoji in product copy.
- It answers where you already are, over iMessage, and does the work instead of
  describing it.

## Mark

- A single filled droplet with a flat cut on the left edge, drawn on a 32-unit grid.
- Source: `public/brand/blud-mark.svg`.
- Used at 24px or larger, never stretched, never rotated.

## Colour

| Token          | Hex     | Use                           |
| -------------- | ------- | ----------------------------- |
| `--blud-ink`   | #0B0B0C | Primary text, mark on light   |
| `--blud-paper` | #F7F6F3 | Light surface                 |
| `--blud-ember` | #E4572E | Single accent: actions, focus |
| `--blud-slate` | #5A5F66 | Secondary text                |
| `--blud-line`  | #E2DFD8 | Borders and dividers          |

Ember is an accent, not a background. One ember element per view.

## Type

- Display: Geist, 600, tight tracking.
- Body: Geist, 400, 16px minimum.
- Code: Geist Mono.

## Surfaces

- Corners: 12px on cards, 8px on controls, 999px on pills.
- Borders: 1px `--blud-line`, never a drop shadow for structure.
- Motion: 120ms ease-out for state, nothing decorative.

## Ruled out

- No purple gradients, no glassmorphism, no mascots.
- No second accent colour.
- No copy claiming experience, memory or actions the system does not have.

Tokens live in `public/brand/blud-tokens.css`.
