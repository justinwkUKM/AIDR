# AIDR Product Decisions

Date: 2026-05-21

## 1) Default first-install mode
- Decision: `shadow`
- Rationale: reduce false-positive friction while collecting diagnostics baselines.
- Implementation: policy module supports `shadow`/`enforcement`; default documented for rollout.

## 2) Critical-alert override UX
- Decision: `typed_confirm` for critical paths in production profile.
- Rationale: reduce accidental unsafe override.
- Implementation: `criticalOverrideMode` config supports `single_confirm` and `typed_confirm`.

## 3) Harmful-content category policy
- Decision: detect + warn; enforcement remains severity-driven and policy-dependent.
- Rationale: preserve safety signaling while avoiding unnecessary hard blocks for ambiguous phrasing.

## 4) Host permissions scope
- Decision: limit to ChatGPT hosts only (`chatgpt.com`, `chat.openai.com`).
- Rationale: least privilege for initial release.
