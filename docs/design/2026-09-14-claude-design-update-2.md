# Roost Family — Design Update 2: Kids' Corner Icon Artwork

Paste everything below the line into Claude Design (same project as "Roost Family App v2").

---

## The ask

Replace the 12 placeholder routine icons in the v2 "Routine icon library" panel with **final illustrated artwork**, and add the icons below. The rest of v2 is built; this is the only open design deliverable. The icons appear in **Kids' Corner** (picture schedule and sticker chart) and on the main screen's Now → Next card.

## Who reads these icons

Pre-readers aged about 2–7, glancing at a kitchen tablet. They must recognize each icon **without the label**, from arm's length, in about one second.

## Icon set (file name = key)

**Routine steps (24)**

- Existing, redraw: `breakfast`, `teeth`, `shoes`, `car`, `nap`, `bath`, `books`, `bed`, `potty`, `park`, `snack`, `getting-dressed`
- New: `lunch`, `dinner`, `wash-hands`, `jacket`, `school`, `playtime`, `screen-time`, `tidy-up`, `music`, `grandparents`, `doctor`, `swimming`

**Sticker categories (3)** — shown in the sticker chart rows and the sticker log sheet

- `potty`, `teeth` (reuse the routine icons) and new `new-food` ("tried a new food")

**Sticker (1)** — the reward mark placed in the chart

- `sticker-star`: a cheerful star sticker, shown at 40 pt, up to 5 in a row

## Sizes they must read at

- **120 pt** — the current step (inside a 240 pt card)
- **64 pt** — upcoming/done steps (inside a 140 pt card) and the Now → Next card on the main screen
- **40 pt** — sticker chart rows and stickers

## Style

- Friendly and simple, matching the warm v2 palette and the rounded line style of the Gable logo. Filled shapes are fine (probably better for toddlers) as long as the whole set is consistent.
- Works on the Kids' Corner background `#F5E6C4`, tile `#FBF3E0`, and the main screen surface `#FBF6EE`.
- No meaning carried by color alone; each icon is recognizable in grayscale.
- **No people with specific skin tones or genders.** Use objects, or neutral simple figures (e.g., `grandparents` as two simple rounded shapes with glasses/cane cues, `doctor` as a stethoscope).
- No text inside icons.

## States to show

1. **Current step card** (240 pt): icon 120 pt + label.
2. **Upcoming step card** (140 pt): icon 64 pt + label.
3. **Done step card**: the done look (e.g., green check badge `#2F6B57` on `#DDEDE5`, softened icon).
4. **Photo replacement**: a parent's photo in place of the icon, rounded crop, same card frame, at both sizes.
5. **"All done!" card** shown when every step is finished.

## Export requirements (for implementation)

- One **SVG per icon**, file named exactly by key (e.g., `wash-hands.svg`), square `viewBox="0 0 120 120"`.
- Vector only: no embedded raster images, no external fonts, no `<style>` blocks or scripts; flatten effects. Under 10 KB each.
- Include them in the handoff bundle under `project/icons/`.

## Deliver

- A panel with all icons at 120 / 64 / 40 pt on the Kids' Corner background
- The five card states above
- The SVG files in the handoff bundle
