(() => {
  const STORAGE_KEY = 'aidr_events_v1';
  const DIAGNOSTICS_KEY = 'aidr_diagnostics_v1';

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

  function formatTs(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return 'Invalid date';
    }
  }

  function getDiagnostics() {
    return new Promise((resolve) => {
      chrome.storage.local.get([DIAGNOSTICS_KEY], (res) => {
        resolve(res[DIAGNOSTICS_KEY] || null);
      });
    });
  }

  function setDiagnostics(payload) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [DIAGNOSTICS_KEY]: payload }, () => resolve());
    });
  }

  function severityClass(sev) {
    return `sev-${String(sev || 'safe').toLowerCase()}`;
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
      e.ts,
      e.direction,
      e.risk,
      e.severity,
      e.confidence,
      (e.matched_rule_ids || []).join('|'),
      (e.categories || []).join('|'),
      (e.evidence_spans || []).join('|')
    ]));
    return [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
  }

  function categoriesFromEvents(events) {
    const set = new Set();
    for (const e of events) {
      (e.categories || []).forEach((c) => set.add(c));
    }
    return Array.from(set).sort();
  }

  function ratio(num, den) {
    if (!den) return 0;
    return Number((num / den).toFixed(4));
  }

  function buildDiagnostics(events) {
    const now = Date.now();
    const categories = categoriesFromEvents(events);
    const total = events.length;
    const blockedHighOrCritical = events.filter((e) => e.severity === 'high' || e.severity === 'critical').length;

    const perCategory = categories.map((category) => {
      const subset = events.filter((e) => Array.isArray(e.categories) && e.categories.includes(category));
      return {
        category,
        event_count: subset.length,
        precision: null,
        recall: null,
        f1: null,
        false_positive_rate: null,
        note: 'Ground-truth labels required. Upload labeled dataset JSON below.'
      };
    });

    return {
      schema_version: 1,
      computed_at_ts: now,
      source: 'dashboard_recompute_from_local_events',
      summary: {
        total_events: total,
        blocked_high_or_critical: blockedHighOrCritical
      },
      per_category: perCategory
    };
  }

  function parseLabeledDataset(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') throw new Error('Dataset JSON must be an object.');
    if (!Array.isArray(parsed.samples)) throw new Error('Dataset JSON must include a samples array.');
    return parsed.samples.map((s, idx) => {
      const predicted = Array.isArray(s.predicted_categories) ? s.predicted_categories.map((v) => String(v)) : [];
      const actual = Array.isArray(s.actual_categories) ? s.actual_categories.map((v) => String(v)) : [];
      if (!predicted.length && !actual.length) {
        throw new Error(`Sample ${idx} must include predicted_categories or actual_categories.`);
      }
      return { predicted, actual };
    });
  }

  function categoriesFromSamples(samples) {
    const set = new Set();
    for (const s of samples) {
      s.predicted.forEach((c) => set.add(c));
      s.actual.forEach((c) => set.add(c));
    }
    return Array.from(set).sort();
  }

  function buildDiagnosticsFromLabeledSamples(samples) {
    const categories = categoriesFromSamples(samples);
    const perCategory = categories.map((category) => {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let tn = 0;

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

      return {
        category,
        sample_count: samples.length,
        tp,
        fp,
        fn,
        tn,
        precision,
        recall,
        f1,
        false_positive_rate: falsePositiveRate
      };
    });

    return {
      schema_version: 2,
      computed_at_ts: Date.now(),
      source: 'dashboard_labeled_dataset',
      summary: {
        total_samples: samples.length,
        total_categories: categories.length
      },
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

  async function render() {
    const events = await getEvents();
    const diagnostics = await getDiagnostics();
    const list = filtered(events).sort((a, b) => Number(b.ts) - Number(a.ts));

    countEl.textContent = `${list.length} event${list.length === 1 ? '' : 's'}`;
    timelineEl.innerHTML = '';
    renderDiagnostics(diagnostics);

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
    const text = await file.text();
    try {
      const samples = parseLabeledDataset(text);
      const diagnostics = buildDiagnosticsFromLabeledSamples(samples);
      await setDiagnostics(diagnostics);
      render();
    } catch (err) {
      diagnosticsMetaEl.textContent = `Dataset parse error: ${err.message}`;
    }
  });

  render();
})();
