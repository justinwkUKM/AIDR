/**
 * AIDR Plugin API - v3 extensibility layer
 * Allows third-party/custom rule registration without core edits.
 * Rules persist to chrome.storage.local and sync across tabs.
 */
(function () {
  const STORAGE_KEY = 'aidr_custom_rules_v1';
  const PLUGIN_REGISTRY_KEY = 'aidr_plugin_registry_v1';

  /** Rule schema for validation */
  const RULE_SCHEMA = {
    required: ['id', 'category', 'message'],
    optional: ['severity_base', 'confidence', 'recommended_action', 'pattern', 'detect'],
    categories: [
      'prompt_injection',
      'sensitive_data',
      'jailbreak',
      'exfiltration',
      'harmful_content',
      'behavioral',
      'response_leakage'
    ],
    severities: ['low', 'medium', 'high', 'critical'],
    actions: ['warn', 'edit', 'block', 'log']
  };

  /**
   * Validate a rule against the schema
   */
  function validateRule(rule) {
    if (!rule || typeof rule !== 'object') {
      throw new Error('Plugin rule must be an object');
    }

    for (const field of RULE_SCHEMA.required) {
      if (!rule[field]) {
        throw new Error(`Plugin rule missing required field: ${field}`);
      }
    }

    const id = String(rule.id).slice(0, 64);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id)) {
      throw new Error('Rule id must be alphanumeric/underscore and start with a letter');
    }

    const category = String(rule.category).slice(0, 32);
    if (!RULE_SCHEMA.categories.includes(category)) {
      throw new Error(`Invalid category: ${category}. Must be one of: ${RULE_SCHEMA.categories.join(', ')}`);
    }

    if (rule.severity_base && !RULE_SCHEMA.severities.includes(String(rule.severity_base))) {
      throw new Error(`Invalid severity_base: ${rule.severity_base}. Must be one of: ${RULE_SCHEMA.severities.join(', ')}`);
    }

    if (rule.recommended_action && !RULE_SCHEMA.actions.includes(String(rule.recommended_action))) {
      throw new Error(`Invalid recommended_action: ${rule.recommended_action}. Must be one of: ${RULE_SCHEMA.actions.join(', ')}`);
    }

    const confidence = Number(rule.confidence || 0.7);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('Confidence must be a number between 0 and 1');
    }

    // Validate pattern if provided
    if (rule.pattern) {
      if (typeof rule.pattern === 'string') {
        try {
          new RegExp(rule.pattern);
        } catch (e) {
          throw new Error(`Invalid regex pattern: ${e.message}`);
        }
      } else if (!(rule.pattern instanceof RegExp)) {
        throw new Error('Pattern must be a string or RegExp');
      }
    }

    // Validate detect function if provided
    if (rule.detect && typeof rule.detect !== 'function') {
      throw new Error('Detect must be a function');
    }

    // At least one of pattern or detect is required
    if (!rule.pattern && !rule.detect) {
      throw new Error('Rule must have either a pattern or detect function');
    }
  }

  /**
   * Normalize a rule for storage (serializable form)
   */
  function normalizeRuleForStorage(rule) {
    return {
      id: String(rule.id).slice(0, 64),
      category: String(rule.category).slice(0, 32),
      severity_base: String(rule.severity_base || 'medium').slice(0, 16),
      confidence: Number(rule.confidence || 0.7),
      message: String(rule.message).slice(0, 160),
      recommended_action: String(rule.recommended_action || 'warn').slice(0, 32),
      pattern_source: rule.pattern instanceof RegExp ? rule.pattern.source : (typeof rule.pattern === 'string' ? rule.pattern : null),
      pattern_flags: rule.pattern instanceof RegExp ? rule.pattern.flags : null,
      has_detect_fn: typeof rule.detect === 'function',
      source: 'plugin',
      installed_at: Date.now()
    };
  }

  /**
   * Restore a rule from storage to executable form
   */
  function restoreRuleFromStorage(stored) {
    const rule = {
      id: stored.id,
      category: stored.category,
      severity_base: stored.severity_base,
      confidence: stored.confidence,
      message: stored.message,
      recommended_action: stored.recommended_action,
      source: stored.source || 'plugin',
      installed_at: stored.installed_at || Date.now()
    };

    if (stored.pattern_source) {
      try {
        rule.pattern = new RegExp(stored.pattern_source, stored.pattern_flags || '');
      } catch (_) {
        // Invalid pattern on restore, skip
      }
    }

    // detect functions can't be restored from storage
    if (stored.has_detect_fn && !rule.pattern) {
      // Mark as needing re-registration
      rule.needs_re_registration = true;
    }

    return rule;
  }

  /**
   * Storage helpers
   */
  function storageGet(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (res) => resolve(res[key] || null));
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  }

  /**
   * Plugin registry state
   */
  const registry = {
    plugins: [], // { name, version, rule_ids: [] }
    rules: []    // full rule objects
  };

  /**
   * Load persisted rules from storage
   */
  async function loadPersistedRules() {
    try {
      const stored = await storageGet(STORAGE_KEY);
      if (Array.isArray(stored)) {
        registry.rules = stored.map(restoreRuleFromStorage).filter(r => !r.needs_re_registration || r.pattern);
      }
    } catch (_) {
      registry.rules = [];
    }

    try {
      const storedRegistry = await storageGet(PLUGIN_REGISTRY_KEY);
      if (storedRegistry && Array.isArray(storedRegistry.plugins)) {
        registry.plugins = storedRegistry.plugins;
      }
    } catch (_) {
      // ignore
    }
  }

  /**
   * Persist rules to storage
   */
  async function persistRules() {
    const serializable = registry.rules.map(normalizeRuleForStorage);
    await storageSet(STORAGE_KEY, serializable);
    await storageSet(PLUGIN_REGISTRY_KEY, { plugins: registry.plugins });
  }

  /**
   * Register a single rule via plugin API
   * @param {Object} rule - The rule to register
   * @returns {Promise<Object>} The normalized rule
   */
  async function registerRule(rule) {
    validateRule(rule);

    // Check for duplicate ID
    const exists = registry.rules.some(r => r.id === String(rule.id));
    if (exists) {
      throw new Error(`Rule with id '${rule.id}' already registered`);
    }

    const normalized = normalizeRuleForStorage(rule);

    // Also register with the in-memory rules engine
    if (window.AIDR && window.AIDR.rules && window.AIDR.rules.registerRule) {
      window.AIDR.rules.registerRule(rule);
    }

    registry.rules.push(normalized);
    await persistRules();

    return normalized;
  }

  /**
   * Register multiple rules at once
   * @param {Array<Object>} rules - Array of rules
   * @returns {Promise<Array<Object>>} Normalized rules
   */
  async function registerRuleSet(rules) {
    if (!Array.isArray(rules)) {
      throw new Error('registerRuleSet expects an array of rules');
    }

    const results = [];
    for (const rule of rules) {
      try {
        const normalized = await registerRule(rule);
        results.push({ ok: true, rule: normalized });
      } catch (err) {
        results.push({ ok: false, error: err.message, id: rule.id || 'unknown' });
      }
    }

    return results;
  }

  /**
   * Unregister a rule by ID
   * @param {string} ruleId - The rule ID to remove
   * @returns {Promise<boolean>} True if removed
   */
  async function unregisterRule(ruleId) {
    const index = registry.rules.findIndex(r => r.id === ruleId);
    if (index === -1) return false;

    registry.rules.splice(index, 1);

    // Remove from plugin registry tracking
    for (const plugin of registry.plugins) {
      plugin.rule_ids = (plugin.rule_ids || []).filter(id => id !== ruleId);
    }

    await persistRules();
    return true;
  }

  /**
   * List all registered plugin rules
   * @returns {Array<Object>} Copy of registered rules
   */
  function listRegisteredRules() {
    return registry.rules.map(r => ({
      id: r.id,
      category: r.category,
      severity_base: r.severity_base,
      confidence: r.confidence,
      message: r.message,
      recommended_action: r.recommended_action,
      source: r.source,
      installed_at: r.installed_at
    }));
  }

  /**
   * Register a plugin manifest (groups rules under a name/version)
   * @param {Object} manifest - { name, version, rules: [] }
   * @returns {Promise<Object>} Registration results
   */
  async function registerPlugin(manifest) {
    if (!manifest || !manifest.name || !manifest.version) {
      throw new Error('Plugin manifest requires name and version');
    }

    if (!Array.isArray(manifest.rules)) {
      throw new Error('Plugin manifest requires rules array');
    }

    const name = String(manifest.name).slice(0, 64);
    const version = String(manifest.version).slice(0, 16);

    // Check if plugin already registered
    const existingIndex = registry.plugins.findIndex(p => p.name === name);
    if (existingIndex !== -1) {
      // Unregister old rules from this plugin
      const oldPlugin = registry.plugins[existingIndex];
      for (const ruleId of (oldPlugin.rule_ids || [])) {
        const idx = registry.rules.findIndex(r => r.id === ruleId);
        if (idx !== -1) registry.rules.splice(idx, 1);
      }
      registry.plugins.splice(existingIndex, 1);
    }

    const results = await registerRuleSet(manifest.rules);
    const ruleIds = results.filter(r => r.ok).map(r => r.rule.id);

    registry.plugins.push({
      name,
      version,
      rule_ids: ruleIds,
      installed_at: Date.now()
    });

    await persistRules();

    return {
      name,
      version,
      total: manifest.rules.length,
      registered: results.filter(r => r.ok).length,
      failures: results.filter(r => !r.ok).map(r => ({ id: r.id, error: r.error }))
    };
  }

  /**
   * Unregister an entire plugin by name
   * @param {string} pluginName - Plugin name to remove
   * @returns {Promise<boolean>} True if removed
   */
  async function unregisterPlugin(pluginName) {
    const index = registry.plugins.findIndex(p => p.name === pluginName);
    if (index === -1) return false;

    const plugin = registry.plugins[index];
    for (const ruleId of (plugin.rule_ids || [])) {
      await unregisterRule(ruleId);
    }

    registry.plugins.splice(index, 1);
    await persistRules();
    return true;
  }

  /**
   * List all registered plugins
   * @returns {Array<Object>} Plugin manifests
   */
  function listPlugins() {
    return registry.plugins.map(p => ({
      name: p.name,
      version: p.version,
      rule_count: (p.rule_ids || []).length,
      installed_at: p.installed_at
    }));
  }

  /**
   * Export rules as JSON (for sharing/backing up)
   * @returns {string} JSON string of all rules
   */
  function exportRules() {
    return JSON.stringify(registry.rules.map(normalizeRuleForStorage), null, 2);
  }

  /**
   * Import rules from JSON (returns import results)
   * @param {string} json - JSON string of rules
   * @returns {Promise<Array<Object>>} Import results
   */
  async function importRules(json) {
    let rules;
    try {
      rules = JSON.parse(json);
    } catch (e) {
      throw new Error('Invalid JSON: ' + e.message);
    }

    if (!Array.isArray(rules)) {
      throw new Error('Import data must be an array of rules');
    }

    // Convert stored format back to registerable format
    const registerable = rules.map(r => {
      const rule = {
        id: r.id,
        category: r.category,
        severity_base: r.severity_base,
        confidence: r.confidence,
        message: r.message,
        recommended_action: r.recommended_action
      };

      if (r.pattern_source) {
        rule.pattern = new RegExp(r.pattern_source, r.pattern_flags || '');
      }

      return rule;
    });

    return await registerRuleSet(registerable);
  }

  // Initialize on load
  loadPersistedRules().catch(() => { /* silent fail on init */ });

  // Expose plugin API
  window.AIDR = window.AIDR || {};
  window.AIDR.plugin = {
    registerRule,
    registerRuleSet,
    unregisterRule,
    listRegisteredRules,
    registerPlugin,
    unregisterPlugin,
    listPlugins,
    exportRules,
    importRules
  };
})();