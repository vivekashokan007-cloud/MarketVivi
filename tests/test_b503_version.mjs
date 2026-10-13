// b503: the PWA labels must move together with the APK (2.6.72 / versionCode 503) and bust the app.js cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('b503 version labels and cache key are in sync', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<title>Market Radar v2\.6\.72<\/title>/);
  assert.match(index, /<span class="version">v2\.6\.72 · b503<\/span>/);
  assert.match(index, /app\.js\?v=1366"/);
  assert.doesNotMatch(index, /2\.6\.71|b502|v=1365/);
});
