# Ani Tracker Design Style

## Document Authority

This file is the canonical design-language specification for Ani Tracker.

- The English document at `docs/design_style.md` is the source of truth.
- The Chinese document at `docs/design_style.zh-CN.md` is a reference translation.
- If the two documents differ, follow the English document.
- Product and implementation decisions must consider Apple Human Interface Guidelines (HIG), adapted to the web and to each supported platform context.
- Desktop and mobile are equal product targets. Neither is a reduced version of the other.

## Product Context

Ani Tracker is a cross-platform anime tracking application. It must support user-selected anime illustrations as the bottommost background of the entire web app.

These wallpapers may have:

- highly saturated fantasy colors;
- dense character and costume detail;
- bright highlights and deep shadows in the same image;
- strong complementary color contrast;
- text-like shapes, line art, particles, and decorative patterns;
- visual complexity comparable to richly colored contemporary anime illustration.

This is a non-negotiable environmental constraint. The glass language is not decoration added for trend value. It is the functional layer that keeps navigation, controls, and content legible while allowing personally meaningful artwork to remain visible.

The design system must work with an unknown wallpaper, not only with the default Twilight Iris gradient.

## Design Name

**Ani Tracker - Twilight Iris**

Twilight Iris combines:

- Iris Indigo for selection, focus, and primary action;
- Periwinkle for ambient light and atmospheric continuity;
- Emerald for watched, completed, and successful states;
- Neutral Graphite for content and structure;
- adaptive glass and neutral veils for legibility over expressive artwork.

The product should feel calm, precise, media-aware, and personal. It should respect vivid anime artwork without allowing the artwork to overpower the task.

## Apple Design Principles

Apple HIG is a permanent design input for Ani Tracker. It is not copied literally; its principles are translated into responsive web behavior.

### Hierarchy

- Put primary content and actions first in reading order.
- Group related controls and separate unrelated functions.
- Keep content distinct from navigation and control layers.
- Use progressive disclosure for secondary information and rare maintenance tools.

### Legibility

- Text and controls must remain readable over every supported wallpaper.
- Do not rely on blur alone. Blur must be combined with sufficient opacity, luminosity control, and contrast.
- Use semantic foreground levels: primary, secondary, and tertiary.
- Avoid thin font weights for small text.

### Adaptability

- Desktop and mobile may use different layouts, navigation, components, and interaction logic.
- Preserve brand, semantics, task outcome, and feedback across platforms.
- Respect safe areas, browser chrome, virtual keyboards, resizable windows, localization, and text scaling.

### Familiar Interaction

- Prefer familiar controls and platform-appropriate presentation.
- Desktop can use sidebars, anchored popovers, inspectors, dialogs, and side sheets.
- Mobile uses top navigation as a defining Ani Tracker pattern, together with bottom sheets, full-screen flows, and direct gestures where appropriate.
- Hover is an enhancement, never the only route to an action.
- Every gesture needs a visible, accessible alternative.

### Inclusive Design

- Do not communicate essential state through color alone.
- Support keyboard operation and visible focus.
- Respect reduced motion and reduced transparency preferences.
- Maintain adequate hit targets and contrast.

## Foundational Layer Model

The interface is organized into five conceptual layers. Their order is stable even when platform composition changes.

### Layer 0 - User Artwork

The user wallpaper is the bottommost visual layer.

Responsibilities:

- express personalization;
- provide atmosphere;
- remain visible enough to be meaningful;
- never become responsible for text or control contrast.

The wallpaper is content-like artwork, not a UI color token. Never sample one arbitrary wallpaper color and apply it directly to all controls.

### Layer 1 - Adaptive Environment

This layer stabilizes the wallpaper before UI appears above it.

It can include:

- a neutral light/dark scrim;
- a low-strength Twilight Iris tint;
- localized luminosity reduction behind navigation;
- optional background blur or softening;
- edge gradients that protect safe areas and sticky controls.

The environment must reduce visual noise without turning the wallpaper into an indistinct gray fog.

### Layer 2 - Content Surfaces

This layer contains anime cards, episode rows, metadata, text, charts, and settings groups.

Rules:

