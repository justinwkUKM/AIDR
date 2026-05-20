# AIDR

AIDR (AI Detection and Response) is a Chrome extension security layer focused on reducing risky AI-chat interactions, with local-first detection and explainable alerts.

## Repository Contents

- `AIDR_PLAN.md`: phased implementation plan (`v1`/`v2`/`v3`)
- `manifest.json`: Chrome extension manifest
- `content.js`: content script logic
- `styles.css`: extension styles
- `tokenizer.js`: tokenizer and token counting logic

## Current Status

This repository currently contains the baseline extension files and a revised implementation plan for AIDR.

## Next Steps

1. Implement `v1` detection primitives and scoring from `AIDR_PLAN.md`.
2. Add test fixtures and regression tests.
3. Add response UI and logging controls behind feature flags.
