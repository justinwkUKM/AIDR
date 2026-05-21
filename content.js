(() => {
  // --------------------------
  // Site Profiles Setup
  // --------------------------
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
      } catch (_) {}
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
        } catch (_) {}
      }
    }
    return firstQuery(ACTIVE_PROFILE.formSelectors, document);
  }

  function getInputText(form) {
    const composerForm = form || getComposerForm(document.activeElement);
    if (!composerForm) return '';

    // Prioritize active element if it's an actual input/textarea inside the composer
    const active = document.activeElement;
    if (active && active.closest && getComposerForm(active)) {
      if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
        return String(active.value || '').trim();
      }
      if (active.getAttribute('contenteditable') === 'true' || active.contentEditable === 'true') {
        return String(active.innerText || '').trim();
      }
    }

    // Otherwise, check input selectors in strict order of priority
    for (const selector of ACTIVE_PROFILE.inputSelectors) {
      try {
        const node = composerForm.querySelector(selector);
        if (node) {
          if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
            return String(node.value || '').trim();
          }
          if (node.getAttribute('contenteditable') === 'true' || node.contentEditable === 'true') {
            return String(node.innerText || '').trim();
          }
        }
      } catch (_) {}
    }

    return '';
  }

  // --------------------------
  // AIDR Security State
  // --------------------------
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

  // Tab Scan Telemetry
  let promptsScannedCount = 0;
  let attacksBlockedCount = 0;
  let warningCount = 0;
  let tabIncidents = [];

  // --------------------------
  // Collapsible Sidebar UI
  // --------------------------
  let sidebarState = 'collapsed'; // 'collapsed' or 'expanded'

  async function initSidebarState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['aidrSidebarState'], (res) => {
        if (res.aidrSidebarState === 'expanded') {
          expandSidebar();
        } else {
          collapseSidebar();
        }
      });
    } else {
      collapseSidebar();
    }
  }

  function saveSidebarState(state) {
    sidebarState = state;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ aidrSidebarState: state });
    }
  }

  function expandSidebar() {
    const sidebar = document.getElementById('aidr-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('aidr-collapsed');
    sidebar.classList.add('aidr-expanded');
    saveSidebarState('expanded');
  }

  function collapseSidebar() {
    const sidebar = document.getElementById('aidr-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('aidr-expanded');
    sidebar.classList.add('aidr-collapsed');
    saveSidebarState('collapsed');
  }

  function toggleSidebar() {
    if (sidebarState === 'collapsed') {
      expandSidebar();
    } else {
      collapseSidebar();
    }
  }

  function createPanel() {
    // Clean up existing elements if any
    const existing = document.getElementById('aidr-sidebar');
    if (existing) existing.remove();

    const sidebar = document.createElement('div');
    sidebar.id = 'aidr-sidebar';
    sidebar.className = 'aidr-collapsed';

    sidebar.innerHTML = `
      <!-- Collapsed Ribbon Handle -->
      <div class="aidr-handle" id="aidr-handle">
        <div class="aidr-handle-logo">
          <img src="${chrome.runtime.getURL('icons/icon32.png')}" alt="AIDR" />
        </div>
        <div class="aidr-status-indicator pulse-green" id="aidr-status-indicator"></div>
        <div class="aidr-handle-arrow">◀</div>
      </div>

      <!-- Expanded Sidebar Content -->
      <div class="aidr-sidebar-container">
        <!-- Brand Header -->
        <div class="aidr-header">
          <div class="aidr-brand">
            <img src="${chrome.runtime.getURL('icons/icon32.png')}" class="aidr-logo" />
            <span class="aidr-title">AIDR Shield</span>
          </div>
          <button class="aidr-collapse-btn" id="aidr-collapse-btn">▶</button>
        </div>

        <!-- Protection State Status Card -->
        <div class="status-card">
          <div class="status-indicator-dot pulsing-blue" id="aidr-status-glow"></div>
          <div class="status-meta">
            <span class="status-label">PROTECTION STATE</span>
            <span class="status-mode" id="ctc-aidr-mode-state">Loading...</span>
          </div>
        </div>

        <!-- Telemetry Scan Metrics -->
        <div class="aidr-section">
          <h3 class="section-title">Telemetry & Scans</h3>
          <div class="metric-row">
            <span>Scanned Prompts</span>
            <span class="metric-val" id="aidr-stat-scanned">0</span>
          </div>
          <div class="metric-row">
            <span>Blocked Attacks</span>
            <span class="metric-val text-red" id="aidr-stat-blocked">0</span>
          </div>
          <div class="metric-row">
            <span>Triggered Warnings</span>
            <span class="metric-val text-yellow" id="aidr-stat-warnings">0</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-row total-row">
            <span>Tab Risk Level</span>
            <span class="metric-val text-glow-safe" id="aidr-tab-risk">SAFE (0)</span>
          </div>
        </div>

        <!-- Active Security Logs Feed -->
        <div class="aidr-section flex-expand">
          <h3 class="section-title">Active Incident Feed</h3>
          <div class="incident-log-container" id="aidr-incidents-feed">
            <div class="incident-empty-state">No security incidents detected.</div>
          </div>
        </div>

        <!-- Policy Controls -->
        <div class="aidr-section no-border">
          <h3 class="section-title">Policy Enforcement</h3>
          <div class="action-grid">
            <button id="ctc-aidr-mode-toggle" class="aidr-btn secondary">Toggle Shield</button>
            <button id="ctc-aidr-pause-15" class="aidr-btn warning">Pause 15m</button>
            <button id="ctc-aidr-resume" class="aidr-btn primary">Resume</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(sidebar);

    // Click event on collapsed handle to expand
    document.getElementById('aidr-handle').addEventListener('click', (e) => {
      e.stopPropagation();
      expandSidebar();
    });

    // Click event on close button to collapse
    document.getElementById('aidr-collapse-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      collapseSidebar();
    });

    // Interactive Button Listeners
    const modeStateEl = document.getElementById('ctc-aidr-mode-state');
    const statusGlowEl = document.getElementById('aidr-status-glow');
    const statusIndicatorEl = document.getElementById('aidr-status-indicator');
    const modeToggleBtn = document.getElementById('ctc-aidr-mode-toggle');
    const pauseBtn = document.getElementById('ctc-aidr-pause-15');
    const resumeBtn = document.getElementById('ctc-aidr-resume');

    async function refreshPolicyState() {
      if (!window.AIDR || !window.AIDR.policy || !modeStateEl) return;
      await window.AIDR.policy.init();
      const st = window.AIDR.policy.getStateSync();
      const isPaused = window.AIDR.policy.isSessionPaused();
      
      modeStateEl.textContent = st.mode + (isPaused ? ' (paused)' : '');

      if (isPaused) {
        modeStateEl.style.color = 'var(--aidr-warning)';
        if (statusGlowEl) statusGlowEl.style.background = 'var(--aidr-warning)';
        if (statusIndicatorEl) {
          statusIndicatorEl.className = 'aidr-status-indicator pulse-yellow';
        }
      } else if (st.mode === 'enforcement') {
        modeStateEl.style.color = '#fff';
        if (statusGlowEl) statusGlowEl.style.background = 'var(--aidr-accent)';
        if (statusIndicatorEl) {
          statusIndicatorEl.className = 'aidr-status-indicator pulse-green';
        }
      } else {
        // Shadow mode
        modeStateEl.style.color = 'var(--aidr-muted)';
        if (statusGlowEl) statusGlowEl.style.background = 'var(--aidr-muted)';
        if (statusIndicatorEl) {
          statusIndicatorEl.className = 'aidr-status-indicator';
          statusIndicatorEl.style.background = 'var(--aidr-muted)';
          statusIndicatorEl.style.boxShadow = 'none';
        }
      }
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
    initSidebarState();
  }

  function isPromptElement(el) {
    if (!el) return false;
    for (const selector of ACTIVE_PROFILE.inputSelectors) {
      try {
        if (el.matches && el.matches(selector)) return true;
        if (el.closest && el.closest(selector)) return true;
      } catch (_) {}
    }
    return false;
  }

  function isComposerContext(el) {
    if (!el || !el.closest) return false;
    for (const selector of ACTIVE_PROFILE.composerContextSelectors.concat(ACTIVE_PROFILE.formSelectors)) {
      try {
        if (el.closest(selector)) return true;
      } catch (_) {}
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

  // Registers security incidents into our UI list
  function logIncidentToFeed(severity, detections) {
    if (!detections || !detections.length) return;
    
    const feed = document.getElementById('aidr-incidents-feed');
    if (!feed) return;

    // Remove empty state placeholder
    const emptyState = feed.querySelector('.incident-empty-state');
    if (emptyState) emptyState.remove();

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    detections.forEach((d) => {
      const item = document.createElement('div');
      const isWarning = severity === 'low' || severity === 'medium';
      item.className = `incident-item${isWarning ? ' warning' : ''}`;

      item.innerHTML = `
        <div class="incident-header">
          <span class="incident-cat">${d.category || 'General threat'}</span>
          <span class="incident-time">${timestamp}</span>
        </div>
        <div class="incident-detail">${d.message || 'Triggered policy warning.'}</div>
      `;

      // Prepend to top of feed
      feed.insertBefore(item, feed.firstChild);
      tabIncidents.push({ time: timestamp, category: d.category, message: d.message, severity });
    });
  }

  function maybeBlockPromptSend(form) {
    const promptText = getInputText(form);
    const fp = promptFingerprint(promptText);
    if (!fp) return false;

    promptsScannedCount++;
    const result = evaluatePromptForEnforcement(promptText);
    sendRiskHistory.push({ ts: Date.now(), severity: result.severity, risk: result.risk });
    if (sendRiskHistory.length > 50) sendRiskHistory.shift();

    const renderPayload = {
      severity: result.severity,
      risk: result.risk,
      detections: result.detections,
      _promptText: promptText
    };
    
    window._aidrLastResult = renderPayload;
    if (window.AIDR && window.AIDR.responder) {
      window.AIDR.responder.render(renderPayload);
    }

    // Log warning or block to sidebar
    if (result.severity !== 'safe') {
      if (result.severity === 'high' || result.severity === 'critical') {
        attacksBlockedCount++;
      } else {
        warningCount++;
      }
      logIncidentToFeed(result.severity, result.detections);
    }

    updatePanelValues(result.severity, result.risk);

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

  if (isAidrEnabledHost()) installTransportGuard();

  window.addEventListener('aidr:transport-blocked', () => {
    attacksBlockedCount++;
    const blockDetections = [{
      id: 'transport_pi_block',
      category: 'prompt_injection',
      message: 'Blocked prompt injection attempt at network transport layer.'
    }];
    logIncidentToFeed('critical', blockDetections);
    updatePanelValues('critical', 100);

    handleBlockedPrompt({
      severity: 'critical',
      risk: 100,
      confidence: 1,
      detections: blockDetections
    });
  }, true);

  // pre-send keyboard submission intercept
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

  // click submit button intercept
  window.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    let button = null;
    if (e.target && e.target.closest) {
      for (const selector of ACTIVE_PROFILE.sendSelectors) {
        try {
          button = e.target.closest(selector);
          if (button) break;
        } catch (_) {}
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

  // standard form submit event intercept
  window.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form || !form.matches || !form.matches('form[data-type="unified-composer"]')) return;
    const enforcementResult = maybeBlockPromptSend(form);
    if (enforcementResult && enforcementResult.severity) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleBlockedPrompt(enforcementResult);
    }
  }, true);

  // Keyboard shortcut Ctrl+Shift+T to toggle expanding sidebar
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Updates the counters and safety levels shown in the expanded sidebar
  function updatePanelValues(maxSeverity, maxRisk) {
    const scannedEl = document.getElementById('aidr-stat-scanned');
    const blockedEl = document.getElementById('aidr-stat-blocked');
    const warningsEl = document.getElementById('aidr-stat-warnings');
    const riskEl = document.getElementById('aidr-tab-risk');

    if (scannedEl) scannedEl.textContent = promptsScannedCount;
    if (blockedEl) blockedEl.textContent = attacksBlockedCount;
    if (warningsEl) warningsEl.textContent = warningCount;

    if (riskEl) {
      let sev = (maxSeverity || 'SAFE').toUpperCase();
      let r = maxRisk || 0;

      riskEl.textContent = `${sev} (${r})`;

      if (sev === 'SAFE') {
        riskEl.className = 'metric-val text-glow-safe';
      } else if (sev === 'LOW' || sev === 'MEDIUM') {
        riskEl.className = 'metric-val text-glow-warning';
      } else {
        riskEl.className = 'metric-val text-glow-danger';
      }
    }
  }

  function updatePanel() {
    const promptText = getInputText();
    if (promptText && aidrEngine) {
      aidrEngine.analyzePrompt(promptText);
    }
    updatePanelValues('safe', 0);
  }

  // --------------------------
  // DOM Observation
  // --------------------------
  function startObserver() {
    let debounceTimer;
    let typingIdleTimer;

    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updatePanel, 300);

      clearTimeout(typingIdleTimer);
      typingIdleTimer = setTimeout(() => {
        const text = getInputText();
        if (text && isAidrEnabledHost() && window.AIDR && window.AIDR.detect) {
          const detections = window.AIDR.detect(text);
          if (detections && detections.length) {
            const hasCritical = detections.some(d => d.category === 'prompt_injection' || d.category === 'jailbreak');
            const sev = hasCritical ? 'critical' : 'medium';
            // Non-blocking real-time warning logging
            if (promptsScannedCount === 0 || tabIncidents.length === 0) {
              logIncidentToFeed(sev, detections);
              warningCount++;
              updatePanelValues(sev, hasCritical ? 85 : 45);
            }
          }
        }
      }, 1500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Initialize UI Elements
  if (document.body) {
    createPanel();
    startObserver();
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      createPanel();
      startObserver();
    });
  }
})();
