(function () {
  const BANNER_ID = 'aidr-warning-banner';
  const MODAL_ID = 'aidr-block-modal';
  const BACKDROP_ID = 'aidr-block-backdrop';

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

  function render(result) {
    const banner = ensureBanner();
    if (!result || result.severity === 'safe') {
      banner.style.display = 'none';
      banner.textContent = '';
      return;
    }

    const summary = result.detections.slice(0, 2).map((d) => d.message).join(' | ');
    banner.className = severityClass(result.severity);
    banner.textContent = `[AIDR ${result.severity.toUpperCase()} ${result.risk}] ${summary}`;
    banner.style.display = 'block';
  }

  function ensureModal() {
    let backdrop = document.getElementById(BACKDROP_ID);
    let modal = document.getElementById(MODAL_ID);
    if (backdrop && modal) return { backdrop, modal };

    backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.style.display = 'none';

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="aidr-modal-title">AIDR blocked this message</div>
      <div class="aidr-modal-subtitle" id="aidr-modal-subtitle"></div>
      <div class="aidr-modal-evidence" id="aidr-modal-evidence"></div>
      <div class="aidr-modal-actions">
        <button id="aidr-edit-btn" class="aidr-btn aidr-btn-secondary">Edit</button>
        <button id="aidr-allow-btn" class="aidr-btn aidr-btn-danger">Allow once</button>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    return { backdrop, modal };
  }

  function showBlockModal(result) {
    const { backdrop, modal } = ensureModal();
    const subtitle = modal.querySelector('#aidr-modal-subtitle');
    const evidence = modal.querySelector('#aidr-modal-evidence');
    const editBtn = modal.querySelector('#aidr-edit-btn');
    const allowBtn = modal.querySelector('#aidr-allow-btn');

    subtitle.textContent = `Severity: ${result.severity.toUpperCase()} | Risk: ${result.risk}`;
    evidence.textContent = result.detections.slice(0, 2).map((d) => d.message).join(' | ');

    backdrop.style.display = 'block';
    modal.style.display = 'block';

    return new Promise((resolve) => {
      function cleanup(decision) {
        backdrop.style.display = 'none';
        modal.style.display = 'none';
        editBtn.removeEventListener('click', onEdit);
        allowBtn.removeEventListener('click', onAllow);
        backdrop.removeEventListener('click', onEdit);
        resolve(decision);
      }
      function onEdit() { cleanup('edit'); }
      function onAllow() { cleanup('allow_once'); }
      editBtn.addEventListener('click', onEdit);
      allowBtn.addEventListener('click', onAllow);
      backdrop.addEventListener('click', onEdit);
    });
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.responder = {
    render,
    showBlockModal
  };
})();
