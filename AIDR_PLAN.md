# AIDR (AI Detection and Response) - Implementation Plan

## Executive Summary

AIDR is a local-first security layer for AI chat interactions in a Chrome extension context. It detects risky prompts and responses, scores risk, and provides user controls before content is sent.

This plan is intentionally staged:
- `v1` ships high-confidence protection with low friction.
- `v2` adds analytics and richer controls.
- `v3` adds extensibility and advanced features.

---

## Product Goals

1. Reduce accidental sharing of sensitive data.
2. Detect common prompt injection / jailbreak patterns with explainable rules.
3. Keep user trust through transparent, local processing and controllable alerts.
4. Maintain low overhead and minimal UI interruption.

---

## Non-Goals (v1)

1. No cloud backend.
2. No machine-learning model inference in extension runtime.
3. No team/multi-user auth or RBAC.
4. No cross-platform (non-ChatGPT) support initially.

---

## Architecture

AIDR keeps a 5-layer model, but implementation is phased.

1. Capture
- Prompt interception pre-send.
- Response capture post-render.
- Conversation context window (last N items).

2. Detect
- Deterministic rules with confidence values.
- Category-specific detectors (PII, injection, jailbreak, exfil hints, behavior anomalies).

3. Analyze
- Composite risk scoring.
- Context modifiers (repeat behavior, escalation trend, grace factors).

4. Respond
- Inline warnings, blocking modal for critical events, allow-once path.

5. Dashboard
- Initially minimal event history and filters, expanded later.

---

## Delivery Roadmap

## v1 (Weeks 1-3): Core Protection, Low Risk

### Scope
- Capture engine for prompt/response.
- High-confidence detectors only:
  - Email, phone, credit card (with Luhn), API key formats, private key headers.
  - Prompt injection core patterns.
- Risk scoring engine.
- Response UI:
  - `Low/Medium`: passive or inline warning.
  - `High`: strong warning with edit/allow once.
  - `Critical`: block by default with explicit override.
- Local event logging with strict redaction.

### Out of scope for v1
- Custom rule editor.
- Heatmaps/charts.
- Cross-tab orchestration complexity.
- Export to PDF/HTML.

### v1 Exit Criteria
- p95 detection latency <100ms per analyzed message on baseline hardware.
- False positive rate <5% on v1 labeled test set.
- No raw secrets persisted in storage logs.
- All critical alerts provide `what triggered this` explanation.

---

## v2 (Weeks 4-6): Quality + Observability

### Scope
- Expanded detectors:
  - Exfiltration intent heuristics (scored conservatively).
  - Behavioral anomalies (rate spike, repetition, prompt-length anomalies).
- Shadow mode + enforcement mode toggle:
  - Shadow mode logs detections with no blocking.
  - Enforcement mode activates response actions.
- Dashboard v2:
  - Timeline, severity/category filters, JSON/CSV export.
- Whitelist/allowlist manager (rule-level and pattern-level exceptions).

### v2 Exit Criteria
- Per-category precision/recall reported in dashboard diagnostics.
- User controls: mute/snooze per category and session-level pause.
- Storage retention policy enforced and test-covered.

---

## v3 (Weeks 7-8): Extensibility + Hardening

### Scope
- Plugin-style rule registration API.
- Rule test harness for custom rules.
- Background worker coordination refinements.
- Security hardening pass + release readiness.

### v3 Exit Criteria
- Third-party/custom rule can be registered without core edits.
- Full regression suite green.
- Permission and CSP audit completed.

---

## Detection Strategy

## Threat Categories

1. Prompt Injection (High)
- Example cues: "ignore previous instructions", "new system prompt", "forget above".

2. Sensitive Data Exposure (High)
- PII and credential-like patterns with high-confidence validators where possible.

3. Jailbreak Attempts (High)
- Roleplay / bypass framing patterns; scored conservatively unless multiple signals combine.

4. Data Exfiltration Signals (Medium)
- Bulk export language + structured extraction intent + suspicious destination context.

5. Harmful Content Signals (Medium)
- Kept informational in v1/v2 unless combined with other risk factors.

6. Behavioral Anomalies (Low-Medium)
- Session-level pattern deviations.

## Rule Design Requirements

Each rule must define:
- `id`, `category`, `severity_base`, `pattern or detector`, `confidence method`, `message`, `recommended action`.

Each detection output must include:
- `matched_rule_ids`
- `evidence_spans` (redacted/snippet-safe)
- `confidence`
- `category`

---

## Risk Scoring

Composite formula:

`risk = clamp(0, 100, (base_weight * confidence) + context_modifiers + multi_hit_bonus)`

