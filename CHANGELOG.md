# Changelog

All notable changes to Strum Fighter are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.5.0] — 2026-08-31

Learn the shape, not just the letter — and drill a song from your own library.

### Added
- **Chord diagrams that fill in as you fly.** The locked chord's shape is drawn as a chord box
  in the HUD, one finger at a time, low string to high — the order you actually place the grip.
  It opens as an empty grid, then shows which strings are played and muted, then the fretted
  dots, so you get a beat to recall the chord before the answer arrives. Barres grow in with
  their strings, and a shape further up the neck captions its base fret. New **Chord diagram**
  modifier (`reveal` / `on` / `off`).
- **Song mode.** Pick one of your own songs from the new **Track** row and the run drills its
  chords: fighters carry them in scheduled order, and the boss wears the song's real progression
  in playing order, taking a later slice each time so a long song isn't reduced to its opening
  bars. Chord shapes come from the song's own chart, so you play and see the voicing the song
  uses. Songs are read from the host's library API — favourites first, then recent — limited to
  standard tuning and to charts that carry usable chord shapes.
- **Spaced repetition.** Chords are scheduled by how well you actually know them rather than
  drawn uniformly: miss one and it returns soon and often, land it cleanly several times and it
  fades into the background. A miss costs two boxes while a hit earns one, and a scrappy hit
  only promotes on a second one, so barely scraping through never reads as mastery. History is
  kept per song (or per difficulty pool) between runs, and decays if you stay away. It drives
  selection in song and practice mode; a plain scored run keeps its original random draw.
- **The diagram follows your mastery.** A chord you keep losing shows its grip almost
  immediately; one you've earned shows little more than the grid. The game gives exactly as much
  help as you need and takes it back as you stop needing it.
- **Practice mode.** No hull damage, no waves, no boss — the run is on a clock instead (the
  Length modifier reads as 2 / 5 / 10 minutes). A wrong chord still flashes and still breaks the
  combo; it just doesn't end the session you're learning in. New **Mode** modifier.
- **A report worth reading.** The run summary gains a per-chord table (attempts, hit rate,
  mastery), your weakest chords, and your slowest chord changes (`Am → F: 2.4s`). Change times
  count only clean first-attempt hits and are measured from the previously *hit* chord, so they
  describe real changes rather than the reticle reshuffling.

### Changed
- **The chord diagram is on by default** (`shape: reveal`). This is the one place where the
  default run differs from 0.4.x and earlier: the game now teaches the shape rather than only
  testing the name. `shape: off` restores the previous behaviour exactly.
- The **Waves** modifier is now labelled **Length**, since it means minutes in practice mode.

### Fixed
- **Long chord names no longer run off their label.** At 84px even a built-in name like `Cmaj7`
  overflowed the 256px enemy sprite. Both the sprite label and the HUD's big chord name now
  shrink to fit — which matters more now that names can come from a chart and be anything.

### Notes
- Song mode, and the whole library path, is best-effort: a browser build, an unreachable host,
  or a library with nothing playable leaves the Track row absent and the game plays its
  difficulty pools exactly as before.
- Spaced repetition uses `localStorage`, since the minigames SDK exposes no storage API. It is
  treated as optional: if it's unavailable or throws, the run has no history rather than no
  scheduler, and it is written between strums rather than on the gameplay path.

## [0.3.4] — 2026-06-27

### Fixed
- **Desktop engine no longer undetected after the bridge rename.** `audio-input.js`
  now reads `window.feedBackDesktop` with a fallback to the legacy
  `window.slopsmithDesktop`, so the game detects the JUCE engine on desktop builds
  that still expose the old bridge name (got-feedback/feedBack-desktop#40). Bumped
  `BUILD`/version so the cached ES module is refetched on reload.

## [0.3.3] — 2026-06-24

### Fixed
- **Chords never registered during boss fights.** The strum-onset detector
  required the input level to fall below an absolute floor (a moment of near
  silence) before it would accept the next strum. Boss waves turn on continuous
  backing music (`setIntensity(1)`), which pinned the measured input level above
  that floor for the whole fight, so the detector never saw "quiet", never fired
  `onStrum()`, and every boss chord was silently dropped (regular waves were fine
  because the level dipped between strums). The detector now tracks a rolling
  background level and fires on a sharp rise *above* that background — immune to a
  high-but-steady floor — with a fast-attack guard so slow music swells aren't
  mistaken for strums, and a warm-start so the opening frame can't false-trigger.
- **NaN input reading could brick detection for a run.** A non-finite
  `inputLevel` is now coerced to 0 instead of poisoning the rolling-average state.

## [0.3.1] — 2026-06-19

### Fixed
- **Crash on the run-ending hit.** When an incoming enemy bolt landed the final
  hull point, its `onArrive()` callback ran `endRun()` synchronously from inside
  `weapons.update()`'s effect loop — that tears the game down (`sdk.end()` →
  `cleanup()` → `weapons.dispose()` → `reset()`), emptying the `effects` array
  mid-iteration. The loop then dereferenced a now-undefined slot and threw
  `Cannot read properties of undefined (reading 'dispose')`. `update()` now
  snapshots each effect and guards against re-entrant teardown, `dispose()` is
  idempotent, and `reset()` is null-safe.

