(function () {
  function safeSnippet(text, index, length, maxLen) {
    const start = Math.max(0, index - 10);
    const end = Math.min(text.length, index + length + 10);
    const raw = text.slice(start, end);
    return raw.replace(/[A-Za-z0-9]/g, '*').slice(0, maxLen);
  }

  function addMatch(matches, item) {
    // Deduplicate by rule ID
    if (!matches.some(m => m.id === item.id)) {
      matches.push(item);
    }
  }

  // ─── Expanded Pattern Library ──────────────────────────────────────────

  // Prompt injection patterns (expanded from 4 → 16)
  const promptInjectionPatterns = [
    // Original 4
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /forget\s+(all\s+)?above/i,
    /new\s+system\s+prompt/i,
    /override\s+your\s+rules/i,
    // Expanded coverage
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|guidelines|directives)/i,
    /pretend\s+(the\s+)?(above|previous|prior)\s+(instructions|rules|guidelines)\s+(don'?t|do\s+not)\s+exist/i,
    /from\s+now\s+on,?\s+(you\s+)?(have\s+no|ignore\s+all|forget\s+all|disregard)/i,
    /act\s+as\s+if\s+(you\s+)?(have\s+no|had\s+no|were\s+given\s+no)\s+(rules|restrictions|guidelines)/i,
    /you\s+are\s+now\s+(free|unrestricted|unfiltered|uncensored)/i,
    /reset\s+(your|all)\s+(instructions|rules|guidelines|context|memory)/i,
    /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions|rules|guidelines)/i,
    /repeat\s+(everything|all|the\s+text)\s+(above|before)\s+(this\s+)?(line|point|message)/i,
    /translate\s+(your\s+)?(system\s+)?(prompt|instructions)\s+to/i,
    /output\s+(your|the)\s+(system\s+)?(prompt|instructions|initial\s+message)/i,
    /print\s+(your|the)\s+(system|initial|original)\s+(prompt|instructions|message)/i,
    /respond\s+(only\s+)?with\s+(your\s+)?(system\s+)?(prompt|instructions)/i
  ];

  // Jailbreak patterns (expanded from 4 → 14)
  const jailbreakPatterns = [
    // Original 4
    /roleplay\s+as\s+an?\s+unrestricted/i,
    /developer\s+mode/i,
    /bypass\s+safety/i,
    /do\s+anything\s+now/i,
    // Expanded coverage
    /you\s+are\s+(DAN|STAN|DUDE|KEVIN|EVIL)/i,
    /act\s+as\s+(an?\s+)?(evil|malicious|unrestricted|unfiltered|uncensored)\s+(AI|assistant|version|model)/i,
    /jailbreak/i,
    /in\s+(this\s+)?(hypothetical|fictional|imaginary)\s+scenario,?\s+(there\s+are\s+)?no\s+(rules|restrictions|limits)/i,
    /pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(evil|unrestricted|unfiltered|unethical)/i,
    /respond\s+without\s+(any\s+)?(ethical|moral|safety)\s+(constraints|guidelines|filters|restrictions)/i,
    /enable\s+(god|admin|root|sudo|superuser)\s+mode/i,
    /switch\s+to\s+(unrestricted|unfiltered|uncensored|unlimited)\s+mode/i,
    /disable\s+(your\s+)?(safety|content|ethical)\s+(filters?|guidelines|restrictions|guardrails)/i,
    /you\s+(can|must|should|will)\s+(now\s+)?(say|do|generate)\s+anything/i
  ];

  // Exfiltration patterns (expanded from 4 → 10)
  const exfilPatterns = [
    // Original 4
    /export\s+(all|entire|full)\s+(data|history|conversation)/i,
    /send\s+to\s+(http|https|ftp|webhook)/i,
    /dump\s+as\s+(json|csv|xml)/i,
    /extract\s+all\s+(emails|keys|tokens|records)/i,
    // Expanded
    /forward\s+(this|all|the)\s+(data|messages|conversation|info)\s+to/i,
    /upload\s+(this|all|the)\s+(data|content|conversation)\s+to/i,
    /post\s+(this|the\s+data|everything)\s+to\s+(http|https|a\s+url|my\s+server)/i,
    /make\s+(a|an)\s+(http|api|web)\s+(request|call|post)\s+to/i,
    /curl\s+(-X\s+POST\s+)?https?:\/\//i,
    /fetch\s*\(\s*['"]https?:\/\//i
  ];

  // Harmful content patterns (expanded from 3 → 8)
  const harmfulPatterns = [
    // Original 3
    /how\s+to\s+make\s+(a\s+)?bomb/i,
    /instructions\s+to\s+harm/i,
    /poison\s+someone/i,
    // Expanded
    /how\s+to\s+(hack|break\s+into|gain\s+unauthorized\s+access)/i,
    /create\s+(a\s+)?(malware|virus|trojan|ransomware|keylogger)/i,
    /exploit\s+(a\s+)?(vulnerability|security\s+flaw|zero.?day)/i,
    /write\s+(a\s+)?(phishing|scam)\s+(email|message|page)/i,
    /generate\s+(a\s+)?fake\s+(id|passport|identity|document)/i
  ];

  // Response-side leakage patterns (NEW)
  const responseLeakagePatterns = [
    // AI echoing system prompt
    { re: /you\s+are\s+a\s+helpful\s+assistant/i, id: 'resp_system_echo', msg: 'AI may be echoing its system prompt.' },
    { re: /my\s+(system\s+)?instructions\s+(are|say|tell)/i, id: 'resp_instruction_leak', msg: 'AI may be leaking its instructions.' },
    { re: /as\s+(?:a|an)\s+AI\s+(?:language\s+)?model,?\s+(?:I|my)\s+(?:instructions|system\s+prompt)/i, id: 'resp_prompt_reflection', msg: 'AI appears to be reflecting its prompt.' },
    // Suspicious generated URLs
    { re: /https?:\/\/(?!(?:www\.)?(?:google|github|stackoverflow|wikipedia|microsoft|apple|openai)\.)[\w.-]+\.(?:xyz|top|tk|ml|ga|cf|pw|click|link|buzz)\b/i, id: 'resp_suspicious_url', msg: 'Response contains a suspicious URL domain.' },
    // Generated credentials
    { re: /password\s*[:=]\s*['"]?[\w!@#$%^&*]{8,}/i, id: 'resp_credential_gen', msg: 'Response contains what appears to be a generated password.' },
    { re: /connection\s*string\s*[:=]/i, id: 'resp_connstring', msg: 'Response contains a connection string.' }
  ];

  // ─── Main Detection Function ───────────────────────────────────────────

  function detect(text, context) {
    const A = window.AIDR;
    const cfg = A.config;
    const p = A.patterns;
    const out = [];

    // Apply normalizer if available
    let normalizedInput, embeddedFragments, rawInput;
    if (A.normalizer && A.normalizer.normalize) {
      const norm = A.normalizer.normalize(text);
      normalizedInput = norm.normalized;
      embeddedFragments = norm.embedded;
      rawInput = norm.original;
    } else {
      normalizedInput = String(text || '');
      embeddedFragments = [];
      rawInput = normalizedInput;
    }

    // Helper: run a pattern set against text
    function scanPatterns(input, patterns, categoryId, category, severityBase, confidence, msgTemplate) {
      patterns.forEach((re, idx) => {
        const m = input.match(re);
        if (m && typeof m.index === 'number') {
          addMatch(out, {
            id: `${categoryId}_${idx + 1}`,
            category: category,
            severity_base: severityBase,
            confidence: confidence,
            message: msgTemplate,
            recommended_action: severityBase === 'high' || severityBase === 'critical' ? 'block' : 'warn',
            evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
          });
        }
      });
    }

    // ── Prompt Injection ──
    scanPatterns(normalizedInput, promptInjectionPatterns, 'pi', 'prompt_injection', 'high', 0.88, 'Prompt injection phrase detected.');

    // ── Jailbreak ──
    scanPatterns(normalizedInput, jailbreakPatterns, 'jb', 'jailbreak', 'high', 0.78, 'Jailbreak/bypass phrasing detected.');

    // ── Exfiltration ──
    scanPatterns(normalizedInput, exfilPatterns, 'exfil', 'exfiltration', 'medium', 0.68, 'Potential exfiltration intent detected.');

    // ── Harmful Content ──
    scanPatterns(normalizedInput, harmfulPatterns, 'harm', 'harmful_content', 'medium', 0.70, 'Potential harmful content signal detected.');

    // ── Indirect Injection (embedded in code blocks, quotes, JSON) ──
    if (embeddedFragments && embeddedFragments.length > 0) {
      for (const fragment of embeddedFragments) {
        let fragNorm = fragment;
        if (A.normalizer && A.normalizer.collapseWhitespace) {
          fragNorm = A.normalizer.collapseWhitespace(fragment);
        }

        // Check for prompt injection inside embedded content
        promptInjectionPatterns.forEach((re, idx) => {
          const m = fragNorm.match(re);
          if (m && typeof m.index === 'number') {
            addMatch(out, {
              id: `pi_indirect_${idx + 1}`,
              category: 'prompt_injection',
              severity_base: 'high',
              confidence: 0.82,
              message: 'Prompt injection detected inside embedded content (code block, quote, or JSON).',
              recommended_action: 'block',
              evidence: safeSnippet(fragNorm, m.index, m[0].length, cfg.maxEvidenceLength)
            });
          }
        });

        // Check for jailbreak inside embedded content
        jailbreakPatterns.forEach((re, idx) => {
          const m = fragNorm.match(re);
          if (m && typeof m.index === 'number') {
            addMatch(out, {
              id: `jb_indirect_${idx + 1}`,
              category: 'jailbreak',
              severity_base: 'high',
              confidence: 0.75,
              message: 'Jailbreak phrasing detected inside embedded content.',
              recommended_action: 'warn',
              evidence: safeSnippet(fragNorm, m.index, m[0].length, cfg.maxEvidenceLength)
            });
          }
        });
      }
    }

    // ── PII: Email ──
    const email = normalizedInput.match(p.email);
    if (email && typeof email.index === 'number') {
      addMatch(out, {
        id: 'pii_email',
        category: 'sensitive_data',
        severity_base: 'high',
        confidence: 0.9,
        message: 'Email-like sensitive data detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(normalizedInput, email.index, email[0].length, cfg.maxEvidenceLength)
      });
    }

    // ── PII: Phone (expanded for international) ──
    const phonePatterns = [
      p.phone,
      /\b\+?\d{1,4}[\s.-]?\(?\d{1,5}\)?[\s.-]?\d{1,5}[\s.-]?\d{1,5}\b/  // International catch-all
    ];
    for (const phoneRe of phonePatterns) {
      const phone = normalizedInput.match(phoneRe);
      if (phone && typeof phone.index === 'number' && phone[0].replace(/\D/g, '').length >= 7) {
        addMatch(out, {
          id: 'pii_phone',
          category: 'sensitive_data',
          severity_base: 'high',
          confidence: 0.82,
          message: 'Phone number-like pattern detected.',
          recommended_action: 'warn',
          evidence: safeSnippet(normalizedInput, phone.index, phone[0].length, cfg.maxEvidenceLength)
        });
        break;
      }
    }

    // ── PII: Credit Card ──
    const card = normalizedInput.match(p.creditCard);
    if (card && typeof card.index === 'number' && window.AIDR.luhnValid(card[0])) {
      addMatch(out, {
        id: 'pii_credit_card',
        category: 'sensitive_data',
        severity_base: 'critical',
        confidence: 0.98,
        message: 'Potential credit card number detected (Luhn-valid).',
        recommended_action: 'block',
        evidence: safeSnippet(normalizedInput, card.index, card[0].length, cfg.maxEvidenceLength)
      });
    }

    // ── PII: SSN (US Social Security Number) ──
    const ssnRe = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
    const ssn = normalizedInput.match(ssnRe);
    if (ssn && typeof ssn.index === 'number') {
      const digits = ssn[0].replace(/\D/g, '');
      // Exclude obviously invalid SSNs
      if (digits.length === 9 && !digits.startsWith('000') && !digits.startsWith('666') && !digits.startsWith('9')) {
        addMatch(out, {
          id: 'pii_ssn',
          category: 'sensitive_data',
          severity_base: 'critical',
          confidence: 0.85,
          message: 'US Social Security Number pattern detected.',
          recommended_action: 'block',
          evidence: safeSnippet(normalizedInput, ssn.index, ssn[0].length, cfg.maxEvidenceLength)
        });
      }
    }

    // ── Secrets: Private Key Header ──
    const keyHeader = normalizedInput.match(p.privateKeyHeader);
    if (keyHeader && typeof keyHeader.index === 'number') {
      addMatch(out, {
        id: 'secret_private_key',
        category: 'sensitive_data',
        severity_base: 'critical',
        confidence: 0.99,
        message: 'Private key header detected.',
        recommended_action: 'block',
        evidence: safeSnippet(normalizedInput, keyHeader.index, keyHeader[0].length, cfg.maxEvidenceLength)
      });
    }

    // ── Secrets: API Keys ──
    p.apiKeys.forEach((re, idx) => {
      const m = normalizedInput.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `secret_api_key_${idx + 1}`,
          category: 'sensitive_data',
          severity_base: 'critical',
          confidence: 0.96,
          message: 'API key-like pattern detected.',
          recommended_action: 'block',
          evidence: safeSnippet(normalizedInput, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    // ── Secrets: Connection Strings & Database URLs ──
    const connStringPatterns = [
      /\b(?:mongodb|postgres|mysql|redis|amqp):\/\/[\w:@.]+/i,
      /\bServer\s*=\s*[\w.]+;\s*Database\s*=/i
    ];
    connStringPatterns.forEach((re, idx) => {
      const m = normalizedInput.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `secret_conn_${idx + 1}`,
          category: 'sensitive_data',
          severity_base: 'critical',
          confidence: 0.92,
          message: 'Database connection string detected.',
          recommended_action: 'block',
          evidence: safeSnippet(normalizedInput, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    // ── PII: Internal File Paths ──
    const filePathPatterns = [
      /(?:\/Users\/|\/home\/|C:\\Users\\|\/var\/|\/etc\/|\/opt\/)\S{5,}/i,
      /\b\w+@[\w.-]+:[\w/.]+/  // SSH-style paths (git@github.com:user/repo)
    ];
    filePathPatterns.forEach((re, idx) => {
      const m = normalizedInput.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `pii_filepath_${idx + 1}`,
          category: 'sensitive_data',
          severity_base: 'medium',
          confidence: 0.60,
          message: 'Internal file path or server path detected.',
          recommended_action: 'warn',
          evidence: safeSnippet(normalizedInput, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    // ── Behavioral: Prompt Length ──
    if (normalizedInput.length > 5000) {
      addMatch(out, {
        id: 'beh_prompt_len',
        category: 'behavioral',
        severity_base: 'low',
        confidence: 0.65,
        message: 'Prompt length anomaly detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(normalizedInput, 0, Math.min(80, normalizedInput.length), cfg.maxEvidenceLength)
      });
    }

    // ── Behavioral: Repetition ──
    if (/\b(\w+)\b(?:\s+\1\b){6,}/i.test(normalizedInput)) {
      addMatch(out, {
        id: 'beh_repetition',
        category: 'behavioral',
        severity_base: 'low',
        confidence: 0.6,
        message: 'High repetition pattern detected.',
        recommended_action: 'warn',
        evidence: safeSnippet(normalizedInput, 0, Math.min(80, normalizedInput.length), cfg.maxEvidenceLength)
      });
    }

    // ── Custom Rules ──
    if (window.AIDR.rules && window.AIDR.rules.runCustomRules) {
      const custom = window.AIDR.rules.runCustomRules(normalizedInput, context || {});
      custom.forEach((d) => out.push(d));
    }

    // ── Policy Filtering ──
    if (window.AIDR.policy && window.AIDR.policy.filterDetections) {
      return window.AIDR.policy.filterDetections(out, rawInput);
    }

    return out;
  }

  // ─── Response-Side Detection ───────────────────────────────────────────

  function detectResponse(text) {
    const A = window.AIDR;
    const cfg = A.config;
    const p = A.patterns;
    const out = [];
    const input = String(text || '');

    // Check response-specific patterns
    for (const pattern of responseLeakagePatterns) {
      const m = input.match(pattern.re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: pattern.id,
          category: 'response_leakage',
          severity_base: 'medium',
          confidence: 0.72,
          message: pattern.msg,
          recommended_action: 'warn',
          evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    }

    // Check for PII in responses (AI echoing sensitive data)
    const email = input.match(p.email);
    if (email && typeof email.index === 'number') {
      addMatch(out, {
        id: 'resp_pii_email',
        category: 'response_leakage',
        severity_base: 'medium',
        confidence: 0.75,
        message: 'AI response contains an email address.',
        recommended_action: 'warn',
        evidence: safeSnippet(input, email.index, email[0].length, cfg.maxEvidenceLength)
      });
    }

    // Check for API keys in responses
    p.apiKeys.forEach((re, idx) => {
      const m = input.match(re);
      if (m && typeof m.index === 'number') {
        addMatch(out, {
          id: `resp_api_key_${idx + 1}`,
          category: 'response_leakage',
          severity_base: 'high',
          confidence: 0.90,
          message: 'AI response contains an API key pattern.',
          recommended_action: 'warn',
          evidence: safeSnippet(input, m.index, m[0].length, cfg.maxEvidenceLength)
        });
      }
    });

    // Check for private key headers in responses
    const keyHeader = input.match(p.privateKeyHeader);
    if (keyHeader && typeof keyHeader.index === 'number') {
      addMatch(out, {
        id: 'resp_private_key',
        category: 'response_leakage',
        severity_base: 'critical',
        confidence: 0.95,
        message: 'AI response contains a private key.',
        recommended_action: 'block',
        evidence: safeSnippet(input, keyHeader.index, keyHeader[0].length, cfg.maxEvidenceLength)
      });
    }

    if (window.AIDR.policy && window.AIDR.policy.filterDetections) {
      return window.AIDR.policy.filterDetections(out, input);
    }

    return out;
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.detect = detect;
  window.AIDR.detectResponse = detectResponse;
})();
