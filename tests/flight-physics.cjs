const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../game.js'), 'utf8');
const context = { sceneHeight: 720, finishedAt: null, impactSound() {}, recordDefeat() {}, clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)) };
vm.runInNewContext(source.slice(source.indexOf('function flightPoint('), source.indexOf('function drawGinny(')), context);
const plane = (overrides = {}) => ({ x: 240, y: 160, vx: 160, vy: 0, angle: 0, spin: 0, cooldown: 0, hit: 0, ...overrides });
const paw = (overrides = {}) => ({ x: 290, y: 160, vx: 0, vy: 0, tracked: true, ...overrides });
const bounce = plane();
assert.equal(context.deflectPlane(bounce, paw(), 1000), true);
assert.ok(bounce.vx < 0, 'A stationary paw reflects an incoming plane');
assert.equal(context.deflectPlane(bounce, paw(), 1050), false, 'Contact cooldown prevents repeated impulses in one overlap');
const gentle = plane({ vx: 0 }), strong = plane({ vx: 0 });
context.deflectPlane(gentle, paw({ x: 240, y: 190, vy: -150 }), 1000);
context.deflectPlane(strong, paw({ x: 240, y: 190, vy: -600 }), 1000);
assert.ok(strong.vy < gentle.vy && gentle.vy < 0, 'Faster upward swats launch planes upward more strongly');
const offCenter = plane();
context.deflectPlane(offCenter, paw({ y: 185, vx: -100 }), 1000);
assert.ok(Math.abs(offCenter.spin) > .1, 'An off-center collision imparts spin');
const missed = plane();
assert.equal(context.deflectPlane(missed, paw({ y: 350 }), 1000), false, 'A distant paw cannot hit');
const airborne = plane({ hit: 1000, path: [], vy: -300, facing: 1 });
context.advancePlane(airborne, .1, 1200, []);
assert.ok(airborne.y < 160 && airborne.vy > -300, 'Deflected planes keep moving while gravity slows their climb');
const signs = new Set(); let reachesClouds = false;
for (let route = 0; route < 4; route++) {
  const flight = { route, speed: 150 };
  context.launchPlane(flight);
  signs.add(Math.sign(flight.path[3].x - flight.path[0].x));
  for (let t = 0; t <= 1; t += .05) {
    const point = context.flightPoint(flight.path, t);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    if (point.x > 0 && point.x < 480 && point.y < 170) reachesClouds = true;
  }
}
assert.equal(signs.size, 2, 'Routes fly in both horizontal directions');
assert.ok(reachesClouds, 'Routes cross the cloud artwork in the upper sky');
let effectShapes = 0;
Object.assign(context, { smoke: [], planes: [{ ...airborne, lane: 0 }], planeWidth: 190,
  planeRows: [0, .346, .679, 1], planeSprites: { complete: true, naturalWidth: 1254, naturalHeight: 1254 },
  skyCtx: new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...args) => {
    for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), 'Effect drawing stays finite');
    if (key === 'arc' || key === 'ellipse') effectShapes++;
  } }),
});
context.drawFlights(1300, .016, []);
assert.ok(context.smoke.length > 0 && effectShapes > 0, 'Hit planes emit smoke and render fire');
const firstPuff = context.smoke[0], oldY = firstPuff.y;
context.drawSmoke(.2);
assert.ok(firstPuff.y < oldY && firstPuff.age > 0, 'Smoke rises and ages after emission');
context.drawSmoke(3);
assert.equal(context.smoke.length, 0, 'Expired smoke is removed');
console.log('Passed: directional impulses, swat strength, spin, cooldown, gravity, and varied cloud routes.');