- Prefer solid or high-opacity surfaces.
- Use subtle borders and low elevation.
- Do not apply heavy backdrop blur to every card in a long list.
- Keep poster artwork inside cards visually separate from text surfaces.
- Metadata surfaces require a neutral veil when they overlap artwork-derived glow.

### Layer 3 - Functional Glass

This layer contains navigation and controls that float above content.

Examples:

- desktop sidebar;
- mobile top navigation;
- floating pill glass bars for compact secondary navigation and view switching;
- sticky search and toolbars;
- segmented control tracks;
- anchored popovers;
- floating action controls.

Functional glass should visibly belong to a higher plane than content.

### Layer 4 - Modal And Focus Surfaces

This layer contains dialogs, sheets, menus over artwork, provider switching, and long-form reading surfaces.

Rules:

- Use dense, near-opaque glass.
- Use a backdrop that separates the focused task from the page.
- Render through a portal when clipping or stacking may be unstable.
- Preserve a clear close action and Escape behavior where appropriate.

## Wallpaper Adaptation Contract

Every page must remain usable with bright, dark, saturated, low-contrast, and compositionally dense wallpapers.

### Wallpaper Rendering

- Preserve the artwork aspect ratio.
- Prefer `cover` for the app background, with a user-safe focal position when available.
- Do not stretch artwork.
- Avoid abrupt color cropping around navigation or safe areas.
- Keep the wallpaper fixed or spatially stable unless motion has a clear product purpose.
- Do not animate wallpaper scale or parallax by default.

### Readability Protection

At least one neutral protection layer must exist between wallpaper and text-heavy UI.

Recommended sequence:

```text
User artwork
  -> adaptive scrim / tint
  -> content or functional surface
  -> text and controls
```

Never place body text directly over the raw wallpaper.

### Bright And Dark Regions

Because one wallpaper can contain bright and dark regions simultaneously:

- global light/dark mode alone is insufficient;
- large glass surfaces need enough inherent opacity to remain stable over both extremes;
- navigation surfaces may use localized scrims;
- poster or hero glows must fade before entering metadata and control regions;
- a white highlight behind glass must not erase borders, icons, or secondary text.

### User Wallpaper Controls

If wallpaper controls are exposed, prefer a small set of understandable adjustments:

- image selection;
- focal position;
- dimming strength;
- blur/softening strength;
- reset to default background.

Do not expose arbitrary theme-color customization as a substitute for robust adaptation. The Twilight Iris semantic palette remains consistent across wallpapers.

### Fallbacks

- Without `backdrop-filter`, increase surface opacity and keep the hierarchy intact.
- Under `prefers-reduced-transparency`, use solid surfaces.
- If an image fails to load, use the default Twilight Iris canvas and ambient gradients.
- Loading wallpaper must not cause large layout shifts.

## Material System

Glass is selected by function and reading load, not by visual novelty.

### Content Surface

Use for cards, rows, and long-form content.

Light:

```css
background: rgb(255 255 255 / 0.90);
border: 1px solid rgb(18 20 32 / 0.10);
```

Dark:

```css
background: rgb(25 23 32 / 0.92);
border: 1px solid rgb(255 255 255 / 0.09);
```

Blur is optional and should remain light.

### Regular Functional Glass

Use for sidebar, mobile navigation, sticky toolbar, and compact controls.

```css
background: rgb(255 255 255 / 0.76);
backdrop-filter: blur(20px) saturate(150%);
border: 1px solid rgb(255 255 255 / 0.64);
```

Opacity may increase when the surface is large or the wallpaper is complex.

### Strong Functional Glass

Use for popovers, text-heavy toolbars, and floating panels.

```css
background: rgb(250 250 255 / 0.88);
backdrop-filter: blur(24px) saturate(145%);
```

### Dense Modal Glass

Use for dialogs, sheets, full-summary reading, and menus over artwork.

```css
background: rgb(252 252 255 / 0.94);
border: 1px solid rgb(255 255 255 / 0.60);
backdrop-filter: blur(32px) saturate(140%);
box-shadow:
  inset 0 1px rgb(255 255 255 / 0.60),
  0 28px 80px rgb(22 18 46 / 0.22);
```

Dark:

