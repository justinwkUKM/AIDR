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

  /**
   * Behavioral anomaly detection - v3 enhancement
   * Analyzes session-level patterns for rate spikes, repetition, and length anomalies
   */
  const behavioralContext = {
    messageTimestamps: [],
    messageLengths: [],
    messageHashes: []
  };

  /**
   * Simple string hash for repetition detection
   */
  function simpleHash(str) {
    let hash = 0;
    const s = str.toLowerCase().trim();
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * Check if two messages are similar (simple token overlap)
   */
  function messagesSimilar(text1, text2) {
    const normalize = (t) => t.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const tokens1 = new Set(normalize(text1));
    const tokens2 = normalize(text2);
    if (!tokens1.size || !tokens2.length) return false;
    const overlap = tokens2.filter(t => tokens1.has(t)).length;
    const minLen = Math.min(tokens1.size, tokens2.length);
    return overlap / minLen > 0.6;
  }

  /**
   * Detect behavioral anomalies in the current session
   * Returns array of behavioral detections
   */
  function detectBehavioralAnomalies(text, history) {
    const detections = [];
    const now = Date.now();
    const input = String(text || '');
    const inputLength = input.length;

    // Update behavioral context
    behavioralContext.messageTimestamps.push(now);
    behavioralContext.messageLengths.push(inputLength);
    behavioralContext.messageHashes.push(simpleHash(input));

    // Keep only last 50 messages for analysis
    const maxHistory = 50;
    if (behavioralContext.messageTimestamps.length > maxHistory) {
      behavioralContext.messageTimestamps.shift();
      behavioralContext.messageLengths.shift();
      behavioralContext.messageHashes.shift();
    }

    const msgCount = behavioralContext.messageTimestamps.length;

    // 1. Rate spike detection: >10 messages in 60 seconds
    if (msgCount >= 5) {
      const oneMinuteAgo = now - 60000;
      const recentMsgs = behavioralContext.messageTimestamps.filter(t => t >= oneMinuteAgo).length;
      if (recentMsgs >= 10) {
        detections.push({
          id: 'beh_rate_spike',
          category: 'behavioral',
          severity_base: 'medium',
          confidence: Math.min(0.9, 0.5 + (recentMsgs - 10) * 0.05),
          message: `High message rate detected (${recentMsgs} messages/min).`,
          recommended_action: 'warn',
          evidence: `rate:${recentMsgs}/min`
        });
      }
    }

    // 2. Repetition detection: similar message sent multiple times
    if (msgCount >= 3) {
      const currentHash = simpleHash(input);
      const recentHashes = behavioralContext.messageHashes.slice(-10);
      let repeatCount = 0;
      for (const hash of recentHashes) {
        if (Math.abs(hash - currentHash) < 1000) repeatCount++;
      }
      if (repeatCount >= 3) {
        detections.push({
          id: 'beh_repetition_session',
          category: 'behavioral',
          severity_base: 'medium',
          confidence: Math.min(0.85, 0.5 + repeatCount * 0.05),
          message: `Repeated similar messages detected (${repeatCount} times).`,
          recommended_action: 'warn',
          evidence: `repeat:${repeatCount}x`
        });
      }
    }

    // 3. Prompt-length anomaly: current message >3x median length
    if (msgCount >= 5) {
      const sorted = [...behavioralContext.messageLengths].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median > 0 && inputLength > median * 3 && inputLength > 500) {
        detections.push({
          id: 'beh_length_anomaly',
          category: 'behavioral',
          severity_base: 'low',
          confidence: Math.min(0.8, 0.4 + (inputLength / (median * 5)) * 0.2),
          message: `Prompt length anomaly (${inputLength} chars vs ${median} median).`,
          recommended_action: 'warn',
          evidence: `len:${inputLength} vs median:${median}`
        });
      }
    }

    return detections;
  }

  /**
   * Reset behavioral context (called on new session)
   */
  function resetBehavioralContext() {
    behavioralContext.messageTimestamps = [];
    behavioralContext.messageLengths = [];
    behavioralContext.messageHashes = [];
  }

  function buildContextModifiers(history, currentCategories) {
    const now = Date.now();
    const windowMs = window.AIDR.config.repeatWindowMs;

    const recent = history.filter((h) => now - h.ts <= windowMs);
    const repeatBonus = Math.min(30, recent.length * 10);
    const escalationBonus = recent.length >= 2 && recent[recent.length - 1].risk > recent[0].risk ? 15 : 0;
    const lastTs = history.length ? history[history.length - 1].ts : 0;
    const safeStreakBonus = lastTs && (now - lastTs >= 30 * 60 * 1000) ? -10 : 0;
    const multiCategoryBonus = currentCategories.size > 1 ? 20 : 0;

    return {
      repeatBonus,
      escalationBonus,
      firstOccurrenceGrace: recent.length === 0 ? -5 : 0,
      safeStreakBonus,
      multiCategoryBonus
    };
  }

  function score(detections, history, options) {
    options = options || {};
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
  window.AIDR.detectBehavioralAnomalies = detectBehavioralAnomalies;
  window.AIDR.resetBehavioralContext = resetBehavioralContext;
})();
