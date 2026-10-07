// Exercise the actual startup and frame loop with a deliberately delayed API.
// Run: node --experimental-vm-modules tests/tracking-startup.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let finishLoading, frame, detections = 0, faceDetections = 0, cameraRequests = 0, portraitDraws = 0, faceStarts = 0, fetches = 0;
const loading = new Promise(resolve => { finishLoading = resolve; });
const nodes = new Map();
const drawing = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...args) => {
  for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${String(key)} has finite coordinates`);
  if (key === 'drawImage') portraitDraws++;
} });
const track = { stop() {}, addEventListener() {} };
const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
const timers = new Map();
const context = vm.createContext({
  document: {
    baseURI: 'http://localhost:4175/',
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        textContent: '', checked: true, hidden: true, readyState: 2, currentTime: 1,
        complete: true, naturalWidth: 1024, naturalHeight: 1024,
        classList: { toggle(name, value) { this[name] = value; } }, addEventListener() {}, getContext: () => drawing,
        play: async () => {},
      });
      return nodes.get(selector);
    }, addEventListener() {},
  },
  window: { isSecureContext: true, addEventListener() {}, fetch: async () => { fetches++; return new Response(null, { status: 200 }); } },
  URL, Response,
  navigator: { mediaDevices: { getUserMedia: async () => { cameraRequests++; return stream; } } },
  performance: { now: () => 1000 },
  requestAnimationFrame(callback) { frame = callback; },
  setTimeout(callback, delay) { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); }, console,
});
const hand = Array.from({ length: 21 }, () => ({ x: 0.7, y: 0.4, z: 0 }));
const fakeAPI = new vm.SyntheticModule(['HandLandmarker', 'FaceLandmarker', 'FilesetResolver'], function () {
  this.setExport('FaceLandmarker', { createFromOptions: async () => { faceStarts++; return { detectForVideo() {
    faceDetections++;
    return { faceBlendshapes: [{ categories: [
      { categoryName: 'eyeBlinkLeft', score: .9 }, { categoryName: 'eyeBlinkRight', score: .05 },
      { categoryName: 'jawOpen', score: .5 }, { categoryName: 'eyeLookOutLeft', score: .3 },
    ] }] };
  } }; } });
  this.setExport('FilesetResolver', { forVisionTasks: async url => {
    assert.equal(url, 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
    return {};
  } });
  this.setExport('HandLandmarker', { createFromOptions: async (vision, options) => {
    assert.equal(options.baseOptions.delegate, 'GPU');
    assert.equal(options.baseOptions.modelAssetPath, 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task');
    await loading;
    return { detectForVideo() { detections++; return { landmarks: [hand] }; } };
  } });
}, { context });
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const moduleUnderTest = new vm.SourceTextModule(source + '\nexport { recordDefeat, resetRound, followFace, expression }; export const defeats = () => defeatedPlanes;', {
  context,
  importModuleDynamically: async url => {
    assert.equal(url, 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs');
    await fakeAPI.link(() => {});
    await fakeAPI.evaluate();
    return fakeAPI;
  },
});
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  await moduleUnderTest.link(() => {});
  await moduleUnderTest.evaluate();
  await settle();
  assert.equal((await context.window.fetch('https://odml.pa.googleapis.com/analytics')).status, 204);
  assert.equal(fetches, 0, 'Optional telemetry never reaches the network');
  await context.window.fetch('https://storage.googleapis.com/mediapipe-models/example');
  assert.equal(fetches, 1, 'Tracking asset requests still reach the network');
  assert.equal(cameraRequests, 1);
  assert.equal(nodes.get('.preview').hidden, false, 'Camera is usable while tracking loads');
  // Fire every old-style deadline before the slow API completes.
  for (const { callback } of [...timers.values()]) callback();
  await settle();
  finishLoading();
  await settle();
  assert.equal(faceStarts, 0, 'Face initialization waits for a working hand frame');
  frame(61000);
  assert.equal(detections, 1, 'Hands process their first frame before face initialization');
  for (const [id, { callback }] of [...timers]) { timers.delete(id); callback(); }
  await settle();
  frame(61100);
  assert.equal(faceDetections, 1, 'Face tracking uses the same camera frame');
  assert.equal(moduleUnderTest.namespace.expression.targetLeft, undefined, 'Facial eyelid tracking is disabled');
  assert.equal(moduleUnderTest.namespace.expression.gazeX, undefined, 'Eyes retain their automatic gaze');
  assert.ok(moduleUnderTest.namespace.expression.mouth > .6, 'Mouth opening drives Ginny\'s jaw');
  assert.equal(detections, 1, 'Delayed initialization still reaches real frame processing');
  assert.match(nodes.get('#status').textContent, /One paw found/);
  frame(61110);
  assert.equal(faceDetections, 1, 'Face inference skips unchanged video frames');
  assert.equal(detections, 1, 'An unchanged video frame is not processed twice');
  nodes.get('#camera').currentTime = 2;
  frame(61120);
  assert.equal(detections, 2);
  assert.ok(portraitDraws > 0, 'The live frame loop animates the portrait');
  const defeated = { hit: 1000 };
  const before = moduleUnderTest.namespace.defeats();
  for (let i = 0; i < 25; i++) moduleUnderTest.namespace.recordDefeat(defeated);
  assert.equal(moduleUnderTest.namespace.defeats(), before + 1, 'Repeated hits on the same defeated plane count once');
  while (moduleUnderTest.namespace.defeats() < 19) moduleUnderTest.namespace.recordDefeat({ hit: 1000 });
  frame(61600);
  assert.equal(nodes.get('.stage').classList.gold, false, 'Celebration does not start before 20 defeats');
  moduleUnderTest.namespace.recordDefeat({ hit: 1000 }, 61650);
  frame(61650);
  assert.equal(nodes.get('.stage').classList.gold, true, 'Gold clouds unlock after 20 defeats');
  frame(63800);
  assert.equal(nodes.get('.stage').classList.gold, false, 'Gold clouds alternate back to the originals');
  assert.equal(nodes.get('#replay').hidden, true, 'Replay waits for the confetti celebration');
  moduleUnderTest.namespace.recordDefeat({ hit: 1000 }, 64000);
  assert.equal(moduleUnderTest.namespace.defeats(), 20, 'A finished round accepts no more defeats');
  frame(65200);
  assert.equal(nodes.get('#replay').hidden, false, 'Replay appears after 3.5 seconds');
  moduleUnderTest.namespace.resetRound();
  assert.equal(moduleUnderTest.namespace.defeats(), 0, 'Replay clears the defeat count');
  assert.equal(nodes.get('#replay').hidden, true);
  assert.equal(nodes.get('.stage').classList.gold, false, 'Replay restores the original clouds');
  moduleUnderTest.namespace.followFace({ faceBlendshapes: [] }, 65200);
  frame(66000);
  assert.ok(moduleUnderTest.namespace.expression.mouth < .1, 'Lost face releases expression control');
  console.log('Passed: slow initialization recovers, results reach paws, fresh frames only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