```css
background: rgb(31 27 42 / 0.94);
border-color: rgb(255 255 255 / 0.10);
```

### Glass Rules

- Use more opacity for larger surfaces and surfaces with more text.
- Do not stack several translucent surfaces without a neutral separator.
- Do not let character faces, costume lines, or wallpaper text remain sharply visible through a reading panel.
- Do not color multiple nearby glass controls with solid accent backgrounds.
- Use glass for functional hierarchy; use solid/high-opacity surfaces for repeated content.

## Color System

### Semantic Roles

- **Iris Indigo**: selection, current location, keyboard focus, primary action.
- **Periwinkle Ambient**: environmental glow and decorative continuity.
- **Emerald**: watched, completed, success.
- **Amber**: warning, airing attention, recoverable risk.
- **Coral Red**: destructive action, failure, irreversible risk.
- **Graphite**: text, structure, metadata, neutral controls.

Do not use green for primary navigation. Do not use purple for every hover state.

### Light Tokens

```css
--canvas: #f3f4f8;
--ambient: #eceefa;

--surface-solid: #ffffff;
--surface-glass: rgb(255 255 255 / 0.68);
--surface-glass-strong: rgb(255 255 255 / 0.86);
--surface-panel: rgb(250 250 253 / 0.82);
--surface-card: #ffffff;

--text-primary: #17171d;
--text-secondary: #686875;
--text-tertiary: #9595a1;

--accent-solid: #6657e8;
--accent-hover: #7567f0;
--accent-pressed: #5546c8;
--accent-ambient: #aaa5ff;
--accent-foreground: #ffffff;
--accent-soft: rgb(102 87 232 / 0.14);
--accent-glow: rgb(102 87 232 / 0.26);

--watched: #16a36a;
--warning: #d88500;
--destructive: #d84c57;
```

### Dark Tokens

```css
--canvas: #0d0c12;
--ambient: #14111e;

--surface-solid: #191720;
--surface-glass: rgb(24 21 33 / 0.72);
--surface-glass-strong: rgb(31 27 42 / 0.88);
--surface-panel: rgb(31 27 42 / 0.78);
--surface-card: #191720;
--surface-card-hover: #211e2a;

--text-primary: #f5f2fa;
--text-secondary: #bab5c5;
--text-tertiary: #898391;

--accent-solid: #7562e8;
--accent-hover: #8373f1;
--accent-pressed: #5f4ed0;
--accent-ambient: #9b8cff;
--accent-soft: rgb(155 140 255 / 0.18);
--accent-glow: rgb(155 140 255 / 0.28);

--watched: #36d18a;
```

### Color Rules Over Artwork

- Apply semantic tokens to UI, not sampled wallpaper colors.
- Use `--accent-ambient` for atmospheric light, never for body text.
- Use `--text-tertiary` only on sufficiently opaque surfaces.
- Pair watched green with a check, label, line, or shape.
- Pair warning and destructive colors with text or icons.
- Validate contrast on the final composited result, including wallpaper, scrim, glass, and foreground.

## Typography

Use the system sans-serif stack. Typography must remain readable over glass and at different viewport sizes.

### Shared Rules

- Prefer Regular, Medium, Semibold, and Bold.
- Avoid thin weights for small text.
- Body copy is generally `14px` to `16px` on desktop and `15px` to `17px` on mobile.
- Long reading text uses line-height from `1.65` to `1.8`.
- Metadata is secondary and must not carry essential meaning alone.
- Long titles wrap safely and usually clamp to two lines in constrained heroes/cards.
- At larger text scales, stack inline metadata instead of clipping or overlapping.

### Desktop Scale

- Page title: `30px` to `40px`.
- Detail hero title: `clamp(30px, 3.2vw, 52px)`.
- Section heading: `20px` to `24px`.
- Card title: `14px` to `16px`.
- Metadata: `12px` to `13px`.

### Mobile Scale

- Page title: `28px` to `34px`.
- Detail title: `28px` to `40px`.
- Section heading: `20px` to `24px`.
- Card title: `15px` to `17px`.
- Metadata: `12px` to `14px`.

These are ranges, not fixed values. Preserve role hierarchy at all text scales.

## Cross-Platform Strategy

