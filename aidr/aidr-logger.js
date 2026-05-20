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
        resolve(Array.isArray(res[key]) ? res[key] : []);
      });
    });
  }

  function retentionCutoffMs() {
    const days = window.AIDR.config.retentionDays;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }

  function sanitizeEvent(evt) {
    return {
      ts: evt.ts,
      direction: evt.direction,
      risk: evt.risk,
      severity: evt.severity,
      confidence: evt.confidence,
      matched_rule_ids: evt.matched_rule_ids,
      categories: evt.categories,
      evidence_spans: evt.evidence_spans
    };
  }

  async function logEvent(eventData) {
    const enabled = await isLoggingEnabled();
    if (!enabled) return;

    const key = window.AIDR.config.storageKey;
    const old = await loadEvents();
    const cutoff = retentionCutoffMs();

    const kept = old.filter((e) => e.ts >= cutoff);
    const next = kept.concat([sanitizeEvent(eventData)]);
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
