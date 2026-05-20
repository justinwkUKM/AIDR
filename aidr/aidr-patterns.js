(function () {
  const patterns = {
    promptInjection: [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /forget\s+(all\s+)?above/i,
      /new\s+system\s+prompt/i,
      /override\s+your\s+rules/i
    ],
    email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    phone: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/,
    creditCard: /\b(?:\d[ -]*?){13,19}\b/,
    privateKeyHeader: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----/i,
    apiKeys: [
      /\bsk-[A-Za-z0-9]{20,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bghp_[A-Za-z0-9]{20,}\b/
    ]
  };

  function luhnValid(card) {
    const digits = card.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;

    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let n = Number(digits.charAt(i));
      if (shouldDouble) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.patterns = patterns;
  window.AIDR.luhnValid = luhnValid;
})();