Desktop and mobile share the design language but can use different information architecture and components.

### Shared Across Platforms

- semantic colors and status meaning;
- material hierarchy;
- icon family and writing tone;
- task outcome and API behavior;
- loading, success, error, and rollback semantics;
- accessibility expectations.

### Desktop Experience

- Use horizontal space intentionally.
- Support resizable windows, keyboard, pointer, and hover enhancement.
- Use persistent sidebar navigation.
- Keep useful secondary context visible in adjacent columns when space permits.
- Prefer anchored popovers, dialogs, inspectors, and side sheets.
- Test full, half, third, and compact window widths.

Desktop width guidance:

- App shell: up to about `1440px`.
- Library: `1280px` to `1440px`.
- Tracking: main queue plus recent activity when space permits.
- Search and statistics: about `1160px` to `1280px`.
- Settings: about `1120px` to `1240px`.

### Mobile Experience

- Use the Ani Tracker mobile top navigation as the primary mobile navigation pattern.
- Do not replace it with a bottom tab bar by default. Any navigation redesign must preserve the product's top-navigation identity and demonstrate a clear usability improvement.
- Respect safe-area insets, browser toolbars, orientation, and virtual keyboard.
- Use one primary column unless a compact two-column arrangement is clearly readable.
- Prioritize the current task and disclose secondary information progressively.
- Prefer bottom sheets or full-screen flows when desktop popovers become cramped.
- Keep important touch targets at least `44x44px`.
- Never require hover.
- Protect horizontal app gestures from browser back navigation and vertical scrolling conflicts.

Mobile page gutters are generally `16px` to `20px`, adjusted for safe areas.

### Platform Adaptation Contract

Every substantial feature must define both experiences.

Desktop questions:

- How is additional width used?
- What context remains visible while acting?
- How do keyboard and pointer users operate it?
- What happens in a resized window?

Mobile questions:

- What is the first visible task and action?
- What moves behind progressive disclosure?
- Does a popover become a bottom sheet or full-screen flow?
- Are targets, safe areas, and keyboard avoidance correct?
- Does the gesture coexist with browser and scroll gestures?

Responsive design is incomplete if only columns change while interaction remains desktop-oriented.

## Layout And Navigation

### Desktop Shell

- Persistent sidebar for primary destinations.
- Main content width depends on page type.
- Sticky/floating controls require a readable functional surface.
- Hide tertiary columns before compressing primary content beyond readability.

### Mobile Shell

- Top navigation is a stable part of the Ani Tracker mobile design language, not a temporary responsive fallback.
- The mobile top navigation provides primary destination access and must remain safe-area-aware, compact, and reachable.
- Secondary destinations and low-frequency actions can use menus, sheets, or contextual controls instead of overloading the top navigation.
- Fixed and sticky elements must include safe-area insets.
- Avoid consuming excessive vertical space with persistent chrome.

### Page Headers

Shared roles:

- optional eyebrow;
- title;
- optional description;
- optional actions.

Desktop can use centered or left-aligned compositions based on page purpose. Mobile may omit eyebrows, stack actions, or move low-priority actions to overflow. Preserve hierarchy, not exact geometry.

### Floating Pill Glass Bars

Ani Tracker frequently uses a compact, top-anchored pill-shaped glass bar for secondary navigation, view switching, filters, or other controls that must remain available while content scrolls. This is a defined Layer 3 Functional Glass pattern, not a decorative content surface.

Appropriate uses:

- secondary page categories, such as Settings sections;
- compact view or queue switching;
- a small group of closely related filters or tools;
- controls whose persistent availability materially improves the current task.

Do not use it for:

- page titles, descriptions, or ordinary content;
- long forms, dense toolbars, or unrelated action collections;
- every section header merely to create visual consistency;
- a second competing primary navigation system;
- controls that do not need to remain visible while scrolling.

Hierarchy and placement:

