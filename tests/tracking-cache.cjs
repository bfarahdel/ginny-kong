const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../game.js'), 'utf8');
const stored = new Map();
let requests = 0;
const cache = {
  async match(url) { return stored.get(url)?.clone(); },
  async put(url, response) {
    const bytes = await response.arrayBuffer();
    stored.set(url, new Response(bytes, { status: response.status, headers: response.headers }));
  },
};
const originalFetch = async url => {
  requests++;
  return new Response('asset bytes', { status: String(url).includes('missing') ? 404 : 200 });
};
function load(caches = { open: async () => cache }) {
  const context = vm.createContext({ window: { fetch: originalFetch, caches },
    document: { baseURI: 'http://localhost:4175/' }, URL, Response, performance, console });
  vm.runInContext(source.slice(source.indexOf('let trackingFetchInstalled'), source.indexOf('async function createTracker()')), context);
  context.installTrackingFetch();
  return context;
}
(async () => {
  const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
  const first = load();
  assert.equal(await (await first.window.fetch(url)).text(), 'asset bytes');
  assert.equal(requests, 1);
  const reload = load();
  assert.equal(await (await reload.window.fetch(url)).text(), 'asset bytes');
  assert.equal(requests, 1, 'Reload reads the persisted asset without another network request');
  const runtime = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm/vision_wasm_internal.wasm';
  await reload.window.fetch(runtime);
  await load().window.fetch(runtime);
  assert.equal(requests, 2, 'WASM runtime also persists across reloads');
  assert.equal((await reload.window.fetch('https://odml.pa.googleapis.com/analytics')).status, 204);
  assert.equal(requests, 2, 'Optional analytics stays bypassed');
  await reload.window.fetch('https://example.org/other');
  assert.equal(requests, 3, 'Other requests pass through normally');
  await assert.rejects(reload.window.fetch(url.replace('latest', 'missing')), /HTTP 404/);
  const unavailable = load({ open: async () => { throw new Error('Storage unavailable'); } });
  assert.equal(await (await unavailable.window.fetch(url)).text(), 'asset bytes', 'Unavailable storage does not prevent tracking');
  console.log('Passed: persistent tracking assets, telemetry bypass, HTTP errors, storage fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
