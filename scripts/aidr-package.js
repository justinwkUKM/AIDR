#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

console.log('--- STEP 1: Running Release Gate Checks ---');
const gate = spawnSync(process.execPath, [path.join(root, 'scripts/aidr-release-gate.js')], { stdio: 'inherit' });
if (gate.status !== 0) {
  console.error('\n❌ Packaging cancelled: Release gate checks failed.');
  process.exit(1);
}
console.log('✅ Release gate checks passed successfully.\n');

console.log('--- STEP 2: Parsing Extension Version ---');
const manifestPath = path.join(root, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Error: manifest.json not found.');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error('❌ Error parsing manifest.json:', err.message);
  process.exit(1);
}

const version = manifest.version || '0.0.0';
console.log(`📦 Extension name: ${manifest.name}`);
console.log(`🏷️  Extension version: ${version}\n`);

console.log('--- STEP 3: Packaging Extension ---');
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

const zipName = `aidr-v${version}.zip`;
const zipPath = path.join(distDir, zipName);

// Clean up old zip if it exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Define the production files and directories to be packaged
const prodFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'styles.css',
  'aidr',
  'dashboard',
  'icons'
];

console.log('Packaging the following production assets:');
prodFiles.forEach(f => console.log(`  - ${f}`));

// Since user is on Mac (or Unix-like environment), use native zip for zero-dependency execution
const zipArgs = ['-r', zipPath, ...prodFiles];
const zipProcess = spawnSync('zip', zipArgs, { cwd: root, stdio: 'inherit' });

if (zipProcess.status === 0) {
  console.log(`\n🎉 SUCCESS! packaged production zip created at:`);
  console.log(`👉 ${zipPath}`);
  console.log(`Size: ${(fs.statSync(zipPath).size / 1024).toFixed(2)} KB\n`);
} else {
  console.error('\n❌ Error: Failed to package extension using native `zip` command.');
  process.exit(1);
}
