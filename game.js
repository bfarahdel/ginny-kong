const video = document.querySelector('#camera');
const status = document.querySelector('#status');
const preview = document.querySelector('.preview');
const canvas = document.querySelector('#paws');
const ctx = canvas.getContext('2d');
const armCanvas = document.querySelector('#arms');
const armCtx = armCanvas.getContext('2d');
const catCanvas = document.querySelector('#cat');
const catCtx = catCanvas.getContext('2d');
const portrait = document.querySelector('#portrait');
const skyCanvas = document.querySelector('#sky');
const skyCtx = skyCanvas.getContext('2d');
const planeSprites = document.querySelector('#plane-sprites');
const planeWidth = 190;
// Row boundaries include the wheels and propellers of the generated atlas.
const planeRows = [0, .346, .679, 1];
const gaze = { x: 0, y: 0 };
const smoke = [];
let lastSwat = -10000;
let defeatedPlanes = 0;
const stage = document.querySelector('.stage');
const replayButton = document.querySelector('#replay');
const celebrationCanvas = document.querySelector('#celebration');
const celebrationCtx = celebrationCanvas.getContext('2d');
let finishedAt = null;
const confetti = [];
const planes = Array.from({ length: 3 }, (_, i) => ({ x: -190, y: 150, lane: i, speed: 125 + i * 25, route: i, hit: 0 }));
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
let tracker, trackerPromise, stream, running = false, starting = false, generation = 0;
let faceTracker, startFaceTracking, lastFaceTime = -1, lastFaceDetection = 0;
const expression = { seen: -10000, mouth: 0, targetMouth: 0 };
let trackingReady = false, resumeOnVisible = false;
let lastVideoTime = -1, lastRender = performance.now();
const paws = [78, 402].map(x => ({ x, y: 555, tx: x, ty: 555, seen: 0, tracked: false }));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
let sceneHeight = 720;

function resizeScene() {
  // Use the same scale on both axes so Ginny and her arms keep their proportions
  // on tall phones as well as the wider desktop preview.
  sceneHeight = Math.round(480 * (canvas.clientHeight || 720) / (canvas.clientWidth || 480));
  canvas.height = armCanvas.height = catCanvas.height = skyCanvas.height = celebrationCanvas.height = sceneHeight;
  paws.forEach(paw => { paw.y = paw.ty = sceneHeight - 165; });
}
window.addEventListener('resize', resizeScene);
resizeScene();

let soundContext, soundBus, soundMuted = false;
async function startAudio(event) {
  // Create audio only after interaction; page-load autoplay is blocked in browsers.
  if (!soundContext && !event?.isTrusted && !navigator.userActivation?.hasBeenActive) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    if (!soundContext) {
      const audio = new AudioContext();
      const limiter = audio.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 6;
      soundBus = audio.createGain(); soundBus.gain.value = .65;
      soundBus.connect(limiter).connect(audio.destination);
      soundContext = audio;
    }
    if (!document.hidden) await soundContext.resume();
  } catch (error) { if (window.location?.search === '?debug=1') console.info('Impact audio is waiting for browser interaction:', error.message); }
}
// Browsers that block autoplay unlock impact sounds on the first click, tap, or key.
window.addEventListener('pointerdown', startAudio);
window.addEventListener('keydown', startAudio);

function impactSound(strength) {
  if (!soundContext || soundContext.state !== 'running' || soundMuted) return;
  const time = soundContext.currentTime;
  const hit = soundContext.createOscillator(); hit.type = 'triangle';
  hit.frequency.setValueAtTime(180, time); hit.frequency.exponentialRampToValueAtTime(35, time + .22);
  const gain = soundContext.createGain(); gain.gain.setValueAtTime(Math.min(.65, .25 + strength / 1500), time);
  gain.gain.exponentialRampToValueAtTime(.001, time + .3);
  hit.connect(gain).connect(soundBus); hit.start(time); hit.stop(time + .32);
  hit.onended = () => { hit.disconnect(); gain.disconnect(); };
}

function victorySound() {
  if (!soundContext || soundContext.state !== 'running' || soundMuted) return;
  const time = soundContext.currentTime;
  // A rising major arpeggio resolves into a bright, sustained final chord.
  for (const [frequency, delay, duration] of [[523.25, 0, .4], [659.25, .15, .4], [783.99, .3, .4],
    [1046.5, .5, 1.2], [659.25, .5, 1.2], [783.99, .5, 1.2]]) {
    const note = soundContext.createOscillator(); note.type = 'sine'; note.frequency.value = frequency;
    const gain = soundContext.createGain(), start = time + delay;
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(.22, start + .025);
    gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    note.connect(gain).connect(soundBus); note.start(start); note.stop(start + duration + .05);
    note.onended = () => { note.disconnect(); gain.disconnect(); };
  }
}

