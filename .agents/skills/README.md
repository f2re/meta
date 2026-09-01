# Qt / Meteorological UI skills for Codex

Canonical repo-scoped design skills for C++/Qt applications, with special rules for operational meteorological workstations.

## Skills

1. `ui-skill-router` — chooses the smallest relevant set of UI skills before implementation.
2. `qt-cpp-design-system` — Qt Widgets/C++ design tokens, components, layout, styling and architecture.
3. `meteorologist-workstation-ux` — domain workflow for forecast, radar, satellite and observation workstations.
4. `viewport-map-interactions` — pan/zoom, wheel gestures, semantic zoom, layers, probes and map navigation.
5. `time-data-navigation` — forecast time, animation, data resolution, cycles, scrubbing and accelerated wheel semantics.
6. `meteorological-visualization` — charts, meteograms, aerological diagrams, legends, units and uncertainty.
7. `dense-controls-and-selection` — toolbars, combo/select boxes, segmented controls, filters and compact operator UI.
8. `workflow-and-progressive-disclosure` — end-to-end flows, wizards, contextual actions and progressive disclosure.
9. `motion-feedback-and-microinteractions` — purposeful Qt animation, hover/focus/press feedback and latency budgets.
10. `states-errors-and-recovery` — loading, empty, stale, offline, error, partial-data and recovery states.
11. `operator-accessibility-and-safety` — keyboard operation, contrast, non-color encoding, destructive actions and fatigue reduction.
12. `ui-audit-and-acceptance` — evidence-based UI audit and implementation acceptance checklist.

## Usage

Codex discovers repository skills from `.agents/skills`. Invoke explicitly with `$skill-name` or allow Codex to match a skill by its `description`.

For implementation work, start with `ui-skill-router`, then load only the relevant specialist skills. Do not load the whole catalog by default.

## Sources incorporated

The rules synthesize recurring product requirements from f2re meteorological and operations repositories and adapt design-engineering practices from UI Skills, shadcn/ui, coss ui, Design System Checklist, transitions.dev and Emil Kowalski's interaction/motion guidance. Web-specific implementation details are translated into native Qt/C++ patterns rather than copied literally.