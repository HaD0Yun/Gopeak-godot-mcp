#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT_README = 'README.md';
const LOCALES = [
  'README-ko.md',
  'README-ja.md',
  'README-de.md',
  'README-pt_BR.md',
  'README-zh.md',
];

const rootReadme = fs.readFileSync(new URL(`./${ROOT_README}`, import.meta.url), 'utf8');

for (const locale of LOCALES) {
  assert.match(rootReadme, new RegExp(`\\(${locale.replace('.', '\\.')}`), `${ROOT_README} should link to ${locale}`);
}

for (const locale of LOCALES) {
  const localized = fs.readFileSync(new URL(`./${locale}`, import.meta.url), 'utf8');
  assert.match(localized, /\[English\]\(README\.md\)/, `${locale} should link back to ${ROOT_README}`);
  assert.match(
    localized,
    /Canonical docs:\s*\[README\.md\]\(README\.md\)\./,
    `${locale} should declare README.md as the canonical source`,
  );
}

console.log('README localization consistency checks passed');
