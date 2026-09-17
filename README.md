# Keyboardless Strafing Trainer

A browser-based trainer for CS:S/CS:GO-style air-strafing (bhop/surf speed
gain), built on the exact air-acceleration physics used by the Source
engine. The model is ported from a reference Desmos sheet and verified in
`test/physics.test.mjs` against that sheet's own numeric example.

## Run it

```sh
python3 serve.py 8000
# open http://localhost:8000
```

Click the canvas to lock the pointer, then move the mouse to strafe.

**Use `serve.py`, not plain `python3 -m http.server`.** Reported directly: after
pulling an update, the page went completely black with dead buttons and no
visible error. Root cause -- `http.server` sends no `Cache-Control` header at
all, so Chrome can silently keep serving an old cached copy of `physics.mjs`
or `input.js` after a `git pull` without even asking the server for the new
one (confirmed: the dev server's own request log was missing those files
entirely). `main.js` then fails to import a since-added export from the
stale module, which throws before any of `main.js` runs -- canvas never gets
sized, no listeners get attached. `serve.py` is the same `http.server` with
one difference, a `Cache-Control: no-store, must-revalidate` header on every
response, so a normal reload after `git pull` always gets the current files.
If you're ever stuck on plain `http.server`, a hard refresh
(Ctrl+Shift+R / Ctrl+F5) works around it for that one load.

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

**Why mouse angle isn't the wish direction (the actual "something
fundamental" bug):** asked directly, after every earlier fix, why it still
felt completely wrong given thousands of hours of real strafing experience.
Asked back a single concrete, checkable question -- while strafing well,
does your crosshair track close to your direction of travel, or point
~90 degrees off to the side? Confirmed: close to travel direction. That's
only possible under the classic held-key mechanic (wishdir = view angle
+/- 90 degrees, whichever of A/D is held) -- a "keyboardless" setup
automates *which key* is held (based on which way you're currently turning
the mouse), it does not remove the offset. This trainer had been feeding
the raw mouse-controlled view angle in as the wish direction directly, zero
offset -- silently training a different, easier skill (aim perpendicular to
your own velocity) than the one real strafing muscle memory is built on,
and explains why every earlier round of fixes (mouse curve, tickrate label,
the quality formula three times over) never actually closed the gap: they
were all built on top of a wishdir model that was never right in the first
place. Confirmed independently before shipping: `idealYawSpeedUncapped`/
`idealYawSpeedCapped` in `physics.mjs` -- present since early in the
project -- were already computing "the yaw speed to hold the optimal
angle," which only makes sense under the view+/-90 model; `main.js`'s
actual tick loop just never used that model for the live wishdir. Fixed via
`keyboardlessWishDir` in `physics.mjs`: sign of the 90-degree offset
follows whichever way you're turning the mouse that tick; zero movement
means no key is being held, i.e. no wish direction and no gain, matching
`AirAccelerate` itself (wishspeed 0 fails the addspeed check and returns
without touching velocity). Verified with a dedicated regression suite
(`test/keyboardless-model.test.mjs`): continuous one-directional turning at
the theoretical ideal yaw rate gains speed every tick and converges to
exactly the known steady state (accel == airMaxSpeed, wishdir-relative-to-
velocity angle == 90 degrees); a realistic back-and-forth strafe (direction
reversing every few ticks, as a real strafer alternates keys) still nets a
speed gain across many reversals, not just in the single-direction case.

**Why the bars are a yaw-rate ratio now, not a gain ratio (round 4):**
reported directly that the panel still showed non-KSF values after the
default change, and that bars never crossed the 100% line "even when
strafing very fast," which contradicted the uploaded Momentum Mod
Panorama zip. Two separate causes:

1. The settings panel had no way back to "the actual defaults" once
   customized -- `localStorage` persists whatever you last set forever,
   and Reset only restarted the current run, never touched settings. Added
   a distinct "Restore defaults" button (`resetSettingsToDefaults` in
   `main.js`) that reads each control's `defaultValue`/`defaultChecked`
   (the original HTML attributes, never overwritten by runtime `.value`
   assignment) so it always matches whatever index.html currently declares
   as default -- KSF values included -- rather than a hardcoded snapshot
   that could itself drift out of date.
