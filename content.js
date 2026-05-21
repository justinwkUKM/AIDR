/**
 * Content script for ChatGPT Visible Token Counter.
 * Reads the input box, observes conversation messages, counts tokens,
 * and displays them in a floating panel.
 */

(function () {
  // Prevent double injection
  if (window.__tokenCounterInitialized) return;
  window.__tokenCounterInitialized = true;

  const DEFAULT_PROFILE = {
    formSelectors: [
      'form[data-type="unified-composer"]',
      'form:has(textarea)',
      'form'
    ],
    inputSelectors: [
      'textarea[name="prompt-textarea"]',
      '#prompt-textarea',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      '[aria-label*="message" i]',
      '[aria-label*="prompt" i]',
      '[placeholder*="ask" i]',
      '[placeholder*="message" i]'
    ],
    sendSelectors: [
      '#composer-submit-button',
      'button[data-testid="send-button"]',
      'button[data-testid*="send"]',
      'button[aria-label*="send" i]',
      'button[type="submit"]'
    ],
    composerContextSelectors: [
      'form',
      '[role="form"]',
      '[class*="composer"]',
      '[class*="chat-input"]',
      '[class*="prompt"]'
    ]
  };

  const SITE_PROFILES = [
    {
      hosts: ['chatgpt.com', 'chat.openai.com'],
      formSelectors: ['form[data-type="unified-composer"]', '#thread-bottom form'],
      inputSelectors: ['textarea[name="prompt-textarea"]', '#prompt-textarea', 'div[contenteditable="true"]'],
      sendSelectors: ['#composer-submit-button', 'button[data-testid="send-button"]']
    },
    {
      hosts: ['claude.ai'],
      inputSelectors: ['div[contenteditable="true"][role="textbox"]', 'textarea', '[aria-label*="Message Claude" i]'],
      sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]']
    },
    {
      hosts: ['gemini.google.com'],
      inputSelectors: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'textarea'],
      sendSelectors: ['button[aria-label*="Send message" i]', 'button[type="submit"]']
    },
    {
      hosts: ['perplexity.ai'],
      inputSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
      sendSelectors: ['button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]', 'button[type="submit"]']
    },
    {
      hosts: ['poe.com'],
      inputSelectors: ['textarea', 'div[contenteditable="true"]'],
      sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]']
    },
    {
      hosts: ['grok.com', 'x.com', 'twitter.com'],
      inputSelectors: ['div[contenteditable="true"][role="textbox"]', 'textarea'],
      sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]']
    },
    {
      hosts: ['copilot.microsoft.com', 'bing.com'],
      inputSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
      sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]']
    }
  ];

  function hostMatches(candidate, host) {
    return host === candidate || host.endsWith('.' + candidate);
  }

  function getSiteProfile() {
    const host = window.location.hostname;
    const site = SITE_PROFILES.find((p) => (p.hosts || []).some((h) => hostMatches(h, host)));
    return {
      formSelectors: site && site.formSelectors ? site.formSelectors : DEFAULT_PROFILE.formSelectors,
      inputSelectors: site && site.inputSelectors ? site.inputSelectors : DEFAULT_PROFILE.inputSelectors,
      sendSelectors: site && site.sendSelectors ? site.sendSelectors : DEFAULT_PROFILE.sendSelectors,
      composerContextSelectors: site && site.composerContextSelectors ? site.composerContextSelectors : DEFAULT_PROFILE.composerContextSelectors
    };
  }

  const ACTIVE_PROFILE = getSiteProfile();

  function firstQuery(selectors, root) {
    const scope = root || document;
    for (const selector of selectors) {
      try {
        const found = scope.querySelector(selector);
        if (found) return found;
      } catch (_) {
        // Ignore invalid selectors on older engines.
      }
    }
    return null;
  }

  // --------------------------
  // DOM Reading Helpers
  // --------------------------

  function getComposerForm(el) {
    if (el && el.closest) {
      for (const selector of ACTIVE_PROFILE.formSelectors) {
        try {
          const fromTarget = el.closest(selector);
          if (fromTarget) return fromTarget;
        } catch (_) {
          // Ignore invalid selector for this browser.
        }
      }
    }
    return firstQuery(ACTIVE_PROFILE.formSelectors, document);
  }

  function getInputText(form) {
    const composerForm = form || getComposerForm(document.activeElement);
    if (!composerForm) return '';

    const candidates = [];
    for (const selector of ACTIVE_PROFILE.inputSelectors) {
      try {
        const node = composerForm.querySelector(selector);
        if (!node) continue;
        if (typeof node.value === 'string') candidates.push(node.value || '');
        if (typeof node.innerText === 'string') candidates.push(node.innerText || '');
        if (typeof node.textContent === 'string') candidates.push(node.textContent || '');
      } catch (_) {
        // Ignore invalid selector.
      }
    }

    const active = document.activeElement;
    if (active && active.closest && getComposerForm(active)) {
      if (typeof active.value === 'string') candidates.push(active.value || '');
      if (typeof active.innerText === 'string') candidates.push(active.innerText || '');
      if (typeof active.textContent === 'string') candidates.push(active.textContent || '');
    }

    return candidates
      .map((s) => String(s || '').trim())
      .sort((a, b) => b.length - a.length)[0] || '';
  }

  function getConversationMessages() {
    const messageNodes = document.querySelectorAll('[data-message-author-role]');

    return Array.from(messageNodes).map((node) => ({
      role: node.getAttribute('data-message-author-role'),
      text: node.innerText || '',
    }));
  }

  function calculateTotals() {
    const messages = getConversationMessages();

    let userTokens = 0;
    let assistantTokens = 0;
    let paynetCount = 0;

    for (const message of messages) {
      const count = window.estimateTokens(message.text);

      if (message.role === 'user') {
        userTokens += count;
      }

      if (message.role === 'assistant') {
        assistantTokens += count;
      }

      // Count "paynet" occurrences (case-insensitive, with or without dash)
      paynetCount += window.countPaynetOccurrences(message.text);
    }

    return {
      userTokens,
      assistantTokens,
      totalTokens: userTokens + assistantTokens,
      paynetCount,
    };
  }

  // --------------------------
  // Model Detection
  // --------------------------

  /**
   * Mapping from model names shown in ChatGPT UI to our MODEL_PRICING keys.
   */
  const MODEL_NAME_MAP = {
    'gpt-5.5': 'gpt-5.5',
    'gpt-5': 'gpt-5',
    'gpt 5.5': 'gpt-5.5',
    'gpt 5': 'gpt-5',
    'gpt-4o': 'gpt-4o',
    'gpt 4o': 'gpt-4o',
    'gpt-4o mini': 'gpt-4o-mini',
    'gpt 4o mini': 'gpt-4o-mini',
    'gpt-4': 'gpt-4',
    'gpt 4': 'gpt-4',
    'gpt-3.5': 'gpt-3.5-turbo',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
    'o3-mini': 'o3-mini',
    'o3 mini': 'o3-mini',
    'o1': 'o1',
    'o1-mini': 'o1-mini',
    'o1 mini': 'o1-mini',
  };

  /**
   * Attempts to auto-detect the current model from the ChatGPT UI.
   * Tries multiple strategies: data attributes, UI elements, and page state.
   */
  function detectCurrentModel() {
    // Strategy 1: Look for model name in common UI locations
    const modelSelectors = [
      // Model selector button/text in header
      'button[data-testid="model-switcher"]',
      'div[data-testid="model-switcher"]',
      // Any element containing model name
      '[data-model-label]',
    ];

    for (const selector of modelSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = (el.textContent || el.getAttribute('data-model-label') || '').trim().toLowerCase();
        if (text && MODEL_NAME_MAP[text]) {
          return MODEL_NAME_MAP[text];
        }
      }
    }

    // Strategy 2: Scan all elements for model name indicators
    const allText = document.body.textContent.toLowerCase();
    for (const [uiName, modelKey] of Object.entries(MODEL_NAME_MAP)) {
      // Look for "gpt-5.5", "gpt-4o", etc. in visible UI text
      const regex = new RegExp('\\b' + uiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (regex.test(allText)) {
        // Only match if it appears in a header/title-like element, not in conversation text
        const headers = document.querySelectorAll('h1, h2, h3, header, [class*="model"], [class*="header"]');
        for (const header of headers) {
          if (regex.test(header.textContent)) {
            return modelKey;
          }
        }
      }
    }

    // Strategy 3: Check window __NEXT_DATA__ for model info (ChatGPT uses Next.js)
    try {
      const nextData = window.__NEXT_DATA__;
      if (nextData && nextData.props) {
        const json = JSON.stringify(nextData.props);
        for (const [uiName, modelKey] of Object.entries(MODEL_NAME_MAP)) {
          if (json.toLowerCase().includes(uiName.toLowerCase())) {
            return modelKey;
          }
        }
      }
    } catch (e) {
      // Ignore errors reading __NEXT_DATA__
    }

    // Default fallback
    return 'gpt-4o';
  }

  // --------------------------
  // Caching for Analysis Results
  // --------------------------

  /**
   * Simple cache to avoid re-analyzing identical text.
   * Maps text content -> analysis result.
   */
  const analysisCache = new Map();
  const MAX_CACHE_SIZE = 50;

  /**
   * Get a simple hash of a string for cache keys.
   */
  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return String(hash);
  }

  /**
   * Cached sentiment analysis.
   */
  function cachedAnalyzeSentiment(text) {
    const key = 'sent:' + simpleHash(text);
    if (analysisCache.has(key)) {
      return analysisCache.get(key);
    }
    const result = window.analyzeSentiment(text);
    if (analysisCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry
      const oldestKey = analysisCache.keys().next().value;
      analysisCache.delete(oldestKey);
    }
    analysisCache.set(key, result);
    return result;
  }

  /**
   * Cached topic extraction.
   */
  function cachedExtractTopics(text, maxTopics) {
    const key = 'topic:' + maxTopics + ':' + simpleHash(text);
    if (analysisCache.has(key)) {
      return analysisCache.get(key);
    }
    const result = window.extractTopics(text, maxTopics);
    if (analysisCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = analysisCache.keys().next().value;
      analysisCache.delete(oldestKey);
    }
    analysisCache.set(key, result);
    return result;
  }

  // --------------------------
  // Floating Panel UI
  // --------------------------

  // Auto-detect model on load, allow manual override
  let selectedModel = detectCurrentModel();
  manualModelOverride = false;

  // AIDR is only enabled on ChatGPT / OpenAI sites
  function isAidrEnabledHost() {
    const host = window.location.hostname;
    return host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com') || host.endsWith('.chat.openai.com');
  }

  const aidrEngine = (isAidrEnabledHost() && window.AIDR && window.AIDR.createEngine)
    ? window.AIDR.createEngine()
    : null;
  if (isAidrEnabledHost() && window.AIDR && window.AIDR.policy && window.AIDR.policy.init) {
    window.AIDR.policy.init();
  }
  const sendRiskHistory = [];
  const cooldownByFingerprint = new Map();

  let panelVisible = true;

  function togglePanelVisibility() {
    const panel = document.getElementById('chatgpt-token-counter');
    const toggleBtn = document.getElementById('ctc-toggle-btn');
    if (!panel) return;

    panelVisible = !panelVisible;
    panel.style.display = panelVisible ? 'block' : 'none';

    // Show/hide the floating toggle button
    if (toggleBtn) {
      toggleBtn.style.display = panelVisible ? 'none' : 'flex';
    }
  }

  function createPanel() {
    // Remove existing panel and toggle button if any
    const existing = document.getElementById('chatgpt-token-counter');
    if (existing) existing.remove();
    const existingBtn = document.getElementById('ctc-toggle-btn');
    if (existingBtn) existingBtn.remove();

    const panel = document.createElement('div');
    panel.id = 'chatgpt-token-counter';

    // Build model selector options
    const modelOptions = Object.entries(window.MODEL_PRICING).map(([key, val]) => {
      const selected = key === selectedModel ? ' selected' : '';
      return `<option value="${key}"${selected}>${val.name}</option>`;
    }).join('');

    panel.innerHTML = `
      <div class="ctc-title">
        Token Counter
        <button id="ctc-hide-btn" title="Hide panel">─</button>
      </div>
      <div class="ctc-model-select">
        <label>Model:</label>
        <select id="ctc-model">${modelOptions}</select>
      </div>
      <div>Prompt: <span id="ctc-prompt">0</span></div>
      <div>User total: <span id="ctc-user">0</span></div>
      <div>Assistant total: <span id="ctc-assistant">0</span></div>
      <div>Total: <span id="ctc-total">0</span></div>
      <div class="ctc-cost">Est. cost: <span id="ctc-cost">< $0.001</span></div>
      <div class="ctc-sentiment">Last: <span id="ctc-last-sentiment">--</span></div>
      <div class="ctc-sentiment">Overall: <span id="ctc-overall-sentiment">--</span></div>
      <div class="ctc-topics">🔑 Last: <span id="ctc-last-topics">--</span></div>
      <div class="ctc-topics">🔑 Overall: <span id="ctc-overall-topics">--</span></div>
      <div>"paynet" mentions: <span id="ctc-paynet">0</span></div>
      <div class="ctc-topics">AIDR mode: <span id="ctc-aidr-mode-state">enforcement</span></div>
      <div class="ctc-topics">
        <button id="ctc-aidr-mode-toggle" type="button">Toggle Mode</button>
        <button id="ctc-aidr-pause-15" type="button">Pause</button>
        <button id="ctc-aidr-resume" type="button">Resume</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Create floating toggle button (shown when panel is hidden)
    const toggleBtn = document.createElement('div');
    toggleBtn.id = 'ctc-toggle-btn';
    toggleBtn.title = 'Show Token Counter';
    toggleBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="white" stroke-width="1.5" fill="rgba(255,255,255,0.05)"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="12" font-weight="700" font-family="system-ui, sans-serif">T</text></svg>`;
    toggleBtn.style.display = 'none';
    document.body.appendChild(toggleBtn);

    // Hide button click
    const hideBtn = document.getElementById('ctc-hide-btn');
    hideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanelVisibility();
    });

    // Toggle button click
    toggleBtn.addEventListener('click', () => {
      togglePanelVisibility();
    });

    // Set dropdown to detected model
    const modelSelect = document.getElementById('ctc-model');
    modelSelect.value = selectedModel;

    // Listen for manual model changes
    modelSelect.addEventListener('change', (e) => {
      selectedModel = e.target.value;
      manualModelOverride = true;
      updatePanel();
    });

    const modeStateEl = document.getElementById('ctc-aidr-mode-state');
    const modeToggleBtn = document.getElementById('ctc-aidr-mode-toggle');
    const pauseBtn = document.getElementById('ctc-aidr-pause-15');
    const resumeBtn = document.getElementById('ctc-aidr-resume');

    async function refreshPolicyState() {
      if (!window.AIDR || !window.AIDR.policy || !modeStateEl) return;
      await window.AIDR.policy.init();
      const st = window.AIDR.policy.getStateSync();
      modeStateEl.textContent = st.mode + (window.AIDR.policy.isSessionPaused() ? ' (paused)' : '');
    }

    function downloadTextFile(filename, text, mime) {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    if (modeToggleBtn) {
      modeToggleBtn.addEventListener('click', async () => {
        if (!window.AIDR || !window.AIDR.policy) return;
        const st = window.AIDR.policy.getStateSync();
        await window.AIDR.policy.setMode(st.mode === 'enforcement' ? 'shadow' : 'enforcement');
        await refreshPolicyState();
      });
    }
    if (pauseBtn) {
      pauseBtn.addEventListener('click', async () => {
        if (!window.AIDR || !window.AIDR.policy) return;
        await window.AIDR.policy.pauseSession(15);
        await refreshPolicyState();
      });
    }
    if (resumeBtn) {
      resumeBtn.addEventListener('click', async () => {
        if (!window.AIDR || !window.AIDR.policy) return;
        await window.AIDR.policy.resumeSession();
        await refreshPolicyState();
      });
    }
    refreshPolicyState();
  }

  function isPromptElement(el) {
    if (!el) return false;
    for (const selector of ACTIVE_PROFILE.inputSelectors) {
      try {
        if (el.matches && el.matches(selector)) return true;
        if (el.closest && el.closest(selector)) return true;
      } catch (_) {
        // Ignore selector errors.
      }
    }
    return false;
  }

  function isComposerContext(el) {
    if (!el || !el.closest) return false;
    for (const selector of ACTIVE_PROFILE.composerContextSelectors.concat(ACTIVE_PROFILE.formSelectors)) {
      try {
        if (el.closest(selector)) return true;
      } catch (_) {
        // Ignore selector errors.
      }
    }
    return false;
  }

  function promptFingerprint(text) {
    return String(text || '').trim().slice(0, 140);
  }

  function detectionFingerprint(result) {
    const ids = result.detections.map((d) => d.id).sort().join(',');
    return `${result.severity}|${ids}`;
  }

  function evaluatePromptForEnforcement(text) {
    if (!isAidrEnabledHost()) return { severity: 'safe', risk: 0, detections: [] };
    if (!window.AIDR || !window.AIDR.detect || !window.AIDR.score) {
      return { severity: 'safe', risk: 0, detections: [] };
    }
    const detections = window.AIDR.detect(text);
    const score = window.AIDR.score(detections, sendRiskHistory);
    return {
      severity: score.severity,
      risk: score.risk,
      confidence: score.confidence,
      detections
    };
  }

  function persistEnforcementEvent(direction, result) {
    if (!window.AIDR || !window.AIDR.logger || !window.AIDR.logger.logEvent) return;
    if (result.severity === 'safe') return;
    window.AIDR.logger.logEvent({
      ts: Date.now(),
      direction,
      risk: result.risk,
      severity: result.severity,
      confidence: result.confidence || 0,
      matched_rule_ids: result.detections.map((d) => d.id),
      categories: Array.from(new Set(result.detections.map((d) => d.category))),
      evidence_spans: result.detections.map((d) => d.evidence)
    });
  }

  function maybeBlockPromptSend(form) {
    const promptText = getInputText(form);
    const fp = promptFingerprint(promptText);
    if (!fp) return false;

    const result = evaluatePromptForEnforcement(promptText);
    sendRiskHistory.push({ ts: Date.now(), severity: result.severity, risk: result.risk });
    if (sendRiskHistory.length > 50) sendRiskHistory.shift();

    const renderPayload = {
      severity: result.severity,
      risk: result.risk,
      detections: result.detections,
      _promptText: promptText
    };
    // Store for upgradeToBanner() to access
    window._aidrLastResult = renderPayload;
    if (window.AIDR && window.AIDR.responder) {
      window.AIDR.responder.render(renderPayload);
    }

    const hasHardBlockCategory = result.detections.some((d) =>
      d && (d.category === 'prompt_injection' || d.category === 'jailbreak')
    );
    const shouldBlockBySeverity = result.severity === 'high' || result.severity === 'critical';
    if (!shouldBlockBySeverity && !hasHardBlockCategory) {
      return false;
    }

    if (!window.AIDR || !window.AIDR.policy || !window.AIDR.policy.isEnforcementActive()) {
      return false;
    }

    const now = Date.now();
    const cooldownKey = detectionFingerprint(result);
    const until = cooldownByFingerprint.get(cooldownKey) || 0;
    if (now < until) {
      result.suppressModal = true;
      return result;
    }
    cooldownByFingerprint.set(cooldownKey, now + (window.AIDR.config.cooldownMs || 45000));

    persistEnforcementEvent('prompt', result);
    return result;
  }

  function handleBlockedPrompt(result) {
    if (!window.AIDR || !window.AIDR.responder || !window.AIDR.responder.showBlockedNotice) return;
    window.AIDR.responder.showBlockedNotice(result);
  }

  function installTransportGuard() {
    if (!isAidrEnabledHost()) return;
    if (window.__aidrTransportGuardInstalled) return;
    window.__aidrTransportGuardInstalled = true;

    const script = document.createElement('script');
    if (!chrome || !chrome.runtime || !chrome.runtime.getURL) return;
    script.src = chrome.runtime.getURL('aidr/page-transport-guard.js');
    script.setAttribute('data-aidr-host', window.location.hostname);
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  // Keyboard shortcut: Ctrl+Shift+T to toggle panel
  if (isAidrEnabledHost()) installTransportGuard();

  window.addEventListener('aidr:transport-blocked', () => {
    handleBlockedPrompt({
      severity: 'critical',
      risk: 100,
      confidence: 1,
      detections: [{
        id: 'transport_pi_block',
        category: 'prompt_injection',
        message: 'Blocked at transport layer.'
      }]
    });
  }, true);

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.isComposing) return;
    if (e.key !== 'Enter') return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement;
    const inComposer = isComposerContext(e.target) || isComposerContext(active);
    if (!inComposer && !isPromptElement(e.target) && !isPromptElement(active)) return;

    const form = getComposerForm(e.target) || getComposerForm(active);
    if (!form) return;
    const enforcementResult = maybeBlockPromptSend(form);
    if (enforcementResult && enforcementResult.severity) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleBlockedPrompt(enforcementResult);
    }
  }, true);

  window.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    let button = null;
    if (e.target && e.target.closest) {
      for (const selector of ACTIVE_PROFILE.sendSelectors) {
        try {
          button = e.target.closest(selector);
          if (button) break;
        } catch (_) {
          // Ignore selector errors.
        }
      }
    }
    if (!button) return;
    const form = getComposerForm(button);
    if (!form) return;

    const enforcementResult = maybeBlockPromptSend(form);
    if (enforcementResult && enforcementResult.severity) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleBlockedPrompt(enforcementResult);
    }
  }, true);

  window.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || !form.matches || !form.matches('form[data-type=\"unified-composer\"]')) return;
    const enforcementResult = maybeBlockPromptSend(form);
    if (enforcementResult && enforcementResult.severity) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleBlockedPrompt(enforcementResult);
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      togglePanelVisibility();
    }
  });

  function updatePanel() {
    const promptText = getInputText();
    const promptTokens = window.estimateTokens(promptText);
    const totals = calculateTotals();

    // Fetch messages once and reuse for all analyses
    const messages = getConversationMessages();
    const lastMsg = messages.length ? messages[messages.length - 1].text : '';
    const lastRole = messages.length ? messages[messages.length - 1].role : '';
    const fullText = messages.map(m => m.text).join(' ');

    if (aidrEngine) {
      aidrEngine.analyzePrompt(promptText);
      if (lastRole === 'assistant') {
        aidrEngine.analyzeResponse(lastMsg);
      }
    }

    const promptEl = document.getElementById('ctc-prompt');
    const userEl = document.getElementById('ctc-user');
    const assistantEl = document.getElementById('ctc-assistant');
    const totalEl = document.getElementById('ctc-total');

    if (promptEl) promptEl.textContent = promptTokens;
    if (userEl) userEl.textContent = totals.userTokens;
    if (assistantEl) assistantEl.textContent = totals.assistantTokens;
    if (totalEl) totalEl.textContent = totals.totalTokens;

    // Calculate and display estimated cost
    const costEl = document.getElementById('ctc-cost');
    if (costEl) {
      const inputTokens = promptTokens + totals.userTokens;
      const outputTokens = totals.assistantTokens;
      const cost = window.calculateCost(inputTokens, outputTokens, selectedModel);
      costEl.textContent = window.formatCost(cost);
    }

    const paynetEl = document.getElementById('ctc-paynet');
    if (paynetEl) paynetEl.textContent = totals.paynetCount;

    // Sentiment: last message (cached)
    const lastSentEl = document.getElementById('ctc-last-sentiment');
    if (lastSentEl) {
      const lastResult = cachedAnalyzeSentiment(lastMsg);
      lastSentEl.textContent = sentimentEmoji(lastResult.label) + ' ' + lastResult.label;
      lastSentEl.className = 'ctc-sentiment-value ctc-sentiment-' + lastResult.label.toLowerCase();
    }

    // Sentiment: overall conversation (cached)
    const overallSentEl = document.getElementById('ctc-overall-sentiment');
    if (overallSentEl) {
      const overallResult = cachedAnalyzeSentiment(fullText);
      overallSentEl.textContent = sentimentEmoji(overallResult.label) + ' ' + overallResult.label;
      overallSentEl.className = 'ctc-sentiment-value ctc-sentiment-' + overallResult.label.toLowerCase();
    }

    // Topics: last message (cached)
    const lastTopicsEl = document.getElementById('ctc-last-topics');
    if (lastTopicsEl) {
      const lastTopics = cachedExtractTopics(lastMsg, 4);
      lastTopicsEl.textContent = lastTopics.length ? lastTopics.join(', ') : '--';
    }

    // Topics: overall conversation (cached)
    const overallTopicsEl = document.getElementById('ctc-overall-topics');
    if (overallTopicsEl) {
      const overallTopics = cachedExtractTopics(fullText, 5);
      overallTopicsEl.textContent = overallTopics.length ? overallTopics.join(', ') : '--';
    }
  }

  function sentimentEmoji(label) {
    if (label === 'Positive') return '\u{1F60A}';  // 😊
    if (label === 'Negative') return '\u{1F61E}';  // 😞
    return '\u{1F610}';  // 😐
  }

  // --------------------------
  // DOM Observation
  // --------------------------

  function startObserver() {
    let debounceTimer;
    let typingIdleTimer;

    const observer = new MutationObserver(() => {
      // Debounce updates to avoid excessive recalculations
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updatePanel, 300);

      // Reset typing idle timer
      clearTimeout(typingIdleTimer);
      typingIdleTimer = setTimeout(() => {
        // User has stopped typing for 2s — upgrade inline indicator to banner
        if (window.AIDR && window.AIDR.responder && window.AIDR.responder.upgradeToBanner) {
          window.AIDR.responder.upgradeToBanner();
        }
      }, 2000);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Also listen for input events on the prompt area
    document.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updatePanel, 150);

      // Reset typing idle timer
      clearTimeout(typingIdleTimer);
      typingIdleTimer = setTimeout(() => {
        if (window.AIDR && window.AIDR.responder && window.AIDR.responder.upgradeToBanner) {
          window.AIDR.responder.upgradeToBanner();
        }
      }, 2000);
    }, true);

    // Periodic check in case mutations are missed
    setInterval(updatePanel, 5000);
  }

  // --------------------------
  // Initialize
  // --------------------------

  createPanel();
  updatePanel();
  startObserver();

  // Periodically re-detect model if not manually overridden
  setInterval(() => {
    if (!manualModelOverride) {
      const detected = detectCurrentModel();
      if (detected !== selectedModel) {
        selectedModel = detected;
        const modelSelect = document.getElementById('ctc-model');
        if (modelSelect) modelSelect.value = selectedModel;
        updatePanel();
      }
    }
  }, 10000);
})();
