---
name: meteorologist-workstation-ux
description: Design operational meteorologist workflows for radar, satellite, observations, forecasts and model comparison in Qt/C++. Use when the interface supports weather analysis or time-critical meteorological decisions; prioritize provenance, validity, units, uncertainty and rapid comparison.
---

# Meteorologist Workstation UX

## Operator model

Assume the user repeatedly answers: what is happening now, what changed, what will happen next, how certain is it, and which source/model supports that conclusion.

## Information hierarchy

Always make the following discoverable without opening a settings dialog:
- valid time and timezone;
- observation/model cycle time;
- forecast lead time;
- data source/model/product;
- units;
- freshness/staleness;
- spatial/temporal resolution when it materially affects interpretation;
- quality flags, uncertainty or missing data.

Do not display internal identifiers when a human-readable model/product name exists. Put secondary provenance in a quiet metadata line or inspector.

## Operational shell

Prefer a stable workstation anatomy:
- main visualization area;
- compact top/side command strip for product, layer, model and time;
- timeline/playback area near the visualization;
- optional inspector for exact values and metadata;
- status strip for source health, loading, stale/offline state and cursor coordinates/time.

Frequent comparisons must take one action: model A/B, fact/forecast, current/previous cycle, radar/satellite/model overlay. Avoid hiding these behind nested menus.

## Meteorological conventions

- Keep units adjacent to values and consistent within a product.
- Localize numeric separators according to product locale without changing machine data.
- Use domain-meaningful ordering: e.g. temperature/dew point/humidity together; wind speed/direction/gust together; pressure/tendency together.
- Do not encode severe weather only by color. Add symbols, hatching, contours, labels or shape.
- Preserve known meteorological palettes where operator training depends on them; redesign legend layout before redesigning scientifically meaningful colors.

## Cognitive load

- Default view shows the minimum set needed for the current task, not every available field.
- Advanced diagnostics are one level deeper, not removed.
- Keep screen geometry stable during live updates; values may update without controls jumping.
- When a new cycle arrives, do not silently replace the user's analytical context. Show availability and allow explicit switch, unless the product is defined as real-time auto-follow.

## Evidence and trust

A forecast pane must never look more authoritative than its data supports. Surface stale inputs, extrapolation horizon, missing frames and low-confidence regions. Distinguish observed, analyzed, extrapolated and modelled information visually and textually.