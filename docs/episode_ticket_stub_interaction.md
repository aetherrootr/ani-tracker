# Ani Tracker Ticket-Stub Swipe Episode Watch Interaction

## Document Authority

This document is the canonical product and interaction specification for marking an episode watched or unwatched through Ani Tracker's ticket-stub swipe control.

- The English document at `docs/episode_ticket_stub_interaction.md` is the source of truth.
- The Chinese document at `docs/episode_ticket_stub_interaction.zh-CN.md` is a reference translation.
- If the two documents differ, follow the English document.
- This specification extends `docs/design_style.md` and is authoritative for the ticket-stub swipe interaction.
- Business rules may determine whether a specific episode can change state, but they must not silently change the interaction semantics defined here.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** indicate requirement strength.

## Purpose

The ticket-stub swipe is Ani Tracker's signature way to update episode watch state. Its visual metaphor is a perforated cinema ticket, while its gesture model is direct manipulation of the complete ticket as one rigid surface. Sliding the ticket toward the semantic leading edge records that the episode has been watched.

The interaction MUST provide fast episode management using an Ani Tracker-specific, local-first, accessible treatment consistent with the Twilight Iris design language.

The control exists to make a frequent task:

- fast enough for repeated use;
- satisfying without becoming theatrical;
- predictable before release;
- easy to cancel;
- equally possible without a gesture;
- safe under latency and failure;
- usable while vertically scrolling a long episode list.

## Product Principles

### Direct Manipulation

The complete ticket, including its body, perforation, stub, and state control, follows the pointer or finger with no perceptible lag and approximately one-to-one translation before the threshold. The interface continuously shows the action that would occur if the person released at the current position.

### Reversible Commitment

Crossing a threshold arms an action; it does not commit immediately. The action commits only on release while armed. Moving back before release cancels it.

### One State, Multiple Equal Paths

Drag, visible state button, keyboard, screen reader, voice control, and supported accessibility actions all set the same explicit boolean state. The gesture is the fastest path, not the only path.

### Ticket Metaphor, Not Simulation

The interface suggests a perforated cinema ticket through its silhouette, dashed line, circular notches, and trailing stub region. The perforation is visual structure, not a mechanical hinge: the body and stub **MUST NOT** separate during direct manipulation.

### Scroll First Until Intent Is Clear

Vertical scrolling remains available until horizontal intent is unambiguous. A diagonal or uncertain movement must not unexpectedly change episode state.

### Honest Feedback

Optimistic feedback may make the interface feel immediate, but pending, confirmed, failed, and rolled-back states must remain distinguishable and truthful.

## Terminology

### Ticket

The complete episode row, including the main ticket body and trailing stub.

### Next Episode Ticket Stack

A dedicated surface that presents episodes from one Ani Tracker anime entry as a stack: the current eligible episode occupies the Front Layer and the following episode from that same anime occupies the Depth Underlayer. It advances only within the current anime's episode sequence; it is neither a cross-anime queue nor the default presentation for a browsable episode list.

### Front Layer And Depth Underlayer

The **Front Layer** is the ticket layer visually closest to the person. The **Depth Underlayer** shares the same screen-space `x/y` slot but sits farther from the person along the display plane's depth axis.

- “Depth Underlayer”, “behind”, and “revealed from the Depth Underlayer” describe visual `z`-order.
- They **MUST NOT** mean the lower screen edge, positive screen-space `y`, or a ticket entering vertically from the bottom of the display or row.
- A small screen-space offset, scale reduction, lower elevation, or reduced emphasis **MAY** indicate depth, but that offset does not redefine the source direction.
- When the Front Layer leaves, the Depth Underlayer is revealed in place and advances visually toward the Front Layer.

### Ticket Body

The content region containing episode number, title, secondary title, airing information, duration, and semantic badges.

### Stub

The visually distinct trailing region that contains the visible watched-state control. It suggests a cinema-ticket stub at rest but remains structurally attached to the Ticket during every gesture and transition.

### Perforation

The dashed vertical boundary and circular edge notches between body and stub. It establishes the cinema-ticket identity but does not represent a moving joint or actual separation.

### Action Rail

The semantic layer behind the ticket that appears during horizontal drag. It previews the target action.

### Armed

The drag has crossed the commit threshold. Releasing now requests the previewed state.

### Committed

The person released while armed and the client issued an explicit state request.

### Confirmed

The server accepted the requested state.

## Semantic Direction

Directions are semantic, not permanently physical:

- Dragging the complete ticket **toward the leading edge** marks an unwatched episode as watched.
- Dragging the complete ticket **toward the trailing edge** restores a watched episode to unwatched.
- In left-to-right layouts, leading is left and trailing is right.
- In right-to-left layouts, leading is right and trailing is left.

The stub remains on the semantic trailing edge. Copy, icons, gradients, and motion must mirror with layout direction.

This mapping creates a consistent direct-manipulation model: slide the complete ticket toward leading to process it as watched; slide it toward trailing to restore it as unwatched. The system-edge protection defined below remains authoritative and must not be weakened to shorten the gesture.

## Visual Anatomy

### Overall Ticket Surface

The ticket is a Layer 2 content surface.

- It MUST use a solid or high-opacity surface.
- It MUST remain legible over bright, dark, saturated, and detailed wallpapers.
- It MUST NOT depend on backdrop blur for text contrast.
- It SHOULD use the standard content-card radius, approximately `18px`.
- It SHOULD use a subtle border and low elevation at rest.
- Every ticket in the same list or stack presentation **MUST** use the same height token. Content length and state changes **MUST NOT** change an individual ticket's height.

Recommended fixed ticket metrics at standard text sizes:

