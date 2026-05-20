(function () {
  function safeSnippet(text, index, length, maxLen) {
    const start = Math.max(0, index - 10);
    const end = Math.min(text.length, index + length + 10);
    const raw = text.slice(start, end);
    return raw.replace(/[A-Za-z0-9]/g, '*').slice(0, maxLen);
  }

  function addMatch(matches, item) {
    matches.push(item);
  }

  function detect(text) {
    const input = String(text || '');
    const A = window.AIDR;
    const cfg = A.config;
    const p = A.patterns;
    const out = [];

    p.promptInjection.forEach((re, idx) => {
      const m = input.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `pi_${idx + 1}`,
          category: 'prompt_injection',
          severity_base: 'high',
          confidence: 0.9,
          message: 'Prompt injection phrase detected.',
          recommended_action: 'edit',
          evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    const email = input.match(p.email);
    if (email && typeof email.index === 'number') {
      addMatch(out, {
        id: 'pii_email',
        category: 'sensitive_data',
        severity_base: 'high',
        confidence: 0.9,
        message: 'Email-like sensitive data detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(input, email.index, email[0].length, cfg.maxEvidenceLength)
      });
    }

    const phone = input.match(p.phone);
    if (phone && typeof phone.index === 'number') {
      addMatch(out, {
        id: 'pii_phone',
        category: 'sensitive_data',
        severity_base: 'high',
        confidence: 0.82,
        message: 'Phone number-like pattern detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(input, phone.index, phone[0].length, cfg.maxEvidenceLength)
      });
    }

    const card = input.match(p.creditCard);
    if (card && typeof card.index === 'number' && window.AIDR.luhnValid(card[0])) {
      addMatch(out, {
        id: 'pii_credit_card',
        category: 'sensitive_data',
        severity_base: 'critical',
        confidence: 0.98,
        message: 'Potential credit card number detected (Luhn-valid).',
        recommended_action: 'block',
        evidence: safeSnippet(input, card.index, card[0].length, cfg.maxEvidenceLength)
      });
    }

    const keyHeader = input.match(p.privateKeyHeader);
    if (keyHeader && typeof keyHeader.index === 'number') {
      addMatch(out, {
        id: 'secret_private_key',
        category: 'sensitive_data',
        severity_base: 'critical',
        confidence: 0.99,
        message: 'Private key header detected.',
        recommended_action: 'block',
        evidence: safeSnippet(input, keyHeader.index, keyHeader[0].length, cfg.maxEvidenceLength)
      });
    }

    p.apiKeys.forEach((re, idx) => {
      const m = input.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `secret_api_key_${idx + 1}`,
          category: 'sensitive_data',
          severity_base: 'critical',
          confidence: 0.96,
          message: 'API key-like pattern detected.',
          recommended_action: 'block',
          evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    return out;
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.detect = detect;
})();
