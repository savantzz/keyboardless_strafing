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

The trainer's core visual is a scrolling bar chart -- one bar per game
tick, height and color driven by a min-max-normalized "quality" score for
that tick (0% = the worst possible outcome for that angle, 100% = the best
possible, see `onTick` in `main.js` for exactly how and why), smoothed over
a short trailing window (see "Why the bars are smoothed" below). A dashed
line marks 100% (optimal); bars above it mean over-rotating past optimal,
below the zero baseline means actively losing speed that tick. The
headline SYNC% is the percentage of recent ticks that gained any speed at
all, unsmoothed. Since keyboardless strafing has no key press defining a
wish direction, a dip in this signal *is* the hesitation-at-a-direction-reversal
problem -- no separate smoothness heuristic needed on top of it. Settings (tickrate,
sv_airaccelerate, sensitivity, m_yaw, air-accel penalties) are behind the
gear icon, top left; tickrate has quick-select buttons for 64/66.667/100.4/128,
every slider has a paired number input for typing an exact value, and all
of it is remembered in the browser (`localStorage`) across sessions.

**Why the default speed is 260, not something higher:** `gainRange()` in
`physics.mjs` (~13 degrees wide at 260 u/s, ~2 degrees at 1600 u/s) measures
a narrow band centered tightly on the true 90-degree optimum -- **not** "the
region where you gain any speed at all," which is actually much wider
(verified directly: at 1600 u/s you gain speed across roughly an 89-to-180-degree
range, not 2 degrees -- an earlier version of this note overstated how
unforgiving high speed is). What *does* get harder at high speed is landing
close to the exact optimum, and more importantly, the raw speedGain/idealGain
ratio (see below) used to blow up disproportionately at high speed even for
tiny, real aiming errors. 260 keeps everything comfortably legible while
learning; the "why the ratio metric changed" note below is the more
important one now.

**Why the score isn't a straight gain ratio (round 1):** it started as
`speedGain / idealGain` (see "Ported from Momentum Mod" below) directly.
Real testing at higher speed produced "random"-looking wild swings between
deep blue and deep red on a smooth, consistent mouse sweep. Root-caused it
directly: `idealGain` (the theoretical best single-tick gain) shrinks
roughly as 1/speed, so a fixed real-world aiming error of 0.5 degrees swung
from ~99% at 260 u/s to **-35% at 4000 u/s** -- same absolute precision,
wildly different-looking number, purely because the yardstick itself was
vanishing.

**Round 2, also wrong:** replaced it with a min-max normalization of
`v_new^2` between "aim 180 degrees opposite ideal" (0%) and "aim exactly
ideal" (100%), which fixed the volatility -- but broke something else,
reported directly: standing still (`accel = 0`, literally zero gain)
scored ~99.6% and painted the HUD blue at rest. Cause: anchoring "worst"
to an extreme (aiming fully backward, which actively decelerates you) made
"doing nothing" sit almost at the top of that wide range, since doing
nothing is much closer to ideal than actively reversing is.

**Current version:** piecewise. Gaining speed uses the original
`actualGain / idealGain` ratio (0% = no gain, 100% = this tick's best
possible, matching the reference HUD, including its high-speed
sensitivity near the exact optimum -- no formulation tried avoided that
without breaking something else worse, see conversation history).
Actively losing speed switches to `actualGain / accelCap` instead --
`accelCap` is fixed by your settings and never shrinks with speed, so it
can't inherit the same-yardstick problem. Verified: resting now scores
exactly 0%, not ~99.6%.

**Why the bars are smoothed:** raw per-tick "gained" is a hard threshold,
and real hand motion has brief micro-reversals (tremor) even during a
sweep that feels perfectly steady -- verified by simulating the exact
scenario through `physics.mjs`: a mathematically smooth sweep (even with
heavy rate jitter) locks into a stable gain/no-gain state and never flips,
but adding realistic micro-reversal noise reproduces the same volume of
flip-flopping seen in real testing. A hard threshold turns each blip into
a full flip from bright green to flat red. Tested empirically that a short
window (3-5 ticks) barely helps (cuts flips roughly in half); a ~12-tick
(~180ms) trailing window is what actually flattens tremor noise down to
just the real underlying transitions (`SyncTrace`'s `smoothingWindow` in
`synctrace.js`). The headline SYNC%/avg-efficiency stats stay on the raw,
unsmoothed values -- they're already aggregates over many ticks, so
smoothing first wouldn't change them, and raw is the more honest number
there.

**Ported from Momentum Mod:** the user found Momentum Mod's actual
Panorama UI source (`RoadyBhop/panorama`) and asked whether we could build
on it directly. Its Panorama TypeScript/XML/SCSS runs inside the actual
game engine via APIs (`MomentumMovementAPI`, `MomentumPlayerAPI`, ...)
that only exist when Momentum Mod itself is running, so none of it
executes in a browser -- using it "as a basis" would mean owning and
installing that specific game and dropping files into its UI folder, not
opening a page. But two things from its `scripts/hud/strafe-trainer.ts`
were worth porting as design, not code: (1) its core metric,
`speedGain / idealGain`, was this trainer's original `efficiencyPct` too
(since replaced -- see above -- after real testing exposed it as unstable
at high speed, which the reference HUD may or may not also suffer from;
we don't have its engine-side scale to compare against); (2) critically,
it does *not* clamp that ratio to [0, 100] -- it shows negative when
you're actively losing speed and >100% when over-rotating, with a 7-tier
color scale (blue/cyan/green/yellow/gray/orange/red) instead of a flat
two-color gradient. This trainer had been discarding exactly that
unclamped information; both the unclamped range and the color tiers carry
over to the new quality score (`render.js`'s `tierColor`/`COLOR_STOPS`,
ported from that file's `Colors` object and `getColorPair`). Its other file,
`strafe-sync.ts` ("Strafe Offset"), measures key-press-vs-mouse-turn
timing in ticks -- inherently needs an A/D key event to compare against,
so it doesn't apply to keyboardless training at all.

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
  themselves only change once per tick. Drains the mouse accumulator once
  per rendered frame and splits it evenly across however many ticks catch
  up that frame -- draining per-tick meant a frame hiccup (GC pause, a busy
  tab) dumped all the movement that piled up during the stall into the
  first catch-up tick and left the rest at zero: one artificial spike
  followed by nothing, from otherwise smooth mouse movement. Regression
  test in `test/sim.test.mjs`.
- `src/synctrace.js` -- rolling history of per-tick efficiency/gained
  samples, each annotated with a smoothed efficiency value (trailing
  ~12-tick window) for rendering, plus the raw sync-percent and
  average-efficiency stats.
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
