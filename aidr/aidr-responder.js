(function () {
  const BANNER_ID = 'aidr-warning-banner';
  const INDICATOR_ID = 'aidr-inline-indicator';

  // State
  let currentAlertState = 'none'; // 'none' | 'inline' | 'banner' | 'blocked'
  let currentFingerprint = '';
  let dismissedFingerprints = new Set(); // Per-detection dismiss (session-scoped)
  let collapseTimer = null;
  let isCollapsed = false;

  // ─── Human-readable label map ───────────────────────────────────────────
  const LABELS = {
    // Prompt injection
    pi_1: { icon: '💉', label: 'Prompt Injection', hint: 'Attempt to override system instructions' },
    pi_2: { icon: '💉', label: 'Prompt Injection', hint: 'Attempt to forget prior instructions' },
    pi_3: { icon: '💉', label: 'Prompt Injection', hint: 'Attempt to set a new system prompt' },
    pi_4: { icon: '💉', label: 'Prompt Injection', hint: 'Attempt to override safety rules' },
    // Jailbreak
    jb_1: { icon: '🔓', label: 'Jailbreak Attempt', hint: 'Unrestricted roleplay request' },
    jb_2: { icon: '🔓', label: 'Jailbreak Attempt', hint: 'Developer mode activation' },
    jb_3: { icon: '🔓', label: 'Jailbreak Attempt', hint: 'Safety bypass request' },
    jb_4: { icon: '🔓', label: 'Jailbreak Attempt', hint: 'DAN-style bypass' },
    // Exfiltration
    exfil_1: { icon: '📤', label: 'Data Exfiltration', hint: 'Request to export all data' },
    exfil_2: { icon: '📤', label: 'Data Exfiltration', hint: 'Attempt to send data to external URL' },
    exfil_3: { icon: '📤', label: 'Data Exfiltration', hint: 'Request to dump structured data' },
    exfil_4: { icon: '📤', label: 'Data Exfiltration', hint: 'Attempt to extract sensitive records' },
    // Harmful content
    harm_1: { icon: '⚠️', label: 'Harmful Content', hint: 'Potential weapon-related query' },
    harm_2: { icon: '⚠️', label: 'Harmful Content', hint: 'Instructions to cause harm' },
    harm_3: { icon: '⚠️', label: 'Harmful Content', hint: 'Poisoning-related query' },
    // PII / sensitive data
    pii_email:       { icon: '📧', label: 'Email Address',     hint: 'Personal email detected in prompt' },
    pii_phone:       { icon: '📱', label: 'Phone Number',      hint: 'Phone number detected in prompt' },
    pii_credit_card: { icon: '💳', label: 'Credit Card',       hint: 'Credit card number detected' },
    secret_private_key: { icon: '🔑', label: 'Private Key',    hint: 'Private key header detected' },
    secret_api_key_1:   { icon: '🗝️', label: 'API Key',        hint: 'OpenAI-style API key detected' },
    secret_api_key_2:   { icon: '🗝️', label: 'API Key',        hint: 'AWS access key detected' },
    secret_api_key_3:   { icon: '🗝️', label: 'API Key',        hint: 'GitHub token detected' },
    // Behavioral
    beh_prompt_len:  { icon: '📏', label: 'Unusual Length',    hint: 'Prompt length anomaly detected' },
    beh_repetition:  { icon: '🔁', label: 'Repetition Pattern', hint: 'High repetition detected' },
    // Transport guard
    transport_pi_block: { icon: '🛑', label: 'Transport Block', hint: 'Blocked at network layer' },
  };

  function getLabel(ruleId) {
    return LABELS[ruleId] || { icon: '⚡', label: ruleId, hint: 'Unknown detection' };
  }

  // ─── Group detections by human-readable category ────────────────────────
  function groupDetections(detections) {
    const groups = {};
    for (const d of (detections || [])) {
      const info = getLabel(d.id);
      const key = info.label;
      if (!groups[key]) {
        groups[key] = { icon: info.icon, label: key, hint: info.hint, ruleIds: [] };
      }
      groups[key].ruleIds.push(d.id);
    }
    return Object.values(groups);
  }

  // ─── Severity helpers ───────────────────────────────────────────────────
  const SEVERITY_ICONS = {
    low: 'ℹ️',
    medium: '⚠️',
    high: '🚨',
    critical: '🛑'
  };

  const SEVERITY_LABELS = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk'
  };

  const SEVERITY_DOT_COLORS = {
    low: '#f0ad4e',
    medium: '#ff9800',
    high: '#e74c3c',
    critical: '#c0392b'
  };

  // ─── Fingerprint for deduplication ──────────────────────────────────────
  function detectionFingerprint(result) {
    if (!result || !result.detections) return '';
    const ids = (result.detections || []).map((d) => d.id).sort().join(',');
    return `${result.severity}|${ids}`;
  }

  // ─── Inline Indicator (subtle dot shown during typing) ──────────────────
  function ensureIndicator() {
    let el = document.getElementById(INDICATOR_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = INDICATOR_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    return el;
  }

  function showInlineIndicator(severity, hint) {
    // Remove banner if showing (downgrade)
    hideBanner();

    const dot = ensureIndicator();
    const color = SEVERITY_DOT_COLORS[severity] || SEVERITY_DOT_COLORS.low;
    const tooltip = hint || 'Potential issue detected — reviewing as you type';

    dot.className = `aidr-inline-indicator aidr-${severity}`;
    dot.innerHTML = `
      <span class="aidr-indicator-dot" style="background-color:${color}"></span>
      <span class="aidr-indicator-tooltip">${tooltip}</span>
    `;
    dot.style.display = 'block';
    currentAlertState = 'inline';
  }

  function hideIndicator() {
    const el = document.getElementById(INDICATOR_ID);
    if (el) el.style.display = 'none';
    if (currentAlertState === 'inline') currentAlertState = 'none';
  }

  // ─── Banner DOM helpers ─────────────────────────────────────────────────
  function ensureBanner() {
    let banner = document.getElementById(BANNER_ID);
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.display = 'none';
    document.body.appendChild(banner);
    return banner;
  }

  function hideBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (banner) {
      banner.style.display = 'none';
      banner.classList.remove('aidr-collapsed');
    }
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
    isCollapsed = false;
    if (currentAlertState === 'banner') currentAlertState = 'none';
  }

  function severityClass(severity) {
    return `aidr-${severity}`;
  }

  // ─── Build structured HTML banner content ──────────────────────────────
  function setBannerContent(banner, result, blocked) {
    const severity = (result.severity || 'safe').toLowerCase();
    const risk = Math.round(Number(result.risk || 0) * 10) / 10;
    const groups = groupDetections(result.detections);
    const sevIcon = SEVERITY_ICONS[severity] || '⚡';
    const sevLabel = SEVERITY_LABELS[severity] || 'Risk Detected';

    const itemsHtml = groups.slice(0, 5).map((g) => {
      const rules = g.ruleIds.join(', ');
      return `<div class="aidr-issue">
        <span class="aidr-issue-icon">${g.icon}</span>
        <span class="aidr-issue-info">
          <span class="aidr-issue-label">${g.label}</span>
          <span class="aidr-issue-hint">${g.hint}</span>
        </span>
        <span class="aidr-issue-rules">${rules}</span>
      </div>`;
    }).join('');

    const moreText = groups.length > 5
      ? `<div class="aidr-more">+${groups.length - 5} more issue${groups.length - 5 > 1 ? 's' : ''}</div>`
      : '';

    const statusText = blocked ? '🚫 BLOCKED' : '⚡ DETECTED';

    banner.innerHTML = `
      <div class="aidr-banner-header" id="aidr-banner-header">
        <span class="aidr-banner-title">${sevIcon} AIDR Security Alert</span>
        <span class="aidr-banner-badge aidr-${severity}">${sevLabel} · ${statusText}</span>
        <div class="aidr-banner-header-actions">
          <button class="aidr-btn-collapse" type="button" title="Minimize" aria-label="Minimize">−</button>
          <button class="aidr-dismiss" type="button" aria-label="Dismiss" title="Dismiss this alert">&times;</button>
        </div>
      </div>
      <div class="aidr-banner-body" id="aidr-banner-body">
        <div class="aidr-risk-row">
          <span class="aidr-risk-label">Risk Score</span>
          <div class="aidr-risk-bar">
            <div class="aidr-risk-fill aidr-${severity}" style="width:${risk}%"></div>
          </div>
          <span class="aidr-risk-value">${risk}/100</span>
        </div>
        <div class="aidr-issues">${itemsHtml}${moreText}</div>
      </div>
      <div class="aidr-banner-footer" id="aidr-banner-footer">
        <button class="aidr-btn-ghost" id="aidr-btn-whitelist" type="button">Whitelist This</button>
        <button class="aidr-btn-ghost" id="aidr-btn-dismiss" type="button">Dismiss</button>
      </div>
    `;

    // Wire up dismiss button (per-detection dismiss)
    const fp = detectionFingerprint(result);
    banner.querySelectorAll('[class="aidr-dismiss"], #aidr-btn-dismiss').forEach((btn) => {
      btn.addEventListener('click', () => {
        dismissedFingerprints.add(fp);
        hideBanner();
        hideIndicator();
      });
    });

    // Wire up collapse/expand
    const header = banner.querySelector('#aidr-banner-header');
    const collapseBtn = banner.querySelector('.aidr-btn-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        collapseBanner(banner);
      });
    }
    if (header) {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.aidr-dismiss') || e.target.closest('.aidr-btn-collapse')) return;
        toggleCollapse(banner);
      });
    }

    // Wire up whitelist button
    const whitelistBtn = banner.querySelector('#aidr-btn-whitelist');
    if (whitelistBtn) {
      whitelistBtn.addEventListener('click', async () => {
        let promptText = window._aidrLastPrompt || '';
        if (promptText && window.AIDR && window.AIDR.policy && window.AIDR.policy.addAllowlistPattern) {
          // Use first 200 chars as literal string match
          const snippet = promptText.trim().slice(0, 200);
          await window.AIDR.policy.addAllowlistPattern(snippet);
          whitelistBtn.textContent = '✓ Whitelisted';
          whitelistBtn.disabled = true;
        }
      });
    }

    // Auto-collapse after 8 seconds
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => collapseBanner(banner), 8000);
  }

  function collapseBanner(banner) {
    isCollapsed = true;
    banner.classList.add('aidr-collapsed');
    const body = banner.querySelector('#aidr-banner-body');
    const footer = banner.querySelector('#aidr-banner-footer');
    if (body) body.style.display = 'none';
    if (footer) footer.style.display = 'none';
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
  }

  function toggleCollapse(banner) {
    const body = banner.querySelector('#aidr-banner-body');
    const footer = banner.querySelector('#aidr-banner-footer');
    if (isCollapsed) {
      isCollapsed = false;
      banner.classList.remove('aidr-collapsed');
      if (body) body.style.display = '';
      if (footer) footer.style.display = '';
      // Restart auto-collapse timer
      if (collapseTimer) clearTimeout(collapseTimer);
      collapseTimer = setTimeout(() => collapseBanner(banner), 8000);
    } else {
      collapseBanner(banner);
    }
  }

  // ─── Determine alert level based on severity ────────────────────────────
  function getAlertLevel(severity) {
    const sev = (severity || 'safe').toLowerCase();
    if (sev === 'critical') return 'blocked';
    if (sev === 'high') return 'banner';
    if (sev === 'medium') return 'banner';
    if (sev === 'low') return 'inline';
    return 'none';
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * render() — Called by core engine on each analysis result.
   * Progressive behavior:
   * - low severity → inline indicator only (during typing)
   * - medium/high severity → full banner
   * - critical severity → blocked notice
   * - safe → clear inline indicator (user may have rephrased)
   */
  function render(result) {
    if (!result) return;

    const fp = detectionFingerprint(result);
    const severity = (result.severity || 'safe').toLowerCase();

    // Store prompt text for whitelist
    if (result._promptText) {
      window._aidrLastPrompt = result._promptText;
    }

    // If dismissed for this fingerprint, skip
    if (dismissedFingerprints.has(fp)) return;

    // Safe result: clear inline indicator (user rephrased away from risk)
    if (severity === 'safe') {
      hideIndicator();
      // Don't hide banner if showing (user needs to see what was detected)
      return;
    }

    // Determine target alert level
    const targetLevel = getAlertLevel(severity);

    // Same fingerprint already rendered — skip
    if (fp === currentFingerprint && currentAlertState !== 'none') return;

    currentFingerprint = fp;

    // Get first detection hint for tooltip
    const groups = groupDetections(result.detections);
    const hint = groups.length > 0 ? groups[0].hint : 'Security issue detected';

    switch (targetLevel) {
      case 'inline':
        showInlineIndicator(severity, hint);
        break;

      case 'banner':
        // Hide inline indicator, show banner
        hideIndicator();
        const banner = ensureBanner();
        banner.className = severityClass(severity);
        setBannerContent(banner, result, false);
        banner.style.display = 'block';
        currentAlertState = 'banner';
        break;

      case 'blocked':
        showBlockedNotice(result);
        break;

      default:
        break;
    }
  }

  /**
   * upgradeToBanner() — Called when user stops typing (2s debounce) or submits.
   * If inline indicator is showing, upgrade to full banner.
   */
  function upgradeToBanner() {
    if (currentAlertState === 'inline' && currentFingerprint) {
      hideIndicator();
      // Re-render using stored result data
      const banner = ensureBanner();
      // The last result is passed via window._aidrLastResult
      const lastResult = window._aidrLastResult;
      if (lastResult) {
        const severity = (lastResult.severity || 'safe').toLowerCase();
        banner.className = severityClass(severity);
        setBannerContent(banner, lastResult, false);
        banner.style.display = 'block';
        currentAlertState = 'banner';
      }
    }
  }

  /**
   * showBlockedNotice() — Called when enforcement policy blocks a prompt.
   */
  function showBlockedNotice(result) {
    // If dismissed for this fingerprint, skip
    const fp = detectionFingerprint(result);
    if (dismissedFingerprints.has(fp)) return;

    hideIndicator();

    const banner = ensureBanner();
    banner.className = severityClass(result && result.severity ? result.severity : 'critical');
    setBannerContent(banner, result || { severity: 'critical', risk: 0, detections: [] }, true);
    banner.style.display = 'block';
    currentAlertState = 'blocked';
    currentFingerprint = fp;
  }

  /**
   * clearAll() — Called on page navigation or explicit reset.
   */
  function clearAll() {
    hideIndicator();
    hideBanner();
    dismissedFingerprints.clear();
    currentFingerprint = '';
    currentAlertState = 'none';
    isCollapsed = false;
  }

  /**
   * getState() — Expose current state for debugging/content.js integration.
   */
  function getState() {
    return {
      alertState: currentAlertState,
      fingerprint: currentFingerprint,
      dismissedCount: dismissedFingerprints.size,
      isCollapsed
    };
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.responder = {
    render,
    showBlockedNotice,
    upgradeToBanner,
    clearAll,
    getState
  };
})();