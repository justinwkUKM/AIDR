/**
 * Content script for ChatGPT Visible Token Counter.
 * Reads the input box, observes conversation messages, counts tokens,
 * and displays them in a floating panel.
 */

(function () {
  // Prevent double injection
  if (window.__tokenCounterInitialized) return;
  window.__tokenCounterInitialized = true;

  // --------------------------
  // DOM Reading Helpers
  // --------------------------

  function getInputText() {
    const selectors = [
      'textarea',
      'div[contenteditable="true"]',
      '#prompt-textarea'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;

      if (el.tagName === 'TEXTAREA') {
        return el.value || '';
      }

      return el.innerText || '';
    }

    return '';
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
  let manualModelOverride = false;

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
  }

  // Keyboard shortcut: Ctrl+Shift+T to toggle panel
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
    const fullText = messages.map(m => m.text).join(' ');

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

    const observer = new MutationObserver(() => {
      // Debounce updates to avoid excessive recalculations
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updatePanel, 300);
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