- The bar floats above the content layer and below the primary mobile top navigation.
- It must use the actual page scroll container as its sticky containing block.
- Its sticky offset must include the primary navigation height, safe-area inset, and a small visual gap when document scrolling is active.
- In an internal app scroll container that already begins below primary navigation, use only the local sticky inset.
- Reserve content space for the bar; it must not cover headings, focused fields, anchors, or validation messages.
- The bar must remain spatially stable while scrolling. Avoid resize, blur, scale, or vertical-position changes that cause visible jumping.
- Desktop may convert the same categories into a persistent vertical sidebar when that uses space more effectively.

Geometry:

- Mobile outer margin: generally `16px` to `20px`, including safe-area compensation.
- Mobile bar height: generally `44px` to `52px`, excluding an optional safe-area inset.
- Desktop compact bar height: generally `36px` to `44px`.
- Every mobile destination or action keeps at least a `44px` touch target even when its visible selection shape is smaller.
- Use pill geometry only when the bar reads as one compact control group. A multiline or tall container must use the normal panel radius instead.
- Prefer content-sized or purposefully constrained width. Full available width is acceptable for scrollable categories, but the bar must not look like a content card.

Material:

- Use Regular Functional Glass as the baseline: approximately `0.68` to `0.80` neutral surface opacity, `20px` blur, and `140%` to `155%` saturation.
- Combine translucency with a neutral veil, subtle border, one-pixel inner highlight, and medium elevation. Blur alone is never sufficient.
- Increase opacity when the wallpaper is bright, high-contrast, saturated, or compositionally dense.
- Keep resting labels monochromatic. Reserve Iris Indigo for current location, keyboard focus, or one primary action.
- Do not give every item an opaque accent fill. A selected item can use an Iris-tinted thumb or soft fill with text/icon reinforcement.
- Content must visibly pass behind the bar during scrolling, but never remain sharp enough to compete with labels.

Navigation and selection:

- Use `aria-current="page"` or the appropriate selected-state semantic for the current destination.
- Communicate current location with at least two cues, such as shape plus text/icon treatment; never rely on Iris color alone.
- Keep labels concise and use sentence case. Do not truncate the only information that distinguishes two destinations.
- Changing the selection must not unexpectedly move keyboard focus.
- When selection changes the visible pane without navigation, use the correct tabs or radio-group semantics instead of link semantics.

Horizontal overflow:

- A single row may scroll horizontally when categories do not fit. Never compress touch targets or force labels into unreadable widths.
- Hide the platform scrollbar only when direct touch/pointer scrolling remains available and overflow is otherwise discoverable through a partially visible next item, edge treatment, or equivalent cue.
- Use contained overscroll and proximity scroll snapping; do not hijack vertical page scrolling.
- Bring the selected item fully into view without an abrupt full-row jump.
- Support trackpad gestures and pointer-wheel horizontal scrolling where the platform provides them.
- If categories become numerous, hierarchical, or difficult to scan in one row, replace the bar with a menu, grouped list, drill-in page, or desktop sidebar rather than creating an excessively long carousel.

Accessibility and adaptation:

- Maintain at least `4.5:1` contrast for normal-size labels on the final wallpaper, scrim, and glass composite.
- Preserve a visible Iris semantic focus ring that is not clipped by the pill or scroll container.
- At 200% text size, allow the bar to grow or switch presentation; never clip labels or reduce touch targets.
- Under `prefers-reduced-transparency`, replace glass with a solid high-opacity functional surface while preserving border and hierarchy.
- Under `prefers-reduced-motion`, disable sliding, scaling, spring, and blur transitions; selection may update instantly or with a short fade.
- In forced-colors mode, preserve borders, current-location semantics, and focus without depending on translucency.

Reference implementation shape:

```css
.floating-pill-glass-bar {
  position: sticky;
  top: var(--resolved-sticky-offset);
  min-height: 44px;
  border: 1px solid var(--border-highlight);
  border-radius: var(--radius-pill);
  background: rgb(255 255 255 / 0.72);
  backdrop-filter: blur(20px) saturate(150%);
  box-shadow:
    inset 0 1px rgb(255 255 255 / 0.42),
    var(--shadow-medium);
}
```

This code is a semantic starting point, not a fixed visual recipe. Dark appearance, wallpaper complexity, reduced transparency, safe areas, and the active scroll mode must adjust the final composition.

## Component Language

### Buttons

Types:

- Primary: Iris Indigo background, white text.
- Secondary: neutral or glass supporting action.
- Outline: high-opacity neutral surface and border.
- Ghost: low-emphasis action.
- Destructive: destructive action only.
- Icon: square control with an accessible label.

Sizing:

- Small desktop control: around `32px`.
- Default desktop control: around `38px`.
- Large primary control: around `42px`.
- Important mobile target: at least `44x44px`.
- Desktop interactive area: generally at least `28x28px`.

Mobile and desktop variants may use different labels, padding, grouping, and placement.

### Focus

Do not expose browser-default black focus outlines in the polished UI. Replace them with a visible semantic focus style.

```css
outline: none;
border-color: rgb(102 87 232 / 0.52);
box-shadow: 0 0 0 4px rgb(102 87 232 / 0.14);
```

Focus must remain visible on buttons, links, segmented controls, select triggers, menus, settings, search, and episode actions.

### Segmented Control

- Use a shared moving thumb.
- Selected thumb uses Iris Indigo and white text.
- Track uses neutral functional glass.
- Use `radiogroup` for mutually exclusive choices.
- Use `tablist` only for actual tab panels.
- Support Arrow keys, Home, and End.
- Do not force all mutually exclusive choices into segmented controls when labels are long or options may grow.

### Select And Menus

- Match or exceed trigger width.
- Use dense glass over artwork.
- Use a subtle selected background plus check icon.
- Support Escape and outside dismissal where appropriate.
- Render through a portal when a rounded or clipped parent can cut the menu.
- On mobile, replace cramped anchored menus with a bottom sheet or full-screen choice flow when needed.

### Cards

- Repeated content cards use solid or high-opacity surfaces.
- Desktop hover may lift the card by about `2px` and subtly scale the poster.
- Hover must not reveal the only available action.
- Mobile cards can use a dedicated compact horizontal layout instead of a narrow desktop poster grid.
- Long titles and metadata must remain stable under localization and text scaling.

### Chips And Metadata

Use two visual levels:

- neutral metadata chip;
- semantic status/action chip.

Do not make provider, type, date, and episode count all look selected. “Next episode” may be stronger; “provider” should be quieter.

## Page Patterns

### Tracking List

Shared:

- protected swipe/drag watch interaction;
- queue summary;
- local-date grouping for recent watches;
- emerald watched state;
- visible watch-state button.

Desktop:

- main queue plus sticky recent-activity column when width permits;
- compact recent cards;
- segmented queue switching.

Mobile:

- dedicated single-column flow;
- tracking, backlog, and recent activity can use mobile-specific tabs or sections;
- preserve vertical scrolling during horizontal drag;
- keep touch actions visible and reachable.

### Anime Detail

This page is a status-driven control center, not a database record.

Priority:

1. Identity and status.
2. Summary excerpt.
3. Progress and next action.
4. Metadata.
5. Related series when present.
6. Episodes.

Desktop hero:

```css
grid-template-columns: clamp(180px, 17vw, 240px) minmax(0, 1fr);
grid-template-areas:
  "poster identity"
  "poster summary"
  "progress progress"
  "metadata metadata";
```

Mobile hero:

- recompose into a touch-friendly single-column hierarchy;
- keep status, progress, and primary action above low-priority metadata;
- use a smaller centered poster or compact poster/identity pairing when space permits;
- do not preserve desktop proportions if they create excessive scrolling.

Summary:

- hero shows a fixed excerpt;
- full summary never expands the hero;
- wide desktop opens a right-side reading sheet;
- narrow desktop uses a centered dialog;
- mobile uses a bottom sheet or full-screen reading view.

Hero artwork:

- artwork glow stays near poster and identity;
- a neutral veil protects text;
- glow fades before progress and metadata;
- metadata uses stable high-opacity surfaces.

Related series:

- filter out the current anime;
- render nothing when no other items remain;
- keep the section focused on content and navigation;
- maintenance belongs in the hero settings menu.

### Library

- Search/filter state remains URL-addressable.
- Desktop grid can use `repeat(auto-fill, minmax(190px, 1fr))`.
- Cards remain readable over the global wallpaper through high-opacity content surfaces.
- Desktop filters may use anchored controls.
- Mobile filters may use a dedicated sheet when a desktop popover is cramped.
- Mobile cards may use a compact composition rather than shrinking the desktop grid.