| Context | Fixed height | Horizontal padding | Gap |
|---|---:|---:|---:|
| Mobile portrait | `96px` | `12px` | `10px` |
| Mobile landscape | `96px` | `14-16px` | `10-12px` |
| Desktop compact | `88px` | `14-16px` | `10-12px` |
| Desktop comfortable | `104px` | `16-18px` | `12px` |

At 200% text size, the entire presentation switches to a shared Accessibility Height Tier: recommended `144px` on mobile and `128px` on desktop. A breakpoint or text-size change may select a different shared token, but one long title **MUST NOT** make only its own ticket taller.

### Ticket Body

The body contains the episode's identity and supporting metadata.

Reading priority:

1. Episode number and display title.
2. Next, watched, upcoming, or unavailable state.
3. Air date/time and duration.
4. Original title or lower-priority metadata.

Rules:

- The main title SHOULD use `15-17px` on mobile and `14-16px` on desktop.
- The main title SHOULD retain up to two lines where space permits. The compact mobile tier MAY use one line after reducing the title to no less than `15px`.
- Long titles **MUST** use a one- or two-line clamp and ellipsis within the fixed height. The complete title MUST remain available through the accessible name and a directly activatable episode title or detail destination.
- Essential identity MUST NOT disappear during drag.
- Lower-priority metadata progressively hides or condenses before title, state, or controls are clipped. Metadata may fade slightly during drag, but primary text must remain readable.
- The body MUST NOT become a single giant button because it may contain links or selectable text.

### Poster Artwork

A ticket **MAY** include the anime entry's selected poster inside the Ticket Body. Poster artwork MUST use the anime entry's selected poster source. Episode-specific artwork MAY be used only when the product defines an authoritative episode-artwork source.

- The poster well **MUST** use a `2:3` portrait aspect ratio.
- The image **MUST** preserve its intrinsic aspect ratio and **MUST NOT** stretch. A cover crop **MAY** fill the `2:3` well when necessary, with a stable focal position.
- Suggested poster widths are `44-56px` in compact ticket rows and `64-80px` in dedicated stack presentations. The poster scales within the selected fixed height; it **MUST NOT** expand one ticket or force text or controls to overlap.
- Missing, failed, or unavailable artwork **MUST** use a neutral `2:3` placeholder with identical geometry so that loading and failure do not shift layout.
- The poster **MUST NOT** be an anchor, navigation control, or independent drag-and-drop source. Clicking, tapping, or dragging it **MUST NOT** open the image URL or navigate to the anime.
- On the web, the image **MUST** set `draggable="false"` or provide equivalent native-drag suppression. It **MUST NOT** expose a browser drag preview, URL payload, or file payload.
- Because the poster is noninteractive, a watch-state drag **MAY** begin over it and is handled by the Ticket Body. The poster must not stop or reinterpret the ticket gesture.
- If the adjacent episode text already supplies the same identity, the poster **SHOULD** be ignored by screen readers to avoid duplicate output. Otherwise, it uses a concise descriptive alternative without action wording.
- In a Next Episode Ticket Stack, Front Layer and Depth Underlayer posters **MUST** retain the same `2:3` well and crop behavior. The Depth Underlayer may receive the same restrained scale and emphasis changes as its ticket, but the poster **MUST NOT** animate independently or create parallax.
- Poster loading, decoding, or replacement **MUST NOT** interrupt an active gesture, change the commit threshold, or alter the ticket's row slot.

### Stub

The stub is always visible. It is not revealed only on hover or drag.

Recommended dimensions:

| Context | Stub width | State-control target |
|---|---:|---:|
| Mobile | `60-68px` | at least `44x44px` |
| Desktop | `52-60px` | at least `32x32px`, never below `28x28px` |

The stub:

- MUST contain a visible watched-state control.
- MUST share the ticket's base surface at rest.
- SHOULD use a slightly different luminosity or a subtle neutral veil to clarify its role.
- MUST NOT look like a separate destructive-action pane.
- **MUST** translate with the Ticket Body at the same distance and velocity throughout drag, cancellation, commit, and rollback.
- **MUST NOT** remain fixed, lag behind, stretch, rotate independently, or change its spacing relative to the body.

### Perforation

The perforation is the primary visual affordance for the cinema-ticket metaphor.

It SHOULD combine:

- a subtle dashed or dotted vertical divider;
- one small semicircular notch at the top and bottom edge;
- a neutral color at rest;
- a restrained emphasis change as drag progress grows, if needed.

It MUST NOT:

- use a dense photorealistic paper texture;
- reduce the state-control hit target;
- create visual noise behind text;
- rely on color alone;
- disappear in dark, high-contrast, or reduced-transparency modes.
- open into a gap, stretch, or move independently during drag.

### State Control

The visible stub control is a checkbox-style control with a circular bezel. It **MUST** remain circular across unwatched, watched, pending, and unavailable states; state changes affect the inner glyph and semantic feedback, not the bezel shape.

Visible-label policy:

- On mobile, the stub **SHOULD NOT** show a persistent “Unwatched” or “Watched” text label beneath the circular control when the control meets this specification. The circle is centered in the stub and retains its full `44x44px` target.
- Removing the visible label **MUST NOT** remove the accessible name, checked state, action-rail label, live announcement, or noncolor state cues.
- On desktop, hover or keyboard focus **MAY** show a concise action tooltip such as “Mark watched” or “Mark unwatched”. The tooltip supplements the control and is never the only explanation.
- Pending, unavailable, and failed states retain their progress, lock/unavailable, or error glyphs even when persistent state text is absent.
- A wider, simplified-access, or explicitly high-clarity presentation **MAY** show a visible state label, but it **MUST NOT** reduce the control target, increase only one ticket's height, or crowd the perforation.