Context modifiers:
- Repeat events in session: `+10` each, max `+30`.
- Escalation trend: `+15`.
- First occurrence grace: `-5`.
- Safe streak (>=30m): `-10`.
- Multi-category hit in single message: `+20`.

Severity bands:
- `0-20 Safe`
- `21-40 Low`
- `41-60 Medium`
- `61-80 High`
- `81-100 Critical`

---

## Response Policy

1. Safe
- No interruption; optional silent logging.

2. Low
- Subtle indicator only.

3. Medium
- Inline warning banner with `Edit` and `Allow once`.

4. High
- Strong warning; default focus on `Edit`.

5. Critical
- Send blocked by default.
- User may `Allow once` with explicit confirmation.

Anti-fatigue controls:
- Per-category snooze.
- Session mute with time limit.
- Do-not-repeat identical alert within cooldown window.

---

## Privacy and Data Handling

Local-first guarantees:
- All analysis in-browser.
- No telemetry egress in v1-v3.

Storage policy:
- Store event metadata and redacted evidence only.
- Never store full raw prompt/response by default.
- If temporary raw snippet is needed for UX explainability, keep in memory only and discard after action.

Retention:
- Default retention: 14 days.
- Configurable range: 1-30 days.
- Hard cap: 1000 events, FIFO rotation.

User controls:
- Clear all logs.
- Disable logging while keeping detection active.
- Export user-owned records (JSON/CSV).

---

## Security Controls (Chrome Extension-Specific)

1. Permission minimization
- Request only required host and extension permissions.

2. CSP hardening
- No remote script execution.
- No inline script allowances unless unavoidable and audited.

3. Isolated execution
- Keep detection logic in isolated extension context where possible.

4. Storage safety
- Redaction before write.
- Strict schema validation for persisted events.

5. Supply chain hygiene
- Pin and review dependencies.
- Run dependency vulnerability scans before release.

---

## Performance Targets

1. p95 analysis latency <100ms/message.
2. Additional memory footprint <5MB steady state.
3. CPU overhead <2% during normal typing cadence.
4. Debounce/throttle for streaming updates.

Implementation tactics:
- Precompile regex rules.
- Incremental diff-based analysis on changed text only.
- Off-main-thread work for heavy scans where needed.

---

## Evaluation and Testing Plan

## Dataset

Create a labeled corpus with:
- Benign prompts/responses.
- Realistic sensitive-data variants (synthetic).
- Injection/jailbreak patterns (direct + obfuscated).
- Edge cases likely to trigger false positives.

## Metrics

Per category:
- Precision
- Recall
- F1
- False positive rate

System-level:
- Alert rate per 100 messages.
- Override rate (`Allow once`) by category.
- Time-to-decision for warning dialogs.

## Test Layers

1. Unit tests
- Rule matching, validators, scoring math.

2. Integration tests
- Capture -> detect -> score -> respond flow.

3. Regression suite
- Locked fixtures for previously fixed false positives/negatives.

4. Performance tests
- Synthetic high-frequency message stream.

Release gate:
- No severity-1 bugs.
- Metric thresholds met for v-target.

---

## File Structure

```text
chatgpt-token-counter/
├── manifest.json
├── content.js
├── styles.css
├── background.js
├── aidr/
│   ├── aidr-core.js
│   ├── aidr-patterns.js
│   ├── aidr-detector.js
│   ├── aidr-scorer.js
│   ├── aidr-responder.js
│   ├── aidr-logger.js
│   ├── aidr-config.js
│   └── aidr-styles.css
└── dashboard/
    ├── dashboard.html
    ├── dashboard.js
    └── dashboard.css
```

---

## Milestones

1. M1 (end Week 1)
- Detection primitives and test fixtures merged.

2. M2 (end Week 2)
- Scoring + response UI merged behind feature flag.

3. M3 (end Week 3)
- v1 release candidate, shadow mode validation complete.

4. M4 (end Week 6)
- v2 feature complete with dashboard and allowlist.

5. M5 (end Week 8)
- v3 hardening complete, release docs finalized.

---

## Open Decisions

1. Default mode at first install: `shadow` vs `enforcement`.
2. Critical-alert override UX: single confirm vs typed confirm.
3. Whether to include harmful-content category in enforcement or informational-only at v1.
4. Exact host permissions scope for initial release.

---

## Release Readiness Checklist

1. Functional
- All v-target features implemented and tested.

2. Security
- Permission review complete.
- CSP review complete.
- Dependency scan clean or accepted with documented exceptions.

3. Privacy
- Redaction and retention behavior validated.
- Export and delete flows verified.

4. UX
- Alert copy reviewed for clarity and minimal friction.
- Accessibility checks for warning components.

---

Last Updated: May 21, 2026
Version: 1.1.0
Status: Revised and Implementation-Ready
