---
name: meteorological-visualization
description: Design meteorological charts and scientific visualizations in Qt/C++: meteograms, profiles, aerological diagrams, ensemble plots, legends, units, uncertainty, crosshairs and comparison. Use for Qwt/QCustomPlot/custom painters and weather data graphics.
---

# Meteorological Visualization

## Scientific first

Do not sacrifice interpretability for visual minimalism. Preserve scientifically meaningful scales, units, sign conventions and domain color semantics.

## Chart anatomy

Every chart must define:
- clear variable name and unit;
- valid time/date axis with timezone;
- source/model/cycle in compact metadata;
- readable grid hierarchy;
- hover/crosshair values where precision matters;
- legend that identifies series without relying on color alone;
- missing-data gaps rather than invented interpolation unless interpolation is explicitly part of the product.

## Meteograms

Group related variables into aligned tracks sharing the time axis. Keep temperature/dew point, wind/gust/direction, pressure/tendency, precipitation, cloud, humidity and visibility logically clustered. Avoid stacking so many tracks that each becomes unreadably shallow; allow collapsible/resizeable tracks and saved layouts.

## Model comparison

Prefer a small number of visually distinguishable models by default. Keep model selection in a compact searchable selector or comparison panel. Show full model metadata on demand, not as permanent clutter.

## Ensembles and uncertainty

Use median/central estimate plus spread bands or percentiles. Distinguish deterministic and ensemble products. Explain percentile/spread semantics in tooltip/help. Avoid opaque spaghetti plots by default; individual members are an expert toggle.

## Aerology

For Skew-T/Emagram/Stüve and vertical profiles, maintain meteorological geometry and standard pressure/height orientation. Provide hover readout, parcel/indices overlays and layer toggles without obscuring the thermodynamic traces.

## Interaction

- wheel over chart: horizontal/time zoom by default if chart is time-centric; require modifier for y-scale unless domain convention differs;
- drag: pan selected axis/range;
- double click axis: reset that axis;
- crosshair linked across vertically aligned charts;
- selection/brush on time range should optionally synchronize map/other charts.

## Rendering

Render axes/text sharply at high DPI. Decimate only for display performance, never for calculations. When downsampling, preserve extrema important for warnings. Cache static layers and redraw only changed data/overlays where possible.