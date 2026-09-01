# UI skills: design sources and adaptation rules

These skills intentionally separate **design principles** from **technology-specific implementation**. Web libraries are used as evidence for interaction patterns and design-system completeness; implementation for desktop meteorological products remains native C++/Qt.

## External sources

- https://www.ui-skills.com/ — catalog and skill-routing approach; small task-specific skills rather than one giant prompt.
- https://ui.shadcn.com/ — open-code, composable component-system approach and complete stateful component inventory.
- https://coss.com/ui — dense modern primitives including combobox, segmented controls, command/search, drawers, status and form patterns.
- https://www.designsystemchecklist.com/ — design-system coverage checklist.
- https://transitions.dev/ — examples of purposeful transitions and microinteraction vocabulary.
- https://emilkowal.ski/ui/you-dont-need-animations — guidance to avoid animation in frequent keyboard interactions and keep product motion fast.
- https://developers.openai.com/codex/skills — Codex skill format, progressive disclosure and `.agents/skills` repository discovery.

## f2re product evidence

The bundle consolidates recurring requirements from operational and UI work across repositories such as:

- `f2re/mrl_forecast`: operational forecast UI, source/model validity, diagnostics, macOS-like visual language, radar/nowcast workflow;
- `f2re/gfs_profile`: meteograms, aerology, model comparison, forecast products and meteorological units;
- `f2re/SatDump`: map/satellite visualization, overlays, orientation and operator labels;
- `f2re/marine-track`: geospatial selection, calibration and imagery workflows;
- `f2re/kafedra-planner`, `f2re/docomator`, `f2re/planer-solving`: compact selectors, one-click state switches, adaptive import/review flows, progressive disclosure and dense desktop/web application patterns;
- `f2re/crop_forecast_bot`: concise domain terminology and decision-oriented weather presentation.

## Adaptation rule

Never copy a React/Tailwind component implementation into Qt. Extract the underlying behavior (state model, interaction, hierarchy, feedback, keyboard semantics, composition) and implement it using Qt Widgets, Qt models/views, QStyle/QProxyStyle, layouts, event handling and native C++ state.