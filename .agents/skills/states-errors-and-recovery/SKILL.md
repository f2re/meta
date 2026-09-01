---
name: states-errors-and-recovery
description: Design Qt UI states for loading, empty, stale, offline, partial data, errors, cancellation and recovery. Use for network/data-intensive meteorological applications where the last valid view, source health and retry behavior matter.
---

# States, Errors and Recovery

## State model

Treat UI state as explicit product state, not ad-hoc labels. Distinguish at least: idle, loading initial, refreshing, ready, partial, stale, offline, empty, error, cancelled.

## Preserve context

During refresh, keep last valid scientific content visible when safe and mark it as updating/stale rather than blanking the canvas. Never present old data as current without freshness indication.

## Errors

An error message must say what failed, what remains usable and the next recovery action. Prefer inline/contextual error near the affected source. Reserve modal error dialogs for conditions that block the whole task or require an immediate decision.

## Partial data

Show which layers/times/models are missing. Do not collapse a partially available product into generic `Error`. If a frame is unavailable, preserve timeline continuity with an explicit gap.

## Retry and cancellation

Provide retry where meaningful. Long downloads/computation need cancel and progress. Cancellation should return to a coherent prior state and ignore late results.

## Source health

For multi-source meteorological systems, expose source health compactly: healthy/degraded/unavailable/auth required/stale. Do not flood the primary view with infrastructure details; provide drill-down diagnostics.

## Empty state

Differentiate `no data exists`, `filters exclude all data`, `source not configured`, and `data still loading`. Each needs a different next action.

## Logging boundary

User-facing messages are concise and actionable. Detailed exception text, stack traces, paths and transport diagnostics belong in logs/diagnostic details, with a copy action when support workflows need them.