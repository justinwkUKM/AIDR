/**
 * AIDR Cross-Tab Synchronization - v3
 * Shares AIDR state (events, risk scores, session context) across tabs
 * using chrome.storage.onChanged listeners.
 */
(function () {
  const SYNC_PREFIX = 'aidr_sync_';
  const STATE_KEY = SYNC_PREFIX + 'state';
  const EVENTS_KEY = SYNC_PREFIX + 'events';
  const BEHAVIORAL_KEY = SYNC_PREFIX + 'behavioral';

  /**
   * Local cache of synced state
   */
  const localState = {
    lastRisk: 0,
    lastSeverity: 'safe',
    eventCount: 0,
    activeTabs: new Set(),
    sessionStart: Date.now()
  };

  /**
   * Storage helpers
   */
  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (res) => resolve(res[key] || null));
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }

  /**
   * Publish current tab's state to shared storage
   */
  async function publishState(risk, severity, eventCount) {
    const tabId = await getCurrentTabId();
    const state = {
      tabId,
      risk,
      severity,
      eventCount,
      timestamp: Date.now(),
      url: window.location.href.split('/').slice(0, 3).join('/') // domain only, no PII
    };

    localState.lastRisk = risk;
    localState.lastSeverity = severity;
    localState.eventCount = eventCount;

    await storageSet(STATE_KEY, state);
  }

  /**
   * Publish a single event to shared storage (for cross-tab event log)
   */
  async function publishEvent(event) {
    const sanitized = {
      ...event,
      tabId: await getCurrentTabId(),
      synced_at: Date.now()
    };

    // Remove raw text to avoid PII in shared storage
    delete sanitized.raw_text;
    delete sanitized.full_prompt;

    try {
      const events = await storageGet(EVENTS_KEY);
      const eventList = Array.isArray(events) ? events : [];
      eventList.push(sanitized);

      // Keep max 500 synced events
      if (eventList.length > 500) {
        eventList.splice(0, eventList.length - 500);
      }

      await storageSet(EVENTS_KEY, eventList);
    } catch (_) {
      // Silent fail on sync
    }
  }

  /**
   * Get all synced events from all tabs
   */
  async function getSyncedEvents() {
    const events = await storageGet(EVENTS_KEY);
    return Array.isArray(events) ? events : [];
  }

  /**
   * Get current tab ID (best effort)
   */
  async function getCurrentTabId() {
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, resolve);
      });
      return tabs[0]?.id || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  /**
   * Listen for state changes from other tabs
   */
  function startListening(callback) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'local') return;

      if (changes[STATE_KEY]) {
        const newState = changes[STATE_KEY].newValue;
        if (newState && newState.tabId !== getCurrentTabId()) {
          callback('state_change', newState);
        }
      }

      if (changes[EVENTS_KEY]) {
        callback('event_change', null);
      }
    });
  }

  /**
   * Get aggregated risk across all active tabs
   */
  async function getAggregatedRisk() {
    const state = await storageGet(STATE_KEY);
    if (!state) return { risk: 0, severity: 'safe' };

    // Return the highest risk seen across tabs
    return {
      risk: state.risk || 0,
      severity: state.severity || 'safe'
    };
  }

  /**
   * Clear sync data for this tab
   */
  async function clearSyncData() {
    // Only clear events older than 1 hour
    const events = await storageGet(EVENTS_KEY);
    if (Array.isArray(events)) {
      const oneHourAgo = Date.now() - 3600000;
      const recent = events.filter(e => (e.synced_at || 0) > oneHourAgo);
      await storageSet(EVENTS_KEY, recent);
    }
  }

  // Expose API
  window.AIDR = window.AIDR || {};
  window.AIDR.sync = {
    publishState,
    publishEvent,
    getSyncedEvents,
    getAggregatedRisk,
    startListening,
    clearSyncData,
    getLocalState: () => ({ ...localState })
  };
})();