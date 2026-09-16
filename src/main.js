import {
  DEFAULT_PARAMS,
  accelCap,
  applyAirAccelTick,
  idealAngle,
  vecLength,
} from './physics.mjs';
import { MouseInput } from './input.js';
import { Simulation } from './sim.js';
import { renderSyncBars } from './render.js';
import { SyncTrace } from './synctrace.js';

const canvas = document.getElementById('trace');
const ctx = canvas.getContext('2d');

// Size directly off the viewport rather than the parent's bounding rect --
// on some layouts the latter can momentarily read wider than the actual
// window (e.g. before a fixed-position sibling settles), which made the
// canvas wider than the page and forced a horizontal scrollbar.
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const el = (id) => document.getElementById(id);

const controls = {
  initialVelocity: el('initialVelocity'),
  tickRate: el('tickRate'),
  airAccelerate: el('airAccelerate'),
  groundMaxSpeed: el('groundMaxSpeed'),
  sensitivity: el('sensitivity'),
  mYaw: el('mYaw'),
  penaltyCrouch: el('penaltyCrouch'),
  penaltyWalk: el('penaltyWalk'),
  penaltyZ: el('penaltyZ'),
  penaltyMoveup: el('penaltyMoveup'),
};

// Remember settings across sessions (per-browser, this-device-only --
// there's no account/server, so it can't follow you to another machine).
// Applied before anything reads controls.value below, so a saved value
// wins over the HTML default from the very first frame.
const STORAGE_KEY = 'strafe-trainer-settings-v1';
const RANGE_IDS = ['initialVelocity', 'tickRate', 'airAccelerate', 'groundMaxSpeed', 'sensitivity', 'mYaw'];
const CHECKBOX_IDS = ['penaltyCrouch', 'penaltyWalk', 'penaltyZ', 'penaltyMoveup'];
const numEl = (id) => el(id + 'Num');

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private browsing / storage blocked -- just use the HTML defaults
  }
}

function saveSettings() {
  try {
    const data = {};
    for (const id of RANGE_IDS) data[id] = controls[id].value;
    for (const id of CHECKBOX_IDS) data[id] = controls[id].checked;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore -- persistence is a nicety, not required for the app to work
  }
}

// A saved value from a browser session predating a default change (e.g.
// sv_maxspeed 260 -> 320 for the KSF convention) otherwise silently wins
// over the new HTML default forever -- restoring settings is supposed to
// preserve what a user deliberately chose, not pin them to a value they
// never actually picked. Only skip restoring a field if it's still sitting
// exactly on the superseded default; anything the user actually changed is
// untouched.
const SUPERSEDED_DEFAULTS = { groundMaxSpeed: '260' };

const saved = loadSavedSettings();
if (saved) {
  for (const id of RANGE_IDS) {
    if (saved[id] === undefined) continue;
    if (SUPERSEDED_DEFAULTS[id] !== undefined && String(saved[id]) === SUPERSEDED_DEFAULTS[id]) continue;
    controls[id].value = saved[id];
    numEl(id).value = saved[id];
  }
  for (const id of CHECKBOX_IDS) {
    if (saved[id] === undefined) continue;
    controls[id].checked = saved[id];
  }
}

// Every slider gets a matching number input the user can type an exact
// value into (dragging a thin slider for something like sensitivity is too
// imprecise) -- bind them together so either one updates both.
function linkPair(rangeEl, numberEl, onChange) {
  const apply = (value) => {
    rangeEl.value = value;
    numberEl.value = value;
    if (onChange) onChange(Number(value));
    saveSettings();
  };
  rangeEl.addEventListener('input', () => apply(rangeEl.value));
  numberEl.addEventListener('change', () => apply(numberEl.value));
  numberEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply(numberEl.value);
  });
  return apply;
}

// Documented minimum penalty multipliers from the reference sheet (fraction
// of unpenalized sv_airaccelerate effectiveness).
const PENALTY_MIN = { crouch: 88.4 / 260, walk: 135.2 / 260, z: 1 / 4, moveup: 203.026 / 260 };

function currentPenalty() {
  return (
    (controls.penaltyCrouch.checked ? PENALTY_MIN.crouch : 1) *
    (controls.penaltyWalk.checked ? PENALTY_MIN.walk : 1) *
    (controls.penaltyZ.checked ? PENALTY_MIN.z : 1) *
    (controls.penaltyMoveup.checked ? PENALTY_MIN.moveup : 1)
  );
}

function readParams() {
  return {
    groundMaxSpeed: Number(controls.groundMaxSpeed.value),
    airMaxSpeed: DEFAULT_PARAMS.airMaxSpeed,
    tickRate: Number(controls.tickRate.value),
    airAccelerate: Number(controls.airAccelerate.value),
    penalty: currentPenalty(),
  };
}

const state = {
  velocity: { x: Number(controls.initialVelocity.value), y: 0 },
  worldViewAngle: 0,
};

function resetState() {
  state.velocity = { x: Number(controls.initialVelocity.value), y: 0 };
  state.worldViewAngle = 0;
  trace.clear();
}

const input = new MouseInput({
  sensitivity: Number(controls.sensitivity.value),
  mYaw: Number(controls.mYaw.value),
});
input.attach(canvas);
input.onLockChange = (locked) => {
  el('lockHint').textContent = locked
    ? 'Locked -- move the mouse to strafe. Esc to release.'
    : 'Click to lock the mouse and start.';
  el('lockHint').classList.toggle('locked', locked);
};

const trace = new SyncTrace({ maxTicks: 240 });

