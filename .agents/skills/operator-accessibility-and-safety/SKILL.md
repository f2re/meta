---
name: operator-accessibility-and-safety
description: Review and implement keyboard access, focus, contrast, non-color encoding, fatigue reduction, destructive-action safety and operator ergonomics in Qt/C++ desktop interfaces. Use for professional tools and time-critical meteorological workstations.
---

# Operator Accessibility and Safety

## Keyboard-first operation

Every frequent action must be reachable without the mouse. Define tab order deliberately. Provide shortcuts for high-frequency commands and expose them in menus/tooltips. Escape closes transient UI or cancels a mode. Enter activates the primary action only when focus context makes that safe.

## Focus

Always show visible keyboard focus. Opening a dialog/popover moves focus to a sensible first control; closing returns focus to the trigger. Do not trap focus in non-modal panels.

## Visual encoding

Never communicate warning/severity/selection only by hue. Combine color with text, symbol, pattern, line style, shape or position. Preserve legibility in dark/light themes and under common color-vision deficiencies.

## Contrast and density

Dense does not mean tiny. Maintain readable typography, sufficient control hit areas and clear grouping. Secondary metadata may be quieter but must remain readable. Avoid low-contrast gray-on-gray controls that disappear under poor displays or fatigue.

## Destructive and consequential actions

Use undo where practical. Confirm only destructive/irreversible or operationally consequential actions; repeated harmless actions should not generate confirmation fatigue. Confirmation must name the object/action, not ask generic `Are you sure?`.

## Modes

If the cursor is in a drawing, measurement, cross-section, calibration or edit mode, show that mode persistently near the working area. Provide one obvious exit and an Escape path. Avoid invisible modal tool states.

## Fatigue reduction

Keep recurring controls in stable positions, minimize pointer travel, avoid visual jitter and continuous decorative motion, and permit compact layouts for expert use. Support theme/density choices when operational environment requires them.