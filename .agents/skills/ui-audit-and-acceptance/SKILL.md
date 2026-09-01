---
name: ui-audit-and-acceptance
description: Audit an existing or newly implemented Qt/C++ interface against design-system, interaction, meteorological, accessibility and state-management requirements. Use before considering UI work complete; produce concrete defects and acceptance checks, not generic taste comments.
---

# UI Audit and Acceptance

## Evidence

Inspect screenshots, actual code, existing behavior and domain requirements. Do not invent a defect because a different style is fashionable.

## Audit sequence

1. Identify the primary task and count actions required for frequent workflows.
2. Check hierarchy: primary data, context, controls, secondary metadata.
3. Check grouping and alignment: controls that act together must look and behave together.
4. Check every interactive state and keyboard path.
5. Check map/chart/time gestures for collisions and hidden mode changes.
6. Check scientific labels: model/product, valid time, cycle, lead, units, source, freshness, uncertainty.
7. Check loading, stale, partial, offline, empty, error, retry and cancellation states.
8. Check high-DPI, resize, minimum window size, long localized strings and font metrics.
9. Check performance while dragging, zooming, scrubbing and live-updating.
10. Check dark/light themes, contrast and non-color encoding.
11. Check destructive actions, undo/recovery and accidental activation risk.
12. Check persistence of preferences and reset-to-default.

## Severity

- P0: scientifically misleading, unsafe, data loss, wrong state/time/source, unusable core workflow.
- P1: major workflow friction, inaccessible frequent action, gesture conflict, blocking responsive/performance issue.
- P2: consistency, clarity, spacing, secondary accessibility or recovery issue.
- P3: polish only.

## Acceptance format

For each issue record: `surface -> observed behavior -> why it matters -> exact target behavior -> acceptance test`.

Do not accept statements such as `make it prettier`, `modernize`, or `Apple-like` without measurable behavior/layout criteria.

## Completion gate

UI work is complete only when the primary happy path, top failure path, keyboard path and resize/high-DPI path are exercised, and no P0/P1 issues remain.