---
name: workflow-and-progressive-disclosure
description: Design end-to-end Qt task flows, adaptive wizards, import/review/edit workflows and progressive disclosure. Use when the user must complete a multi-step operation, upload/parse data, configure products or resolve ambiguity without being overwhelmed.
---

# Workflow and Progressive Disclosure

## Start from the task

Write the happy path and the top failure/ambiguity paths before drawing controls. Each step must answer: what does the user know now, what decision is required, what can be automated safely, and how do they undo/correct it.

## Adaptive flow

Do not force a fixed wizard when the input already determines later choices. Detect document/data type, prefill what is known, skip irrelevant steps, and expose a clear review step for uncertain extraction.

Use confidence to decide presentation:
- high confidence -> apply automatically and show editable result;
- medium confidence -> highlight fields needing review;
- low confidence -> ask a focused question or show candidate choices.

## Progressive disclosure

Keep primary action and essential context visible. Put advanced options close to the object they affect, usually in a collapsible section or inspector. Do not make the user traverse a global settings screen for a local task.

## Navigation

Show where the user is, what is complete and what remains. Back must preserve entered state. Cancel must state whether temporary data is discarded. Long-running tasks should be resumable when practical.

## Review before commitment

For imports, generated plans, parsed documents or automatic corrections, provide a diff/preview rather than a generic confirmation dialog. Highlight what will be created, changed, merged, skipped or flagged.

## Defaults

Use safe domain defaults. Never default a destructive/irreversible choice. If a default comes from inference, make that provenance visible on review.

## Empty starts

An empty product area should explain the next useful action in context. Avoid generic `No data` when the application can say what to load, configure or wait for.