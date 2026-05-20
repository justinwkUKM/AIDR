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

  function detect(text, context) {
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

    const jailbreakPatterns = [
      /roleplay\s+as\s+an?\s+unrestricted/i,
      /developer\s+mode/i,
      /bypass\s+safety/i,
      /do\s+anything\s+now/i
    ];
    jailbreakPatterns.forEach((re, idx) => {
      const m = input.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `jb_${idx + 1}`,
          category: 'jailbreak',
          severity_base: 'high',
          confidence: 0.78,
          message: 'Jailbreak/bypass phrasing detected.',
          recommended_action: 'warn',
          evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    const exfilPatterns = [
      /export\s+(all|entire|full)\s+(data|history|conversation)/i,
      /send\s+to\s+(http|https|ftp|webhook)/i,
      /dump\s+as\s+(json|csv|xml)/i,
      /extract\s+all\s+(emails|keys|tokens|records)/i
    ];
    exfilPatterns.forEach((re, idx) => {
      const m = input.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `exfil_${idx + 1}`,
          category: 'exfiltration',
          severity_base: 'medium',
          confidence: 0.68,
          message: 'Potential exfiltration intent detected.',
          recommended_action: 'warn',
          evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    const harmfulPatterns = [
      /how\s+to\s+make\s+(a\s+)?bomb/i,
      /instructions\s+to\s+harm/i,
      /poison\s+someone/i
    ];
    harmfulPatterns.forEach((re, idx) => {
      const m = input.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `harm_${idx + 1}`,
          category: 'harmful_content',
          severity_base: 'medium',
          confidence: 0.7,
          message: 'Potential harmful content signal detected.',
          recommended_action: 'warn',
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

    if (input.length > 5000) {
      addMatch(out, {
        id: 'beh_prompt_len',
        category: 'behavioral',
        severity_base: 'low',
        confidence: 0.65,
        message: 'Prompt length anomaly detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(input, 0, Math.min(80, input.length), cfg.maxEvidenceLength)
      });
    }

    if (/\b(\w+)\b(?:\s+\1\b){6,}/i.test(input)) {
      addMatch(out, {
        id: 'beh_repetition',
        category: 'behavioral',
        severity_base: 'low',
        confidence: 0.6,
        message: 'High repetition pattern detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(input, 0, Math.min(80, input.length), cfg.maxEvidenceLength)
      });
    }

    if (window.AIDR.rules && window.AIDR.rules.runCustomRules) {
      const custom = window.AIDR.rules.runCustomRules(input, context || {});
      custom.forEach((d) => out.push(d));
    }

    if (window.AIDR.policy && window.AIDR.policy.filterDetections) {
      return window.AIDR.policy.filterDetections(out, input);
    }

    return out;
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.detect = detect;
})();
