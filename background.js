/* AIDR service worker: serialized event writes and policy/diagnostics coordination */

const AIDR_STORAGE_KEY = 'aidr_events_v1';
const MAX_EVENTS = 1000;
const RETENTION_DAYS = 14;

function retentionCutoffMs() {
  return Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

function sanitizeEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  const ts = Number(evt.ts);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const risk = Number(evt.risk);
  const confidence = Number(evt.confidence);
  return {
    ts,
    direction: String(evt.direction || 'unknown').slice(0, 24),
    risk: Number.isFinite(risk) ? Math.max(0, Math.min(100, risk)) : 0,
    severity: String(evt.severity || 'safe').slice(0, 16),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    matched_rule_ids: Array.isArray(evt.matched_rule_ids) ? evt.matched_rule_ids.map((v) => String(v).slice(0, 64)).slice(0, 12) : [],
    categories: Array.isArray(evt.categories) ? evt.categories.map((v) => String(v).slice(0, 32)).slice(0, 8) : [],
    evidence_spans: Array.isArray(evt.evidence_spans) ? evt.evidence_spans.map((v) => String(v).slice(0, 128)).slice(0, 8) : []
  };
}

async function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
async function storageSet(vals) {
  return new Promise((resolve) => chrome.storage.local.set(vals, resolve));
}

async function appendEvent(eventData) {
  const sanitized = sanitizeEvent(eventData);
  if (!sanitized) return { ok: false, reason: 'invalid_event' };

  const res = await storageGet([AIDR_STORAGE_KEY]);
  const old = Array.isArray(res[AIDR_STORAGE_KEY]) ? res[AIDR_STORAGE_KEY].map(sanitizeEvent).filter(Boolean) : [];
  const kept = old.filter((e) => e.ts >= retentionCutoffMs());
  const next = kept.concat([sanitized]);
  while (next.length > MAX_EVENTS) next.shift();
  await storageSet({ [AIDR_STORAGE_KEY]: next });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'AIDR_LOG_EVENT') {
    appendEvent(msg.payload)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, reason: String(e && e.message || e) }));
    return true;
  }
});
