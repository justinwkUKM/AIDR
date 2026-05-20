#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/regression.json'), 'utf8'));
const modules = [
  'aidr/aidr-config.js',
  'aidr/aidr-policy.js',
  'aidr/aidr-rules.js',
  'aidr/aidr-patterns.js',
  'aidr/aidr-detector.js'
];

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
for (const rel of modules) vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });

let failures = 0;

for (const t of fixture.must_detect || []) {
  const ids = sandbox.window.AIDR.detect(t.text).map((d) => d.id);
  if (!ids.includes(t.rule_id)) {
    failures += 1;
    console.log(`FAIL must_detect: expected ${t.rule_id}`);
  }
}

for (const t of fixture.must_not_detect || []) {
  const ids = sandbox.window.AIDR.detect(t.text).map((d) => d.id);
  if (ids.includes(t.rule_id)) {
    failures += 1;
    console.log(`FAIL must_not_detect: unexpected ${t.rule_id}`);
  }
}

if (failures) {
  console.log(`REGRESSION TESTS: FAIL (${failures})`);
  process.exit(1);
}
console.log('REGRESSION TESTS: PASS');
