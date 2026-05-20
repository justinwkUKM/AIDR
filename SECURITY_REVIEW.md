# AIDR Security Review (v1 Baseline)

Date: 2026-05-21
Scope: Chrome extension runtime for AIDR detection/response and local logging.

## Permission Minimization
- `permissions`: `storage` only.
- `host_permissions`: limited to:
  - `https://chatgpt.com/*`
  - `https://chat.openai.com/*`
- No background host wildcard permissions.

## CSP Hardening
- `manifest.json` includes explicit extension-page CSP:
  - `script-src 'self'`
  - `object-src 'self'`
  - `base-uri 'self'`
  - `frame-ancestors 'none'`
- No remote script loading in extension code.

## Storage Safety
- Event persistence runs through schema sanitization before write.
- Rejected entries: malformed objects, invalid timestamps.
- Stored fields are bounded in type and length.
- Redacted evidence spans are persisted; raw prompt/response content is not persisted by default.

## Retention and Volume Controls
- Default retention: 14 days.
- Max event cap: 1000 (FIFO rotation).
- Logging can be disabled while detection/enforcement remains active.

## Supply Chain Hygiene
- Current repo has no runtime package dependencies in manifest/runtime path.
- If JS package manager tooling is added later, require:
  1. pinned lockfile commits,
  2. dependency review on update PRs,
  3. vulnerability scan step in CI.

## Remaining Work (Follow-up)
- Add automated security lint/check script in CI once CI workflow is introduced.
- Add regression tests for schema sanitizer edge cases.
- Add formal CSP/permission review gate in release checklist.
