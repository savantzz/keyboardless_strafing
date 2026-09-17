import {
  DEFAULT_PARAMS,
  accelCap,
  applyAirAccelTick,
  idealAngle,
  idealYawSpeedFor,
  keyboardlessWishDir,
  tickInterval,
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
  averagingWindow: el('averagingWindow'),
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
const RANGE_IDS = ['initialVelocity', 'tickRate', 'airAccelerate', 'groundMaxSpeed', 'sensitivity', 'mYaw', 'averagingWindow'];
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

const trace = new SyncTrace({ maxTicks: 240, smoothingWindow: Number(controls.averagingWindow.value) });

// Diagnostic: the raw turn this specific tick produced, in degrees. Lets
// you see directly on screen whether slow mouse movement is actually
// reaching the sim at all (a real but tiny number here vs. a flat 0.00
// while you're clearly moving the mouse tells apart "small effect" from
// "input isn't arriving," e.g. from Windows' mouse-acceleration curve
// dampening slow movement before the browser ever sees it).
let lastTickYawDeg = 0;

// Physics ticks: authoritative velocity simulation. Sync is scored per
// tick (one bar = one tick) as a yaw-RATE ratio: how much you actually
// turned the mouse this tick versus the ideal turn amount for your
// current speed/tickrate/settings (idealYawSpeedFor in physics.mjs) --
// 100% = exactly optimal, under 100% = under-turning, over 100% =
// over-turning past optimal, unbounded above. Matches the momentum-mod
// strafe trainer's actual design, confirmed directly from
// github.com/momentum-mod/game issue #1629: "gain percentage" there is
// literally ViewAngle delta / Optimal rotation angle, explicitly not
// clamped to 100. See README for why this replaced an earlier
// actualGain/idealGain speed-gain ratio: that idealGain was already the
// analytically-best possible gain from ANY angle this tick, so
// actualGain could never exceed it -- structurally bounded at <=100% no
// matter how fast you turned, which is why bars never crossed the
// reference line even when strafing very fast. A yaw-rate ratio has no
// such ceiling, since it's just two rotation amounts divided.
//
// Bar COLOR is a second, separate metric: speedGain/idealGain (the ratio
// this replaced above, brought back here for a different job), matching
// the reference exactly -- confirmed directly from strafe-trainer.ts:
// graphHistory stores { ratio: yawRatio, gain: gainRatio } as two
// independent fields, height comes from `ratio`, color from `gain`
// (getColorPair(s.gain, ...) in drawGraph). Reusing the yaw ratio for
// color too (what this file did before) meant sustained over-turning
// pinned every bar to the same flat color once past the top color-tier
// breakpoint, since nothing here distinguished "over-turned a little,
// still gaining well" from "over-turned wildly, barely gaining at all."
function onTick(dt, yawDelta) {
  const params = readParams();
  const startSpeed = vecLength(state.velocity);
  const startAngle = Math.atan2(state.velocity.y, state.velocity.x);

  lastTickYawDeg = (yawDelta * 180) / Math.PI;
  state.worldViewAngle += yawDelta;

  // See keyboardlessWishDir in physics.mjs for why this isn't just
  // applyAirAccelTick(state.velocity, state.worldViewAngle, params) --
  // confirmed directly that view/crosshair tracks close to travel
  // direction while strafing well, which means view angle itself is not
  // the wish direction; it's offset +/-90 degrees by whichever key an
  // auto-strafe setup is currently holding.
  const { active, wishDirRad } = keyboardlessWishDir(state.worldViewAngle, yawDelta);
  const result = active
    ? applyAirAccelTick(state.velocity, wishDirRad, params)
    : { velocity: state.velocity, speed: startSpeed, accel: 0 };
  state.velocity = result.velocity;

  const cap = accelCap(params);
  const idealYawDelta = idealYawSpeedFor(startSpeed, params.airMaxSpeed, cap, params.tickRate) * tickInterval(params.tickRate);
  const actualYawDelta = Math.abs(yawDelta);
  const efficiencyPct = idealYawDelta > 1e-9 ? (actualYawDelta / idealYawDelta) * 100 : 0;

  const idealA = idealAngle(startSpeed, params.airMaxSpeed, cap);
  const startVel = { x: startSpeed * Math.cos(startAngle), y: startSpeed * Math.sin(startAngle) };
  const best = applyAirAccelTick(startVel, startAngle + idealA, params);
  const idealGain = best.speed - startSpeed;
  const actualGain = result.speed - startSpeed;
  const gainRatioPct = idealGain > 1e-9 ? (actualGain / idealGain) * 100 : 0;

  trace.push({ efficiencyPct, gainRatioPct, gained: result.accel > 0 });
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
const applyInitialVelocity = linkPair(controls.initialVelocity, el('initialVelocityNum'), (v) => {
  const speed = vecLength(state.velocity);
  const angle = Math.atan2(state.velocity.y, state.velocity.x);
  if (speed > 1e-6) {
    state.velocity = { x: v * Math.cos(angle), y: v * Math.sin(angle) };
  } else {
    state.velocity = { x: v, y: 0 };
  }
});
const applyTickRate = linkPair(controls.tickRate, el('tickRateNum'), (v) => sim.setTickRate(v));
const applyAirAccelerate = linkPair(controls.airAccelerate, el('airAccelerateNum'));
const applyGroundMaxSpeed = linkPair(controls.groundMaxSpeed, el('groundMaxSpeedNum'));
const applySensitivity = linkPair(controls.sensitivity, el('sensitivityNum'), (v) => (input.sensitivity = v));
const applyMYaw = linkPair(controls.mYaw, el('mYawNum'), (v) => (input.mYaw = v));
const applyAveragingWindow = linkPair(
  controls.averagingWindow,
  el('averagingWindowNum'),
  (v) => (trace.smoothingWindow = v),
);

for (const btn of document.querySelectorAll('#tickRatePresets button')) {
  btn.addEventListener('click', () => applyTickRate(btn.dataset.value));
}

for (const id of CHECKBOX_IDS) {
  controls[id].addEventListener('change', saveSettings);
}

el('resetBtn').addEventListener('click', resetState);

// Separate from resetState (which restarts the current run): this restores
// the settings panel itself to index.html's declared defaults. Reported
// directly -- after the sv_maxspeed/sv_airaccelerate defaults were updated
// to match KSF convention, the panel kept showing old, heavily-customized
// values (100 / 400 / sensitivity 10) with no visible connection to
// anything current, because localStorage persists whatever you last set
// indefinitely and there was previously no way back to "the actual
// defaults" short of manually retyping every field or clearing site data.
// `defaultValue`/`defaultChecked` read the original HTML `value`/`checked`
// attributes, which JS assigning `.value` at runtime never overwrites, so
// this always restores exactly what index.html declares -- current KSF
// defaults included -- not a hardcoded snapshot that could itself go stale.
function resetSettingsToDefaults() {
  applyInitialVelocity(controls.initialVelocity.defaultValue);
  applyTickRate(controls.tickRate.defaultValue);
  applyAirAccelerate(controls.airAccelerate.defaultValue);
  applyGroundMaxSpeed(controls.groundMaxSpeed.defaultValue);
  applySensitivity(controls.sensitivity.defaultValue);
  applyMYaw(controls.mYaw.defaultValue);
  applyAveragingWindow(controls.averagingWindow.defaultValue);
  for (const id of CHECKBOX_IDS) {
    controls[id].checked = controls[id].defaultChecked;
  }
  saveSettings();
}
el('restoreDefaultsBtn').addEventListener('click', resetSettingsToDefaults);

const settingsToggle = el('settingsToggle');
const settingsPanel = el('panel');
settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('open'));

sim.start();