### Search

- Desktop can use horizontal result cards and anchored provider controls.
- Mobile can use stacked or compact media rows and keyboard-aware controls.
- Primary add action uses Iris Indigo.
- Already-added state becomes neutral or success, not another primary action.

### Statistics

- Watched/completion heatmaps use Emerald.
- Selection/focus uses Iris Indigo.
- Tooltips use functional glass.
- Desktop can show multiple charts side by side.
- Mobile prioritizes one chart at a time and replaces hover-only details with tap/focus behavior.

### Settings

- Group related settings.
- Avoid one oversized card per setting.
- Desktop may use category navigation plus a content pane.
- Mobile should use grouped lists, drill-in pages, or compact sections instead of a compressed split view.
- Auto-save confirmation should be transient rather than permanently repeated.

## Protected Episode Interaction

The episode watch toggle is protected product behavior and one of Ani Tracker's core episode-update interactions.

The horizontal card gesture is an intentional product choice inspired by the interaction experience of TV Time. It is not an incidental animation or optional visual flourish. It provides a fast, direct way to update episode state and is the recommended interaction for mobile users.

Ani Tracker also provides a visible checkbox-style state button. The gesture and checkbox are two first-class paths to the same episode state operation:

- Mobile users are encouraged to drag the episode card horizontally for fast updates.
- Users can always activate the checkbox-style button to set or clear watched state.
- Keyboard and assistive-technology users operate the checkbox-style button.
- Neither route may produce different data semantics, confirmation rules, or rollback behavior.

- Mobile drag threshold: `76px`.
- Desktop drag threshold: `224px`.
- Left drag marks watched.
- Right drag cancels watched.
- The API path remains `await onChange(next)`.
- Optimistic update and failure rollback remain intact.
- Mobile edge-back guard remains active.

The current implementation is the behavioral authority for detailed interaction rules:

- `web/src/components/library/EpisodeWatchToggle.tsx`
- `web/src/components/library/TrackingEpisodeRow.tsx`
- `web/src/components/library/EpisodeRow.tsx`

In particular, preserve the current direction detection, axis locking, edge-back guard, unavailable-direction handling, confirmation behavior, pending state, checkbox semantics, API call, and failure rollback unless a product decision explicitly changes them.

Visual structure:

- action background is behind content;
- content and its watch button move together;
- green confirms watched/completed state;
- purple may communicate interaction before completion.

Platform behavior can use separate implementations, but direction semantics and data behavior must remain identical. The mobile presentation should teach or make the drag affordance discoverable without requiring a blocking tutorial. The checkbox-style button remains visible as the precise and accessible alternative.

## Settings And Maintenance Hierarchy

Normal content choices and rare maintenance tools must be separated.

Anime hero settings:

- Content display: change title, change poster, choose summary language.
- Data maintenance: refresh upstream information, redetect same-series works, manually fix series links.

Manual relationship repair is an exception path.

Recommended label:

```text
Manually fix series links
Use only when automatic matching is wrong
```

## Motion

Motion explains state and spatial relationship.

Timing:

- Fast feedback: `120ms` to `160ms`.
- Standard transition: `180ms` to `220ms`.
- Sheet/dialog entrance: `220ms` to `260ms`.

