import {
  DEFAULT_PARAMS,
  accelCap,
  applyAirAccelTick,
  idealAngle,
  idealYawSpeedFor,
  keyboardlessWishDir,
  keyWishDir,
  tickInterval,
  vecLength,
} from './physics.mjs';
import { MouseInput } from './input.js';
import { KeyboardInput } from './keyboard-input.js';
import { Simulation } from './sim.js';
import { renderSyncBars } from './render.js';
import { SyncTrace } from './synctrace.js';
import { StrafeSync } from './strafesync.js';

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
  keyboardModeEnabled: el('keyboardModeEnabled'),
  lockSpeedEnabled: el('lockSpeedEnabled'),
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
const CHECKBOX_IDS = ['keyboardModeEnabled', 'lockSpeedEnabled', 'penaltyCrouch', 'penaltyWalk', 'penaltyZ', 'penaltyMoveup'];
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
  strafeSync.clear();
}

const input = new MouseInput({
  sensitivity: Number(controls.sensitivity.value),
  mYaw: Number(controls.mYaw.value),
});
input.attach(canvas);

// Real A/D key capture for "keyboard mode" (see keyboard-input.js,
// keyWishDir in physics.mjs, and strafesync.js). Always attached, like
// MouseInput -- direction() itself only reports a held key while locked,
// so this is inert whenever keyboard mode is off or the pointer isn't
// locked.
const keyboardInput = new KeyboardInput();
keyboardInput.attach();

input.onLockChange = (locked) => {
  el('lockHint').textContent = locked
    ? 'Locked -- move the mouse to strafe. Esc to release.'
    : 'Click to lock the mouse and start.';
  el('lockHint').classList.toggle('locked', locked);
  keyboardInput.setLocked(locked);
};

const trace = new SyncTrace({ maxTicks: 240, smoothingWindow: Number(controls.averagingWindow.value) });

// Real strafe-key-vs-mouse-turn timing (see strafesync.js) -- only
// meaningful in keyboard mode, since keyboardless mode infers its "held
// key" directly from the mouse, leaving no independent second signal to
// time against. tickIndex is a running per-tick counter (the reference
// derives its own from wall-clock time / tick interval; a counter is
// equivalent here since this sim already ticks at a fixed rate).
// TURN_EPS_RAD adapts the reference's TURN_EPS (0.5 deg/frame, ignores
// turn jitter below this) to a per-tick threshold, since this sim's
// yawDelta is already per-tick rather than per-frame.
const strafeSync = new StrafeSync();
let tickIndex = 0;
const TURN_EPS_RAD = (0.5 * Math.PI) / 180;

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
// Bar COLOR is a second, separate metric: the RAW speedGain/idealGain
// ratio, unmodified, gaining or losing -- matching the reference exactly
// (confirmed directly from strafe-trainer.ts: graphHistory stores
// { ratio: yawRatio, gain: gainRatio } as two independent fields, height
// from `ratio`, color from `gain`, and getColorPair(s.gain, ...) is
// called with that raw ratio, no special-casing for losing).
//
// A first attempt here piecewise-substituted accelCap for idealGain on
// the losing side (this project's own round 3, applied to a DIFFERENT,
// older color scale). Reported directly as "everything goes gray
// suddenly" at high speed -- confirmed directly why: round 3's
// accelCap-normalized formula was calibrated against that older scale's
// -20%/-100% LOSS/STOP breakpoints, but gainTierColor below ports the
// REFERENCE's own thresholds verbatim, whose STOP floor is -500%. A
// realistic losing tick (e.g. actualGain=-30 at 500 u/s) came out to
// -4% on the accelCap-normalized formula -- nowhere near red, stuck
// in the wide flat NEUTRAL band -- versus -3336% on the raw ratio,
// well past the STOP floor and correctly solid red. The two were never
// validated together; reverted to the raw ratio, which is both what the
// reference actually does and, it turns out, the one that actually
// produces the reference's intended visual range. The GAINING side's
// high-speed sensitivity (idealGain shrinks roughly as 1/speed, so any
// real aiming imprecision swings the ratio hugely -- round 1's original
// -35%-at-4000-u/s finding) is real and still present, but is inherent
// to this exact metric, including in the reference itself, not
// something to work around here.
function onTick(dt, yawDelta) {
  const params = readParams();
  const startSpeed = vecLength(state.velocity);
  const startAngle = Math.atan2(state.velocity.y, state.velocity.x);

  lastTickYawDeg = (yawDelta * 180) / Math.PI;
  state.worldViewAngle += yawDelta;

  // Keyboard mode: wish direction comes from an actually-held A/D key
  // (keyWishDir) instead of being inferred from this tick's mouse motion
  // (keyboardlessWishDir) -- see physics.mjs for both. Only keyboard mode
  // also drives strafesync.js's real key-vs-mouse timing metric, since
  // keyboardless mode's "held key" is derived FROM the mouse, leaving
  // nothing independent to time it against.
  const keyboardMode = controls.keyboardModeEnabled.checked;
  const { active, wishDirRad } = keyboardMode
    ? keyWishDir(state.worldViewAngle, keyboardInput.direction())
    : keyboardlessWishDir(state.worldViewAngle, yawDelta);
  const result = active
    ? applyAirAccelTick(state.velocity, wishDirRad, params)
    : { velocity: state.velocity, speed: startSpeed, accel: 0 };
  state.velocity = result.velocity;

  tickIndex += 1;
  if (keyboardMode) {
    strafeSync.update(tickIndex, keyboardInput.direction(), yawDelta, TURN_EPS_RAD);
  }

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

  // Requested directly ("fix speed at a certain percentage / reset it
  // more easily"): a way to drill technique at a fixed speed instead of
  // it drifting up or down across a run. Applied AFTER scoring above, not
  // before -- the feedback should reflect what your actual technique this
  // tick really did, not a version pre-corrected by the clamp; only the
  // NEXT tick's starting speed is affected.
  if (controls.lockSpeedEnabled.checked) {
    const lockedSpeed = Number(controls.initialVelocity.value);
    const curSpeed = vecLength(state.velocity);
    if (curSpeed > 1e-6) {
      const angle = Math.atan2(state.velocity.y, state.velocity.x);
      state.velocity = { x: lockedSpeed * Math.cos(angle), y: lockedSpeed * Math.sin(angle) };
    }
  }
}

