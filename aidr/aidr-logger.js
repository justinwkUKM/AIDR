(function () {
  const ENABLED_KEY = 'aidr_logging_enabled';
  const memoryStore = [];

  function hasChromeStorage() {
    return !!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local);
  }

  function storageGet(keys, fallback) {
    if (!hasChromeStorage()) return Promise.resolve(fallback);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(fallback);
            return;
          }
          resolve(res || fallback);
        });
      } catch (_) {
        resolve(fallback);
      }
    });
  }

  function storageSet(obj) {
    if (!hasChromeStorage()) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function isLoggingEnabled() {
    if (!hasChromeStorage()) return Promise.resolve(true);
    return storageGet([ENABLED_KEY], {}).then((res) => {
      if (typeof res[ENABLED_KEY] !== 'boolean') return true;
      return res[ENABLED_KEY];
    });
  }

  function setLoggingEnabled(enabled) {
    if (!hasChromeStorage()) return Promise.resolve();
    return storageSet({ [ENABLED_KEY]: Boolean(enabled) });
  }

  function loadEvents() {
    if (!hasChromeStorage()) {
      return Promise.resolve(memoryStore.map(sanitizeEvent).filter(Boolean));
    }
    return storageGet([window.AIDR.config.storageKey], {}).then((res) => {
      const key = window.AIDR.config.storageKey;
      const raw = Array.isArray(res[key]) ? res[key] : [];
      return raw.map(sanitizeEvent).filter(Boolean);
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

    if (!hasChromeStorage()) {
      const sanitized = sanitizeEvent(eventData);
      if (!sanitized) return;
      memoryStore.push(sanitized);
      while (memoryStore.length > (window.AIDR?.config?.maxEvents || 1000)) memoryStore.shift();
      return;
    }

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

    return storageSet({ [key]: next });
  }

  function clearEvents() {
    if (!hasChromeStorage()) {
      memoryStore.length = 0;
      return Promise.resolve();
    }
    const key = window.AIDR.config.storageKey;
    return storageSet({ [key]: [] });
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
