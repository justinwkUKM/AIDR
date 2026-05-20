(function () {
  function clamp(min, max, n) {
    return Math.max(min, Math.min(max, n));
  }

  function severityForRisk(risk, thresholds) {
    if (risk <= thresholds.safe) return 'safe';
    if (risk <= thresholds.low) return 'low';
    if (risk <= thresholds.medium) return 'medium';
    if (risk <= thresholds.high) return 'high';
    return 'critical';
  }

  function buildContextModifiers(history, currentCategories) {
    const now = Date.now();
    const windowMs = window.AIDR.config.repeatWindowMs;

    const recent = history.filter((h) => now - h.ts <= windowMs);
    const repeatBonus = Math.min(30, recent.length * 10);
    const multiCategoryBonus = currentCategories.size > 1 ? 20 : 0;

    return {
      repeatBonus,
      escalationBonus: 0,
      firstOccurrenceGrace: recent.length === 0 ? -5 : 0,
      safeStreakBonus: 0,
      multiCategoryBonus
    };
  }

  function score(detections, history) {
    if (!detections.length) {
      return {
        risk: 0,
        severity: 'safe',
        confidence: 0,
        modifiers: {}
      };
    }

    const cfg = window.AIDR.config;
    const baseWeights = cfg.baseWeights;
    const categories = new Set(detections.map((d) => d.category));
    const mods = buildContextModifiers(history, categories);

    const base = detections.reduce((acc, d) => {
      const weight = baseWeights[d.category] || 50;
      return Math.max(acc, weight * d.confidence);
    }, 0);

    const risk = clamp(
      0,
      100,
      base + mods.repeatBonus + mods.escalationBonus + mods.firstOccurrenceGrace + mods.safeStreakBonus + mods.multiCategoryBonus
    );

    const avgConfidence = detections.reduce((acc, d) => acc + d.confidence, 0) / detections.length;
    return {
      risk,
      severity: severityForRisk(risk, cfg.severityThresholds),
      confidence: Number(avgConfidence.toFixed(2)),
      modifiers: mods
    };
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.score = score;
})();