// Rendering runs every animation frame (not just on tick) so the numeric
// readouts stay live even between ticks; the bars themselves only change
// when a new tick lands.
function onFrame() {
  const speed = vecLength(state.velocity);
  const keyboardMode = controls.keyboardModeEnabled.checked;
  // Keyboard mode swaps the headline SYNC% for the real strafe-key-vs-
  // mouse timing stat (strafesync.js) instead of the keyboardless proxy
  // (trace.syncPercent(), "% of ticks that gained speed" -- see
  // synctrace.js's own comment for why that stand-in exists at all).
  // continuousSyncPercent() (not the discrete, keyswitch-event-only
  // syncPercent()) so the headline number updates every turning tick --
  // reported directly as the expected behavior for a live percentage,
  // and it's null before any turning tick has happened yet, distinct
  // from an actual 0%.
  const syncPct = keyboardMode ? (strafeSync.continuousSyncPercent() ?? 0) : trace.syncPercent();

  // Formatted here (not in render.js) so render.js stays pure drawing --
  // text/tier ported directly from the reference's updateText: "Perfect"
  // within perfectThreshold ticks, else "Late Nt"/"Early Nt".
  let latestKeySwitch = null;
  if (keyboardMode) {
    const latest = strafeSync.latest();
    if (latest) {
      const rounded = Math.round(latest.offset);
      if (Math.abs(rounded) <= strafeSync.perfectThreshold) latestKeySwitch = { text: 'Perfect', tier: 'PERFECT' };
      else if (rounded > 0) latestKeySwitch = { text: `Late ${rounded}t`, tier: 'LATE' };
      else latestKeySwitch = { text: `Early ${-rounded}t`, tier: 'EARLY' };
    }
  }

  renderSyncBars(ctx, {
    ticks: trace.ticks,
    maxTicks: trace.maxTicks,
    speed,
    syncPct,
    syncLabel: keyboardMode ? 'SYNC (keyboard)' : 'SYNC',
    avgEfficiencyPct: trace.averageEfficiencyPct(),
    lastTickYawDeg,
    latestKeySwitch,
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

// Switching modes mid-run would otherwise leave a stale pending
// key/mouse switch (from before the toggle) around to pair against a
// switch that happens after it.
controls.keyboardModeEnabled.addEventListener('change', () => strafeSync.clear());

el('resetBtn').addEventListener('click', resetState);

// Quick in-session reset without breaking focus to reach the settings
// panel/button -- requested directly ("reset it more easily with a
// keybind, R perhaps when focused on screen"). Gated on pointer lock so
// it can't fire while typing (e.g. R doesn't appear in a type="number"
// field anyway, but this also keeps it inert whenever the game isn't the
// thing actually receiving input).
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && document.pointerLockElement === canvas) resetState();
});

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
