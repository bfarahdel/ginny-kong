const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');

async function checkCameraStartup(getUserMedia) {
  const nodes = new Map();
  const node = () => ({ textContent: '', hidden: true, checked: true, readyState: 1, classList: { toggle() {} }, addEventListener() {}, getContext() { return {}; }, play: async () => {} });
  let requests = 0;
  const context = {
    document: { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }, addEventListener() {} },
    window: { isSecureContext: true, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia(options) { requests++; assert.equal(options.audio, false); return getUserMedia(options); } } },
    performance: { now: () => 1000 }, requestAnimationFrame() {}, setTimeout, clearTimeout,
    console: { error() {}, info() {} },
  };
  // External tracking is deliberately unavailable: camera startup must be independent of it.
  vm.runInNewContext(source, context, { importModuleDynamically: async () => { throw new Error('Tracking unavailable in test'); } });
  // Hand targets can be anywhere, but both limbs must remain connected and finite.
  for (const index of [0, 1]) for (const [x, y] of [[0, 110], [480, 110], [240, 720], [144, 658], [336, 658]]) {
    const { shoulder, elbow, wrist } = context.solveArm({ x, y }, index);
    const upperLength = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
    const lowerLength = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
    assert.ok(Math.abs(upperLength / lowerLength - 165 / 175) < 0.001, 'Extended limbs keep their proportions');
    assert.ok(Math.abs(wrist.x - x) < 0.001 && Math.abs(wrist.y - y) < 0.001 || Math.hypot(x - shoulder.x, y - shoulder.y) < 11, 'Sky targets are reachable');
    assert.equal(shoulder.x, index ? 336 : 144);
    assert.equal(shoulder.y, 658);
  }
  nodes.get('#paws').clientWidth = 390;
  nodes.get('#paws').clientHeight = 844;
  context.resizeScene();
  for (const index of [0, 1]) for (const x of [36, 240, 444]) {
    const { wrist } = context.solveArm({ x, y: 85 }, index);
    assert.ok(Math.hypot(wrist.x - x, wrist.y - 85) < 0.001, 'Tall portrait screens retain full sky reach');
  }
  assert.equal(requests, 1, 'Page load immediately requests the camera');
  assert.equal(nodes.has('#toggle'), false, 'No enable-camera button is used');
  await new Promise(resolve => setImmediate(resolve));
  return nodes;
}

(async () => {
  const pending = await checkCameraStartup(() => new Promise(() => {}));
  assert.match(pending.get('#status').textContent, /Allow camera access/);
  const denied = await checkCameraStartup(() => Promise.reject(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })));
  assert.match(denied.get('#status').textContent, /blocked by the browser or system/);
  assert.equal(denied.get('.preview').hidden, true);
  const track = { stop() {}, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const connected = await checkCameraStartup(() => Promise.resolve(stream));
  assert.equal(connected.get('#camera').srcObject, stream);
  assert.equal(connected.get('.preview').hidden, false, 'Camera preview stays available even if tracking fails');
  assert.match(connected.get('#status').textContent, /Camera connected, but hand tracking could not load/);
  console.log('Passed: automatic request, pending permission, denied permission, camera independent of tracking.');
})().catch(error => { console.error(error); process.exitCode = 1; });
