# AIDR

AIDR (AI Detection and Response) is a Chrome extension security layer focused on reducing risky AI-chat interactions, with local-first detection and explainable alerts.

## Repository Contents

- `AIDR_PLAN.md`: phased implementation plan (`v1`/`v2`/`v3`)
- `manifest.json`: Chrome extension manifest
- `content.js`: content script logic
- `styles.css`: extension styles
- `tokenizer.js`: tokenizer and token counting logic
- `aidr/`: AIDR runtime modules (policy, rules, detector, scorer, logger, responder, core)
- `dashboard/`: extension popup dashboard for events, diagnostics, and policy controls
- `scripts/`: local benchmark and rule harness tools
- `tests/fixtures/`: local fixture datasets for harness workflows

## Current Status

AIDR currently includes local detection/scoring, shadow/enforcement policy controls, allowlist/mute/session pause controls, diagnostics ingestion, and custom-rule extensibility.

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

## Custom Rule Harness

- Register plugin-style custom rules without editing core detector logic.
- Run harness:
  - `node scripts/aidr-rule-harness.js tests/fixtures/custom-rules.json`
- Fixture format supports:
  - `rules` list (regex-based custom rules)
  - `cases` list with expected `rule_ids`
