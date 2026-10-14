// b505: the PWA labels must move together with the APK (2.6.74 / versionCode 505) and bust the app.js cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('b505 version labels and cache key are in sync', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(index, /<title>Market Radar v2\.6\.74<\/title>/);
  assert.match(index, /<span class="version">v2\.6\.74 · b505<\/span>/);
  assert.match(index, /app\.js\?v=1368"/);
  assert.doesNotMatch(index, /2\.6\.73|b504|v=1367/);
  assert.match(app, /matching APK \(2\.6\.74 \/ b505\)/);
  assert.doesNotMatch(app, /2\.6\.73|b504/);
});
