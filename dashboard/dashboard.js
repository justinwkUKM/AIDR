(() => {
  const STORAGE_KEY = 'aidr_events_v1';

  const severityFilter = document.getElementById('severity-filter');
  const categoryFilter = document.getElementById('category-filter');
  const refreshBtn = document.getElementById('refresh-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const exportCsvBtn = document.getElementById('export-csv-btn');
  const timelineEl = document.getElementById('timeline');
  const countEl = document.getElementById('event-count');

  function getEvents() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        resolve(Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : []);
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

  async function render() {
    const events = await getEvents();
    const list = filtered(events).sort((a, b) => Number(b.ts) - Number(a.ts));

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

  render();
})();
