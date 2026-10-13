// b504: the PWA labels must move together with the APK (2.6.73 / versionCode 504) and bust the app.js cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('b504 version labels and cache key are in sync', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<title>Market Radar v2\.6\.73<\/title>/);
  assert.match(index, /<span class="version">v2\.6\.73 · b504<\/span>/);
  assert.match(index, /app\.js\?v=1367"/);
  assert.doesNotMatch(index, /2\.6\.72|b503|v=1366/);
});
