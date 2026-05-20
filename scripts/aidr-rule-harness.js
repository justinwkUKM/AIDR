#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const modules = [
  'aidr/aidr-config.js',
  'aidr/aidr-policy.js',
  'aidr/aidr-rules.js',
  'aidr/aidr-patterns.js',
  'aidr/aidr-detector.js'
];

const fixturePath = process.argv[2] || path.join(root, 'tests/fixtures/custom-rules.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const sandbox = {
  window: {},
  chrome: { storage: { local: { get: (_k, cb) => cb({}), set: (_v, cb) => cb() } } },
  console,
  Date,
  setTimeout,
  clearTimeout
};
sandbox.window = sandbox;
vm.createContext(sandbox);

for (const rel of modules) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

if (Array.isArray(fixture.rules)) {
  fixture.rules.forEach((r) => {
    const pattern = r.pattern ? new RegExp(r.pattern, r.flags || 'i') : null;
    sandbox.window.AIDR.rules.registerRule({
      id: r.id,
      category: r.category,
      severity_base: r.severity_base,
      confidence: r.confidence,
      message: r.message,
      recommended_action: r.recommended_action,
      pattern
    });
  });
}

let passed = 0;
let failed = 0;

for (const tc of fixture.cases || []) {
  const detections = sandbox.window.AIDR.detect(tc.text || '');
  const ids = detections.map((d) => d.id);
  const missing = (tc.expect_rule_ids || []).filter((id) => !ids.includes(id));
  if (missing.length) {
    failed += 1;
    console.log(`FAIL: ${tc.name} missing=${missing.join(',')}`);
  } else {
    passed += 1;
    console.log(`PASS: ${tc.name}`);
  }
}

console.log(JSON.stringify({ passed, failed, total: passed + failed }, null, 2));
process.exit(failed ? 1 : 0);
