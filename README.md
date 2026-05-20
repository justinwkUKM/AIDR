# AIDR

AIDR (AI Detection and Response) is a Chrome extension security layer focused on reducing risky AI-chat interactions, with local-first detection and explainable alerts.

## Highlights

- New card-based popup dashboard UI (`dashboard/`) with:
  - threat summary and risk score
  - confidence trend sparkline
  - block/allow once/mute/pause actions
  - shadow/enforce mode switch
  - diagnostics, logs, allowlist, rules quick panels
- Enforcement includes:
  - pre-send interception (keyboard/click/submit paths)
  - transport-layer guard for conversation requests
- Scope currently set to all HTTP/S sites in `manifest.json`.
- Site-adapter framework for interception selectors (hostname-based profiles) with generic fallback.

## Site Coverage Model

AIDR now uses hostname profiles in `content.js` for composer/input/send selector targeting.

Current seeded profiles:
- `chatgpt.com`, `chat.openai.com`
- `claude.ai`
- `gemini.google.com`
- `perplexity.ai`
- `poe.com`
- `grok.com`, `x.com`, `twitter.com`
- `copilot.microsoft.com`, `bing.com`

All other HTTP/S domains fall back to generic selectors and transport-layer guard heuristics.

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

## Quick Start (Chrome)

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder:
   - `/Users/waqas.obeidy/Documents/Development/Chrome/AIDR`
5. Pin extension and open popup from toolbar.

If you already loaded it before, click `Reload` after pulling new changes.

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
