# Strum Fighter

A first-person cockpit **chord-shooter** minigame for [Slopsmith](https://github.com/got-feedback/feedback).

![Strum Fighter — cockpit view: hyperspace starfield, the "STRUM Dm" prompt, and the reticle locked on a Dm fighter](screenshots/strum-fighter.png)

You fly through a space battle. Each enemy fighter has a **chord name** painted on it by
the HUD, and your reticle auto-locks the nearest one. **Strum that chord on your guitar to
destroy it** — a correct strum detonates the fighter, a wrong chord fires but misses. Clear
the waves before the enemies breach your hull.

Every few waves — and always the last — a **boss gunship** warps in, armoured by a **chord
progression**. Strum the highlighted chord to peel a shield plate and advance to the next;
peel them all to crack the core. Its shields show as a segmented bar in the HUD and as pips
painted on the ship, so you can watch its health fall as you fight.

The chord's **shape** draws itself in as the fighter closes, so you get a beat to recall the
grip yourself and only see the answer if you needed it — and the chords you keep missing come
back more often than the ones you already own.

It's a great way to drill chord recognition and clean chord changes under pressure, with no
song or chart required — or, if you'd rather, to drill the chords of a song from your own
library.

## Requirements

- **Slopsmith desktop app** with your guitar plugged in and an input device selected.
  Chord detection runs chart-free on the native audio engine
  (`window.feedBackDesktop.audio.scoreChord`), which only exists in the desktop build. In a
  browser-only Slopsmith the game shows a "needs the desktop app" panel instead of running.
- The **Minigames** plugin (provides the hub + SDK). Strum Fighter registers itself with it.

No `note_detect` dependency — chord scoring is independent of the note-detection plugin.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/charjonn/feedBack-plugin-strum-fighter/main/install.sh | bash
```

Or, if you would rather read it first — which is the better habit for anything piped into a
shell:

```bash
curl -fsSLO https://raw.githubusercontent.com/charjonn/feedBack-plugin-strum-fighter/main/install.sh
less install.sh && bash install.sh
```

Run it again any time to update.

The script exists because installing a feedBack plugin by hand has three traps, and all three
fail quietly:

- **The directory name must equal the manifest `id` exactly** — `strum_fighter`, not the
  repository name and not what GitHub's zip unpacks to. Get it wrong and the host simply does
  not load the plugin: no error, it is just not in the list.
- **An AppImage is a read-only mount**, so the plugin has to live outside it and be pointed at
  with `FEEDBACK_PLUGINS_DIR`.
- **That variable has to reach the feedBack process**, which a desktop icon will not do. The
  installer writes a `start-feedback.sh` launcher that sets it, and `--desktop` adds an entry
  to your application menu so you can click instead.

Options: `--branch NAME` (default `main`), `--dir PATH` (default
`$XDG_DATA_HOME/feedback/plugins`), `--appimage PATH` (autodetected when omitted), `--desktop`.

### Without a terminal

Download `strum_fighter.zip` from the
[latest release](https://github.com/charjonn/feedBack-plugin-strum-fighter/releases/latest) and
unzip it into your plugins directory. It unpacks to a folder named `strum_fighter` — the name
the host requires — so there is nothing to rename. **Do not rename it.**

You still have to start feedBack with `FEEDBACK_PLUGINS_DIR` pointing at that directory, because
an AppImage is read-only and a desktop icon will not pass the variable through. The `install.sh`
in the zip writes a launcher that does it for you:

```bash
bash ~/.local/share/feedback/plugins/strum_fighter/install.sh --desktop
```

### By hand

Clone or unzip the repository into your plugins directory as a folder named exactly
`strum_fighter`, then start feedBack with `FEEDBACK_PLUGINS_DIR` pointing at that directory.
Note that GitHub's own source zip unpacks to `<repo>-<branch>`, which the host will not load —
rename it, or use the release zip above.

## How to play

1. Open **Minigames** → **Strum Fighter**.
2. Pick a difficulty and length. Optionally pick a **Track** — one of your own songs — to drill
   that song's chords instead of a generic pool.
3. Strum the chord shown on the locked (highlighted) fighter. Build a combo with consecutive
   hits; a wrong chord or a fighter reaching your cockpit breaks the combo and damages the hull.

New to a chord? Watch the diagram on the right fill in as the fighter approaches. Already know
it? It'll barely appear.

## Learning the shapes

The chord box on the right builds up one finger at a time, low string to high, in the order you
actually place the shape. It starts as an empty grid, then shows which strings are played and
which are muted, then the fretted dots — so recall comes first and the answer second.

How fast it fills in depends on how well you know that chord. A chord you keep losing shows its
grip almost immediately; one you've earned shows little more than the grid. That memory is kept
between runs, per song, so the game picks up where you left off — and fades if you stay away.

## Practising a song

Pick a **Track** and the run drills that song:

- **Fighters** carry the song's chords, in scheduled rather than random order — the ones you
  miss come back soon and often, the ones you land cleanly several times drop into the
  background.
- **The boss** wears the song's real progression, in playing order. Each boss takes a later
  slice, so a long song isn't reduced to its opening bars.

Chord shapes come from the song's own chart, so you play and see the voicing the song actually
uses. Songs are offered from your library — favourites first, then recent — limited to standard
tuning, since the shapes would otherwise be wrong for a guitar in standard. Songs whose charts
carry no usable chord shapes (Guitar Pro imports often don't) aren't offered. If nothing
qualifies, the Track row simply doesn't appear and the game plays its difficulty pools as usual.

## Practice mode

**Mode → practice** turns off hull damage, waves and bosses, and runs on a clock instead (the
Length modifier reads as 2 / 5 / 10 minutes). A wrong chord still tells you so and still breaks
your combo — it just doesn't end the session you're trying to learn in. The scheduler always
drives the chord order here.

## After the run

The summary reports what you actually practised: a per-chord table with attempts, hit rate and
mastery, your weakest chords, and your **slowest chord changes** (`Am → F: 2.4s`). That last
one measures lock-on to correct strum, so it includes recognising the chord as well as moving
your hand — comparative rather than absolute, but it's the number that tends to move first when
a change starts becoming automatic.

## Modifiers

- **Difficulty** — `easy` / `medium` / `hard`. Sets the chord pool (open → +barre → +7ths),
  the detection leniency, enemy speed/spawn rate, and boss aggression + escort count. In song
  mode it still sets leniency and pacing, but the chords come from the song — so `easy` on a
  hard song means forgiving scoring on difficult shapes, which is deliberate.
- **Mode** — `run` (default) / `practice`. See [Practice mode](#practice-mode).
- **Length** — waves in `run` mode: `short` (3) / `normal` (6) / `long` (10), with a boss every
  3rd wave and on the final wave. In `practice` mode the same setting means minutes: 2 / 5 / 10.
- **Track** — one of your own songs, or none. Populated from your library at load; see
  [Practising a song](#practising-a-song).
- **Livery** — `auto` / `default` / `ace` / `squad`. Re-themes the cockpit (HUD accent, tracer
  colour, fill light). `auto` uses your highest unlocked livery. **Ace** (`ace`) unlocks at
  250 XP and **Squadron** (`squad`) at 1000 XP (total Minigames profile XP); picking a livery
  you haven't unlocked gracefully falls back to your best one.
- **Chord diagram** — `reveal` (default) / `on` / `off`. `reveal` draws the shape in as the
  fighter closes, adjusted by how well you know that chord; `on` shows it whole; `off` is the
  pre-0.5 game, letters only. Forced `off` in ear-only play, where the diagram would simply
  be the answer.
- **Chord labels** — `on` (default) / `fade` / `off`. `on` is the casual game (letter
  always shown). `fade` shows the letter at spawn and fades it as the fighter closes — the
  ear-training on-ramp. `off` hides the letters entirely (pure ear-only; auto-enables the
  enemy chord sound so you have something to go on). In fade/off, the chord name flashes at
  the explosion when you destroy a target, so you learn whether your ear was right.
  `fade` pairs naturally with the diagram's `reveal`: the letter fades out along the same ramp
  the shape fades in, handing you from the name to the grip.
- **Enemy chord sound** — `off` (default) / `on`. When on, the locked enemy "strums" its
  chord (panned by position, louder when nearer) so you can hear your target. Independent of
  the Music toggle. Clean on a direct guitar input; on a mic, loud monitoring could bleed
  into detection.
- **Music** — backing groove on/off (boss waves switch to a heavier, faster groove).

## Architecture

A standard Slopsmith minigame: a `minigame` block in `plugin.json` + a JS spec registered
with `window.slopsmithMinigames`. Entry point `game.js` loads Three.js (vendored in core at
`/static/vendor/three/`) and the ES modules under `assets/modules/`, then runs the game loop.

| Module | Responsibility |
|---|---|
| `chords.js` | Chord dictionary (name → frets → notes), fingerings + derived shapes, difficulty tiers, boss progressions |
| `diagram.js` | Chord-box diagrams, drawn progressively (pure geometry + a canvas renderer) |
| `library.js` | The player's own songs, read from the host API; chord templates → a drillable set |
| `srs.js` | Spaced repetition over the active chord set (Leitner boxes, weighted selection) |
| `report.js` | Chord-change timing + the end-of-run summary |
| `skins.js` | XP-gated cockpit liveries + unlock resolution from the profile |
| `audio-input.js` | Strum-onset detection (`getLevels`) + chord scoring (`scoreChord`) |
| `scene.js` | Three.js scene, camera, renderer, starfield, planet, lighting, livery tint |
| `enemies.js` | Enemy fighters, boss gunship, billboarded chord/progression labels |
| `weapons.js` | Tracers, muzzle flash, explosions, boss shield-peel + core FX |
| `hud.js` | 2D cockpit HUD (reticle, locked chord, hull, combo, boss shield bar, banners) |
| `synth.js` | Backing groove (+ boss intensity) + laser/explosion/stinger SFX + enemy chord cue (Web Audio) |

Scoring uses `scoreChord`'s `{ isHit, score }`: a fighter kill is `100 × combo × (0.5 + 0.5·score)`,
a boss plate peel is `150 ×` the same; plus wave-clear, flawless-wave, and boss-kill bonuses.

**Song mode** reads the host's ordinary same-origin API: `GET /api/library` for the song list,
then `ws://<host>/ws/highway/{filename}` for one song's `chord_templates` and `chords`. A
template carries its own `frets` and `fingers`, which is exactly what `scoreChord` and the
diagram renderer each want — so a song chord is played and drawn as the chart specifies and is
never matched against the built-in dictionary. The chart socket is read once at run start,
never in the game loop. Songs are offered through the hub's `availableTracks` slot, which it
reads at launch, so the list is filled in after registration.

**Spaced repetition** keys history per song (or per difficulty pool). The minigames SDK has no
storage API, so this is `localStorage` — treated as optional throughout: if it's unavailable or
throws, the run has no history rather than no scheduler.

**Liveries** read `sdk.getProfile().unlocks` (game-scoped IDs like `strum_fighter:skin_ace`,
gated on total profile XP) and re-theme the HUD/tracers/lighting. The Livery modifier picks one;
`auto` resolves to the highest unlocked.

## Roadmap

- **Phase 1 (0.1.x):** playable vertical slice — cockpit, starfield, fighters with chord
  labels, locked-reticle strum→score→hit/miss, waves, hull, combo, score + summary.
- **Phase 2/3 (0.2.0, this build):** richer ships + planet/nebula backdrop, boss gunships
  armoured by chord progressions with visible shields, XP-gated liveries, deeper scoring +
  bonuses, more HUD feedback, and boss-intensity audio.
- **0.3.0 (ear-training):** enemies can voice their chord (Karplus-Strong, panned),
  chord-label fade/off modes, and a post-kill chord reveal — opt-in practice for your ear,
  with the casual default unchanged.
- **0.5.0 (this build):** progressively revealed chord diagrams, song mode driven by your own
  library, spaced repetition with cross-run memory, practice mode, and a report that names your
  weakest chords and slowest changes.
- **Next:** glTF ship models + textures, a fuller soundtrack, more boss progressions and
  attack patterns, and additional unlock liveries. For practice: a searchable song picker for
  large libraries (the hub's Track row is a flat button row, so the list is capped at 12), and
  capo support once the engine's `capo` semantics are confirmed.

## Tests

The pure modules (`chords`, `diagram`, `srs`, `library`, `report`, `skins`) are covered by
`node:test` with no dependencies and no DOM:

```
node --test
```

Two of them are drift guards rather than unit tests: `version.test.js` asserts `BUILD` in
`game.js` matches `plugin.json`'s version (a mismatch leaves the host serving stale cached
modules after a reload), and `manifest.test.js` asserts the modifier list is the same in both
places it is written.

## License

**AGPL-3.0-only**, matching the core Slopsmith and Slopsmith Desktop repositories.
See [LICENSE](LICENSE). Contributions require a DCO sign-off (`git commit -s`).