function recordDefeat(plane, now = performance.now()) {
  if (!plane.hit || plane.counted || finishedAt !== null) return;
  plane.counted = true;
  defeatedPlanes++;
  if (defeatedPlanes === 20) {
    finishedAt = now;
    victorySound();
    for (let i = 0; i < 180; i++) confetti.push({ x: Math.random() * 480, y: -Math.random() * sceneHeight,
      vx: (Math.random() - .5) * 50, vy: 150 + Math.random() * 180, angle: Math.random() * 6.28,
      spin: (Math.random() - .5) * 7, color: ['#ffd34f', '#ff7991', '#67d9ef', '#fff5c9', '#a58af1'][i % 5] });
  }
}
function resetRound() {
  defeatedPlanes = 0; finishedAt = null; confetti.length = 0; smoke.length = 0;
  replayButton.hidden = true; stage.classList.toggle('gold', false);
  planes.forEach((plane, i) => { plane.route = i; launchPlane(plane); });
}
replayButton.addEventListener('click', resetRound);

function drawCelebration(now, dt) {
  celebrationCtx.clearRect(0, 0, 480, sceneHeight);
  if (finishedAt === null) { stage.classList.toggle('gold', false); return; }
  replayButton.hidden = now - finishedAt < 3500;
  stage.classList.toggle('gold', reducedMotion || Math.floor((now - finishedAt) / 600) % 2 === 0);
  confetti.forEach(piece => {
    piece.x += piece.vx * dt; piece.y += piece.vy * dt; piece.angle += piece.spin * dt;
    celebrationCtx.save(); celebrationCtx.translate(piece.x, piece.y); celebrationCtx.rotate(piece.angle);
    celebrationCtx.fillStyle = piece.color; celebrationCtx.fillRect(-4, -6, 8, 12); celebrationCtx.restore();
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) soundContext?.suspend();
  else if (soundContext) startAudio();
});

function message(text, active = false, quiet = false) {
  status.textContent = text;
  status.classList.toggle('quiet', quiet);
}
function updatePreview() { preview.hidden = !running; }

async function loadTracker() {
  if (tracker) return tracker;
  if (!trackerPromise) trackerPromise = createTracker().then(result => {
    if (window.location?.search === '?debug=1') console.info('MediaPipe hand tracker ready.');
    return result;
  }).catch(error => { console.error('MediaPipe initialization failed:', error); trackerPromise = undefined; throw error; });
  return trackerPromise;
}

let trackingFetchInstalled = false;
function installTrackingFetch() {
  // SpideyCam also bypasses this optional analytics endpoint. Tracking does not
  // depend on telemetry, and a blocked request should not hold up its startup.
  if (window.fetch && !trackingFetchInstalled) {
    trackingFetchInstalled = true;
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      if (new URL(url, document.baseURI).hostname === 'odml.pa.googleapis.com') {
        return new Response(null, { status: 204 });
      }
      const asset = new URL(url, document.baseURI);
      const trackingAsset = (asset.hostname === 'storage.googleapis.com' && asset.pathname.startsWith('/mediapipe-models/') && asset.pathname.endsWith('.task')) ||
        (asset.hostname === 'cdn.jsdelivr.net' && asset.pathname.includes('/@mediapipe/tasks-vision') && asset.pathname.endsWith('.wasm'));
      const method = init?.method || input?.method || 'GET';
      if (!trackingAsset || method !== 'GET') return originalFetch.call(window, input, init);
      let cache;
      try {
        cache = await window.caches?.open('ginny-tracking-assets-v1');
        const cached = await cache?.match(asset.href);
        if (cached) { if (window.location?.search === '?debug=1') console.info('Tracking asset cache hit:', asset.href); return cached; }
      } catch (error) { if (window.location?.search === '?debug=1') console.info('Tracking cache unavailable:', error.message); }
      const started = performance.now();
      if (window.location?.search === '?debug=1') console.info('Downloading tracking asset:', asset.href);
      const response = await originalFetch.call(window, input, init);
      if (!response.ok) throw new Error(`Tracking asset HTTP ${response.status}: ${asset.href}`);
      // Store complete responses independently of the browser's ordinary HTTP
      // cache. Reloading with devtools open need not repeat these large transfers.
      if (cache) {
        try {
          await cache.put(asset.href, response.clone());
          if (window.location?.search === '?debug=1') console.info('Tracking asset downloaded and cached:', asset.href, `${Math.round(performance.now() - started)} ms`);
        } catch (error) { if (window.location?.search === '?debug=1') console.info('Tracking asset could not be cached:', error.message); }
      }
      return response;
    };
  }
}