Unwatched:

- neutral high-opacity surface;
- visible border;
- empty center;
- accessible label describes the action and current state.

Watched:

- Emerald fill or strong Emerald border;
- white or high-contrast check glyph;
- persistent text/shape semantics elsewhere in the row when space permits;
- no reliance on Emerald alone.

Pending:

- check or empty state remains visible according to the optimistic target;
- a small progress indicator replaces or surrounds the glyph;
- the control is disabled only for the affected episode.

Failed:

- the row returns to the last confirmed state;
- an error glyph and nearby retry action appear outside the stub if necessary;
- the stub must not contain a paragraph of error text.

### Action Rail

The action rail sits behind the ticket and never shifts surrounding rows.

Mark watched rail:

- uses semantic Emerald;
- contains a check glyph and the localized label “Mark watched”;
- reveals from the trailing side as the complete ticket moves toward leading;
- becomes visually stronger as progress approaches the threshold.

Mark unwatched rail:

- uses a neutral surface with an undo/restore glyph;
- MAY use a restrained Iris tint for interaction intent;
- MUST NOT use destructive red because restoring unwatched is reversible, not destructive;
- contains the localized label “Mark unwatched”.

Unavailable rail:

- uses a neutral disabled surface;
- contains a lock, clock, or unavailable glyph plus a reason;
- resists movement and never appears armed.

Rail text MUST remain secondary to direct visual feedback. On very narrow rows, the glyph may remain while the full label appears above the row or in an accessible status region.

## Resting States

### Unwatched

- Neutral ticket surface.
- Intact perforation.
- Empty visible state control.
- No persistent Iris fill.
- “Next episode” MAY use an Iris badge because it represents priority, not watch state.

### Watched

- Very light Emerald surface tint, generally `4-8%` over the content surface.
- Emerald border or leading status line at low emphasis.
- Checked stub control.
- Optional “Watched” label.
- Perforation may gain a subtle completed-state emphasis, but it remains closed and body and stub remain one continuous ticket surface.
- Text retains normal contrast and must not be reduced through whole-row opacity.

### Upcoming Or Restricted

- Primary text remains readable.
- A clear “Upcoming”, “Unavailable”, or equivalent label is present.
- The state control communicates availability.
- If product rules permit marking watched with confirmation, the control remains operable and announces that confirmation will be required.
- If product rules forbid the action, both gesture and button are unavailable for the same reason.

## Presentation Modes

### Standard Episode List

The standard episode list is the default presentation for browsing, comparison, bulk review, and restoring watched episodes to unwatched.

- Each ticket **MUST** retain its list position after a state change.
- Marking watched **MAY** use a same-slot stack transition: the complete ticket continues toward leading until it leaves the row's clipping viewport, revealing the watched version of that same episode from the Depth Underlayer in the original row position.
- The revealed ticket **MUST** preserve the same episode identity, list index, row slot, and surrounding context. This is a state-transition animation, not list reordering or advancement to another episode.
- The revealed ticket **MUST** include its own attached stub and checked state control as one continuous surface.
- Restoring unwatched **MUST** move the complete ticket as one surface and resolve to the unwatched resting state in place.
- Dragging or committing one row **MUST NOT** shift, remove, replace, or reorder surrounding rows.
- The list **MUST** preserve scroll position and episode context after success or rollback.

### Next Episode Ticket Stack

The Next Episode Ticket Stack **MAY** be used only in a dedicated surface for one anime entry where advancing to that anime's following episode is the primary task.

- The stack is scoped to the anime entry currently being viewed and contains only that anime's eligible unwatched episodes in authoritative episode order.
- It **MUST NOT** include episodes from another anime entry, related work, sequel, separately tracked season, or global next-to-watch queue.
- The current episode is the only fully exposed and operable top ticket.
- At least part of the next eligible episode ticket from the same anime **SHOULD** be visible in the Depth Underlayer before interaction, using restrained depth, an offset of approximately `6-10px`, and no more than `1-2%` scale reduction.
- The stack viewport **MUST** keep a stable height and clip outgoing content without causing page layout shift.
- Marking the top ticket watched advances the stack. After committed drag release or checkbox activation, the complete ticket continues toward leading until it leaves the stack viewport; the next ticket is revealed in place from the Depth Underlayer and advances to the Front Layer.
- The outgoing ticket need only leave the stack viewport, not travel to the physical edge of the screen.
- The checked stub leaves as part of the complete outgoing ticket. It **MUST NOT** remain fixed or become orphaned interface content.
- Marking unwatched is not an advancement gesture in this mode. Restoring a previous episode to unwatched remains available in the standard episode list or viewing history.
- Activating the top ticket's visible checkbox follows the same stack advancement as dragging.
- If no next eligible episode exists within the current anime, success reveals a stable completion or empty state rather than a blank ticket-shaped hole. Moving to another anime requires a separate, explicit navigation action.
- A standard episode list may reuse the same-slot exit-and-depth-reveal motion, but it **MUST NOT** replace the row with a different episode or change episode ordering. Only the dedicated Next Episode Ticket Stack advances episode identity.

## Gesture Recognition

### Eligible Start Area

On mobile, horizontal drag may begin from any area of the complete ticket, including the title link and visible state control, using tap-versus-drag arbitration.

An unlinked poster is part of this eligible start area. Native image dragging must remain suppressed so the ticket gesture receives the pointer sequence.

For an interactive start target:

- movement within the undecided slop retains the target's ordinary tap behavior;
- once horizontal intent wins, the ticket gesture takes ownership and suppresses the target's synthesized click, checkbox change, or navigation;
- vertical intent preserves normal scrolling and does not activate the target after a scroll gesture;
- menus, disclosure controls, text-entry controls, and the protected system-edge region remain ineligible;
- active text selection remains ineligible on platforms where text selection is supported.

