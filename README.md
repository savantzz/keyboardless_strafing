# Keyboardless Strafing Trainer

A browser-based trainer for CS:S/CS:GO-style air-strafing (bhop/surf speed
gain), built on the exact air-acceleration physics used by the Source
engine. The model is ported from a reference Desmos sheet and verified in
`test/physics.test.mjs` against that sheet's own numeric example.

## Run it

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Click the canvas to lock the pointer, then move the mouse to strafe.

The trainer's core visual is a scrolling "sync" bar chart -- the standard
bhop/surf HUD metric, one bar per game tick. Each bar's height is that
tick's speed-gain efficiency versus the theoretical max for your speed
(green = efficient, red/short = little or no gain), and the headline SYNC%
is the percentage of recent ticks that gained any speed at all. Since
keyboardless strafing has no key press defining a wish direction, a dip in
this signal *is* the hesitation-at-a-direction-reversal problem -- no
separate smoothness heuristic needed on top of it. Settings (tickrate,
sv_airaccelerate, sensitivity, m_yaw, air-accel penalties) are behind the
gear icon, top right; tickrate has quick-select buttons for 64/66.667/100/128,
and every slider has a paired number input for typing an exact value.

## How it works

- `src/physics.mjs` -- pure port of the Source engine's `AirAccelerate`
  formula and the sheet's derived quantities (ideal angle, ideal yaw speed,
  wallstrafe variants, multi-tick projections). No DOM dependencies, so it's
  directly testable with `node test/physics.test.mjs`.
- `src/input.js` -- Pointer Lock mouse capture. Mouse deltas are
  accumulated with `getCoalescedEvents()` (so a high-polling-rate mouse
  can't lose movement to event coalescing) and drained once per physics
  tick.
- `src/sim.js` -- fixed-timestep accumulator loop: physics ticks run at a
  constant rate (default 66.667, i.e. CS:S 66-tick) independent of display
  refresh rate. Rendering hooks into a separate per-frame callback so the
  numeric HUD stays live at full display refresh rate even though the bars
  themselves only change once per tick.
- `src/synctrace.js` -- rolling history of per-tick efficiency/gained
  samples plus the sync-percent and average-efficiency stats.
- `src/render.js` -- draws the sync bars and HUD.
- `src/main.js` -- wires the above together and reads the settings panel.

## Notes on the physics

- `airMaxSpeed` (30 u/s) is the hardcoded air-wishspeed cap used only during
  air acceleration -- distinct from `sv_maxspeed` (ground speed, default
  260), which is what actually determines `accelcap` each tick.
- The optimal strafe angle (`idealAngle` in `physics.mjs`) is derived
  analytically, not guessed: maximizing resultant speed under the engine's
  accel clamp gives exactly 90 degrees relative to your velocity when
  `airMaxSpeed <= accelcap`, and `acos((airMaxSpeed - accelcap) / speed)`
  when accel-capped. Both are cross-checked against the reference sheet's
  branch conditions and numeric outputs in the test suite.
- Air-accel penalties (crouch, +speed/walk, a z-velocity window, +moveup)
  are exposed as toggles using the reference sheet's documented minimum
  multipliers; real CS:S doesn't expose an exact formula for these, so
  they're adjustable estimates rather than derived constants.
