import {
  DEFAULT_PARAMS,
  accelCap,
  applyAirAccelTick,
  idealYawSpeedFor,
} from './physics.mjs';
import { MouseInput } from './input.js';
import { Simulation } from './sim.js';
import { renderTrace } from './render.js';
import { YawRateTrace, computeConsistencyStats } from './yawtrace.js';

const canvas = document.getElementById('trace');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
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

// Every slider gets a matching number input the user can type an exact
// value into (dragging a thin slider for something like sensitivity is too
// imprecise) -- bind them together so either one updates both.
function linkPair(rangeEl, numEl, onChange) {
  const apply = (value) => {
    rangeEl.value = value;
    numEl.value = value;
    if (onChange) onChange(Number(value));
  };
  rangeEl.addEventListener('input', () => apply(rangeEl.value));
  numEl.addEventListener('change', () => apply(numEl.value));
  numEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply(numEl.value);
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
  trace.samples.length = 0;
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

const trace = new YawRateTrace({ windowMs: 4000 });
let lastContinuousYaw = 0;
let lastFrameTime = null;

// Physics ticks: authoritative velocity simulation, unchanged rate
// regardless of display refresh.
function onTick(dt, yawDelta) {
  const params = readParams();
  state.worldViewAngle += yawDelta;
  const result = applyAirAccelTick(state.velocity, state.worldViewAngle, params);
  state.velocity = result.velocity;
}

// Render frames: run every animation frame independent of tick rate, so the
// trace is smooth even on high-refresh displays where most frames wouldn't
// otherwise contain a tick.
function onFrame(nowMs) {
  if (lastFrameTime === null) lastFrameTime = nowMs;
  const dt = (nowMs - lastFrameTime) / 1000;
  lastFrameTime = nowMs;

  const continuousYaw = input.continuousYawRad();
  const rateRadPerSec = dt > 0 ? (continuousYaw - lastContinuousYaw) / dt : 0;
  lastContinuousYaw = continuousYaw;
  const rateDeg = (rateRadPerSec * 180) / Math.PI;
  trace.push(nowMs, rateDeg);

  const params = readParams();
  const speed = Math.hypot(state.velocity.x, state.velocity.y);
  const cap = accelCap(params);
  const targetRad = idealYawSpeedFor(speed, params.airMaxSpeed, cap, params.tickRate);
  const targetDeg = (targetRad * 180) / Math.PI;

  const stats = computeConsistencyStats(trace.samples, targetDeg);
  renderTrace(ctx, {
    samples: trace.samples,
    targetDeg,
    stutterEvents: stats.stutterEvents,
    nowMs,
    windowMs: trace.windowMs,
    stats: { ...stats, speed },
  });
}

const sim = new Simulation({ tickRate: Number(controls.tickRate.value), onTick, onFrame, input });

linkPair(controls.initialVelocity, el('initialVelocityNum'));
const applyTickRate = linkPair(controls.tickRate, el('tickRateNum'), (v) => sim.setTickRate(v));
linkPair(controls.airAccelerate, el('airAccelerateNum'));
linkPair(controls.groundMaxSpeed, el('groundMaxSpeedNum'));
linkPair(controls.sensitivity, el('sensitivityNum'), (v) => (input.sensitivity = v));
linkPair(controls.mYaw, el('mYawNum'), (v) => (input.mYaw = v));

for (const btn of document.querySelectorAll('#tickRatePresets button')) {
  btn.addEventListener('click', () => applyTickRate(btn.dataset.value));
}

el('resetBtn').addEventListener('click', resetState);

const settingsToggle = el('settingsToggle');
const settingsPanel = el('panel');
settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('open'));

sim.start();