async function createTracker() {
  installTrackingFetch();
  // Use the same library, runtime, asset and GPU options as SpideyCam.
  const { HandLandmarker, FaceLandmarker, FilesetResolver } = await trackingStep('Loading MediaPipe library', () => import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs'));
  const vision = await trackingStep('Loading MediaPipe runtime', () => FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'));
  const options = {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  };
  try { tracker = await trackingStep('Starting hand tracking', () => HandLandmarker.createFromOptions(vision, options)); }
  catch { options.baseOptions.delegate = 'CPU'; tracker = await trackingStep('Starting hand tracking on CPU', () => HandLandmarker.createFromOptions(vision, options)); }
  // Wait for the first working hand frame before starting the extra face task.
  startFaceTracking = () => prepareFaceTracker(FaceLandmarker, vision).catch(error => console.error('Face tracking could not start:', error));
  return tracker;
}

async function prepareFaceTracker(FaceLandmarker, vision) {
  const options = { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
    minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5 };
  try { faceTracker = await FaceLandmarker.createFromOptions(vision, options); }
  catch { options.baseOptions.delegate = 'CPU'; faceTracker = await FaceLandmarker.createFromOptions(vision, options); }
  if (window.location?.search === '?debug=1') console.info('MediaPipe face tracker ready.');
}

function followFace(result, now) {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories?.length) return;
  const values = Object.fromEntries(categories.map(category => [category.categoryName, category.score]));
  const value = name => clamp(values[name] || 0, 0, 1);
  expression.seen = now;
  expression.targetMouth = clamp((value('jawOpen') - .015) / .32, 0, 1);
}

async function trackingStep(label, action) {
  const started = performance.now();
  if (window.location?.search === '?debug=1') console.info('Tracking stage:', label);
  if (running) message(`Camera connected. ${label}…`, true);
  try {
    const result = await action();
    if (window.location?.search === '?debug=1') console.info('Tracking stage complete:', label, `${Math.round(performance.now() - started)} ms`);
    return result;
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function stopCamera(text = 'Camera stopped. Reload the page to try again.') {
  generation++;
  running = false;
  starting = false;
  trackingReady = false;
  expression.seen = -10000;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  video.srcObject = null;
  paws.forEach(paw => { paw.tracked = false; paw.seen = 0; });
  updatePreview();
  message(text);
}

async function startCamera() {
  if (starting || running) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    message('Open this page on HTTPS or localhost to use the camera.');
    return;
  }
  const token = ++generation;
  starting = true;
  message('Allow camera access in your browser to start paw practice.');
  // Prepare tracking while the browser asks for the camera. A slow download must
  // stay connected to startup, so it can enable tracking whenever it finishes.
  const tracking = loadTracker();
  tracking.catch(() => {}); // Handle early rejection while camera permission is pending.
  let acquired;
  try {
    acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    if (token !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    const metadataReady = video.readyState >= 1 ? Promise.resolve() : new Promise(resolve => video.addEventListener('loadedmetadata', resolve, { once: true }));
    video.srcObject = stream;
    await metadataReady;
    if (token !== generation) return;
    await video.play();
    if (token !== generation) return;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (running) stopCamera('Camera disconnected. You can try again.'); });
    running = true;
    lastVideoTime = -1;
    lastFaceTime = -1;
    updatePreview();
    message('Camera connected. Loading hand tracking…', true);
    try {
      await tracking;
      if (token !== generation) return;
      trackingReady = true;
      message('Hold your hands up so Ginny can find them.', true);
    } catch (error) {
      if (token !== generation) return;
      message(`Camera connected, but hand tracking could not load. ${error.message}. Reload to try again.`, true);
      console.error('Hand tracking initialization:', error);
    }
  } catch (error) {
    acquired?.getTracks().forEach(track => track.stop());
    if (token !== generation) return;
    const explanations = {
      NotAllowedError: 'Camera access is blocked by the browser or system. Allow this site to use the camera, then reload.',
      NotFoundError: 'No camera found. Connect a camera, then reload.',
      NotReadableError: 'The camera is unavailable or busy. Close other camera apps, then reload.',
      SecurityError: 'This browser has disabled camera access. Open the page in a browser with camera support.',
    };
    stopCamera(explanations[error.name] || `Camera could not start (${error.name}). Reload the page to try again.`);
    console.error('Camera controls:', error);
  } finally {
    if (token === generation) starting = false;
  }
}
window.addEventListener('pagehide', () => stopCamera());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    resumeOnVisible = true;
    stopCamera('Camera paused while this page was away.');
  } else if (!document.hidden && resumeOnVisible) {
    resumeOnVisible = false;
    startCamera();
  }
});