Easing:

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-emphasized: cubic-bezier(0.2, 0.8, 0.2, 1);
```

Desktop motion can emphasize hover and anchored origin. Mobile motion can emphasize direct manipulation, sheets, and navigation continuity.

Avoid:

- continuous wallpaper motion;
- visible wallpaper parallax by default;
- excessive blur animation;
- page-wide re-fades after routine state changes;
- strong bounce unrelated to a gesture;
- motion that delays the next action.

Under reduced motion, replace nonessential translation/scale with a short fade or no animation.

## Accessibility

- Composite text contrast must account for wallpaper, scrim, glass, and foreground.
- Text below 18pt should target at least `4.5:1` contrast.
- Important mobile targets must be at least `44x44px`.
- Desktop controls should generally be at least `28x28px`.
- State requires text, shape, or icon in addition to color.
- Keyboard navigation must not require hover.
- Dialogs and sheets need clear labels, close actions, and focus handling.
- Escape closes transient desktop overlays where appropriate.
- Mobile overlays respect safe areas and virtual keyboards.
- Text scaling must not overlap controls or hide essential information.
- Reduced transparency uses solid surfaces.
- Reduced motion removes nonessential motion.
- Core gestures always have visible alternatives.

## Implementation Rules

### Semantic Tokens First

Use semantic tokens for color, surfaces, borders, text, status, shadows, radii, and motion. Avoid component-local colors that duplicate token meaning.

### Portal Rule

Render through `document.body` when an overlay:

- sits inside an `overflow: hidden` or clipped parent;
- must escape a rounded hero/card;
- needs stable z-index over artwork and metadata;
- needs viewport collision handling.

Desktop and mobile may share overlay content while using different shells.

### Radius Scale

- Small/default control: `10px` to `12px`.
- Input: around `16px`.
- Content card: around `18px`.
- Panel: around `24px`.
- Dialog/sheet: around `28px`.
- Pill: segmented controls, tags, and explicit pill semantics only.

### Shadow Scale

```css
--shadow-low:
  0 1px 2px rgb(18 20 32 / 0.05),
  0 8px 24px rgb(18 20 32 / 0.06);

--shadow-medium:
  0 2px 6px rgb(18 20 32 / 0.06),
  0 16px 40px rgb(18 20 32 / 0.10);

--shadow-high:
  0 8px 24px rgb(18 20 32 / 0.12),
  0 34px 90px rgb(18 20 32 / 0.18);
```

Dark mode relies more on surface luminance, subtle borders, and one-pixel inner highlights than on large dark shadows.

## Validation Matrix

Every substantial visual change must be checked against:

### Wallpaper Cases

- bright/high-key illustration;
- dark/low-key illustration;
- highly saturated multicolor illustration;
- dense character detail behind navigation;
- strong black/white edges behind text;
- default Twilight Iris fallback.

### Appearance Cases

- light mode;
- dark mode;
- reduced transparency;
- reduced motion;
- increased browser text scale.

### Platform Cases

- wide desktop;
- half-width desktop window;
- compact desktop/tablet-like width;
- narrow mobile portrait;
- mobile landscape where supported;
- touch and pointer input;
- keyboard-only navigation.

### Content Cases

- very long title;
- very long summary;
- missing poster;
- missing metadata;
- empty related series;
- many episodes;
- loading, error, and optimistic rollback states.

## Do And Do Not

### Do

- Treat user artwork as a foundational environment constraint.
- Keep wallpaper visible while protecting all task-critical content.
- Use glass to separate functional layers from artwork and content.
- Increase opacity as text density and surface size increase.
- Use Iris Indigo for selection, focus, and primary action.
- Use Emerald for watched/completed state.
- Design desktop and mobile flows independently where needed.
- Use platform-appropriate overlays and navigation.
- Provide alternatives to gestures and hover.
- Test the final composite over extreme wallpapers.

### Do Not

- Do not place body text directly on raw wallpaper.
- Do not use blur alone as a contrast solution.
- Do not put heavy glass on every repeated content card.
- Do not let wallpaper detail remain sharply visible through reading surfaces.
- Do not derive the product accent from each wallpaper.
- Do not use green for general selection.
- Do not use purple for every hover or control background.
- Do not treat mobile as a compressed desktop layout.
- Do not treat desktop as a widened mobile layout.
- Do not hide essential actions behind hover.
- Do not alter protected watch-swipe semantics without explicit product approval.

## Product Identity

Ani Tracker is a focused media productivity app that lets personal anime artwork remain part of the experience without sacrificing clarity.

The design language is not generic glassmorphism. It is an adaptive layered system:

- user artwork provides identity;
- the adaptive environment controls visual noise;
- content surfaces protect reading;
- functional glass establishes control hierarchy;
- Iris Indigo communicates orientation and action;
- Emerald confirms completion;
- platform-specific composition makes desktop and mobile each feel intentional.

Future design work must preserve this hierarchy, follow Apple design principles, and be evaluated separately for desktop and mobile before it is considered complete.
