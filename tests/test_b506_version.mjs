// b506: the PWA labels must move together with the APK (2.6.75 / versionCode 506) and bust the app.js cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('b506 version labels and cache key are in sync', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(index, /<title>Market Radar v2\.6\.75<\/title>/);
  assert.match(index, /<span class="version">v2\.6\.75 · b506<\/span>/);
  assert.match(index, /app\.js\?v=1369"/);
  assert.doesNotMatch(index, /2\.6\.74|b505|v=1368/);
  assert.match(app, /matching APK \(2\.6\.75 \/ b506\)/);
  assert.doesNotMatch(app, /2\.6\.74 \/ b505|predates/);
});
