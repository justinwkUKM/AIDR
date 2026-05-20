#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scripts = [
  'scripts/aidr-unit-tests.js',
  'scripts/aidr-integration-tests.js',
  'scripts/aidr-regression-tests.js'
];

for (const s of scripts) {
  const p = spawnSync(process.execPath, [path.join(root, s)], { stdio: 'inherit' });
  if (p.status !== 0) process.exit(p.status || 1);
}

const bench = spawnSync(process.execPath, [path.join(root, 'scripts/aidr-bench.js'), '5000'], { encoding: 'utf8' });
if (bench.status !== 0) {
  process.stdout.write(bench.stdout || '');
  process.stderr.write(bench.stderr || '');
  process.exit(bench.status || 1);
}

const match = (bench.stdout || '').match(/\{[\s\S]*\}/m);
if (!match) {
  console.error('Bench output parse failure');
  process.exit(1);
}
const perf = JSON.parse(match[0]);
if (Number(perf.p95Ms) >= 100) {
  console.error(`Release gate fail: p95Ms=${perf.p95Ms} >= 100`);
  process.exit(1);
}

const decisionsPath = path.join(root, 'DECISIONS.md');
if (!fs.existsSync(decisionsPath)) {
  console.error('Release gate fail: DECISIONS.md missing');
  process.exit(1);
}

const signoffPath = path.join(root, 'RELEASE_SIGNOFF.json');
if (!fs.existsSync(signoffPath)) {
  console.error('Release gate fail: RELEASE_SIGNOFF.json missing');
  process.exit(1);
}
const signoff = JSON.parse(fs.readFileSync(signoffPath, 'utf8'));
const requiredTrue = [
  'no_severity_1_bugs',
  'security_review_complete',
  'csp_review_complete',
  'permissions_review_complete',
  'privacy_review_complete',
  'performance_gate_passed'
];
for (const k of requiredTrue) {
  if (signoff[k] !== true) {
    console.error(`Release gate fail: ${k} must be true`);
    process.exit(1);
  }
}

console.log('RELEASE GATE: PASS', perf);