On desktop, the visible state button is the primary precise control. Pointer drag MAY start from noninteractive ticket space, but the cursor must communicate that the region is draggable. Two-finger trackpad scrolling MUST NOT be hijacked as a state-changing gesture.

### Initial Slop

Before axis lock, the ticket does not move.

Recommended slop:

- Mobile: `5-6px`.
- Desktop pointer: `5-6px`.

Small movement within this radius is treated as a tap or scroll preparation, not a drag.

### Axis Lock

The gesture begins in an undecided state.

Horizontal intent wins only when the platform-specific lock distance and directional bias are satisfied:

```text
abs(deltaX) >= horizontalLockDistance
and
abs(deltaX) >= abs(deltaY) * axisRatio
```

Recommended values:

- Mobile: `horizontalLockDistance = 5px`, `axisRatio = 1.12`.
- Desktop: `horizontalLockDistance = 6px`, `axisRatio = 1.2`.

On mobile, vertical intent wins only when all of the following are true: `abs(deltaY) >= 8px`, `abs(deltaX) <= 28px`, and `abs(deltaY) > abs(deltaX) * 1.12`. This deliberate horizontal bias prevents small vertical finger drift from repeatedly stealing an intended ticket swipe. Desktop vertical intent wins after at least `12px` of vertical movement and when vertical movement exceeds horizontal movement by the desktop axis ratio. Once vertical intent wins:

- the ticket returns to rest if it moved at all;
- the horizontal gesture is abandoned for that pointer sequence;
- normal page scrolling continues;
- no state feedback or haptic plays.

After horizontal lock, the control **MUST** retain ownership of the active gesture through pointer capture or equivalent window-level pointer tracking, and lock vertical scrolling for the entire active viewport and relevant nested scroll container. This lock applies only to that pointer sequence and remains active until release, cancellation, navigation interruption, or another defined cancellation condition.

- The lock begins only after horizontal intent wins; it **MUST NOT** begin on pointer down or during the undecided slop phase.
- Activating the lock **MUST NOT** change the existing scroll position, trigger overscroll, or move page content.
- While locked, vertical finger drift **MUST NOT** scroll the page or transfer control back to a vertical scroller.
- The lock **MUST** be released synchronously on every completion and cancellation path, including component unmount and visibility/navigation changes.
- Releasing the pointer after commit immediately restores normal scrolling; the completion animation **MUST NOT** keep the viewport locked.

### System Edge Protection

On mobile, a drag starting within the platform's protected back-gesture edge MUST remain available to the browser or native navigation system.

Recommended protected region:

- at least `24px` from the active system-back edge;
- larger when platform safe-area or browser behavior requires it.

The control MUST NOT delay, block, or imitate the system back gesture.

### Drag Resistance

Movement is approximately one-to-one before the threshold.

- The complete ticket follows horizontal input directly, including the body, poster, perforation, stub, and state control.
- Every visible point on the ticket translates by the same horizontal distance; the gesture must not create internal separation or make the finger outrun the stub.
- After the threshold, additional movement uses increasing resistance.
- Maximum visual travel SHOULD be limited to about `1.12` times the threshold.
- Dragging toward an unavailable action uses strong resistance and caps at `20-28px` on mobile or `24-36px` on desktop.

### Commit Threshold

Mobile uses a stable, thumb-reachable interaction distance. Desktop adapts to the actual draggable width because pointer travel and card widths vary more substantially.

Recommended formula:

```text
mobile threshold  = 76px
desktop threshold = clamp(96px, 18% of draggable width, 160px)
```

Requirements:

- The threshold MUST be large enough to avoid accidental activation during vertical scrolling.
- It MUST remain reachable with one comfortable thumb movement on mobile.
- The desktop threshold MUST be based on the ticket's actual width, not only viewport width. The mobile threshold intentionally remains stable across ordinary phone widths.
- Crossing the threshold arms the action but does not commit it.
- A fast flick MUST NOT commit solely from velocity; minimum displacement is always required.

### Hysteresis

To prevent armed-state flicker:

- enter Armed at the full threshold;
- leave Armed only after moving back approximately `10-14px` below the threshold on touch, or `20-24px` for a desktop pointer where release recoil is more common.

The visual label and haptic follow armed-state changes, not every pixel.

### Release

Release while unarmed:

- cancels the action;
- returns the body to rest;
- does not call the state API;
- does not announce failure or success.

Release while armed:

- computes an explicit target state;
- begins the commit animation;
- sends an idempotent “set watched true/false” request;
- never sends a context-free toggle request.

### Cancellation

The gesture cancels on:

- pointer cancellation;
- loss of the active pointer;
- a second pointer appearing;
- page/navigation interruption;
- Escape on desktop during an active pointer drag;
- movement back below the hysteresis boundary before release.

Cancellation returns to the last confirmed state without an error message.

## State Machine

The control must implement explicit states rather than infer everything from animation classes.

