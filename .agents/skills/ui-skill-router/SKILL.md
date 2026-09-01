---
name: ui-skill-router
description: Route Qt/C++ UI design or redesign tasks to the smallest relevant set of design skills before implementation. Use for interface planning, UX review, new screens, control behavior, maps, charts, workflows or design refactors; do not use for non-UI backend work.
---

# UI Skill Router

## Goal

Prevent generic UI generation. Identify the operator task, domain surface and interaction risks, then load only the specialist skills needed.

## Procedure

1. Inspect the existing screen, code and project evidence before proposing a redesign. Preserve useful established behavior unless there is a verified usability defect.
2. State the primary operator job in one sentence: what decision or action must the user complete and under what time pressure.
3. Classify the surface:
   - application shell / component system -> `qt-cpp-design-system`;
   - operational meteorology -> `meteorologist-workstation-ux`;
   - map/radar/satellite viewport -> `viewport-map-interactions`;
   - forecast cycles/time/data resolution -> `time-data-navigation`;
   - charts/meteograms/aerology -> `meteorological-visualization`;
   - filters/selectors/toolbars -> `dense-controls-and-selection`;
   - multi-step task/wizard/import -> `workflow-and-progressive-disclosure`;
   - animation/feedback -> `motion-feedback-and-microinteractions`;
   - loading/error/offline/stale data -> `states-errors-and-recovery`;
   - keyboard/contrast/safety -> `operator-accessibility-and-safety`;
   - final review -> `ui-audit-and-acceptance`.
4. Use the smallest combination that covers the task. Do not import visual patterns merely because they are fashionable.
5. Before coding, write a compact interaction contract: trigger -> immediate feedback -> state change -> persistence/recovery.
6. After coding, run `ui-audit-and-acceptance`.

## Non-negotiables

- Optimize for information retrieval and operator decisions, not decorative novelty.
- Every control must have a clear state, target, keyboard path, disabled state and error behavior.
- Dense professional interfaces may be compact, but must remain scannable and grouped by task.
- Do not hide frequent actions behind extra clicks solely for visual minimalism.
- Do not use animation to compensate for unclear hierarchy.