function followHands(results, now) {
  const points = results.landmarks.map(hand => {
    const palm = [0, 5, 9, 13, 17].map(i => hand[i]);
    const x = 1 - palm.reduce((sum, p) => sum + p.x, 0) / palm.length;
    const y = palm.reduce((sum, p) => sum + p.y, 0) / palm.length;
    return { x: 36 + clamp((x - 0.1) / 0.8, 0, 1) * 408, y: 85 + clamp((y - 0.12) / 0.72, 0, 1) * (sceneHeight - 185) };
  }).sort((a, b) => a.x - b.x);
  const distance = (paw, point) => (paw.tx - point.x) ** 2 + (paw.ty - point.y) ** 2;
  let assignments = [];
  if (points.length === 2) {
    const recent = paws.every(p => now - p.seen < 650);
    const swap = recent && distance(paws[0], points[1]) + distance(paws[1], points[0]) < distance(paws[0], points[0]) + distance(paws[1], points[1]);
    assignments = [[0, points[swap ? 1 : 0]], [1, points[swap ? 0 : 1]]];
  } else if (points.length === 1) {
    const point = points[0];
    const recent = paws.some(p => now - p.seen < 650);
    const index = recent ? (distance(paws[0], point) <= distance(paws[1], point) ? 0 : 1) : (point.x < 240 ? 0 : 1);
    assignments = [[index, point]];
  }
  paws.forEach(p => { p.tracked = false; });
  assignments.forEach(([index, point]) => Object.assign(paws[index], { tx: point.x, ty: point.y, seen: now, tracked: true }));
  message(points.length === 2 ? 'Both paws are following you!' : points.length === 1 ? 'One paw found. Raise your other hand too.' : 'Hands out of view. Hold them up toward the camera.', points.length > 0, true);
}

function solveArm(paw, index) {
  const shoulder = { x: index ? 336 : 144, y: sceneHeight - 62 };
  const dx = paw.x - shoulder.x, dy = paw.y - shoulder.y;
  const rawDistance = Math.hypot(dx, dy);
  // Lengthen only when reaching: relaxed arms remain compact, raised paws can
  // reach the flight lanes even on a tall phone without detaching the shoulder.
  const extension = Math.max(1, (rawDistance + 1) / 340);
  const upper = 165 * extension, lower = 175 * extension;
  const distance = clamp(rawDistance, Math.abs(upper - lower) + 1, upper + lower - 1);
  const ux = rawDistance > 0.001 ? dx / rawDistance : 0;
  const uy = rawDistance > 0.001 ? dy / rawDistance : -1;
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  const side = index ? 1 : -1;
  return {
    shoulder,
    elbow: { x: shoulder.x + along * ux - side * bend * uy, y: shoulder.y + along * uy + side * bend * ux },
    wrist: { x: shoulder.x + distance * ux, y: shoulder.y + distance * uy },
  };
}

