(function () {
  const config = {
    version: '1.0.0-v1',
    enabled: true,
    mode: 'enforcement',
    criticalOverrideMode: 'single_confirm',
    contextWindowSize: 8,
    maxEvidenceLength: 64,
    repeatWindowMs: 30 * 60 * 1000,
    cooldownMs: 45 * 1000,
    storageKey: 'aidr_events_v1',
    retentionDays: 14,
    maxEvents: 1000,
    severityThresholds: {
      safe: 20,
      low: 40,
      medium: 60,
      high: 80
    },
    baseWeights: {
      sensitive_data: 85,
      prompt_injection: 75,
      jailbreak: 70,
      exfiltration: 55,
      harmful_content: 45,
      behavioral: 35
    }
  };

  window.AIDR = window.AIDR || {};
  window.AIDR.config = config;
})();