## [0.3.0] — 2026-06-12

Ear-training — enemies can voice their chord, and the letters can fade or vanish.

### Added
- **Enemy chord sounds.** Optional: when locked, an enemy "strums" its chord
  (Karplus-Strong plucked strings, low-to-high stagger), panned by its on-screen
  position and louder when nearer. Runs on its own audio bus, so it works with the
  backing music off, and ducks for ~280 ms after you strum so it never bleeds into
  the chord scorer. New **Enemy chord sound** toggle (default off).
- **Chord-label modes.** New **Chord labels** modifier: `on` (default — unchanged
  casual play), `fade` (the letter shows at spawn and fades as the fighter closes,
  weaning you off the text), `off` (no letters — pure ear-only; auto-enables the
  chord sound). Bosses hide their progression letters in fade/off (shield pips +
  progress glyphs still show), and — when Enemy chord sound is on — voice each new
  plate's chord as you peel it.
- **Post-kill chord reveal.** In fade/ear modes, the chord name flashes at the
  explosion when you destroy a target — so you find out whether your ear was right.
  This closes the practice loop (guess → strum → confirm).

### Notes
- The default run is byte-for-byte the same casual game as 0.2.x; ear-training is
  entirely opt-in. Chord cues are clean on a direct guitar input (DI/pickup); on a
  microphone, loud monitoring could in principle bleed into detection.

## [0.2.0] — 2026-06-12

Phase 2/3 upgrade — bosses, livery unlocks, and a visual/audio polish pass.

### Added
- **Boss gunships.** Every few waves (and always the final wave) a heavy boss
  warps in, armoured by a **chord progression**: strum the highlighted chord to
  peel one shield plate and advance to the next. Peel them all to expose and
  detonate the core. The boss holds at range, weaves, and lays down sustained
  fire — kill it before it grinds your hull down. Progressions are difficulty-
  scoped (open → barre → 7ths) and named (Ace of Spades, Seventh Heaven, …).
- **Boss shields you can see.** A segmented shield bar across the top of the HUD,
  plus per-plate pips and a done/current/upcoming progression read-out painted on
  the boss itself, so its "health" is unmistakable as you fight it.
- **XP-gated liveries.** The `skin_ace` (250 XP) and `skin_squad` (1000 XP)
  unlocks now actually re-theme the cockpit: HUD accent, gun-tracer colour, and
  fill-light tint. New **Livery** modifier (`auto` picks your highest unlocked).
- **Richer ships.** Rebuilt fighter silhouette (fuselage + nose + canopy + swept
  wings + wingtip pods + twin engines); the boss adds outboard nacelles and a
  cannon spine.
- **Backdrop & juice.** Distant rotating planet with an atmosphere halo, drifting
  multi-layer nebulae, lock-on converge animation, wave banners, bonus toasts
  (Wave Clear / Flawless / Boss Down), combo pulse, and a boss-alert red wash.
- **Deeper scoring.** Wave-clear bonus (scales with wave), flawless-wave bonus,
  and a big boss-kill bonus; richer run summary (bosses downed, livery).
- **Audio.** Boss waves switch to a faster, heavier groove with a kick; added a
  warp-in stinger and a larger boss detonation boom.

### Tuning
- Expanded chord pools (added `Fmaj7`, `E7`, `A7`, `D7`).

## [0.1.4] — 2026-06-08

Initial release — a first-person cockpit **chord-shooter** minigame for Slopsmith.

### Added
- **Chart-free chord detection** via the desktop engine's harmonic-comb scorer
  (`scoreChord`) — strum the chord painted on the locked enemy to destroy it. No
  song or highway required.
- **3D cockpit scene** (Three.js, loaded from core's vendored copy): hyperspace
  starfield streaks, nebula backdrop, and a 2D cockpit HUD with canopy + dashboard.
- **Maneuvering fighters** that weave, bank/roll, and make strafing firing passes.
- **Enemies shoot back** — fighters fire at the cockpit then peel off; incoming
  bolts cost hull.
- **Background battle ambiance** — friendly/enemy flyby ships + distant explosions.
- **Flight-feel camera** — idle sway, slow roll, banking toward the locked target,
  and recoil/impact shake.
- **Juice** — traveling tracer bolts, shockwave explosions with tumbling debris.
- **Difficulty tiers** (easy/medium/hard), **wave-count** and **music** modifiers.
- Score + combo, hull integrity, and run summary via the Minigames SDK (XP,
  leaderboard, profile handled by the framework).

### Notes
- Requires the **Slopsmith desktop app** (the chord scorer runs on the native
  audio engine) and the **Minigames** plugin. Browser-only builds show a graceful
  "needs desktop" panel.
