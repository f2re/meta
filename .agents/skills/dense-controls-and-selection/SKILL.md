---
name: dense-controls-and-selection
description: Design compact professional Qt controls: combo boxes, searchable selects, segmented controls, filters, toolbars, button groups, toggles and multi-selection. Use for dense operator interfaces where speed and scanability matter more than decorative whitespace.
---

# Dense Controls and Selection

## Choose the right control

- 2–5 mutually exclusive frequent choices -> segmented control.
- Boolean setting -> switch only for an immediately applied setting; checkbox for form/batch commitment.
- Small fixed list -> combo/select.
- Long list -> searchable combo/autocomplete.
- Multiple values -> searchable multi-select with removable chips or checklist popover.
- Frequent action + variants -> split button.
- Rare configuration -> menu/inspector, not permanent toolbar space.

Do not put a frequent binary navigation such as `Current / Archive` inside a dropdown; use a one-click segmented/toggle control.

## Combo/select behavior

Search long lists by human labels and useful aliases. Preserve keyboard type-ahead. Show current selection clearly even when focus leaves. Do not truncate the differentiating part of model/station names. Secondary metadata may appear in a second line or tooltip.

For model/product selectors, order by relevance/recent use, then stable domain grouping. Do not expose internal IDs as the primary label.

## Toolbars

Group actions by task and separate groups visually. Place dangerous actions away from high-frequency actions. Use icon-only buttons only for universally understood or repeatedly learned actions; otherwise show text or persistent tooltip.

Allow compact mode but keep hit targets usable. Avoid wrapping toolbars unpredictably; use overflow menu for low-priority actions.

## Filters

Show active filters as visible state, not hidden menu state. Support `Clear all` when more than one filter is active. Filter changes should update results immediately unless operation is expensive, in which case show an explicit Apply action and pending-change indicator.

## Interaction cost

Count clicks/keystrokes for recurring workflows. A common task should not require opening a menu, choosing a submenu and then confirming if direct manipulation can safely do it in one action.

## Persistence

Remember operator selections that represent preference (chosen models, panel density, columns), but do not persist ephemeral analytical context if doing so could surprise the user on next launch. Provide reset-to-default.