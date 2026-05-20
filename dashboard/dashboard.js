(() => {
  const STORAGE_KEY = 'aidr_events_v1';
  const DIAGNOSTICS_KEY = 'aidr_diagnostics_v1';
  const POLICY_KEY = 'aidr_policy_v1';
  const RULES_KEY = 'aidr_custom_rules_v1';

  const severityFilter = document.getElementById('severity-filter');
  const categoryFilter = document.getElementById('category-filter');
  const refreshBtn = document.getElementById('refresh-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const timelineEl = document.getElementById('timeline');
  const countEl = document.getElementById('event-count');
  const recomputeBtn = document.getElementById('recompute-diagnostics-btn');
  const diagnosticsFileInput = document.getElementById('diagnostics-file-input');
  const diagnosticsMetaEl = document.getElementById('diagnostics-meta');
  const diagnosticsGridEl = document.getElementById('diagnostics-grid');
  const policyMetaEl = document.getElementById('policy-meta');
  const statusChipEl = document.getElementById('status-chip');

  const modeShadowBtn = document.getElementById('mode-shadow-btn');
  const modeEnforceBtn = document.getElementById('mode-enforce-btn');

  const actionBlockBtn = document.getElementById('action-block');
  const actionAllowOnceBtn = document.getElementById('action-allow-once');
  const actionMuteBtn = document.getElementById('action-mute');
  const actionPauseBtn = document.getElementById('action-pause');

  const quickDiagnosticBtn = document.getElementById('quick-diagnostic');
  const quickLogsBtn = document.getElementById('quick-logs');
  const quickAllowlistBtn = document.getElementById('quick-allowlist');
  const quickRulesBtn = document.getElementById('quick-rules');

  const diagnosticPanel = document.getElementById('diagnostic-panel');
  const logsPanel = document.getElementById('logs-panel');
  const allowlistPanel = document.getElementById('allowlist-panel');

  const policyAllowRuleInput = document.getElementById('policy-allow-rule-input');
  const policyAllowRuleBtn = document.getElementById('policy-allow-rule-btn');
  const policyAllowPatternInput = document.getElementById('policy-allow-pattern-input');
  const policyAllowPatternBtn = document.getElementById('policy-allow-pattern-btn');

  const threatTitleEl = document.getElementById('threat-title');
  const threatDescEl = document.getElementById('threat-desc');
  const riskScoreEl = document.getElementById('risk-score');
  const riskLevelEl = document.getElementById('risk-level');
  const reasonListEl = document.getElementById('reason-list');
  const confidenceSparklineEl = document.getElementById('confidence-sparkline');
  const confidenceScoreEl = document.getElementById('confidence-score');
  const confidenceLevelEl = document.getElementById('confidence-level');

  function sanitizeEvent(evt) {
    if (!evt || typeof evt !== 'object') return null;
    const ts = Number(evt.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const risk = Number(evt.risk);
    const confidence = Number(evt.confidence);
    return {
      ts,
      direction: String(evt.direction || 'unknown').slice(0, 24),
      risk: Number.isFinite(risk) ? Math.max(0, Math.min(100, risk)) : 0,
      severity: String(evt.severity || 'safe').slice(0, 16),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      matched_rule_ids: Array.isArray(evt.matched_rule_ids) ? evt.matched_rule_ids.map((v) => String(v).slice(0, 64)).slice(0, 12) : [],
      categories: Array.isArray(evt.categories) ? evt.categories.map((v) => String(v).slice(0, 32)).slice(0, 8) : [],
      evidence_spans: Array.isArray(evt.evidence_spans) ? evt.evidence_spans.map((v) => String(v).slice(0, 128)).slice(0, 8) : []
    };
  }

  function getEvents() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        const raw = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        resolve(raw.map(sanitizeEvent).filter(Boolean));
      });
    });
  }

  function getPolicy() {
    return new Promise((resolve) => {
      chrome.storage.local.get([POLICY_KEY], (res) => {
        const p = res[POLICY_KEY] || {};
        resolve({
          mode: p.mode === 'shadow' ? 'shadow' : 'enforcement',
          sessionPausedUntilTs: Number(p.sessionPausedUntilTs) || 0,
          mutedUntilByCategory: p.mutedUntilByCategory && typeof p.mutedUntilByCategory === 'object' ? p.mutedUntilByCategory : {},
          allowlistRuleIds: Array.isArray(p.allowlistRuleIds) ? p.allowlistRuleIds : [],
          allowlistPatterns: Array.isArray(p.allowlistPatterns) ? p.allowlistPatterns : []
        });
      });
    });
  }

  function setPolicy(policy) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [POLICY_KEY]: policy }, () => resolve());
    });
  }

  function getDiagnostics() {
    return new Promise((resolve) => {
      chrome.storage.local.get([DIAGNOSTICS_KEY], (res) => resolve(res[DIAGNOSTICS_KEY] || null));
    });
  }

  function setDiagnostics(payload) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [DIAGNOSTICS_KEY]: payload }, () => resolve());
    });
  }

  function formatTs(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return 'Invalid date';
    }
  }

  function isPaused(policy) {
    return Date.now() < Number(policy.sessionPausedUntilTs || 0);
  }

  function severityClass(sev) {
    return `sev-${String(sev || 'safe').toLowerCase()}`;
  }

  function riskLabelFromSeverity(sev) {
    if (sev === 'critical') return 'Critical';
    if (sev === 'high') return 'High';
    if (sev === 'medium') return 'Moderate';
    if (sev === 'low') return 'Low';
    return 'Safe';
  }

  function filtered(events) {
    const sev = severityFilter.value;
    const cat = categoryFilter.value;
    return events.filter((e) => {
      const sevOk = sev === 'all' || e.severity === sev;
      const catOk = cat === 'all' || (Array.isArray(e.categories) && e.categories.includes(cat));
      return sevOk && catOk;
    });
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toCsv(events) {
    const headers = ['ts', 'direction', 'risk', 'severity', 'confidence', 'matched_rule_ids', 'categories', 'evidence_spans'];
    const rows = events.map((e) => ([
      e.ts, e.direction, e.risk, e.severity, e.confidence,
      (e.matched_rule_ids || []).join('|'),
      (e.categories || []).join('|'),
      (e.evidence_spans || []).join('|')
    ]));
    return [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  }

  function ratio(num, den) {
    if (!den) return 0;
    return Number((num / den).toFixed(4));
  }

  function buildDiagnostics(events) {
    const categories = Array.from(
      new Set(events.flatMap((e) => Array.isArray(e.categories) ? e.categories : []))
    ).sort();
    const total = events.length;
    const blocked = events.filter((e) => e.severity === 'high' || e.severity === 'critical').length;
    return {
      schema_version: 1,
      computed_at_ts: Date.now(),
      source: 'dashboard_recompute_from_local_events',
      summary: { total_events: total, blocked_high_or_critical: blocked },
      per_category: categories.map((category) => ({
        category,
        event_count: events.filter((e) => Array.isArray(e.categories) && e.categories.includes(category)).length,
        precision: null,
        recall: null,
        f1: null,
        false_positive_rate: null,
        note: 'Ground-truth labels required. Upload labeled dataset JSON below.'
      }))
    };
  }

  function parseLabeledDataset(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.samples)) {
      throw new Error('Dataset JSON must include samples array.');
    }
    return parsed.samples.map((s, idx) => {
      const predicted = Array.isArray(s.predicted_categories) ? s.predicted_categories.map(String) : [];
      const actual = Array.isArray(s.actual_categories) ? s.actual_categories.map(String) : [];
      if (!predicted.length && !actual.length) throw new Error(`Sample ${idx} missing categories.`);
      return { predicted, actual };
    });
  }

  function buildDiagnosticsFromLabeledSamples(samples) {
    const categories = Array.from(new Set(samples.flatMap((s) => [...s.predicted, ...s.actual]))).sort();
    const perCategory = categories.map((category) => {
      let tp = 0, fp = 0, fn = 0, tn = 0;
      for (const sample of samples) {
        const pred = sample.predicted.includes(category);
        const act = sample.actual.includes(category);
        if (pred && act) tp += 1;
        else if (pred && !act) fp += 1;
        else if (!pred && act) fn += 1;
        else tn += 1;
      }
      const precision = ratio(tp, tp + fp);
      const recall = ratio(tp, tp + fn);
      const f1 = (precision + recall) ? Number(((2 * precision * recall) / (precision + recall)).toFixed(4)) : 0;
      const falsePositiveRate = ratio(fp, fp + tn);
      return { category, sample_count: samples.length, tp, fp, fn, tn, precision, recall, f1, false_positive_rate: falsePositiveRate };
    });
    return {
      schema_version: 2,
      computed_at_ts: Date.now(),
      source: 'dashboard_labeled_dataset',
      summary: { total_samples: samples.length, total_categories: categories.length },
      per_category: perCategory
    };
  }

  function renderDiagnostics(diag) {
    diagnosticsGridEl.innerHTML = '';
    if (!diag) {
      diagnosticsMetaEl.textContent = 'No diagnostics computed yet.';
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Use Recompute to generate local diagnostics snapshot.';
      diagnosticsGridEl.appendChild(empty);
      return;
    }
    diagnosticsMetaEl.textContent = `Computed: ${formatTs(diag.computed_at_ts)} | Source: ${diag.source}`;
    const rows = Array.isArray(diag.per_category) ? diag.per_category : [];
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No category metrics available yet.';
      diagnosticsGridEl.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'diag-row';
      el.innerHTML = `
        <div><strong>${row.category}</strong> (${row.event_count || row.sample_count || 0})</div>
        <div>precision: ${row.precision ?? '--'} | recall: ${row.recall ?? '--'} | f1: ${row.f1 ?? '--'} | fpr: ${row.false_positive_rate ?? '--'}</div>
      `;
      diagnosticsGridEl.appendChild(el);
    }
  }

  function renderSparkline(confidencePoints) {
    confidenceSparklineEl.innerHTML = '';
    const points = confidencePoints.length ? confidencePoints : [0];
    points.forEach((p) => {
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.height = `${Math.max(8, Math.round(p * 46))}px`;
      confidenceSparklineEl.appendChild(bar);
    });
  }

  function renderThreatSummary(events) {
    const latest = events[0] || null;
    const risk = latest ? latest.risk : 0;
    const severity = latest ? latest.severity : 'safe';
    const confidence = latest ? latest.confidence : 0;

    riskScoreEl.textContent = String(Math.round(risk));
    riskLevelEl.textContent = riskLabelFromSeverity(severity);
    riskLevelEl.className = `risk-level ${severity}`;

    confidenceScoreEl.textContent = `${Math.round(confidence * 100)}%`;
    confidenceLevelEl.textContent = riskLabelFromSeverity(severity);
    confidenceLevelEl.className = `conf-level ${severity}`;

    if (!latest) {
      threatTitleEl.textContent = 'No active threat detected';
      threatDescEl.textContent = 'Recent prompts appear safe.';
      reasonListEl.innerHTML = '<li>No flagged indicators in recent events.</li>';
      renderSparkline([]);
      return;
    }

    const category = (latest.categories && latest.categories[0]) || 'general';
    threatTitleEl.textContent = `Potential ${category.replace(/_/g, ' ')}`;
    threatDescEl.textContent = `Latest event severity is ${severity.toUpperCase()} with risk score ${Math.round(risk)}.`;

    const reasons = [];
    if (latest.matched_rule_ids && latest.matched_rule_ids.length) {
      reasons.push(`Matched rules: ${latest.matched_rule_ids.slice(0, 3).join(', ')}`);
    }
    if (latest.categories && latest.categories.length) {
      reasons.push(`Triggered categories: ${latest.categories.join(', ')}`);
    }
    if (latest.evidence_spans && latest.evidence_spans.length) {
      reasons.push('Detected suspicious phrasing in prompt content.');
    }
    if (!reasons.length) reasons.push('Risk score exceeded policy threshold.');

    reasonListEl.innerHTML = reasons.map((r) => `<li>${r}</li>`).join('');

    const confidencePoints = events.slice(0, 8).reverse().map((e) => e.confidence || 0);
    renderSparkline(confidencePoints);
  }

  async function renderPolicy() {
    const p = await getPolicy();
    const paused = isPaused(p);
    policyMetaEl.textContent = `mode: ${p.mode}${paused ? ' (paused)' : ''} | allow-rules: ${p.allowlistRuleIds.length} | allow-patterns: ${p.allowlistPatterns.length}`;
    statusChipEl.textContent = paused ? 'Paused' : (p.mode === 'enforcement' ? 'Enforcing' : 'Monitoring');
    modeEnforceBtn.classList.toggle('active', p.mode === 'enforcement');
    modeShadowBtn.classList.toggle('active', p.mode === 'shadow');
  }

  function renderEvents(list) {
    countEl.textContent = `${list.length} event${list.length === 1 ? '' : 's'}`;
    timelineEl.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No events match the current filters.';
      timelineEl.appendChild(empty);
      return;
    }
    for (const e of list) {
      const item = document.createElement('article');
      item.className = 'event';
      item.innerHTML = `
        <div class="row">
          <span>${formatTs(e.ts)}</span>
          <span class="badge ${severityClass(e.severity)}">${String(e.severity || 'safe').toUpperCase()}</span>
        </div>
        <div class="meta">risk: ${e.risk} | direction: ${e.direction || 'unknown'}</div>
        <div class="meta">categories: ${(e.categories || []).join(', ') || '--'}</div>
      `;
      timelineEl.appendChild(item);
    }
  }

  async function render() {
    const events = (await getEvents()).sort((a, b) => Number(b.ts) - Number(a.ts));
    const diagnostics = await getDiagnostics();
    renderThreatSummary(events);
    renderEvents(filtered(events));
    renderDiagnostics(diagnostics);
  }

  function setPanelVisibility(which) {
    diagnosticPanel.style.display = which === 'diagnostic' ? 'grid' : 'none';
    logsPanel.style.display = which === 'logs' ? 'grid' : 'none';
    allowlistPanel.style.display = which === 'allowlist' ? 'grid' : 'none';
  }

  refreshBtn.addEventListener('click', render);
  severityFilter.addEventListener('change', render);
  categoryFilter.addEventListener('change', render);

  exportJsonBtn.addEventListener('click', async () => {
    const events = filtered(await getEvents());
    download('aidr-events.json', JSON.stringify(events, null, 2), 'application/json');
  });

  exportCsvBtn.addEventListener('click', async () => {
    const events = filtered(await getEvents());
    download('aidr-events.csv', toCsv(events), 'text/csv');
  });

  recomputeBtn.addEventListener('click', async () => {
    const events = await getEvents();
    const diagnostics = buildDiagnostics(events);
    await setDiagnostics(diagnostics);
    render();
  });

  diagnosticsFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const samples = parseLabeledDataset(await file.text());
      const diagnostics = buildDiagnosticsFromLabeledSamples(samples);
      await setDiagnostics(diagnostics);
      render();
    } catch (err) {
      diagnosticsMetaEl.textContent = `Dataset parse error: ${err.message}`;
    }
  });

  modeShadowBtn.addEventListener('click', async () => {
    const p = await getPolicy();
    p.mode = 'shadow';
    await setPolicy(p);
    await renderPolicy();
  });

  modeEnforceBtn.addEventListener('click', async () => {
    const p = await getPolicy();
    p.mode = 'enforcement';
    await setPolicy(p);
    await renderPolicy();
  });

  actionPauseBtn.addEventListener('click', async () => {
    const p = await getPolicy();
    p.sessionPausedUntilTs = Date.now() + 15 * 60 * 1000;
    await setPolicy(p);
    await renderPolicy();
  });

  actionBlockBtn.addEventListener('click', async () => {
    const p = await getPolicy();
    p.mode = 'enforcement';
    p.sessionPausedUntilTs = 0;
    await setPolicy(p);
    await renderPolicy();
  });

  actionAllowOnceBtn.addEventListener('click', async () => {
    const p = await getPolicy();
    p.sessionPausedUntilTs = Date.now() + 60 * 1000;
    await setPolicy(p);
    await renderPolicy();
  });

  actionMuteBtn.addEventListener('click', async () => {
    const p = await getPolicy();
    p.mutedUntilByCategory = p.mutedUntilByCategory || {};
    p.mutedUntilByCategory.prompt_injection = Date.now() + 10 * 60 * 1000;
    await setPolicy(p);
    await renderPolicy();
  });

  policyAllowRuleBtn.addEventListener('click', async () => {
    const id = String(policyAllowRuleInput.value || '').trim();
    if (!id) return;
    const p = await getPolicy();
    if (!p.allowlistRuleIds.includes(id)) p.allowlistRuleIds.push(id);
    await setPolicy(p);
    policyAllowRuleInput.value = '';
    await renderPolicy();
  });

  policyAllowPatternBtn.addEventListener('click', async () => {
    const pattern = String(policyAllowPatternInput.value || '').trim();
    if (!pattern) return;
    const p = await getPolicy();
    if (!p.allowlistPatterns.includes(pattern)) p.allowlistPatterns.push(pattern);
    await setPolicy(p);
    policyAllowPatternInput.value = '';
    await renderPolicy();
  });

  quickDiagnosticBtn.addEventListener('click', () => setPanelVisibility('diagnostic'));
  quickLogsBtn.addEventListener('click', () => setPanelVisibility('logs'));
  quickAllowlistBtn.addEventListener('click', () => setPanelVisibility('allowlist'));
  quickRulesBtn.addEventListener('click', () => {
    chrome.storage.local.get([RULES_KEY], (res) => {
      const count = Array.isArray(res[RULES_KEY]) ? res[RULES_KEY].length : 0;
      diagnosticsMetaEl.textContent = `Custom rules: ${count}`;
      setPanelVisibility('diagnostic');
    });
  });

  setPanelVisibility('logs');
  render();
  renderPolicy();
})();