| State | Meaning | User input | Visual response | Data action |
|---|---|---|---|---|
| `unwatched` | Last confirmed state is unwatched | Tap control or drag leading | Empty stub, neutral ticket | None until commit |
| `watched` | Last confirmed state is watched | Tap control or drag trailing | Checked stub, Emerald cues | None until commit |
| `tracking` | Axis locked, below threshold | Continue, reverse, release | Complete ticket follows input; rail previews | None |
| `armed-watched` | Release will mark watched | Reverse or release | Strong Emerald rail, check, threshold feedback | None |
| `armed-unwatched` | Release will restore unwatched | Reverse or release | Neutral restore rail, undo glyph | None |
| `confirming` | Business rule requires confirmation | Confirm or cancel | Ticket returns to rest; focused confirmation UI | None until confirm |
| `pending-watched` | Watched request in flight | Retry blocked; other rows usable | Optimistic watched state or stack advance + progress | Set `watched=true` |
| `pending-unwatched` | Unwatched request in flight | Retry blocked; other rows usable | Optimistic unwatched state + progress | Set `watched=false` |
| `confirmed` | Server accepted target | Any normal input after feedback | Brief success confirmation, then resting state | None |
| `failed` | Server rejected or request failed | Retry or dismiss | Rollback + inline error/retry | Retry explicit target |
| `unavailable` | Target action is not permitted | Explore reason | Resistance + reason; disabled precise control if fully unavailable | None |

Only one state-changing request may be active per episode. Updating one episode **MUST NOT** disable unrelated episode rows. The only exception is the newly exposed top ticket inside the same composite Next Episode Ticket Stack, which is temporarily held against another advancement until the outgoing request resolves; rows outside that stack remain usable.

## Confirmation Rules

Routine watched/unwatched changes are reversible and SHOULD NOT open a confirmation dialog.

Confirmation MAY be required when the action is exceptional, for example marking a future unaired episode watched.

When confirmation is required:

- crossing and releasing the threshold opens confirmation; it does not optimistically update first;
- the ticket returns to rest before confirmation appears;
- the dialog or sheet names the episode and consequence;
- Cancel restores focus to the ticket's state control;
- Confirm uses the same explicit state API as every other path;
- gesture and visible button follow identical confirmation rules.

Do not require confirmation merely because a person uses a gesture.

## Visible State Button

The stub control is a first-class route to the same operation.

### Semantics

The control uses Ani Tracker's fixed circular visual treatment defined in Visual Anatomy; it does not use the browser's default checkbox appearance. On the web, a native `<input type="checkbox">` **MUST** remain the operable semantic control and be styled to produce that treatment. “Native” describes its behavior and accessibility foundation, not its visual appearance.

- The visual treatment **MUST** use the relevant surface, Graphite, Emerald, and Iris tokens from `docs/design_style.md`.
- A `div`, generic button, or other element with recreated checkbox semantics **MUST NOT** replace the native input when the native input is available.
- A non-web implementation **MUST** expose the platform's equivalent checkbox semantics and the same visible circular treatment.

- Accessible role: checkbox.
- Accessible state: checked/unchecked.
- Accessible name identifies the field without duplicating its value, for example “Episode 4 watch state”. The native checked/unchecked state communicates the current value.
- The surrounding card MUST NOT also have a conflicting interactive role.

### Activation

- Tap/click toggles to the explicit opposite state.
- On mobile, a touch beginning on the checkbox remains a checkbox activation only while it stays within tap slop; horizontal axis lock converts the sequence into a ticket drag and suppresses checkbox activation.
- Space activates a focused native checkbox.
- Activation follows the same pending, confirmation, success, failure, and rollback rules as drag.
- Equal data semantics do not require identical motion. Checkbox activation is the concise path: in a standard list it updates the ticket in place without the full exit-and-depth-reveal sequence.
- In a Next Episode Ticket Stack, checkbox activation still advances episode identity, but it uses a concise crossfade/depth handoff rather than the full gesture-driven departure.

### Focus

- Mobile target is at least `44x44px`.
- Desktop target is preferably `32x32px`, never below `28x28px`.
- Focus uses the semantic Iris ring.
- Focus must not be clipped by ticket overflow.
- Focus order follows visual reading order and does not enter decorative perforation elements.

## Data And Network Behavior

### Explicit, Idempotent Mutation

The client sends the intended final value:

```text
setEpisodeWatched(episodeId, true)
setEpisodeWatched(episodeId, false)
```

It MUST NOT send “toggle” because retries, race conditions, and duplicate delivery could produce the wrong state.

### Optimistic Update

For routine allowed actions:

1. Preserve the last confirmed state.
2. Apply the requested state optimistically after armed release.
3. Mark only that episode pending.
4. Send the explicit request.
5. Confirm or roll back based on the response.

In a Next Episode Ticket Stack, the visual advance may occur optimistically, but the newly exposed ticket **MUST NOT** accept another stack-advance action until the outgoing episode request resolves. This temporary serialization applies only to the composite stack; unrelated rows and controls elsewhere remain usable.

### Success

- Transition pending to confirmed.
- Announce the result once through a polite live region.
- Update aggregate progress and next-episode context from the authoritative response.
- Do not show a blocking alert or page-wide celebration.
- In a Next Episode Ticket Stack, finalize the new top ticket and update its accessible identity from the authoritative response.

### Failure

- Roll back to the last confirmed state.
- Show an associated inline error directly below the fixed-height ticket surface. The error region may expand the list item but **MUST NOT** change the ticket surface height or overlap its controls.
- Explain that the update failed and provide Retry.
- Retry sends the same explicit target, not the opposite of the rolled-back UI.
- Preserve scroll position.
- Announce rollback and retry availability once.
- In a Next Episode Ticket Stack, return the outgoing ticket from the same direction and recede the previewed next ticket to the Depth Underlayer. The stack must restore the original top episode and ordering without changing page position.
- In a standard list that completed a same-slot transition optimistically, restore the unwatched representation in the same row slot with a short reverse transition or crossfade; do not replay the full commit animation.

### Race Handling

- Duplicate input while pending is ignored for that episode.
- Stale responses must not overwrite a newer confirmed state.
- Navigation or virtualization must not lose the pending operation.
- If a server response includes authoritative progress, use it instead of independently guessing aggregate counts.

### Offline

If offline mutation queuing is not explicitly supported, the interface MUST fail honestly and roll back. It must not display a permanent watched state that has not been saved.

