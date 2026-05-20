(function () {
  const customRules = [];
  function isRegexLike(v) {
    return !!(v && typeof v === 'object' && typeof v.test === 'function' && typeof v.source === 'string');
  }

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') throw new Error('Rule must be an object');
    if (!rule.id || !rule.category || !rule.message) throw new Error('Rule requires id, category, message');

    if (typeof rule.detect !== 'function' && !isRegexLike(rule.pattern)) {
      throw new Error('Rule requires detect(text) function or RegExp pattern');
    }

    return {
      id: String(rule.id).slice(0, 64),
      category: String(rule.category).slice(0, 32),
      severity_base: String(rule.severity_base || 'medium').slice(0, 16),
      confidence: Number(rule.confidence || 0.7),
      message: String(rule.message).slice(0, 160),
      recommended_action: String(rule.recommended_action || 'warn').slice(0, 32),
      pattern: isRegexLike(rule.pattern) ? rule.pattern : null,
      detect: typeof rule.detect === 'function' ? rule.detect : null
    };
  }

  function registerRule(rule) {
    const normalized = normalizeRule(rule);
    const exists = customRules.some((r) => r.id === normalized.id);
    if (!exists) customRules.push(normalized);
    return normalized;
  }

  function registerRules(rules) {
    if (!Array.isArray(rules)) throw new Error('registerRules expects an array');
    return rules.map(registerRule);
  }

  function runCustomRules(text, context) {
    const input = String(text || '');
    const detections = [];

    for (const rule of customRules) {
      let matched = false;
      let index = 0;
      let length = 0;

      if (rule.detect) {
        const result = rule.detect(input, context || {});
        if (result && result.matched) {
          matched = true;
          index = Number(result.index) || 0;
          length = Number(result.length) || 8;
        }
      } else if (rule.pattern) {
        const m = input.match(rule.pattern);
        if (m && typeof m.index === 'number') {
          matched = true;
          index = m.index;
          length = m[0].length;
        }
      }

      if (!matched) continue;

      const safeEvidence = input
        .slice(Math.max(0, index - 10), Math.min(input.length, index + length + 10))
        .replace(/[A-Za-z0-9]/g, '*')
        .slice(0, (window.AIDR && window.AIDR.config && window.AIDR.config.maxEvidenceLength) || 64);

      detections.push({
        id: rule.id,
        category: rule.category,
        severity_base: rule.severity_base,
        confidence: Math.max(0, Math.min(1, rule.confidence)),
        message: rule.message,
        recommended_action: rule.recommended_action,
        evidence: safeEvidence
      });
    }

    return detections;
  }

  function listRules() {
    return customRules.map((r) => ({
      id: r.id,
      category: r.category,
      severity_base: r.severity_base,
      confidence: r.confidence,
      message: r.message,
      recommended_action: r.recommended_action
    }));
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.rules = {
    registerRule,
    registerRules,
    runCustomRules,
    listRules
  };
})();
