const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../game.js'), 'utf8');
let sources = 0, stops = 0, audioContexts = 0;
const parameter = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ gain: parameter(), frequency: parameter(), threshold: parameter(), ratio: parameter(),
  connect() { return this; }, disconnect() {}, start() {}, stop() { stops++; } });
class AudioContext {
  constructor() { audioContexts++; }
  state = 'running'; currentTime = 1; destination = {};
  createGain = node; createDynamicsCompressor = node;
  createOscillator() { sources++; return node(); }
  async resume() {}
}
const context = vm.createContext({ window: { AudioContext, addEventListener() {} }, document: { hidden: false }, navigator: { userActivation: { hasBeenActive: false } },
  soundButton: { addEventListener() {}, setAttribute() {} }, console });
vm.runInContext(source.slice(source.indexOf('let soundContext,'), source.indexOf('function recordDefeat(')), context);
(async () => {
  await context.startAudio();
  assert.equal(audioContexts, 0, 'No AudioContext is created before user interaction');
  context.navigator.userActivation.hasBeenActive = true;
  await context.startAudio();
  assert.equal(audioContexts, 1, 'The first user interaction enables audio');
  assert.equal(sources, 0, 'Enabling audio starts no background sound sources');
  context.impactSound(400);
  assert.equal(sources, 1, 'A plane impact creates a sound');
  assert.equal(stops, 1, 'Impact audio has a scheduled stop');
  context.victorySound();
  assert.equal(sources, 7, 'Victory schedules the celebration melody');
  assert.equal(stops, 7, 'Every victory note has a scheduled stop');
  vm.runInContext('soundMuted = true', context);
  context.impactSound(400);
  context.victorySound();
  assert.equal(sources, 7, 'Mute prevents impact and victory playback');
  console.log('Passed: no background sources, collision-only sound, scheduled stop, and mute.');
})().catch(error => { console.error(error); process.exitCode = 1; });