2. The gain-ratio metric (`actualGain / idealGain`, see round 3 above) is
   mathematically incapable of exceeding 100%, by construction: `idealGain`
   was already defined as the best possible gain from *any* angle this
   tick, so nothing could ever beat it, no matter how fast you turned.
   Fetched the actual momentum-mod design directly
   ([momentum-mod/game#1629](https://github.com/momentum-mod/game/issues/1629))
   to check against a real reference rather than memory: its "gain
   percentage" is literally `ViewAngle delta / Optimal rotation angle` --
   a ratio of two *rotation amounts*, not two *speeds* -- explicitly not
   clamped to 100. Replaced the metric with exactly that shape, using this
   codebase's own already-validated `idealYawSpeedFor` for the "optimal"
   side: `efficiencyPct = |yawDelta| / (idealYawSpeedFor(...) * tickInterval) * 100`.
   This also matches the user's own description of the skill almost word
   for word ("the only thing impacting gain is how fast you move your
   mouse relative to the optimal, given the tickrate and speed
   travelling") far more directly than a speed-gain ratio does, and is
   simpler: no more hypothetical "best possible tick" simulation needed to
   compute a denominator. Verified directly in-browser: sustained
   over-turning now produces bars well past the reference line (into the
   ported EXTRA/blue tier), matching the reference implementation's own
   unclamped behavior.

**Reference-line z-order and the averaging window (round 5):** reported
directly, from a screenshot of sustained over-strafing: the whole chart
went solid blue and the dashed "optimal" line vanished, and consistent
mouse movement still looked "overly bumpy." Two separate causes:

1. `render.js` drew the dashed reference line *before* the bars loop, so
   any bar tall enough to reach it painted straight over it -- exactly
   the situation (sustained over-turning) where seeing how far past
   optimal you are matters most. Fixed by moving the line draw to after
   the bars, on top, where it can't be covered.
2. Asked directly whether this repo's 12-tick smoothing window matched
   "the averaging window command from the zip" (the Momentum Mod
   panorama source uploaded earlier). Rather than trust memory, found the
   original zip file still on disk and read `strafe-trainer.ts` directly:
   `DEFAULT_BUFFER_LENGTH = 10`, exposed to players as a real setting
   named "Averaging Window" (`updateBufferLength`/`interpFrames`, backed
   by a ring buffer where each sample is pre-scaled by
   `sampleWeight = 1/interpFrames` so summing the buffer gives a true
   moving average -- mechanically different from this repo's
   slice-and-reduce, but the same result: a plain trailing mean over the
   last N ticks). Changed the default from 12 to 10 to match exactly, and
   -- since the reference exposes it as a real setting, not a hardcoded
   constant -- added it to the settings panel here too
   (`averagingWindow`, wired straight to `SyncTrace.smoothingWindow`).

   Reading the actual source also surfaced something not yet ported: the
   reference decouples bar **height** (the yaw ratio, what this repo now
   uses for both) from bar **color** (a separate `speedGain/idealGain`
   ratio, `s.gain` in `graphHistory`) -- height and color come from two
   different metrics there, not one value driving both. That's a
   plausible second contributor to "blue everywhere" beyond the z-order
   bug: this repo's color tiers flatten to a single solid color for
   anything at or past ~105%, so any sustained over-turning currently
   paints uniformly blue regardless of *how* over-turned. Flagged, not
   yet implemented -- it's a real design fork (which metric should drive
   which channel) worth deciding deliberately rather than copying
   reflexively.

## How it works

- `src/physics.mjs` -- pure port of the Source engine's `AirAccelerate`
  formula and the sheet's derived quantities (ideal angle, ideal yaw speed,
  wallstrafe variants, multi-tick projections). No DOM dependencies, so it's
  directly testable with `node test/physics.test.mjs`.
- `src/input.js` -- Pointer Lock mouse capture, requested with
  `{ unadjustedMovement: true }` (see "Why lock requests ask for
  unadjustedMovement" below). Mouse deltas are accumulated with
  `getCoalescedEvents()` (so a high-polling-rate mouse can't lose movement
  to event coalescing) and drained once per physics tick.
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

**Why lock requests ask for `unadjustedMovement`:** reported directly as
"consistent mouse movement, but it randomly, sporadically misreads" it --
re-audited `input.js`'s capture/accumulate/drain path line by line and
found nothing wrong there (still true, and now covered by `sim.test.mjs`'s
burst-distribution case). The actual cause is upstream of this app
entirely: `movementX` from a plain `requestPointerLock()` is the *OS's
processed* pointer-position delta, not a raw device count -- it passes
through the platform's pointer-acceleration/sensitivity curve, which is
non-linear at every setting except exactly Windows' middle "pointer speed"
notch (a separate control from "Enhanced pointer precision," which was
already ruled out). On top of that, Chromium has a documented bug where an
occasional `mousemove` event reports a wildly-too-large delta -- a cursor
"teleport" -- even while the physical motion is steady, which is a very
close match for "consistent movement, sporadic misread." Real games avoid
all of this with raw HID input (`m_rawinput 1` in Source). The fix is
`canvas.requestPointerLock({ unadjustedMovement: true })`, a Chromium
feature added specifically for gaming input so raw device deltas bypass
the OS curve entirely; the app now requests it and falls back to a plain
lock if the browser rejects the option. This could not have been found by
staring harder at this repo's own code -- it's a browser/OS input-pipeline
issue that only a plain ratio/accumulator audit can't see, since by the
time `movementX` reaches JS the bad number is already baked in.

**KSF/skill-surf default cvars:** asked directly what `sv_maxspeed` and
`sv_airaccelerate` should default to, "as a base." `sv_airaccelerate 150`
was already this trainer's default and is confirmed as the standard KSF
(the competitive skill-surf server nearly all world records are set on)
value on CS:GO -- CS:S-era KSF used 100, but CS:GO's air-accel physics
don't behave identically, and 100 is considered too low for it now.
`sv_maxspeed`, previously defaulted here to 260 (chosen only for
`gainRange()` legibility, see above -- unrelated to any real convention),
is set alongside `sv_airaccelerate 150` in KSF-style skill-surf configs at
**320**, so the settings panel default now matches. The initial-speed
slider (a training-scenario starting velocity, not a server cvar) is left
at 260, independent of `sv_maxspeed`.

## Notes on the physics

- **Directly verified against Valve's actual shipped source, not just a
  fan-made recreation.** The user's uploaded PDF (Mikko Peltola's thesis
  "Replicating Source Engine Air Strafing in Unity") was the paper the
  earlier-blocked theseus.fi link and Reddit thread led back to. Its own
  pseudocode reuses one `wishspeed` variable for both the addspeed check
  *and* the accelspeed line -- meaning after it clamps that variable to
  `maxAirWishSpeed` (30) for the check, the same clamped value also feeds
  accelspeed, silently losing the distinction the real engine relies on.
  Fetched the actual `CGameMovement::AirAccelerate` from
  [`ValveSoftware/source-sdk-2013`](https://github.com/ValveSoftware/source-sdk-2013/blob/master/mp/src/game/shared/gamemovement.cpp)
  directly to check: it keeps a *separate* local, `wishspd`, capped to 30
  for the addspeed check only, while `accelspeed = accel * wishspeed *
  frametime * m_surfaceFriction` keeps using the original, uncapped
  parameter -- which `AirMove` clamps to `mv->m_flMaxSpeed` (`sv_maxspeed`),
  not 30. That's exactly what this codebase's `accelCap = groundMaxSpeed *
  penalty * airAccelerate * tickInterval` already does (`penalty` standing
  in for `m_surfaceFriction`) -- confirmed against Valve's own code, not
  just the reference Desmos sheet. It also means `sv_maxspeed` isn't only a
  ground-speed/ramp-entry cap: it directly scales the air-acceleration rate
  itself, which is exactly why KSF-style skill-surf configs deliberately
  raise it to 320 rather than leaving it at a lower "just enough to walk"
  value.
- `airMaxSpeed` (30 u/s) is the hardcoded air-wishspeed cap used only during
  air acceleration -- distinct from `sv_maxspeed` (ground speed, default
  320), which is what actually determines `accelcap` each tick.
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
