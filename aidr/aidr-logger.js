(function () {
  const ENABLED_KEY = 'aidr_logging_enabled';

  function isLoggingEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get([ENABLED_KEY], (res) => {
        if (typeof res[ENABLED_KEY] !== 'boolean') {
          resolve(true);
          return;
        }
        resolve(res[ENABLED_KEY]);
      });
    });
  }

  function setLoggingEnabled(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [ENABLED_KEY]: Boolean(enabled) }, () => resolve());
    });
  }

  function loadEvents() {
    return new Promise((resolve) => {
      const key = window.AIDR.config.storageKey;
      chrome.storage.local.get([key], (res) => {
        const raw = Array.isArray(res[key]) ? res[key] : [];
        resolve(raw.map(sanitizeEvent).filter(Boolean));
      });
    });
  }

  function retentionCutoffMs() {
    const days = window.AIDR.config.retentionDays;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }

  function sanitizeEvent(evt) {
    if (!evt || typeof evt !== 'object') return null;
    const ts = Number(evt.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;

    const risk = Number(evt.risk);
    const confidence = Number(evt.confidence);
    const direction = String(evt.direction || 'unknown');
    const severity = String(evt.severity || 'safe');
    const ruleIds = Array.isArray(evt.matched_rule_ids) ? evt.matched_rule_ids : [];
    const categories = Array.isArray(evt.categories) ? evt.categories : [];
    const evidence = Array.isArray(evt.evidence_spans) ? evt.evidence_spans : [];

    return {
      ts,
      direction: direction.slice(0, 24),
      risk: Number.isFinite(risk) ? Math.max(0, Math.min(100, risk)) : 0,
      severity: severity.slice(0, 16),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      matched_rule_ids: ruleIds.map((v) => String(v).slice(0, 64)).slice(0, 12),
      categories: categories.map((v) => String(v).slice(0, 32)).slice(0, 8),
      evidence_spans: evidence.map((v) => String(v).slice(0, 128)).slice(0, 8)
    };
  }

  async function logEvent(eventData) {
    const enabled = await isLoggingEnabled();
    if (!enabled) return;

    // Prefer background worker serialization when available.
    if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      try {
        const ack = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'AIDR_LOG_EVENT', payload: eventData }, (resp) => {
            resolve(resp || { ok: false });
          });
        });
        if (ack && ack.ok) return;
      } catch (_) {
        // Fallback to local write path.
      }
    }

    const key = window.AIDR.config.storageKey;
    const old = await loadEvents();
    const cutoff = retentionCutoffMs();

    const kept = old.filter((e) => e.ts >= cutoff);
    const sanitized = sanitizeEvent(eventData);
    if (!sanitized) return;
    const next = kept.concat([sanitized]);
    while (next.length > window.AIDR.config.maxEvents) {
      next.shift();
    }

    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: next }, () => resolve());
    });
  }

  function clearEvents() {
    const key = window.AIDR.config.storageKey;
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: [] }, () => resolve());
    });
  }

  async function exportJson() {
    const events = await loadEvents();
    return JSON.stringify(events, null, 2);
  }

  async function exportCsv() {
    const events = await loadEvents();
    const headers = [
      'ts',
      'direction',
      'risk',
      'severity',
      'confidence',
      'matched_rule_ids',
      'categories',
      'evidence_spans'
    ];
    const rows = events.map((e) => ([
      e.ts,
      e.direction,
      e.risk,
      e.severity,
      e.confidence,
      (e.matched_rule_ids || []).join('|'),
      (e.categories || []).join('|'),
      (e.evidence_spans || []).join('|')
    ]));
    return [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.logger = {
    loadEvents,
    logEvent,
    clearEvents,
    exportJson,
    exportCsv,
    isLoggingEnabled,
    setLoggingEnabled
  };
})();