function drawArm(rig, ctx, upperArm) {
  const s = upperArm ? rig.shoulder : rig.elbow;
  const w = upperArm ? rig.elbow : rig.wrist;
  const fur = ctx.createLinearGradient(s.x, s.y, w.x, w.y);
  fur.addColorStop(0, upperArm ? '#e6dbc8' : '#b8aa97');
  fur.addColorStop(.5, upperArm ? '#d4c8b5' : '#897c68');
  fur.addColorStop(1, upperArm ? '#b8aa97' : '#5e5449');
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(w.x, w.y);
  ctx.strokeStyle = '#68472e30'; ctx.lineWidth = 65; ctx.stroke();
  ctx.strokeStyle = fur; ctx.lineWidth = 59; ctx.stroke();
  // Fine directional strokes soften the limbs to match Ginny's painted fur.
  for (const [a, b, light] of [[s, w, upperArm ? '#fff2dd' : '#c6bbaa']]) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    ctx.strokeStyle = light; ctx.lineWidth = 1.3; ctx.globalAlpha = .22;
    for (let j = 0; j < 65; j++) {
      const t = (j % 13) / 13;
      const across = (Math.floor(j / 13) - 2) * 10 + Math.sin(j * 9) * 2;
      const x = a.x + dx * t + nx * across, y = a.y + dy * t + ny * across;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx / length * 9 + nx * 2, y + dy / length * 9 + ny * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPaw(paw, index, rig) {
  const { wrist, elbow } = rig;
  ctx.save();
  ctx.translate(wrist.x, wrist.y);
  ctx.rotate(Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) + Math.PI / 2);
  const fur = ctx.createRadialGradient(-12, -22, 2, 0, 0, 56);
  fur.addColorStop(0, '#928470'); fur.addColorStop(.55, '#6b5c4d'); fur.addColorStop(1, '#493f39');
  ctx.fillStyle = fur; ctx.strokeStyle = '#493f39'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(0, 0, 37, 39, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  [-25, -9, 9, 25].forEach((x, i) => {
    ctx.beginPath(); ctx.ellipse(x, -26 - (i === 1 || i === 2 ? 8 : 0), 12, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
  ctx.fillStyle = '#9c6b72';
  ctx.beginPath(); ctx.ellipse(0, 7, 19, 17, 0, 0, Math.PI * 2); ctx.fill();
  [-24, -8, 8, 24].forEach((x, i) => { ctx.beginPath(); ctx.ellipse(x, -24 - (i === 1 || i === 2 ? 8 : 0), 6, 8, 0, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
}

function flightPoint(path, t) {
  const u = 1 - t;
  return { x: u ** 3 * path[0].x + 3 * u * u * t * path[1].x + 3 * u * t * t * path[2].x + t ** 3 * path[3].x,
    y: u ** 3 * path[0].y + 3 * u * u * t * path[1].y + 3 * u * t * t * path[2].y + t ** 3 * path[3].y };
}

function launchPlane(plane) {
  const type = plane.route++ % 4;
  const reverse = plane.route % 2 === 0;
  const mirror = x => reverse ? 480 - x : x;
  const paths = [
    [[-150, 170], [90, 35], [340, 80], [630, 210]],
    [[-150, 100], [230, 430], [270, 25], [630, 155]],
    [[-150, 340], [300, 290], [80, 30], [630, 100]],
    [[120, -130], [480, 120], [-90, 410], [630, 300]],
  ];
  plane.path = paths[type].map(([x, y]) => ({ x: mirror(x), y }));
  let length = 0, previous = plane.path[0];
  for (let i = 1; i <= 40; i++) {
    const point = flightPoint(plane.path, i / 40);
    length += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point;
  }
  Object.assign(plane, { x: plane.path[0].x, y: plane.path[0].y, progress: 0,
    duration: length / plane.speed, hit: 0, counted: false, cooldown: 0, spin: 0, vx: 0, vy: 0, angle: 0, facing: reverse ? -1 : 1 });
}

function deflectPlane(plane, paw, now) {
  if (finishedAt !== null || !paw.tracked || now < plane.cooldown) return false;
  // Contact is an ellipse in the plane's local coordinates, expanded by the paw.
  const c = Math.cos(plane.angle), s = Math.sin(plane.angle);
  const dx = plane.x - paw.x, dy = plane.y - paw.y;
  const lx = c * dx + s * dy, ly = -s * dx + c * dy;
  const rx = 105, ry = 55;
  if ((lx / rx) ** 2 + (ly / ry) ** 2 >= 1) return false;
  let nx = c * lx / (rx * rx) - s * ly / (ry * ry);
  let ny = s * lx / (rx * rx) + c * ly / (ry * ry);
  let length = Math.hypot(nx, ny);
  if (length < .0001) {
    nx = paw.vx - plane.vx; ny = paw.vy - plane.vy; length = Math.hypot(nx, ny);
    if (length < .001) { nx = 0; ny = -1; length = 1; }
  }
  nx /= length; ny /= length;
  const approach = (plane.vx - paw.vx) * nx + (plane.vy - paw.vy) * ny;
  if (approach >= 0) return false;
  const impulse = -1.85 * approach;
  impactSound(impulse);
  plane.vx += impulse * nx; plane.vy += impulse * ny;
  // An off-center hit or a sideways sweep adds angular momentum.
  const tangent = (paw.vx - plane.vx) * -ny + (paw.vy - plane.vy) * nx;
  plane.spin = clamp(plane.spin + tangent / 55 + (lx * ny - ly * nx) * impulse / 6000, -10, 10);
  plane.hit = now; plane.cooldown = now + 180;
  recordDefeat(plane, now);
  lastSwat = now;
  plane.x += nx * 8; plane.y += ny * 8;
  return true;
}

function advancePlane(plane, dt, now, contacts) {
  if (!plane.path) launchPlane(plane);
  if (plane.hit) {
    plane.vy += 170 * dt;
    const drag = Math.exp(-.18 * dt);
    plane.vx *= drag; plane.vy *= drag;
    plane.x += plane.vx * dt; plane.y += plane.vy * dt;
    plane.angle += plane.spin * dt; plane.spin *= Math.exp(-.25 * dt);
  } else {
    const previous = { x: plane.x, y: plane.y };
    plane.progress = Math.min(1, plane.progress + dt / plane.duration);
    Object.assign(plane, flightPoint(plane.path, plane.progress));
    plane.vx = (plane.x - previous.x) / dt; plane.vy = (plane.y - previous.y) / dt;
    plane.facing = plane.vx < 0 ? -1 : 1;
    plane.angle = Math.atan2(plane.vy * plane.facing, plane.vx * plane.facing);
  }
  contacts.forEach(paw => deflectPlane(plane, paw, now));
  if ((!plane.hit && plane.progress >= 1) || (plane.hit &&
    (now - plane.hit > 5000 || plane.x < -220 || plane.x > 700 || plane.y < -220 || plane.y > sceneHeight + 150))) {
    recordDefeat(plane); launchPlane(plane);
  }
}

function drawFlights(now, dt, contacts) {
  skyCtx.clearRect(0, 0, 480, sceneHeight);
  if (finishedAt !== null) { drawSmoke(dt); return; }
  // Small physics steps and interpolated paw positions prevent fast swats from
  // passing through a plane between camera/render frames.
  const steps = Math.max(1, Math.ceil(dt * 120));
  if (dt > 0) for (let step = 1; step <= steps; step++) {
    const movingPaws = contacts.map(paw => ({ ...paw,
      x: paw.px + (paw.x - paw.px) * step / steps,
      y: paw.py + (paw.y - paw.py) * step / steps }));
    planes.forEach(plane => { if (finishedAt === null) advancePlane(plane, dt / steps, now - dt * 1000 * (1 - step / steps), movingPaws); });
  }
  drawSmoke(dt);
  planes.forEach(plane => {
    if (finishedAt !== null) return;
    skyCtx.save(); skyCtx.translate(plane.x, plane.y);
    skyCtx.rotate(plane.angle || 0); skyCtx.scale(plane.facing || 1, 1);
    if (planeSprites.complete && planeSprites.naturalWidth) {
      const rowTop = planeRows[plane.lane] * planeSprites.naturalHeight;
      const rowHeight = (planeRows[plane.lane + 1] - planeRows[plane.lane]) * planeSprites.naturalHeight;
      const height = planeWidth * rowHeight / planeSprites.naturalWidth;
      skyCtx.drawImage(planeSprites, 0, rowTop, planeSprites.naturalWidth, rowHeight,
        -planeWidth / 2, -height / 2, planeWidth, height);
    }
    if (plane.hit) {
      const flicker = 1 + Math.sin(now / 45 + plane.lane) * .25;
      skyCtx.globalCompositeOperation = 'lighter';
      const glow = skyCtx.createRadialGradient(48, 2, 1, 48, 2, 32 * flicker);
      glow.addColorStop(0, '#fff4a6'); glow.addColorStop(.3, '#ffb52dcc'); glow.addColorStop(1, '#ff4c0000');
      skyCtx.fillStyle = glow; skyCtx.beginPath(); skyCtx.arc(48, 2, 32 * flicker, 0, Math.PI * 2); skyCtx.fill();
      for (let i = 0; i < 3; i++) {
        skyCtx.fillStyle = ['#ff5110', '#ffb325', '#fff4a6'][i];
        skyCtx.beginPath(); skyCtx.ellipse(43 - i * 2, -7 - i * 3, (18 - i * 5) * flicker, (28 - i * 7) * flicker, -.35, 0, Math.PI * 2); skyCtx.fill();
      }
      const c = Math.cos(plane.angle), s = Math.sin(plane.angle);
      const engineX = plane.x + c * 48 * plane.facing, engineY = plane.y + s * 48 * plane.facing;
      const count = Math.ceil(dt * 45);
      for (let i = 0; i < count && smoke.length < 300; i++) smoke.push({
        x: engineX + (Math.random() - .5) * 12, y: engineY,
        vx: -plane.vx * .12 + (Math.random() - .5) * 30,
        vy: -35 - Math.random() * 25, age: 0, life: 1.3 + Math.random() * .7, radius: 6 + Math.random() * 7,
      });
    }
    skyCtx.restore();
  });
}

function drawSmoke(dt) {
  for (let i = smoke.length - 1; i >= 0; i--) {
    const puff = smoke[i]; puff.age += dt;
    if (puff.age >= puff.life) { smoke.splice(i, 1); continue; }
    puff.x += puff.vx * dt; puff.y += puff.vy * dt;
    const t = puff.age / puff.life, radius = puff.radius + t * 23;
    skyCtx.save(); skyCtx.globalAlpha = .48 * (1 - t);
    const haze = skyCtx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, radius);
    haze.addColorStop(0, '#4b4140'); haze.addColorStop(.5, '#756b68bb'); haze.addColorStop(1, '#82797600');
    skyCtx.fillStyle = haze; skyCtx.beginPath(); skyCtx.arc(puff.x, puff.y, radius, 0, Math.PI * 2); skyCtx.fill(); skyCtx.restore();
  }
}

function drawGinny(now, dt) {
  catCtx.clearRect(0, 0, 480, sceneHeight);
  if (!portrait.complete || !portrait.naturalWidth) return;
  const target = planes.filter(p => finishedAt === null && !p.hit && p.x > 0 && p.x < 480)
    .sort((a, b) => Math.abs(a.x - 240) - Math.abs(b.x - 240))[0];
  const faceActive = running && now - expression.seen < 450;
  const gx = target ? clamp((target.x - 240) / 240, -1, 1) : Math.sin(now / 3200) * .4;
  const gy = target ? clamp((target.y - (sceneHeight - 250)) / 350, -.85, .4) : -.15;
  const expressionEase = 1 - Math.exp(-28 * dt);
  expression.mouth += ((faceActive ? expression.targetMouth : 0) - expression.mouth) * expressionEase;
  const ease = 1 - Math.exp(-3 * dt);
  gaze.x += (gx - gaze.x) * ease; gaze.y += (gy - gaze.y) * ease;
  const size = sceneHeight > 800 ? 528 : 432;
  const x = (480 - size) / 2, y = sceneHeight - size;
  const breath = reducedMotion ? 0 : Math.sin(now / 900) * 2.2;
  // A continuous strip deformation keeps the neck joined to the breathing
  // chest while the face follows the action, without separate floating parts.
  const headShift = reducedMotion ? 0 : gaze.x * 7;
  const purrPhase = now / 732;
  const jaw = faceActive ? .6 + expression.mouth * 22 : reducedMotion ? 7 : 9 + Math.sin(purrPhase) * 2.5 + Math.max(0, 1 - (now - lastSwat) / 550) * 3;
  const portraitY = t => y + t * size - breath * (1 - t) + jaw * Math.max(0, 1 - Math.abs(t - .685) / .075);
  for (let sy = 0; sy < portrait.naturalHeight; sy += 4) {
    const sh = Math.min(4, portrait.naturalHeight - sy);
    const t = sy / portrait.naturalHeight;
    const headWeight = 1 - clamp((t - .5) / .35, 0, 1);
    const width = size + breath * (1 - headWeight);
    const top = portraitY(t), bottom = portraitY((sy + sh) / portrait.naturalHeight);
    // Stretch each strip to the next strip's deformed boundary. A fixed height
    // leaves gaps when the jaw expands and exposes the blue sky behind Ginny.
    catCtx.drawImage(portrait, 0, sy, portrait.naturalWidth, sh,
      x + (size - width) / 2 + headShift * headWeight, top, width, bottom - top + .8);
  }
  // Move the photographed eye texture a few pixels inside its original socket.
  const blinkPhase = (now % 5700) / 5700;
  const idleBlink = reducedMotion ? 0 : Math.max(0, 1 - Math.abs(blinkPhase - .93) / .025);
  for (const eye of [{ x: .378, y: .438 }, { x: .658, y: .449 }]) {
    const blink = idleBlink;
    const ex = x + eye.x * size + headShift, ey = y + eye.y * size - breath * (1 - eye.y);
    const rx = size * .044, ry = size * .043;
    catCtx.save(); catCtx.beginPath(); catCtx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); catCtx.clip();
    catCtx.drawImage(portrait,
      (eye.x - .06) * portrait.naturalWidth, (eye.y - .06) * portrait.naturalHeight,
      .12 * portrait.naturalWidth, .12 * portrait.naturalHeight,
      ex - size * .06 + gaze.x * 2.5, ey - size * .06 + gaze.y * 2, size * .12, size * .12);
    if (blink > 0) {
      // Use Ginny's own brow fur for the lids rather than a flat painted patch.
      for (const lidY of [ey - ry, ey + ry * (1 - blink)]) {
        catCtx.drawImage(portrait, (eye.x - .044) * portrait.naturalWidth,
          (eye.y - .09) * portrait.naturalHeight, .088 * portrait.naturalWidth,
          .035 * portrait.naturalHeight, ex - rx, lidY, rx * 2, ry * blink + .5);
      }
      catCtx.strokeStyle = '#3b302c'; catCtx.lineWidth = 1;
      catCtx.beginPath(); catCtx.moveTo(ex - rx, ey - ry * (1 - blink)); catCtx.quadraticCurveTo(ex, ey - ry * (1 - blink) + 2, ex + rx, ey - ry * (1 - blink)); catCtx.stroke();
    }
    catCtx.restore();
  }
  // A small dark opening beneath the nose, with the lower lip following the jaw.
  const mx = x + size * .514 + headShift * .48, my = y + size * .663 - breath * .337;
  if (jaw > 1.5) { catCtx.save(); catCtx.translate(mx, my);
  catCtx.fillStyle = '#281d1d'; catCtx.beginPath(); catCtx.ellipse(0, jaw * .5, size * .035, jaw, 0, 0, Math.PI * 2); catCtx.fill();
  catCtx.fillStyle = '#b9878a'; catCtx.beginPath(); catCtx.ellipse(0, jaw * 1.05, size * .02, jaw * .3, 0, 0, Math.PI * 2); catCtx.fill();
  catCtx.restore();
  }
}

function frame(now) {
  const dt = Math.min((now - lastRender) / 1000, 0.1);
  lastRender = now;
  if (running && trackingReady && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      followHands(tracker.detectForVideo(video, now), now);
      if (startFaceTracking) {
        const prepare = startFaceTracking;
        startFaceTracking = undefined;
        setTimeout(prepare, 0);
      }
    }
    catch (error) { console.error('Hand tracking:', error); trackingReady = false; message('Camera connected, but tracking stopped. Reload to try again.', true); }
  }
  if (running && faceTracker && video.readyState >= 2 && video.currentTime !== lastFaceTime && now - lastFaceDetection >= 80) {
    lastFaceTime = video.currentTime; lastFaceDetection = now;
    try { followFace(faceTracker.detectForVideo(video, now), now); }
    catch (error) { console.error('Face tracking:', error); faceTracker = undefined; expression.seen = -10000; }
  }
  ctx.clearRect(0, 0, 480, sceneHeight);
  armCtx.clearRect(0, 0, 480, sceneHeight);
  paws.forEach((paw, index) => {
    if (!running || now - paw.seen > 650) { paw.tx = index ? 402 : 78; paw.ty = sceneHeight - 165; paw.tracked = false; }
    const smoothing = 1 - Math.exp(-14 * dt);
    paw.x += (paw.tx - paw.x) * smoothing;
    paw.y += (paw.ty - paw.y) * smoothing;
  });
  const arms = paws.map(solveArm);
  const contacts = arms.map((rig, i) => {
    const paw = paws[i], previous = paw.previousWrist || rig.wrist;
    const contact = { x: rig.wrist.x, y: rig.wrist.y, px: previous.x, py: previous.y,
      vx: clamp((rig.wrist.x - previous.x) / Math.max(dt, .001), -1200, 1200),
      vy: clamp((rig.wrist.y - previous.y) / Math.max(dt, .001), -1200, 1200), tracked: paw.tracked };
    paw.previousWrist = { ...rig.wrist };
    return contact;
  });
  drawFlights(now, dt, contacts);
  drawGinny(now, dt);
  arms.forEach(rig => drawArm(rig, armCtx, true));
  arms.forEach(rig => drawArm(rig, ctx, false));
  paws.forEach((paw, index) => drawPaw(paw, index, arms[index]));
  drawCelebration(now, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
startCamera();

