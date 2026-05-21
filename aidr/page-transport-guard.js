(function () {
  if (window.__aidrPageTransportGuardInstalled) return;
  window.__aidrPageTransportGuardInstalled = true;

  // Prompt injection patterns (must match detector's expanded set)
  const PI_RE = /(ignore\s+(all\s+)?previous\s+instructions|reveal\s+hidden\s+system\s+prompt|new\s+system\s+prompt|override\s+your\s+rules|developer\s+mode|bypass\s+safety|disregard\s+(all\s+)?(previous|prior)\s+(instructions|rules)|forget\s+(all\s+)?above|do\s+anything\s+now|jailbreak|pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(evil|unrestricted))/i;

  // PII / secrets patterns for transport-layer scanning
  const PII_RE = /(-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})/;

  function extractTextFromBody(body) {
    try {
      if (!body) return '';
      if (typeof body === 'string') return body;
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        const parts = [];
        body.forEach((value, key) => {
          if (typeof value === 'string') parts.push(value);
        });
        return parts.join(' ');
      }
      return String(body);
    } catch (_) {
      return '';
    }
  }

  function shouldInspect(url) {
    const u = String(url || '');
    return /backend-api\/conversation|\/conversation|\/chat\/completions|\/completions|\/generate|\/messages|\/v1\/chat|\/v1\/messages|\/api\/chat|\/aistudio|\/generateContent/i.test(u);
  }

  function shouldBlock(url, bodyText) {
    if (!shouldInspect(url)) return false;
    const text = String(bodyText || '');
    return PI_RE.test(text) || PII_RE.test(text);
  }

  function getBlockCategory(bodyText) {
    const text = String(bodyText || '');
    if (PI_RE.test(text)) return 'prompt_injection';
    if (PII_RE.test(text)) return 'sensitive_data';
    return 'unknown';
  }

  function emitBlocked(url, category) {
    window.dispatchEvent(new CustomEvent('aidr:transport-blocked', {
      detail: { url: String(url || ''), category: category || 'prompt_injection' }
    }));
  }

  // ── Monkey-patch fetch ──
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = (input && input.url) ? input.url : input;
    const bodyText = extractTextFromBody(
      (init && init.body) || (input && input.body) || ''
    );
    if (shouldBlock(url, bodyText)) {
      emitBlocked(url, getBlockCategory(bodyText));
      return new Response(null, { status: 0, statusText: 'AIDR_BLOCKED' });
    }
    return origFetch.apply(this, arguments);
  };

  // ── Monkey-patch XMLHttpRequest ──
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__aidr_url = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const bodyText = extractTextFromBody(body);
    if (shouldBlock(this.__aidr_url, bodyText)) {
      emitBlocked(this.__aidr_url, getBlockCategory(bodyText));
      return; // Silently drop the request
    }
    return origSend.apply(this, arguments);
  };

  // ── Monkey-patch navigator.sendBeacon ──
  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      const bodyText = extractTextFromBody(data);
      if (shouldBlock(url, bodyText)) {
        emitBlocked(url, getBlockCategory(bodyText));
        return false;
      }
      return origBeacon(url, data);
    };
  }

  // ── Monkey-patch WebSocket.send ──
  if (typeof WebSocket !== 'undefined') {
    const origWsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      const text = typeof data === 'string' ? data : '';
      if (text && (PI_RE.test(text) || PII_RE.test(text))) {
        emitBlocked(this.url || 'websocket', text.match(PI_RE) ? 'prompt_injection' : 'sensitive_data');
        return; // Silently drop the WebSocket message
      }
      return origWsSend.apply(this, arguments);
    };
  }
})();
