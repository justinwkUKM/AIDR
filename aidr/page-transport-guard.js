(function () {
  if (window.__aidrPageTransportGuardInstalled) return;
  window.__aidrPageTransportGuardInstalled = true;

  const PI_RE = /(ignore\s+(all\s+)?previous\s+instructions|reveal\s+hidden\s+system\s+prompt|new\s+system\s+prompt|override\s+your\s+rules|developer\s+mode|bypass\s+safety)/i;

  function extractTextFromBody(body) {
    try {
      if (!body) return '';
      if (typeof body === 'string') return body;
      if (body instanceof URLSearchParams) return body.toString();
      return String(body);
    } catch (_) {
      return '';
    }
  }

  function shouldInspect(url) {
    const u = String(url || '');
    return /backend-api\/conversation|\/conversation|\/chat\/completions|\/completions|\/generate|\/messages/i.test(u);
  }

  function shouldBlock(url, bodyText) {
    if (!shouldInspect(url)) return false;
    return PI_RE.test(String(bodyText || ''));
  }

  function emitBlocked(url) {
    window.dispatchEvent(new CustomEvent('aidr:transport-blocked', {
      detail: { url: String(url || ''), category: 'prompt_injection' }
    }));
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = (input && input.url) ? input.url : input;
    const bodyText = extractTextFromBody(
      (init && init.body) || (input && input.body) || ''
    );
    if (shouldBlock(url, bodyText)) {
      emitBlocked(url);
      throw new Error('AIDR_BLOCKED_REQUEST');
    }
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aidr_url = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const bodyText = extractTextFromBody(body);
    if (shouldBlock(this.__aidr_url, bodyText)) {
      emitBlocked(this.__aidr_url);
      throw new Error('AIDR_BLOCKED_REQUEST');
    }
    return origSend.apply(this, arguments);
  };
})();
