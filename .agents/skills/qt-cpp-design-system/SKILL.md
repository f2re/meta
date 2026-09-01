---
name: qt-cpp-design-system
description: Design and implement consistent native C++/Qt Widgets interfaces: tokens, spacing, typography, components, layouts, QSS, states, density and reusable UI primitives. Use for Qt desktop UI architecture or component work; do not translate web components literally.
---

# Qt C++ Design System

## Principles

Treat the application as a product design system, not a collection of individually styled widgets. Build reusable primitives around Qt Widgets and C++ APIs.

## Required foundation

Define centrally:
- spacing scale: 4/8/12/16/24/32 px with exceptions justified by density;
- radii: small controls, panels, dialogs;
- typography roles: title, section, body, compact label, numeric/monospace data;
- semantic colors: surface, elevated surface, border, text, secondary text, accent, success, warning, danger, selected, focus;
- control heights for compact/regular modes;
- icon sizes and stroke conventions;
- animation durations and easing tokens;
- z-order/elevation policy for menus, popovers, overlays and dialogs.

Use palette/QProxyStyle/QStyleOption and scoped QSS where possible. Avoid enormous global style sheets with selector side effects.

## Component rules

Create reusable wrappers or style helpers for:
- primary/secondary/quiet/destructive buttons;
- icon buttons with tooltip and accessible text;
- segmented control;
- searchable combo/select;
- split button and button group;
- inline field with label, unit, validation and optional suffix action;
- filter chip and removable selection;
- status badge;
- collapsible section;
- side panel / inspector;
- modal confirmation;
- toast/inline notification;
- skeleton/progress placeholder;
- empty/error states.

## Layout

- Group by operator task, not by data model or implementation class.
- Preserve consistent alignment baselines and edge padding.
- Keep primary content visually dominant; controls should recede until needed.
- Prefer resizable splitters for persistent work areas, drawers for temporary secondary tasks, dialogs for blocking decisions only.
- Store user-resized splitter and panel state with sensible reset-to-default.
- Support high-DPI and different font metrics; do not hard-code text widths.

## Interaction states

Every interactive widget must define: default, hover, pressed, focused, selected/toggled, disabled, loading and error where relevant. Focus must be visible. Hover must never be the only way to discover a required action.

## C++ implementation quality

Separate domain state from widget state. Prefer explicit view models/state structs for complex screens. Avoid signal/slot spaghetti: name intents, centralize derived state, guard against recursive updates and test state transitions independently from paint logic.