// Diagnostic: the raw turn this specific tick produced, in degrees. Lets
// you see directly on screen whether slow mouse movement is actually
// reaching the sim at all (a real but tiny number here vs. a flat 0.00
// while you're clearly moving the mouse tells apart "small effect" from
// "input isn't arriving," e.g. from Windows' mouse-acceleration curve
// dampening slow movement before the browser ever sees it).
let lastTickYawDeg = 0;

// Physics ticks: authoritative velocity simulation. Sync is scored per
// tick (one bar = one tick) as a piecewise quality score:
//   - gaining (actualGain >= 0): actualGain / idealGain (the standard
//     speedGain/idealGain ratio, matching Momentum Mod's own
//     strafe-trainer HUD), so 0% = no gain, 100% = the best this tick
//     could do.
//   - losing (actualGain < 0): actualGain / accelCap instead. accelCap is
//     fixed by settings (never shrinks with speed), which is the point --
//     see below.
//
// This replaced two earlier, each-broken-in-a-different-way attempts:
// 1. A straight (possibly negative) speedGain/idealGain ratio everywhere:
//    idealGain shrinks roughly as 1/speed, so a fixed, tiny real-world
//    aiming error (0.5deg) swung from ~99% at 260 u/s to -35% at 4000 u/s
//    for the exact same absolute precision.
// 2. A min-max normalization between v_new^2 at the ideal angle and
//    v_new^2 aiming 180deg opposite: this fixed (1), but made "resting"
//    (accel = 0, i.e. literally zero gain) score ~99.6% instead of 0%,
//    because "aim 180deg backward" is a far more extreme worst-case than
//    "do nothing," which compressed the whole useful range near the top.
//    Reported directly: the HUD defaulted to looking great while idle.
//
// This piecewise version keeps (1)'s proven-correct gaining-side ratio
// (same as the validated reference implementation) while fixing (2)'s
// resting bug exactly: accelGain = 0 now gives exactly 0%, not a value
// anchored to an unrelated extreme. The losing side no longer depends on
// idealGain at all, so it can't inherit that ratio's high-speed
// volatility. The gaining side's high-speed sensitivity near the exact
// optimum is a known remaining tradeoff -- every formulation tried so far
// either has that property or breaks somewhere else (see conversation
// history) -- flagged for future revisit if it proves to matter in
// practice.
function onTick(dt, yawDelta) {
  const params = readParams();
  const startSpeed = vecLength(state.velocity);
  const startAngle = Math.atan2(state.velocity.y, state.velocity.x);

  lastTickYawDeg = (yawDelta * 180) / Math.PI;
  state.worldViewAngle += yawDelta;
  const result = applyAirAccelTick(state.velocity, state.worldViewAngle, params);
  state.velocity = result.velocity;

  const cap = accelCap(params);
  const idealA = idealAngle(startSpeed, params.airMaxSpeed, cap);
  const startVel = { x: startSpeed * Math.cos(startAngle), y: startSpeed * Math.sin(startAngle) };
  const best = applyAirAccelTick(startVel, startAngle + idealA, params);

  const idealGain = best.speed - startSpeed;
  const actualGain = result.speed - startSpeed;
  let efficiencyPct;
  if (actualGain >= 0) {
    efficiencyPct = idealGain > 1e-9 ? (actualGain / idealGain) * 100 : 100;
  } else {
    efficiencyPct = (actualGain / cap) * 100;
  }

  trace.push({ efficiencyPct, gained: result.accel > 0 });
}

// Rendering runs every animation frame (not just on tick) so the numeric
// readouts stay live even between ticks; the bars themselves only change
// when a new tick lands.
function onFrame() {
  const speed = vecLength(state.velocity);
  renderSyncBars(ctx, {
    ticks: trace.ticks,
    maxTicks: trace.maxTicks,
    speed,
    syncPct: trace.syncPercent(),
    avgEfficiencyPct: trace.averageEfficiencyPct(),
    lastTickYawDeg,
  });
}

const sim = new Simulation({ tickRate: Number(controls.tickRate.value), onTick, onFrame, input });

// Also live-applies to the currently running simulation (rescaling the
// current velocity vector to the new magnitude, keeping its direction) --
// not just "what to reset to." Otherwise dragging this mid-session visibly
// does nothing, since the sim only reads it once at load/reset.
linkPair(controls.initialVelocity, el('initialVelocityNum'), (v) => {
  const speed = vecLength(state.velocity);
  const angle = Math.atan2(state.velocity.y, state.velocity.x);
  if (speed > 1e-6) {
    state.velocity = { x: v * Math.cos(angle), y: v * Math.sin(angle) };
  } else {
    state.velocity = { x: v, y: 0 };
  }
});
const applyTickRate = linkPair(controls.tickRate, el('tickRateNum'), (v) => sim.setTickRate(v));
linkPair(controls.airAccelerate, el('airAccelerateNum'));
linkPair(controls.groundMaxSpeed, el('groundMaxSpeedNum'));
linkPair(controls.sensitivity, el('sensitivityNum'), (v) => (input.sensitivity = v));
linkPair(controls.mYaw, el('mYawNum'), (v) => (input.mYaw = v));

for (const btn of document.querySelectorAll('#tickRatePresets button')) {
  btn.addEventListener('click', () => applyTickRate(btn.dataset.value));
}

for (const id of CHECKBOX_IDS) {
  controls[id].addEventListener('change', saveSettings);
}

el('resetBtn').addEventListener('click', resetState);

const settingsToggle = el('settingsToggle');
const settingsPanel = el('panel');
settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('open'));

sim.start();
