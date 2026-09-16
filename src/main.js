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

// Physics ticks: authoritative velocity simulation. Sync is scored per
// tick (one bar = one tick), comparing the actual speed gain against the
// theoretical max achievable from the same starting speed/angle -- reusing
// the same applyAirAccelTick the live simulation uses, not a separate
// formula, so "max possible" always reflects the current settings exactly.
function onTick(dt, yawDelta) {
  const params = readParams();
  const startSpeed = vecLength(state.velocity);
  const startAngle = Math.atan2(state.velocity.y, state.velocity.x);

  state.worldViewAngle += yawDelta;
  const result = applyAirAccelTick(state.velocity, state.worldViewAngle, params);
  state.velocity = result.velocity;

  const cap = accelCap(params);
  const idealA = idealAngle(startSpeed, params.airMaxSpeed, cap);
  const best = applyAirAccelTick(
    { x: startSpeed * Math.cos(startAngle), y: startSpeed * Math.sin(startAngle) },
    startAngle + idealA,
    params,
  );
  const maxGain = best.speed - startSpeed;
  const actualGain = result.speed - startSpeed;
  const efficiencyPct = maxGain > 1e-9 ? Math.max(0, (actualGain / maxGain) * 100) : actualGain >= 0 ? 100 : 0;

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