If queuing is supported, queued state must have a distinct label and a visible way to inspect or retry synchronization.

## Motion Specification

### Direct Tracking

While dragging:

- the complete ticket translates with the pointer without easing;
- no CSS transition delays direct manipulation;
- the complete ticket may scale down no more than `0.5-0.8%` as one unit;
- the body, perforation, stub, poster, and state control maintain fixed internal geometry;
- the perforation may change contrast slightly but never opens into a gap;
- rail opacity and icon scale interpolate continuously;
- blur MUST NOT animate.

### Threshold Feedback

When entering Armed:

- rail reaches full semantic emphasis;
- action glyph settles into its committed preview shape;
- a short optional selection haptic plays on supported devices;
- the label changes from instructional to definitive, such as “Release to mark watched”.

When leaving Armed, these changes reverse immediately without playing repeated noisy feedback.

### Cancel Return

- Duration: `180-220ms`.
- Easing: `--ease-standard`, approximately `cubic-bezier(0.2, 0, 0, 1)`.
- No bounce.
- The complete ticket returns to rest as one rigid surface.

### Commit Swipe

- Standard-list same-slot transition duration: `300-360ms` total. This slightly longer duration keeps the same-slot Depth Underlayer handoff legible in mobile browsers and installed web apps without becoming a blocking celebration.
- Next Episode Ticket Stack gesture transition duration: `280-340ms` total.
- Checkbox state feedback duration: `120-180ms`; a checkbox-triggered stack handoff **SHOULD NOT** exceed `220ms`.
- Easing: `--ease-emphasized`, approximately `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- The complete ticket continues in the committed semantic direction; all internal regions retain fixed relative positions.
- The state control resolves to its target glyph in `120-160ms`; the perforation remains intact.
- In a standard episode list using the same-slot stack transition, the complete ticket exits through the leading side of that row's clipping viewport. The watched representation of the same episode is revealed from the Depth Underlayer as another complete ticket in the original slot.
- The Depth Underlayer **SHOULD** begin advancing toward the Front Layer before the outgoing ticket has fully finished fading so that the row does not appear empty for more than one rendered frame.
- In a Next Episode Ticket Stack, the complete ticket continues beyond the stack viewport while the next complete ticket advances from the Depth Underlayer to the Front Layer.
- No ticket region detaches or flies independently through the interface.
- No confetti, particle burst, large rotation, or page shake.
- The explicit state request begins immediately on committed release or checkbox activation; it **MUST NOT** wait for visual completion.
- Pointer release restores scrolling immediately. The longer gesture animation **MUST NOT** block scrolling, checkbox use on another row, or other unrelated input.
- If another user action supersedes the animation, the visual transition may finish early at the correct pending or confirmed state.

### Restore Unwatched

- Gesture duration: `240-300ms`. Checkbox duration: `120-180ms`.
- The complete ticket moves and settles as one continuous surface.
- Emerald tint recedes while the restore glyph resolves to the empty control.
- Motion remains as deliberate as marking watched; it must not look destructive.

### Pending

- A compact spinner or determinate ring may animate in the stub.
- Pending motion must not move the row or block list scrolling.
- If the request exceeds two seconds, persistent text such as “Saving” appears.
- In a Next Episode Ticket Stack, show pending feedback at the stable stack-control position and hold the newly revealed top ticket against further advancement until resolution.

### Reduced Motion

Under `prefers-reduced-motion`:

- direct translation may continue to follow the finger because it communicates control;
- remove ticket scale, overshoot, icon pop, and decorative perforation effects;
- cancel and commit return instantly or use a `100-140ms` opacity/color transition;
- replace the standard-list same-slot exit and depth reveal with a `100-140ms` crossfade between the unwatched and watched representations of the same episode;
- replace Next Episode Ticket Stack exit-and-depth-advance movement with a `100-140ms` crossfade between episode identities while keeping the container and focus position stable;
- replace spinning indicators with a static pending glyph when possible;
- never require motion perception to understand Armed, Pending, Success, or Failure.

## Haptics And Sound

Haptics are optional enhancement, never required feedback.

Recommended supported-device pattern:

- entering Armed: one light selection haptic;
- confirmed success: one restrained success or light impact haptic;
- failure: one standard error haptic;
- unavailable direction: at most one subtle rigid/limit haptic per pointer sequence.

Rules:

- Do not vibrate continuously while dragging.
- Do not replay the threshold haptic on every pixel of boundary jitter.
- Respect system and in-app haptic preferences.
- Browser vibration APIs must not be used where behavior is inconsistent, intrusive, or unavailable.
- Sound is off by default and must never be the only confirmation.

## Accessibility

### Multiple Input Paths

Every gesture outcome must be available through:

- visible checkbox-style control;
- keyboard;
- screen reader activation;
- voice control by accessible name;
- switch control or equivalent full keyboard access.

Native shells MAY add custom accessibility actions such as “Mark watched”, but these supplement rather than replace the visible control.

### Screen Reader Output

The row exposes content in a concise order:

1. Episode number and title.
2. Airing status and essential metadata.
3. Watched-state checkbox and current state.

Examples:

```text
Episode 4, The Promise. Aired July 12. Episode 4 watch state, checkbox, checked.
Episode 5, New World. Upcoming July 19. Episode 5 watch state, checkbox, unchecked. Marking watched requires confirmation.
```

Live announcements:

- “Episode 4 marked watched.”
- “Episode 4 marked unwatched.”
- “Could not update Episode 4. Restored to unwatched. Retry available.”

Do not announce continuous drag distance or every armed-state fluctuation.

### Color And Contrast

- Watched uses Emerald plus check/label/shape.
- Interaction intent and focus use Iris.
- Unwatched uses neutral structure plus empty control.
- Failure uses destructive color plus error icon and text.
- Text below 18pt targets at least `4.5:1` final composite contrast.
- Control boundaries and meaningful nontext graphics target at least `3:1` against adjacent colors.
- High Contrast and Forced Colors must preserve perforation, selection, checked state, and error state.

### Text Scaling

At 200% text size:

- the entire list or stack switches to its shared Accessibility Height Tier instead of expanding individual tickets by content length;
- title retains up to two lines, uses ellipsis when necessary, and does not sit behind the stub;
- the complete title remains available to assistive technology and through the title/detail route;
- metadata progressively hides or condenses before essential identity is clipped;
- the state control remains at least 44px on mobile;
- the drag target remains the ticket body;
- error and retry content remain adjacent and reachable.

At high browser zoom, the design may switch to the mobile composition or a larger shared height token. If no supported fixed tier can preserve essential identity and minimum targets, the entire presentation **MAY** adopt content-driven height as an accessibility fallback; isolated rows still must not change height during state animation.

### Reduced Transparency

- Ticket, stub, rail, and error surfaces use solid semantic backgrounds.
- Perforation remains visible through border/shape, not translucency.
- Wallpaper detail must not remain sharply visible through text regions.

### Motor Accessibility

- The visible control is always present.
- The gesture requires one pointer and no hold duration.
- There is no velocity-only commit.
- Thresholds are reachable but resistant to accidental scroll motion.
- Retry is a visible button with an adequate target.

## Discoverability And Learning

The ticket form itself provides persistent affordance through the stub, perforation, and visible checkbox.

### First-use Hint

A nonmodal hint SHOULD appear at a relevant moment, not at app launch.

Recommended copy in LTR:

```text
Drag the ticket left to mark watched, or tap the check button.
```

Requirements:

- Show near the first eligible episode row.
- Do not block scrolling or require completion.
- Include a visible dismissal.
- Dismiss permanently after the person successfully drags, explicitly closes it, or sees it a small number of times.
- Mirror direction and illustration in RTL.
- Do not use an autoplaying hand animation indefinitely.

### Contextual Reminder

If a person repeatedly taps the checkbox but never drags, the app MAY show one low-priority reminder. It must not pressure the person to use the gesture; the checkbox is an equally valid preference.

### Unavailable Explanation

When a gesture cannot perform the requested action, show a short reason near the row. Do not rely on resistance alone.

## Platform Adaptation

### Mobile Portrait

- Drag is the recommended fast path.
- The full noninteractive body is draggable.
- Vertical scroll arbitration is strict.
- Stub control target is at least 44px.
- Leading system-edge navigation is protected.
- Labels may condense after the action icon is understood, but accessible text remains complete.

### Mobile Landscape

- Use the same semantic directions and the stable mobile threshold.
- Cap the threshold so the gesture remains reachable in compact height.
- Preserve 44px targets and safe areas.
- Do not switch to desktop pointer behavior solely because viewport width is large.

### Desktop Pointer

- The visible checkbox is the primary precision path.
- Drag is an optional expert enhancement.
- Hover may reveal a subtle grab cursor or emphasize the perforation, but no action is hover-only.
- Drag threshold is larger than mobile and based on card width.
- Text selection, links, context menus, and trackpad scrolling remain functional.
- Escape cancels an active drag before release.

### Keyboard And Assistive Technology

- No horizontal drag is required.
- Checkbox semantics are complete.
- Focus is visible and stable after success, rollback, pagination, or virtualization.
- Lists do not auto-advance focus to the next episode unless the person explicitly enables such a workflow.
- In a Next Episode Ticket Stack, successful advancement **MUST** keep focus on a stable control at the same visual position or explicitly transfer focus to the new top ticket's equivalent control. It announces both the completed episode and the new top episode; failure restores the original accessible identity.

## Content And Localization

Use concise, action-oriented labels:

| State/action | English |
|---|---|
| Unwatched action | Mark watched |
| Watched action | Mark unwatched |
| Armed watched | Release to mark watched |
| Armed unwatched | Release to mark unwatched |
| Pending | Saving watch state |
| Success watched | Marked watched |
| Success unwatched | Marked unwatched |
| Failure | Could not update watch state |
| Retry | Retry |

Localization requirements:

- Use semantic leading/trailing direction in implementation.
- Mirror the ticket and rail in RTL.
- Allow labels to expand without reducing hit targets.
- Keep episode numbers localized according to product conventions.
- Do not hard-code English status text into backend progress messages.

## Performance

- Pointer feedback should target the display refresh rate and feel immediate.
- During drag, update transform and opacity properties that can be composited efficiently.
- Avoid layout reads and writes on every pointer event.
- Avoid animated backdrop blur, filters, and large shadows.
- Long lists may virtualize rows, but an active or pending row must not be recycled until its interaction safely completes.
- Poster loading or unrelated row updates must not interrupt the active drag.

## Analytics And Privacy

Interaction analytics, if enabled, should measure usability without recording sensitive viewing content unnecessarily.

Useful aggregate events:

- hint shown/dismissed;
- drag started;
- vertical intent won;
- drag canceled below threshold;
- drag committed;
- checkbox activated;
- confirmation accepted/canceled;
- update failed/retried.

Do not record raw pointer paths, exact motor behavior, or episode titles unless required and disclosed. Prefer anonymous aggregate distances and outcomes.

## Validation Targets

These are product-quality targets for usability testing, not guarantees derived from implementation:

- At least 95% of participants complete the gesture on the first attempt after the concise hint.
- Accidental state commits during ordinary vertical scrolling remain below 1% of tested scroll interactions.
- At least 95% of intended drags produce the predicted target state.
- Median visible response to pointer movement is within one rendered frame.
- A person can always cancel after crossing the threshold by moving back before release.
- Keyboard-only and screen-reader users complete the same state changes without discovering hidden commands.
- Failure rollback never leaves aggregate progress inconsistent with the episode row.

## Test Matrix

### Input

- One-handed thumb, both hands, left-handed and right-handed use.
- Slow drag, fast drag, diagonal drag, short drag, reverse before release.
- Drag starts on body text, poster, and noninteractive stub space; compare pointer travel with every ticket region to verify one-to-one whole-ticket translation.
- Drag starts immediately outside the protected system edge; verify the whole ticket remains under the finger without capturing a drag that begins inside the protected edge.
- After horizontal lock, add substantial vertical finger drift and verify every page/nested scroller remains fixed until pointer release or cancellation, then scrolls normally immediately afterward.
- Vertical scroll beginning on the ticket.
- Browser back-edge gesture.
- Mouse drag, trackpad, keyboard, touch, stylus where supported.
- Screen reader, switch control, voice control.

### Viewport

- `320x568`, `375x667`, `390x844`, `430x932`.
- Mobile landscape with compact height.
- Compact desktop with sidebar.
- Wide desktop.
- 200% text and 400% browser zoom.

### Appearance

- Light and dark appearance.
- Increased contrast and forced colors.
- Reduced transparency.
- Reduced motion.
- Bright, dark, saturated, and dense anime wallpapers.

### Content

- Long episode title and long localized labels.
- Missing title, duration, or air date.
- Present, missing, loading, failed, unusually wide, and unusually tall poster artwork.
- Upcoming and unavailable episodes.
- Watched and unwatched rows adjacent.
- Next-episode and watched badges together.
- Initial loading, pending, slow request, success, failure, retry, and offline.
- Pagination and virtualized lists.
- Standard episode list and Next Episode Ticket Stack, including the final eligible episode.
- Standard-list same-slot exit and Depth Underlayer reveal without episode identity or ordering changes.
- One-line, two-line, and very long localized titles share the same ticket height at each standard and accessibility text-size tier.

## Acceptance Criteria

An implementation conforms only when:

- the ticket, stub, perforation, rail, and visible state control are present and legible;
- on mobile, omitting persistent watched-state text keeps the circular control centered with a `44x44px` target while accessible state, rail labels, and noncolor feedback remain complete;
- before the threshold, the complete ticket translates approximately one-to-one with the pointer and the stub, perforation, poster, and state control preserve fixed positions relative to the body;
- when a poster is present, it keeps the `2:3` well without distortion, remains non-navigational and non-draggable, and does not interfere with the ticket gesture;
- semantic leading drag marks watched and trailing drag restores unwatched;
- vertical scrolling wins until horizontal intent is clear;
- after horizontal intent wins, viewport and nested vertical scrolling remain locked for that pointer sequence and unlock immediately on every completion or cancellation path;
- system back gestures remain available;
- crossing the threshold previews but does not commit before release;
- moving back before release cancels;
- gesture and checkbox use identical business rules and explicit state mutations;
- optimistic success, pending, confirmed, failure, rollback, and retry are distinguishable;
- no episode update disables unrelated rows outside the same temporarily serialized Next Episode Ticket Stack;
- mobile targets meet 44px and desktop targets meet 28px minimum guidance;
- watched state is not conveyed by Emerald alone;
- keyboard and assistive technology can complete every action;
- motion and transparency preferences are respected;
- all labels and directionality localize correctly;
- the interaction remains usable over every supported wallpaper;
- tests cover scroll conflict, edge navigation, cancellation, race conditions, and failure rollback;
- standard lists retain the changed episode in its original row slot, even when its watched representation is revealed from the Depth Underlayer; a Next Episode Ticket Stack advances only after commit and can restore the original top ticket on failure;
- stack advancement keeps container geometry and accessible focus stable, and Reduced Motion replaces spatial advancement with a crossfade;
- tickets within one presentation use a shared fixed-height token; long text never changes one ticket's height, and accessibility scaling switches the whole presentation to a suitable shared tier;
- gesture completion may use the expressive duration, while checkbox activation remains concise and both paths mutate state immediately without blocking unrelated input.

## Nonconforming Patterns

- Hiding the only watched control until hover or swipe.
- Keeping the stub or state control fixed while the Ticket Body moves.
- Translating different ticket regions by different distances or allowing the pointer to outrun part of the ticket.
- Making poster artwork a link, navigation target, native drag source, or separately draggable object inside the ticket.
- Stretching poster artwork or changing ticket geometry when poster loading succeeds or fails.
- Committing immediately when the threshold is crossed.
- Using a velocity-only flick commit.
- Blocking vertical scroll from pointer down.
- Failing to lock vertical scrolling after horizontal intent wins, or leaving scrolling locked after the pointer sequence ends.
- Allowing long content to increase only one ticket's height or overlap the stub and state control.
- Requiring checkbox activation to wait through the full expressive gesture animation.
- Starting the gesture inside the browser back-edge region.
- Using red for the routine “mark unwatched” action.
- Moving surrounding rows during drag.
- Changing episode identity, list index, or ordering during a standard-list same-slot transition.
- Using stack advancement for “mark unwatched” or implying that it navigates to a previous episode.
- Flying paper fragments, confetti, strong bounce, or long celebratory animation.
- Making the whole row an inaccessible button with nested links.
- Sending a non-idempotent toggle request.
- Leaving optimistic watched state visible after a failed save.
- Disabling the entire episode list while one row is pending.
- Announcing every drag pixel to a screen reader.
- Requiring haptics, color, hover, or motion to understand the state.
