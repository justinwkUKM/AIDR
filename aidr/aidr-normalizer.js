/**
 * AIDR Input Normalizer — Obfuscation-Resistant Pre-Processing
 * Strips evasion techniques before pattern matching:
 *   - Zero-width characters
 *   - Unicode NFKC normalization (fullwidth → ASCII)
 *   - Homoglyph replacement (Cyrillic/Greek → Latin)
 *   - Leetspeak expansion
 *   - Base64 payload detection and decode
 *   - Whitespace collapse
 */
(function () {
  // Zero-width and invisible Unicode characters to strip
  const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u206A\u206B\u206C\u206D\u206E\u206F\u180E]/g;

  // Homoglyph map: visually similar characters from other scripts → Latin
  const HOMOGLYPHS = {
    // Cyrillic
    '\u0410': 'A', '\u0430': 'a', '\u0412': 'B', '\u0435': 'e',
    '\u0415': 'E', '\u041A': 'K', '\u043A': 'k', '\u041C': 'M',
    '\u041D': 'H', '\u043E': 'o', '\u041E': 'O', '\u0440': 'p',
    '\u0420': 'P', '\u0421': 'C', '\u0441': 'c', '\u0422': 'T',
    '\u0443': 'y', '\u0423': 'Y', '\u0445': 'x', '\u0425': 'X',
    '\u0456': 'i', '\u0406': 'I', '\u0458': 'j', '\u0408': 'J',
    // Greek
    '\u0391': 'A', '\u03B1': 'a', '\u0392': 'B', '\u03B2': 'b',
    '\u0395': 'E', '\u03B5': 'e', '\u0397': 'H', '\u0399': 'I',
    '\u03B9': 'i', '\u039A': 'K', '\u03BA': 'k', '\u039C': 'M',
    '\u039D': 'N', '\u039F': 'O', '\u03BF': 'o', '\u03A1': 'P',
    '\u03C1': 'p', '\u03A4': 'T', '\u03C4': 't', '\u03A5': 'Y',
    '\u03C5': 'u', '\u03A7': 'X', '\u03C7': 'x', '\u0396': 'Z',
    // Fullwidth Latin (handled by NFKC, but explicit fallback)
    '\uFF21': 'A', '\uFF22': 'B', '\uFF23': 'C', '\uFF24': 'D',
    '\uFF25': 'E', '\uFF26': 'F', '\uFF27': 'G', '\uFF28': 'H',
    '\uFF29': 'I', '\uFF2A': 'J', '\uFF2B': 'K', '\uFF2C': 'L',
    '\uFF2D': 'M', '\uFF2E': 'N', '\uFF2F': 'O', '\uFF30': 'P',
    '\uFF31': 'Q', '\uFF32': 'R', '\uFF33': 'S', '\uFF34': 'T',
    '\uFF35': 'U', '\uFF36': 'V', '\uFF37': 'W', '\uFF38': 'X',
    '\uFF39': 'Y', '\uFF3A': 'Z',
    '\uFF41': 'a', '\uFF42': 'b', '\uFF43': 'c', '\uFF44': 'd',
    '\uFF45': 'e', '\uFF46': 'f', '\uFF47': 'g', '\uFF48': 'h',
    '\uFF49': 'i', '\uFF4A': 'j', '\uFF4B': 'k', '\uFF4C': 'l',
    '\uFF4D': 'm', '\uFF4E': 'n', '\uFF4F': 'o', '\uFF50': 'p',
    '\uFF51': 'q', '\uFF52': 'r', '\uFF53': 's', '\uFF54': 't',
    '\uFF55': 'u', '\uFF56': 'v', '\uFF57': 'w', '\uFF58': 'x',
    '\uFF59': 'y', '\uFF5A': 'z'
  };

  // Leetspeak substitution map
  const LEET_MAP = {
    '@': 'a', '4': 'a',
    '8': 'b',
    '(': 'c',
    '3': 'e',
    '6': 'g',
    '#': 'h',
    '!': 'i', '1': 'i', '|': 'i',
    '0': 'o',
    '$': 's', '5': 's',
    '7': 't', '+': 't',
    '%': 'x'
  };

  // Base64 detection: looks for blocks of base64-encoded text (min 20 chars)
  const BASE64_BLOCK_RE = /(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;

  /**
   * Strip zero-width and invisible Unicode characters.
   */
  function stripZeroWidth(text) {
    return text.replace(ZERO_WIDTH_RE, '');
  }

  /**
   * Apply Unicode NFKC normalization (fullwidth → ASCII, compatibility decomposition).
   */
  function nfkcNormalize(text) {
    if (typeof text.normalize === 'function') {
      return text.normalize('NFKC');
    }
    return text;
  }

  /**
   * Replace known homoglyphs (Cyrillic, Greek, fullwidth) with Latin equivalents.
   */
  function replaceHomoglyphs(text) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      result += HOMOGLYPHS[ch] || ch;
    }
    return result;
  }

  /**
   * Expand common leetspeak substitutions.
   * Only applies to characters that appear in word-like contexts.
   */
  function expandLeetspeak(text) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      result += LEET_MAP[ch] || ch;
    }
    return result;
  }

  /**
   * Detect and decode base64-encoded payloads embedded in the text.
   * Returns the original text with decoded base64 blocks appended.
   */
  function decodeBase64Payloads(text) {
    const matches = text.match(BASE64_BLOCK_RE);
    if (!matches || !matches.length) return text;

    const decoded = [];
    for (const block of matches) {
      try {
        const raw = atob(block);
        // Only include if the decoded text looks like readable ASCII
        if (/^[\x20-\x7E\n\r\t]{4,}$/.test(raw)) {
          decoded.push(raw);
        }
      } catch (_) {
        // Invalid base64, skip
      }
    }

    if (decoded.length) {
      return text + '\n' + decoded.join('\n');
    }
    return text;
  }

  /**
   * Collapse excessive whitespace (spaces, tabs, newlines) to single spaces.
   * Preserves word boundaries but removes evasion via whitespace injection.
   */
  function collapseWhitespace(text) {
    return text.replace(/[\s\u00A0]+/g, ' ').trim();
  }

  /**
   * Extract text from within markdown code blocks, JSON string values,
   * and quoted sections for deeper scanning (indirect injection detection).
   */
  function extractEmbeddedText(text) {
    const fragments = [];

    // Markdown code blocks: ```...```
    const codeBlockRe = /```[\s\S]*?```/g;
    let m;
    while ((m = codeBlockRe.exec(text)) !== null) {
      // Strip the ``` delimiters
      const inner = m[0].replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      if (inner.length > 10) fragments.push(inner);
    }

    // Inline code: `...`
    const inlineCodeRe = /`([^`]{10,})`/g;
    while ((m = inlineCodeRe.exec(text)) !== null) {
      fragments.push(m[1]);
    }

    // Quoted blocks: > ...
    const quoteRe = /^>\s*(.+)$/gm;
    while ((m = quoteRe.exec(text)) !== null) {
      fragments.push(m[1]);
    }

    // Double-quoted strings (JSON-like): "..."
    const jsonStringRe = /"([^"]{10,})"/g;
    while ((m = jsonStringRe.exec(text)) !== null) {
      fragments.push(m[1]);
    }

    return fragments;
  }

  /**
   * Full normalization pipeline.
   * Returns an object with:
   *   - normalized: the fully normalized text (for pattern matching)
   *   - embedded: array of extracted embedded text fragments
   *   - original: the original input (unchanged)
   */
  function normalize(text) {
    const input = String(text || '');
    if (!input) return { normalized: '', embedded: [], original: '' };

    // Pipeline: strip → NFKC → homoglyphs → leetspeak → base64 → collapse
    let processed = input;
    processed = stripZeroWidth(processed);
    processed = nfkcNormalize(processed);
    processed = replaceHomoglyphs(processed);

    // Extract embedded content before further normalization
    const embedded = extractEmbeddedText(processed);

    // Continue normalization
    processed = expandLeetspeak(processed);
    processed = decodeBase64Payloads(processed);
    processed = collapseWhitespace(processed);

    return {
      normalized: processed,
      embedded: embedded,
      original: input
    };
  }

  window.AIDR = window.AIDR || {};
  window.AIDR.normalizer = {
    normalize,
    stripZeroWidth,
    nfkcNormalize,
    replaceHomoglyphs,
    expandLeetspeak,
    decodeBase64Payloads,
    collapseWhitespace,
    extractEmbeddedText
  };
})();
