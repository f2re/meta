---
name: motion-feedback-and-microinteractions
description: Design purposeful Qt/C++ motion and microinteractions: hover, press, focus, panel transitions, number changes, loading feedback and animation budgets. Use when motion clarifies causality or spatial relationships; avoid animation on high-frequency keyboard/operator actions.
---

# Motion, Feedback and Microinteractions

## Rule

Animation must explain state change, preserve spatial continuity or confirm an action. If removing it makes a frequent operation feel faster and no meaning is lost, remove it.

## Timing budget

- high-frequency navigation, keyboard selection, timeline stepping: no transition or effectively immediate;
- hover/press/focus feedback: immediate response, visual settle typically <=120 ms;
- menus/popovers: roughly 100–180 ms;
- panels/dialogs: roughly 160–240 ms;
- avoid routine product animation beyond 300 ms.

Use one shared duration/easing vocabulary. Respect reduced-motion preference when available.

## Qt implementation

Use `QPropertyAnimation`, `QVariantAnimation` or custom interpolation only when the property can animate without layout thrash. Prefer opacity/geometry transforms for transient overlays. Avoid repeatedly animating large widget trees or expensive scientific canvases.

## Good uses

- origin-aware popover/menu opening;
- inspector/drawer reveal that shows where secondary content came from;
- subtle collapse/expand with preserved focus;
- numeric change highlight when a live value materially changed;
- skeleton/progress transition into loaded content;
- short toast appearance/removal;
- drag/drop snap feedback.

## Bad uses

- animated highlight while arrowing through a list;
- easing every timeline frame change;
- spring physics on core meteorological controls;
- decorative parallax, bouncing, floating or perpetual motion in operational screens;
- animation that delays data inspection.

## Feedback latency

A control must react visually before expensive work finishes. On click/selection, update pressed/selected state immediately, then show loading/progress if work exceeds perceptual immediacy. Never leave the user wondering whether input was registered.