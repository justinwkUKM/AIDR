(function () {
  const KEY = 'aidr_policy_v1';

  const defaultState = {
    mode: 'enforcement',
    sessionPausedUntilTs: 0,
    mutedUntilByCategory: {},
    allowlistRuleIds: [],
    allowlistPatterns: []
  };

  const state = { ...defaultState };

  function nowTs() {
    return Date.now();
  }

  function clampMinutes(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) return 0;
    return Math.min(24 * 60, m);
  }

  function normalizePolicy(input) {
    const src = input && typeof input === 'object' ? input : {};
    const mode = src.mode === 'shadow' ? 'shadow' : 'enforcement';
    return {
      mode,
      sessionPausedUntilTs: Number(src.sessionPausedUntilTs) || 0,
      mutedUntilByCategory: src.mutedUntilByCategory && typeof src.mutedUntilByCategory === 'object' ? src.mutedUntilByCategory : {},
      allowlistRuleIds: Array.isArray(src.allowlistRuleIds) ? src.allowlistRuleIds.map((v) => String(v).slice(0, 64)).slice(0, 100) : [],
      allowlistPatterns: Array.isArray(src.allowlistPatterns) ? src.allowlistPatterns.map((v) => String(v).slice(0, 128)).slice(0, 100) : []
    };
  }

  function persist() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [KEY]: normalizePolicy(state) }, () => resolve());
    });
  }

  async function init() {
    return new Promise((resolve) => {
      chrome.storage.local.get([KEY], (res) => {
        const merged = normalizePolicy(res[KEY]);
        Object.assign(state, merged);
        resolve({ ...state });
      });
    });
  }

  function getStateSync() {
    return { ...state };
  }

  function isSessionPaused() {
    return nowTs() < Number(state.sessionPausedUntilTs || 0);
  }

  function isCategoryMuted(category) {
    const until = Number((state.mutedUntilByCategory || {})[category] || 0);
    return nowTs() < until;
  }

  function isRuleAllowlisted(ruleId) {
    return state.allowlistRuleIds.includes(String(ruleId));
  }

  function isPatternAllowlisted(text) {
    const input = String(text || '');
    return state.allowlistPatterns.some((p) => {
      if (!p) return false;
      try {
        return new RegExp(p, 'i').test(input);
      } catch (_) {
        return input.toLowerCase().includes(String(p).toLowerCase());
      }
    });
  }

  function isEnforcementActive() {
    return state.mode === 'enforcement' && !isSessionPaused();
  }

  function filterDetections(detections, text) {
    if (!Array.isArray(detections) || !detections.length) return [];
    const patternAllowed = isPatternAllowlisted(text);
    return detections.filter((d) => {
      if (!d) return false;
      if (isRuleAllowlisted(d.id)) return false;
      if (isCategoryMuted(d.category)) return false;
      if (patternAllowed) return false;
      return true;
    });
  }

  async function setMode(mode) {
    state.mode = mode === 'shadow' ? 'shadow' : 'enforcement';
    await persist();
    return getStateSync();
  }

  async function pauseSession(minutes) {
    const mins = clampMinutes(minutes);
    state.sessionPausedUntilTs = mins ? nowTs() + mins * 60 * 1000 : nowTs();
    await persist();
    return getStateSync();
  }

  async function resumeSession() {
    state.sessionPausedUntilTs = 0;
    await persist();
    return getStateSync();
  }

  async function muteCategory(category, minutes) {
    const key = String(category || '').trim();
    if (!key) return getStateSync();
    const mins = clampMinutes(minutes);
    if (!mins) return getStateSync();
    state.mutedUntilByCategory[key] = nowTs() + mins * 60 * 1000;
    await persist();
    return getStateSync();
  }

  async function unmuteCategory(category) {
    const key = String(category || '').trim();
    if (!key) return getStateSync();
    delete state.mutedUntilByCategory[key];
    await persist();
    return getStateSync();
  }

  async function addAllowlistRule(ruleId) {
    const id = String(ruleId || '').trim();
    if (!id) return getStateSync();
    if (!state.allowlistRuleIds.includes(id)) state.allowlistRuleIds.push(id);
    await persist();
    return getStateSync();
  }

  async function removeAllowlistRule(ruleId) {
    const id = String(ruleId || '').trim();
    state.allowlistRuleIds = state.allowlistRuleIds.filter((v) => v !== id);
    await persist();
    return getStateSync();
  }

  async function addAllowlistPattern(pattern) {
    const p = String(pattern || '').trim();
    if (!p) return getStateSync();
    if (!state.allowlistPatterns.includes(p)) state.allowlistPatterns.push(p);
    await persist();
    return getStateSync();
  }

  async function removeAllowlistPattern(pattern) {
    const p = String(pattern || '').trim();
    state.allowlistPatterns = state.allowlistPatterns.filter((v) => v !== p);
    await persist();
    return getStateSync();
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.policy = {
    init,
    getStateSync,
    isSessionPaused,
    isCategoryMuted,
    isEnforcementActive,
    filterDetections,
    setMode,
    pauseSession,
    resumeSession,
    muteCategory,
    unmuteCategory,
    addAllowlistRule,
    removeAllowlistRule,
    addAllowlistPattern,
    removeAllowlistPattern
  };
})();
