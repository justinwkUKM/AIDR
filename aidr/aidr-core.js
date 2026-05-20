(function () {
  function toOutput(direction, detections, score) {
    return {
      ts: Date.now(),
      direction,
      risk: score.risk,
      severity: score.severity,
      confidence: score.confidence,
      matched_rule_ids: detections.map((d) => d.id),
      categories: Array.from(new Set(detections.map((d) => d.category))),
      evidence_spans: detections.map((d) => d.evidence),
      detections
    };
  }

  function createEngine() {
    const recentHistory = [];
    let lastFingerprint = '';

    async function analyze(direction, text) {
      const input = String(text || '').trim();
      if (!input) return null;

      const fingerprint = `${direction}:${input.slice(0, 140)}`;
      if (fingerprint === lastFingerprint) return null;
      lastFingerprint = fingerprint;

      const detections = window.AIDR.detect(input);
      const score = window.AIDR.score(detections, recentHistory);
      const result = toOutput(direction, detections, score);

      recentHistory.push({ ts: result.ts, severity: result.severity, risk: result.risk });
      if (recentHistory.length > 50) recentHistory.shift();

      if (result.severity !== 'safe') {
        await window.AIDR.logger.logEvent(result);
      }
      window.AIDR.responder.render(result);
      return result;
    }

    return {
      analyzePrompt(text) {
        return analyze('prompt', text);
      },
      analyzeResponse(text) {
        return analyze('response', text);
      }
    };
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.createEngine = createEngine;
})();
