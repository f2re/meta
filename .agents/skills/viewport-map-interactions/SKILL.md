---
name: viewport-map-interactions
description: Define map, radar and satellite viewport interactions in Qt/C++: pan, wheel zoom, semantic zoom, probes, layers, selection, reset, fit-to-data and multi-level navigation. Use for QGraphicsView/QOpenGLWidget/custom map canvases and geospatial meteorological surfaces.
---

# Viewport and Map Interactions

## Interaction contract

Keep gestures predictable and reversible.

### Pointer
- Drag empty map -> pan.
- Click data -> inspect/select without changing time or scale.
- Double click -> contextually useful local action such as center+zoom one level; never trigger destructive actions.
- Right click -> contextual actions relevant to the pointed object/location.
- Esc -> cancel transient tool/measurement/selection mode.

### Wheel and trackpad
Default wheel over viewport changes spatial zoom around cursor position. Preserve the geographic point under the cursor.

Support accelerated semantic zoom without making ordinary scrolling surprising:
- accumulate wheel impulses in a short sliding window;
- normal impulses change only camera scale;
- a deliberately rapid burst crossing a configured threshold may transition one semantic level, for example local radar -> regional mosaic -> synoptic product;
- show a brief preview/label before the semantic level switch;
- keep center, selected location and valid time where possible;
- provide an immediate reverse gesture and reset action;
- never issue expensive data requests for every wheel tick: debounce and coalesce requests after interaction settles.

Modifier examples:
- Ctrl/Cmd + wheel: optional global/semantic scale where platform convention allows;
- Shift + wheel: time navigation only if the UI visibly teaches it and horizontal scrolling is not required;
- Alt + wheel: product-specific vertical level or parameter adjustment only in expert mode.

Do not overload one unmodified gesture with spatial, temporal and data-resolution changes simultaneously.

## Semantic zoom

At each scale define what becomes visible, hidden or aggregated: stations, labels, radar cells, contours, warnings and vectors. Avoid simply shrinking all symbols. Use decluttering, clustering and level-of-detail rendering.

## Data fetching

Use interaction phases:
1. during drag/zoom: transform existing raster/vector cache at interactive frame rate;
2. after a short idle debounce: request data matching final extent/resolution;
3. swap new data without flashing blank content;
4. indicate if display is temporarily resampled or stale.

Cancel obsolete requests when the viewport changes again.

## Navigation affordances

Provide fit-to-data, home/reset, back-to-previous-view and current-location/station actions where relevant. Preserve a short viewport history so accidental zooms are recoverable.

## Precision tools

Cursor probe should expose exact coordinates, time and values. Measurements and cross-sections are modes with explicit active state and clear exit. Snap only when useful and show what object/location is being snapped to.