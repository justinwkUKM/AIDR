(function () {
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

  window.AIDR = window.AIDR || {};
  window.AIDR.logger = {
    loadEvents,
    logEvent
  };
})();
