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

## Performance Harness

- Local synthetic benchmark script:
  - `node scripts/aidr-bench.js`
  - Optional iterations: `node scripts/aidr-bench.js 5000`
- Runtime metrics are also available from the content-script engine via:
  - `window.AIDR.createEngine().getPerformanceStats()`

## Diagnostics Dataset Schema (Dashboard)

- Upload JSON with shape:
```json
{
  "samples": [
    {
      "predicted_categories": ["prompt_injection"],
      "actual_categories": ["prompt_injection"]
    }
  ]
}
```
- Dashboard computes per-category `precision`, `recall`, `f1`, and `false_positive_rate`.

## Next Steps

1. Implement `v1` detection primitives and scoring from `AIDR_PLAN.md`.
2. Add test fixtures and regression tests.
3. Add response UI and logging controls behind feature flags.
