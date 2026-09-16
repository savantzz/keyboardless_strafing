import {
  DEFAULT_PARAMS,
  accelCap,
  applyAirAccelTick,
  idealAngle,
  vecLength,
} from './physics.mjs';
import { MouseInput } from './input.js';
import { Simulation } from './sim.js';
import { render } from './render.js';

const canvas = document.getElementById('gauge');
const ctx = canvas.getContext('2d');

const el = (id) => document.getElementById(id);

const controls = {
  initialVelocity: el('initialVelocity'),
  tickRate: el('tickRate'),
  airAccelerate: el('airAccelerate'),
  groundMaxSpeed: el('groundMaxSpeed'),
  sensitivity: el('sensitivity'),
  mYaw: el('mYaw'),
  tolerance: el('tolerance'),
  penaltyCrouch: el('penaltyCrouch'),
  penaltyWalk: el('penaltyWalk'),
  penaltyZ: el('penaltyZ'),
  penaltyMoveup: el('penaltyMoveup'),
};

// Documented minimum penalty multipliers from the reference sheet (fraction
// of unpenalized sv_airaccelerate effectiveness).
const PENALTY_MIN = { crouch: 88.4 / 260, walk: 135.2 / 260, z: 1 / 4, moveup: 203.026 / 260 };

function currentPenalty() {
  const p =
    (controls.penaltyCrouch.checked ? PENALTY_MIN.crouch : 1) *
    (controls.penaltyWalk.checked ? PENALTY_MIN.walk : 1) *
    (controls.penaltyZ.checked ? PENALTY_MIN.z : 1) *
    (controls.penaltyMoveup.checked ? PENALTY_MIN.moveup : 1);
  return p;
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
  ticks: 0,
  efficiencySum: 0,
};

function resetState() {
  state.velocity = { x: Number(controls.initialVelocity.value), y: 0 };
  state.worldViewAngle = 0;
  state.ticks = 0;
  state.efficiencySum = 0;
}

const input = new MouseInput({
  sensitivity: Number(controls.sensitivity.value),
  mYaw: Number(controls.mYaw.value),
});
input.attach(canvas);
input.onLockChange = (locked) => {
  el('lockHint').textContent = locked
    ? 'Pointer locked -- move the mouse to strafe. Press Esc to release.'
    : 'Click the gauge to lock the pointer and start strafing.';
};

let latestView = {};

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
  const efficiency = maxGain > 1e-9 ? actualGain / maxGain : actualGain >= 0 ? 1 : 0;
  const efficiencyPct = Math.max(-100, Math.min(100, efficiency * 100));

  state.ticks += 1;
  state.efficiencySum += efficiencyPct;

  latestView = {
    speed: result.speed,
    aimAngle: result.A,
    idealAngle: idealA,
    toleranceRad: (Number(controls.tolerance.value) * Math.PI) / 180,
    angleErrorDeg: (Math.abs(Math.abs(result.A) - idealA) * 180) / Math.PI,
    efficiencyPct,
    avgEfficiencyPct: state.efficiencySum / state.ticks,
  };
  render(ctx, latestView);
}

const sim = new Simulation({ tickRate: Number(controls.tickRate.value), onTick, input });

controls.tickRate.addEventListener('input', () => sim.setTickRate(Number(controls.tickRate.value)));
controls.sensitivity.addEventListener('input', () => (input.sensitivity = Number(controls.sensitivity.value)));
controls.mYaw.addEventListener('input', () => (input.mYaw = Number(controls.mYaw.value)));

for (const [id, out] of [
  ['initialVelocity', 'initialVelocityOut'],
  ['tickRate', 'tickRateOut'],
  ['airAccelerate', 'airAccelerateOut'],
  ['groundMaxSpeed', 'groundMaxSpeedOut'],
  ['sensitivity', 'sensitivityOut'],
  ['mYaw', 'mYawOut'],
  ['tolerance', 'toleranceOut'],
]) {
  const input_ = controls[id] ?? el(id);
  const output = el(out);
  const sync = () => (output.textContent = input_.value);
  input_.addEventListener('input', sync);
  sync();
}

el('resetBtn').addEventListener('click', resetState);

render(ctx, latestView);
sim.start();
