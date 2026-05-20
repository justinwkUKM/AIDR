(function () {
  const BANNER_ID = 'aidr-warning-banner';
  let hideTimer = null;

  function ensureBanner() {
    let banner = document.getElementById(BANNER_ID);
    if (banner) return banner;

    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.display = 'none';
    document.body.appendChild(banner);
    return banner;
  }

  function severityClass(severity) {
    return `aidr-${severity}`;
  }

  function setBannerText(banner, result, blocked) {
    const sev = String(result.severity || 'safe').toUpperCase();
    const risk = Number(result.risk || 0);
    const top = (result.detections || []).slice(0, 2).map((d) => d.id).join(', ');
    banner.textContent = blocked
      ? `[AIDR BLOCKED ${sev} ${risk}] ${top || 'risk detected'}`
      : `[AIDR ${sev} ${risk}] ${top || 'signal detected'}`;
  }

  function render(result) {
    const banner = ensureBanner();
    if (!result || result.severity === 'safe') {
      banner.style.display = 'none';
      banner.textContent = '';
      return;
    }

    banner.className = severityClass(result.severity);
    setBannerText(banner, result, false);
    banner.style.display = 'block';
  }

  function showBlockedNotice(result) {
    const banner = ensureBanner();
    banner.className = severityClass(result && result.severity ? result.severity : 'critical');
    setBannerText(banner, result || { severity: 'critical', risk: 0, detections: [] }, true);
    banner.style.display = 'block';

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      banner.style.display = 'none';
    }, 4500);
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.responder = {
    render,
    showBlockedNotice
  };
})();
