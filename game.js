/* ===========================================================================
   Škoda Pit Stop — game logic (Phase 3)

   Pure Vanilla JS + Canvas 2D. No frameworks, no build step.
   Open index.html directly in a browser to run.

   GAMEPLAY
     Cars enter from the left across the currently active lanes, each lane
     ending in a fixed station. Stations unlock as you progress:
        Red (Petrol) + Black (Diesel)  from level 1
        Carwash (for dirty/brown cars) from level 3
        Blue (CNG)                     from level 6
        Green (BEV / Electric)         from level 9
     Only car types whose station is open will arrive. You steer the frontmost
     (highlighted) car with Up / Down into the lane whose station matches its
     fuel — or, for a dirty car, into the carwash.

       * When a car REACHES its station it joins that station's queue and you
         immediately take control of the next car.
       * The car at the front of a queue LOADS for 3 seconds, then drives off.
         You score +1 the moment a car finishes loading and leaves.
       * Sending a car to the WRONG station is a MISS: it pulls away and you
         lose a life. 0 lives = Game Over.

     Each level lasts 60 seconds. At the end a result screen appears; press
     Enter for the next level (faster cars, more of them). Lives and score
     carry across levels. Level 1 is gentle: one car on the road at a time.

   ARCHITECTURE (logic separated from drawing)
     CONFIG        - tunable constants & data tables
     state         - the single mutable game-state object (incl. phase)
     levelTuning() - derives car speed / spawn rate from the current level
     update()      - advances the simulation by dt seconds
     render()      - draws everything from current state (no game logic)
     loop()        - requestAnimationFrame driver

   Phases:  'playing' -> 'levelComplete' -> 'playing' ... | 'gameOver'
   Car states: 'driving' -> 'queued' -> 'loading' -> 'leaving' -> (removed)
                (a wrong delivery skips straight to 'leaving')
   =========================================================================== */

(function () {
  "use strict";

  /* =========================================================================
     COLORS  (single source of truth — see DESIGN.md)
     One committed palette: Škoda emerald carries the surface, electric green is
     the accent. Every neutral is tinted toward the emerald hue (no pure #fff or
     #000). Station/vehicle colours are a functional gameplay code and keep their
     hues; they just live here as tokens now. OKLCH equivalents are listed in
     DESIGN.md; hex is used for the widest canvas-2d compatibility.
     ========================================================================= */
  const COLORS = {
    // Brand greens
    electric:     "#78faae", // Škoda Electric Green — accents, headings, +1, focus
    emerald:      "#0e3a2f", // Škoda Emerald Green — canvas surface, panels
    emeraldLine:  "#1c5c49", // lighter emerald — unselected card borders
    emeraldDeep:  "#082019", // deepest emerald — page background (mirrors :root)

    // Tinted neutrals (all hued toward emerald, chroma kept low)
    textBright:   "#eef7f1", // near-white, emerald-tinted (replaces pure #fff)
    text:         "#e7ece9", // primary light text
    textMuted:    "#cdd6d1", // secondary text (leaderboard rows)
    textDim:      "#97a39c", // tertiary / dim hints and sub-labels
    surface:      "#1f2724", // dark surface A (lane fill, menu card, name box)
    surfaceAlt:   "#232b27", // dark surface B (alternating lane fill)
    surfaceBox:   "#283029", // station fallback box
    surfaceSel:   "#2f3a2a", // selected menu card (greenish)

    // Functional station / vehicle colours (gameplay code — hues unchanged)
    fuelPetrol:   "#d6453b", // red
    fuelDiesel:   "#454b54", // black / charcoal
    fuelCng:      "#3a78c2", // blue
    fuelElectric: "#4ba82e", // green
    fuelWash:     "#7a5230", // brown
    police:       "#1f2d5a", // dark police blue (sprite fallback)
    danger:       "#d6453b", // game over / miss text (shares the petrol hue)

    // Effects & overlays (emerald- or earth-tinted; no pure black/white)
    overlay:      "rgba(6,28,22,0.8)",      // dark emerald wash over the playfield
    hudBand:      "rgba(14,58,47,0.9)",     // translucent emerald HUD band
    hudLine:      "rgba(120,250,174,0.55)", // electric-green accent line under HUD
    stationBoxArt:"rgba(20,30,26,0.82)",    // station fallback box over painted art
    mud:          "rgba(166,124,72,0.92)",  // dirt on dirty cars
    outline:      "rgba(5,18,14,0.55)",     // text outline on the road (was black)
    outlineStrong:"rgba(5,18,14,0.72)",     // stronger text outline (was black)
    laneGuide:    "rgba(231,236,233,0.08)", // dashed lane-centre guide
    hairline:     "rgba(231,236,233,0.28)", // 1px swatch / element hairline
    hintFaint:    "rgba(231,236,233,0.32)", // dev hotkey hint
  };

  /* =========================================================================
     TYPE  (modular scale — see DESIGN.md)
     One family (the system Segoe UI stack). Hierarchy comes from size + weight,
     not a flat ramp: the scale steps by ~1.27 (13 / 17 / 22 / 28 / 36 / 46).
     font(role[, weight]) builds a canvas font string; pass a weight only to
     override the role's default (e.g. a bold variant of a regular-weight row).
     ========================================================================= */
  const FONT_STACK = "'Segoe UI', Tahoma, Arial, sans-serif";
  const TYPE = {
    display: { size: 46, weight: 700 }, // end screens (level complete, game over)
    h1:      { size: 36, weight: 700 }, // section titles (how-to, menu, board)
    lead:    { size: 28, weight: 700 }, // mode names, name-entry value
    body:    { size: 22, weight: 400 }, // primary body, prompts, HUD numbers
    label:   { size: 22, weight: 700 }, // labels, notices, emphasised lines
    caption: { size: 17, weight: 400 }, // secondary text, hints, blurbs
    small:   { size: 13, weight: 400 }, // smallest sub-labels and hotkey hints
  };
  function font(role, weight) {
    return (weight || role.weight) + " " + role.size + "px " + FONT_STACK;
  }

  /* =========================================================================
     CONFIG
     ========================================================================= */
  const CONFIG = {
    canvas: { width: 960, height: 600 },
    hudHeight: 70,

    // Per-lane-count background art (painterly scenery + asphalt). The road
    // grows with the number of open stations, so each lane count has its own
    // image. `lanes` lists the centre of each painted lane as a fraction of
    // canvas height (measured from the art by detecting its lane markings), so
    // cars and stations sit exactly on the painted lanes — the markings aren't
    // evenly spaced, so we can't just divide the road band. Lane counts without
    // an image fall back to evenly spaced procedural grey lanes.
    backgrounds: {
      2: { src: "pozadi_2.png", lanes: [0.718, 0.832] },
      3: { src: "pozadi_3.png", lanes: [0.611, 0.741, 0.871] },
      4: { src: "pozadi_4.png", lanes: [0.553, 0.631, 0.724, 0.830] },
      5: { src: "pozadi_5.png", lanes: [0.407, 0.496, 0.599, 0.708, 0.819] },
    },

    // Each station has its own painted pump sprite (transparent PNG, measured
    // for its opaque bbox at load like the cars). The colour is kept as the
    // gameplay accent / sprite-less fallback border.
    fuelTypes: {
      ELECTRIC: { label: "Electric", color: COLORS.fuelElectric, standLabel: "Green", sprite: "stand_electric.png" },
      PETROL:   { label: "Petrol",   color: COLORS.fuelPetrol,   standLabel: "Red",   sprite: "stand_petrol.png"   },
      DIESEL:   { label: "Diesel",   color: COLORS.fuelDiesel,   standLabel: "Black", sprite: "stand_diesel.png"    },
      CNG:      { label: "CNG",      color: COLORS.fuelCng,      standLabel: "Blue",  sprite: "stand_cng.png"       },
      // The carwash is modelled as just another "fuel": dirty cars (a normal
      // colour wearing brown spots) must reach the wash bay.
      WASH:     { label: "Carwash",  color: COLORS.fuelWash,     standLabel: "Wash",  sprite: "stand_carwash.png"  },
    },

    // Stations in top-to-bottom display order, each with the level at which it
    // unlocks. New stations appear at the bottom so existing lanes don't move.
    // Listed in unlock order so each newly opened station appears at the
    // bottom and the existing lanes keep their positions.
    stations: [
      { fuel: "PETROL",   unlockLevel: 1 },
      { fuel: "DIESEL",   unlockLevel: 1 },
      { fuel: "WASH",     unlockLevel: 3 },
      { fuel: "CNG",      unlockLevel: 6 },
      { fuel: "ELECTRIC", unlockLevel: 9 },
    ],

    // Police cars: a finale twist. They have no fuel and are rushing to a case,
    // so they must RUSH STRAIGHT THROUGH a station — no loading. Steer one into
    // any FREE station of any kind except the carwash and it passes through for
    // +1. If that station is busy (a car queued/loading) the police car is
    // forced to stop in the queue, or you send it to the wash: that's a miss.
    police: {
      fromLevel: 10,    // police cars start appearing at this level
      chance: 1 / 6,    // 1 in 6 spawns (one extra type beside the five fuels)
      color: COLORS.police, // dark police blue (fallback before the sprite loads)
      sprite: "policecar.png",
    },

    // Once the carwash is open, this share of (non-police) cars are dirty; the
    // rest are split evenly between the other open fuels (so e.g. petrol/diesel
    // stay ~50:50). Keeps dirty cars rare instead of scaling with station count.
    dirtyChance: 0.1,

    carModels: {
      // Real Škoda models, each tied to the fuel its station serves. A dirty
      // car is one of THESE models that just happens to be muddy and needs the
      // wash, so there's no separate "dirty" model — see randomDirtyModelName().
      ENYAQ:   { name: "Enyaq",   fuel: "ELECTRIC", sprite: "enyaq.png"   },
      FABIA:   { name: "Fabia",   fuel: "PETROL",   sprite: "fabia.png"   },
      KODIAQ:  { name: "Kodiaq",  fuel: "DIESEL",   sprite: "kodiaq.png"  },
      OCTAVIA: { name: "Octavia", fuel: "CNG",      sprite: "octavia.png" },
    },

    car: {
      width: 84,
      height: 40,
      laneSwitchSpeed: 520, // vertical px/sec when hopping lanes
      dockSpeed: 200,       // horizontal px/sec while shuffling in a queue
      queueGap: 14,         // gap between queued cars
    },

    station: { width: 124 },

    loadSeconds: 3,            // time a car spends loading at the bay
    levelDurationSeconds: 60,  // length of each level

    // Two selectable difficulty modes (chosen on the start menu).
    //   kid    — relaxed: 5 lives, and one life refills after each finished
    //            level (capped at the 5-life maximum).
    //   racing — for adults: 3 lives, no refills.
    // speedByLevel lists the car speed (px/s) for each level, index = level-1,
    // so it's easy to hand-tune any single level. Both modes only speed up on
    // "quiet" levels and HOLD speed whenever something new arrives, so the
    // player isn't hit by faster traffic and a new element at once: holds at
    // L3 (carwash), L6 (CNG), L9 (electric) and L10 (police). Kid holds 130
    // across L1–3 (L2 only adds more simultaneous traffic, no speed-up) then
    // steps to 220; racing starts faster and steps +30 (150 → 300).
    modeOrder: ["kid", "racing"],
    modes: {
      kid: {
        label: "Kid mode",
        blurb: "Relaxed · 5 lives · +1 life after every level",
        lives: 5,
        refillPerLevel: true,
        //              L1   L2   L3*  L4   L5   L6*  L7   L8   L9*  L10*  (* = hold)
        speedByLevel: [130, 130, 130, 160, 180, 180, 200, 220, 220, 220],
      },
      racing: {
        label: "Racing mode",
        blurb: "For grown-ups · 3 lives · no refills",
        lives: 3,
        refillPerLevel: false,
        //              L1   L2   L3*  L4   L5   L6*  L7   L8   L9*  L10*  (* = hold)
        speedByLevel: [150, 180, 180, 210, 240, 240, 270, 300, 300, 300],
      },
    },

    maxLevel: 10,        // final level; finishing it completes the run
    maxNameLength: 12,   // leaderboard name length cap

    // Selectable UI languages (cycled with ← / → on the start menu). English
    // labels live in CONFIG above; Czech/German come from TRANSLATIONS below.
    languages: ["en", "cs", "de"],

    // Dev/testing aids. Set to false for a release build to disable the
    // level-skip hotkeys and the on-screen hint.
    debug: true,

    // Difficulty. Level 1 is event-driven (one driving car at a time); from
    // level 2 onward cars also arrive on a shrinking timer.
    level1SpawnGap: 0.6,       // pause before the next car on level 1
    perLevel: {
      spawnIntervalBase: 2.6,  // level 2 interval
      spawnIntervalStep: 0.25, // shrink per level beyond 2
      spawnIntervalMin: 0.9,
    },
  };

  /* =========================================================================
     CANVAS
     ========================================================================= */
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  /* =========================================================================
     STATE
     ========================================================================= */
  const state = {
    // 'menu' | 'playing' | 'levelComplete' | 'gameOver' | 'enterName' | 'leaderboard'
    phase: "menu",
    lang: "en",       // UI language ('en' | 'cs' | 'de'); set on boot
    mode: "kid",      // selected difficulty mode (chosen on the menu)
    menuIndex: 0,     // highlighted mode on the start menu
    nameInput: "",    // current text in the name-entry field
    lastResult: null, // { mode, score, level, won } captured when a run ends
    lastBoard: null,  // leaderboard list shown after saving a score
    lastSavedName: "",// name just saved (highlighted on the leaderboard)
    laneFuels: [],    // active stations top-to-bottom; set per level
    cars: [],
    nextId: 1,
    spawnTimer: 0,
    level: 1,
    score: 0,
    lives: 0,
    timeLeft: CONFIG.levelDurationSeconds,
    deliveredThisLevel: 0,
    missedThisLevel: 0,
    flash: null, // { x, y, color, text, life }
  };

  // The config block for the currently selected mode, and its life cap.
  function modeConfig() {
    return CONFIG.modes[state.mode];
  }
  function maxLives() {
    return modeConfig().lives;
  }

  /* =========================================================================
     I18N  (English source lives in CONFIG / inline; cs + de live here)
     ========================================================================= */
  const LANG_NAMES = { en: "English", cs: "Čeština", de: "Deutsch" };

  // Only non-English strings are listed; t() falls back to the English value.
  const TRANSLATIONS = {
    en: {
      title: "Pit Stop",
      instructions:
        "Use ↑ / ↓ to steer the highlighted car into its matching station. Wrong station costs a life!",
      score: "Score", level: "Level", lives: "Lives",
      chooseMode: "Choose your mode",
      menuHint: "↑ / ↓ to choose · Enter to continue",
      langHint: "← / → language",
      topScores: "Top scores — {mode}",
      noScoresMenu: "No scores yet — be the first!",
      howToPlay: "How to play",
      brief1: "Cars drive in from the left. Steer the highlighted car",
      brief2: "(marked with green ▲▼) with ↑ / ↓ into its matching station.",
      brief3: "It loads, then drives off for +1. Wrong station costs a life.",
      matchThese: "Level 1 — match these:",
      pressEnterStart: "Press Enter to start",
      levelComplete: "LEVEL {n} COMPLETE",
      allComplete: "ALL LEVELS COMPLETE!",
      deliveredThis: "Delivered this level: {n}",
      missedThis: "Missed this level: {n}",
      totalAndLives: "Total score: {s}    ·    Lives: {l}",
      pressAddScore: "Press Enter to add your score",
      newStation: "New station unlocked: {names}!",
      policeNotice: "Police cars! Wave them through any free station — not the wash.",
      moreCars: "More cars at once — stay sharp!",
      fasterCars: "Faster cars ahead — speed up!",
      plusLife: "+1 life for finishing the level!",
      pressEnterLevel: "Press Enter for Level {n}",
      gameOver: "GAME OVER",
      finalScore: "Final score: {s}   ·   reached Level {n}",
      youFinished: "YOU FINISHED!",
      scoreMode: "Score {s}  ·  {mode}",
      enterNamePrompt: "Enter your name for the leaderboard:",
      typeNameSave: "Type your name, then press Enter to save",
      leaderboard: "Leaderboard — {mode}",
      noScores: "No scores yet.",
      lvShort: "Lv {n}",
      pressEnterMenu: "Press Enter for the menu",
      miss: "MISS!", policeCar: "Police", dirtyCar: "Dirty",
    },
    cs: {
      title: "netankovat",
      instructions:
        "Šipkami ↑ / ↓ naveď zvýrazněné auto do správné stanice. Špatná stanice stojí život!",
      score: "Skóre", level: "Level", lives: "Životy",
      chooseMode: "Vyber si režim",
      menuHint: "↑ / ↓ výběr · Enter pokračovat",
      langHint: "← / → jazyk",
      topScores: "Nejlepší skóre — {mode}",
      noScoresMenu: "Zatím žádné skóre — buď první!",
      howToPlay: "Jak hrát",
      brief1: "Auta přijíždějí zleva. Naváděj zvýrazněné auto",
      brief2: "(značené zelenými ▲▼) šipkami ↑ / ↓ do správné stanice.",
      brief3: "Naloží a odjede za +1. Špatná stanice stojí život.",
      matchThese: "Level 1 — přiřaď:",
      pressEnterStart: "Stiskni Enter pro start",
      levelComplete: "LEVEL {n} HOTOVO",
      allComplete: "VŠECHNY LEVELY HOTOVO!",
      deliveredThis: "Odbaveno v tomto levelu: {n}",
      missedThis: "Chyby v tomto levelu: {n}",
      totalAndLives: "Celkové skóre: {s}    ·    Životy: {l}",
      pressAddScore: "Stiskni Enter pro zápis skóre",
      newStation: "Nová stanice: {names}!",
      policeNotice: "Policejní auta! Pusť je volnou stanicí — ne do myčky.",
      moreCars: "Víc aut najednou — dávej pozor!",
      fasterCars: "Rychlejší auta — zrychli!",
      plusLife: "+1 život za dokončení levelu!",
      pressEnterLevel: "Stiskni Enter pro Level {n}",
      gameOver: "KONEC HRY",
      finalScore: "Konečné skóre: {s}   ·   Level {n}",
      youFinished: "DOKONČENO!",
      scoreMode: "Skóre {s}  ·  {mode}",
      enterNamePrompt: "Zadej jméno do žebříčku:",
      typeNameSave: "Napiš jméno a stiskni Enter pro uložení",
      leaderboard: "Žebříček — {mode}",
      noScores: "Zatím žádné skóre.",
      lvShort: "Lvl {n}",
      pressEnterMenu: "Stiskni Enter pro menu",
      miss: "MIMO!", policeCar: "Policie", dirtyCar: "Špinavé",
      // Fuel + station-colour labels
      fuel_PETROL: "Benzín", fuel_DIESEL: "Diesel", fuel_CNG: "CNG",
      fuel_ELECTRIC: "Elektřina", fuel_WASH: "Myčka",
      stand_PETROL: "Červená", stand_DIESEL: "Černá", stand_CNG: "Modrá",
      stand_ELECTRIC: "Zelená", stand_WASH: "Mytí",
      mode_kid: "Dětský režim", mode_racing: "Závodní režim",
      blurb_kid: "V pohodě · 5 životů · +1 život po každém levelu",
      blurb_racing: "Pro dospělé · 3 životy · bez doplňování",
    },
    de: {
      title: "Boxenstopp",
      instructions:
        "Mit ↑ / ↓ das markierte Auto in die passende Station lenken. Falsche Station kostet ein Leben!",
      score: "Punkte", level: "Level", lives: "Leben",
      chooseMode: "Wähle deinen Modus",
      menuHint: "↑ / ↓ wählen · Enter weiter",
      langHint: "← / → Sprache",
      topScores: "Bestenliste — {mode}",
      noScoresMenu: "Noch keine Punkte — sei der Erste!",
      howToPlay: "So wird gespielt",
      brief1: "Autos kommen von links. Lenke das markierte Auto",
      brief2: "(mit grünen ▲▼ markiert) mit ↑ / ↓ in die passende Station.",
      brief3: "Es lädt, fährt weg für +1. Falsche Station kostet ein Leben.",
      matchThese: "Level 1 — ordne zu:",
      pressEnterStart: "Enter drücken zum Starten",
      levelComplete: "LEVEL {n} GESCHAFFT",
      allComplete: "ALLE LEVEL GESCHAFFT!",
      deliveredThis: "In diesem Level geschafft: {n}",
      missedThis: "Fehler in diesem Level: {n}",
      totalAndLives: "Gesamtpunkte: {s}    ·    Leben: {l}",
      pressAddScore: "Enter drücken, um dein Ergebnis einzutragen",
      newStation: "Neue Station: {names}!",
      policeNotice: "Polizeiautos! Lass sie durch eine freie Station — nicht die Waschanlage.",
      moreCars: "Mehr Autos gleichzeitig — pass auf!",
      fasterCars: "Schnellere Autos — beeil dich!",
      plusLife: "+1 Leben fürs Schaffen des Levels!",
      pressEnterLevel: "Enter drücken für Level {n}",
      gameOver: "SPIEL VORBEI",
      finalScore: "Endpunkte: {s}   ·   Level {n}",
      youFinished: "GESCHAFFT!",
      scoreMode: "Punkte {s}  ·  {mode}",
      enterNamePrompt: "Gib deinen Namen für die Bestenliste ein:",
      typeNameSave: "Namen eingeben, dann Enter zum Speichern",
      leaderboard: "Bestenliste — {mode}",
      noScores: "Noch keine Punkte.",
      lvShort: "Lvl {n}",
      pressEnterMenu: "Enter drücken für das Menü",
      miss: "DANEBEN!", policeCar: "Polizei", dirtyCar: "Schmutzig",
      fuel_PETROL: "Benzin", fuel_DIESEL: "Diesel", fuel_CNG: "CNG",
      fuel_ELECTRIC: "Elektro", fuel_WASH: "Waschanlage",
      stand_PETROL: "Rot", stand_DIESEL: "Schwarz", stand_CNG: "Blau",
      stand_ELECTRIC: "Grün", stand_WASH: "Wäsche",
      mode_kid: "Kindermodus", mode_racing: "Rennmodus",
      blurb_kid: "Entspannt · 5 Leben · +1 Leben pro Level",
      blurb_racing: "Für Erwachsene · 3 Leben · kein Auffüllen",
    },
  };

  // Translate a key with optional {placeholder} substitution; falls back to the
  // English string, then to the raw key.
  function t(key, vars) {
    const table = TRANSLATIONS[state.lang] || TRANSLATIONS.en;
    let s = key in table ? table[key] : key in TRANSLATIONS.en ? TRANSLATIONS.en[key] : key;
    if (vars) for (const k in vars) s = s.split("{" + k + "}").join(vars[k]);
    return s;
  }

  // Display labels that have an English source in CONFIG and cs/de overrides here.
  function fuelLabel(fuel) {
    const o = TRANSLATIONS[state.lang];
    return (o && o["fuel_" + fuel]) || CONFIG.fuelTypes[fuel].label;
  }
  function standLabel(fuel) {
    const o = TRANSLATIONS[state.lang];
    return (o && o["stand_" + fuel]) || CONFIG.fuelTypes[fuel].standLabel;
  }
  function modeLabel(mode) {
    const o = TRANSLATIONS[state.lang];
    return (o && o["mode_" + mode]) || CONFIG.modes[mode].label;
  }
  function modeBlurb(mode) {
    const o = TRANSLATIONS[state.lang];
    return (o && o["blurb_" + mode]) || CONFIG.modes[mode].blurb;
  }

  // Persisted language choice.
  function loadLang() {
    try {
      const saved = localStorage.getItem("skoda_lang");
      if (saved && CONFIG.languages.includes(saved)) return saved;
    } catch (e) { /* ignore */ }
    const nav = (navigator.language || "en").slice(0, 2);
    return CONFIG.languages.includes(nav) ? nav : "en";
  }
  function saveLang(lang) {
    try { localStorage.setItem("skoda_lang", lang); } catch (e) { /* ignore */ }
  }

  // Push the current language into the HTML header (title + instructions).
  function applyDomLanguage() {
    document.title = "Škoda " + t("title");
    const h1 = document.getElementById("game-title");
    const instr = document.getElementById("instructions");
    if (h1) h1.textContent = "Škoda " + t("title");
    if (instr) instr.textContent = t("instructions");
    document.documentElement.lang = state.lang;
  }

  // Step the language by +1 / -1 (wraps), persist it, and refresh the header.
  function cycleLanguage(dir) {
    const langs = CONFIG.languages;
    const i = (langs.indexOf(state.lang) + dir + langs.length) % langs.length;
    state.lang = langs[i];
    saveLang(state.lang);
    applyDomLanguage();
  }

  /* =========================================================================
     STATION UNLOCKS
     ========================================================================= */
  // Lanes (top-to-bottom) for the given level: every open fuel, one per kind.
  function activeFuels(level) {
    return CONFIG.stations
      .filter((s) => level >= s.unlockLevel)
      .map((s) => s.fuel);
  }

  // Fuels whose station unlocks exactly at the given level (for announcements).
  function fuelsUnlockedAt(level) {
    return CONFIG.stations
      .filter((s) => s.unlockLevel === level)
      .map((s) => s.fuel);
  }

  // The car model that needs a given fuel (e.g. PETROL -> "Fabia").
  function modelForFuel(fuel) {
    const key = Object.keys(CONFIG.carModels).find(
      (k) => CONFIG.carModels[k].fuel === fuel
    );
    return key ? CONFIG.carModels[key].name : "";
  }

  // A dirty car is a random real model that's muddy and must visit the wash.
  // Returns the model so the car can keep that model's normal paint colour
  // (its base fuel) under the mud — the wash is its destination regardless.
  // Only models whose fuel station is open this level may appear, so the player
  // never sees a paint colour (e.g. green Enyaq) whose station isn't in play yet.
  function randomDirtyModel() {
    const openFuels = state.laneFuels.filter((f) => f !== "WASH");
    const models = Object.values(CONFIG.carModels).filter((m) =>
      openFuels.includes(m.fuel)
    );
    return models[Math.floor(Math.random() * models.length)];
  }

  /* =========================================================================
     GEOMETRY HELPERS
     ========================================================================= */
  function laneCount() {
    return state.laneFuels.length;
  }

  // Background art cache, keyed by lane count. Loaded once at boot; until an
  // image is ready (or if there's no art for this lane count) the playfield
  // falls back to procedural grey lanes.
  const bgCache = {};
  function preloadBackgrounds() {
    for (const k in CONFIG.backgrounds) {
      const img = new Image();
      const rec = { img: img, ready: false };
      img.onload = () => { rec.ready = true; };
      img.src = CONFIG.backgrounds[k].src;
      bgCache[k] = rec;
    }
  }
  // The loaded background record for the current lane count, or null.
  function currentBg() {
    const rec = bgCache[laneCount()];
    return rec && rec.ready ? rec : null;
  }

  // Car sprites, keyed by display name ("Fabia", …, "Police"). On load we
  // measure each sprite's opaque bounding box so we can crop away the
  // transparent padding and scale every car to a consistent on-screen size.
  const carSprites = {};
  function preloadCarSprites() {
    const sources = { Police: CONFIG.police.sprite };
    for (const k in CONFIG.carModels) sources[CONFIG.carModels[k].name] = CONFIG.carModels[k].sprite;
    for (const name in sources) {
      const img = new Image();
      const rec = { img: img, ready: false };
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cx = c.getContext("2d");
        cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, c.width, c.height).data;
        let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++)
            if (d[(y * c.width + x) * 4 + 3] > 30) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        rec.sx = minX; rec.sy = minY;
        rec.sw = maxX - minX + 1; rec.sh = maxY - minY + 1;
        rec.ready = true;
      };
      img.src = sources[name];
      carSprites[name] = rec;
    }
  }
  function carSprite(car) {
    const rec = carSprites[car.isPolice ? "Police" : car.model];
    return rec && rec.ready ? rec : null;
  }

  // Station pump sprites, keyed by fuel key. Like the cars, each sprite's
  // opaque bounding box is measured at load so the transparent padding is
  // cropped and every pump scales to a consistent on-screen size.
  const stationSprites = {};
  function preloadStationSprites() {
    for (const key in CONFIG.fuelTypes) {
      const src = CONFIG.fuelTypes[key].sprite;
      if (!src) continue;
      const img = new Image();
      const rec = { img: img, ready: false };
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const cx = c.getContext("2d");
        cx.drawImage(img, 0, 0);
        const d = cx.getImageData(0, 0, c.width, c.height).data;
        let minX = c.width, minY = c.height, maxX = 0, maxY = 0;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++)
            if (d[(y * c.width + x) * 4 + 3] > 30) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        rec.sx = minX; rec.sy = minY;
        rec.sw = maxX - minX + 1; rec.sh = maxY - minY + 1;
        rec.ready = true;
      };
      img.src = src;
      stationSprites[key] = rec;
    }
  }
  function stationSprite(fuelKey) {
    const rec = stationSprites[fuelKey];
    return rec && rec.ready ? rec : null;
  }

  // Reusable offscreen canvas for masking mud onto a dirty car's sprite.
  const mudCanvas = document.createElement("canvas");
  const mudCtx = mudCanvas.getContext("2d");

  // Centre Y of a lane. With background art each lane sits on its painted lane
  // (explicit centres in CONFIG); otherwise lanes are spread evenly across the
  // playfield below the HUD.
  function laneCenterY(laneIndex) {
    const cfg = CONFIG.backgrounds[laneCount()];
    if (cfg && currentBg()) return cfg.lanes[laneIndex] * CONFIG.canvas.height;
    const top = CONFIG.hudHeight;
    const laneHeight = (CONFIG.canvas.height - top) / laneCount();
    return top + laneHeight * laneIndex + laneHeight / 2;
  }

  // Approximate lane height for drawing lane fills and station boxes. With art
  // it's the average spacing between painted lane centres; otherwise the even
  // share of the playfield.
  function laneThickness() {
    const cfg = CONFIG.backgrounds[laneCount()];
    if (cfg && currentBg() && cfg.lanes.length > 1) {
      const L = cfg.lanes;
      return ((L[L.length - 1] - L[0]) / (L.length - 1)) * CONFIG.canvas.height;
    }
    return (CONFIG.canvas.height - CONFIG.hudHeight) / laneCount();
  }

  // X where the stations begin — crossing this resolves a driving car.
  function goalLineX() {
    return CONFIG.canvas.width - CONFIG.station.width;
  }

  // X of the loading bay (where the front-of-queue car sits inside a station).
  function bayX() {
    return goalLineX() + (CONFIG.station.width - CONFIG.car.width) / 2;
  }

  // X for queue slot `i` (0 = bay, higher = further back/left).
  function queueSlotX(i) {
    return bayX() - i * (CONFIG.car.width + CONFIG.car.queueGap);
  }

  /* =========================================================================
     LEVEL TUNING
     ========================================================================= */
  // Car speed (px/s) for a level in the current mode, read from its per-level
  // table; levels past the end of the table reuse the last entry.
  function levelSpeed(level) {
    const speeds = modeConfig().speedByLevel;
    const idx = Math.min(Math.max(level, 1), speeds.length) - 1;
    return speeds[idx];
  }

  function levelTuning() {
    const carSpeed = levelSpeed(state.level);
    const spawnInterval = Math.max(
      CONFIG.perLevel.spawnIntervalMin,
      CONFIG.perLevel.spawnIntervalBase -
        Math.max(0, state.level - 2) * CONFIG.perLevel.spawnIntervalStep
    );
    return { carSpeed, spawnInterval };
  }

  /* =========================================================================
     CARS
     ========================================================================= */
  // Pick the fuel for a regular (non-police) car: a fixed share are dirty once
  // the wash is open, and the remainder split evenly across the other open
  // fuels (so petrol/diesel sit at ~50:50 before CNG/electric appear).
  function pickFuel() {
    const open = state.laneFuels;
    if (open.includes("WASH") && Math.random() < CONFIG.dirtyChance) return "WASH";
    const others = open.filter((f) => f !== "WASH");
    return others[Math.floor(Math.random() * others.length)];
  }

  function spawnCar() {
    // From the police level on, a share of arrivals are police cars: no fuel,
    // park at any free non-wash station. Otherwise pick a deliverable fuel
    // (its station is open) and the matching model.
    let model, fuel, isPolice, baseFuel = null;
    if (state.level >= CONFIG.police.fromLevel && Math.random() < CONFIG.police.chance) {
      isPolice = true;
      model = "Police";
      fuel = "POLICE"; // sentinel; never matches a lane fuel
    } else {
      isPolice = false;
      fuel = pickFuel();
      if (fuel === "WASH") {
        // A dirty car keeps a real model and that model's normal paint colour
        // (baseFuel) under the mud, but its destination is the wash.
        const dm = randomDirtyModel();
        model = dm.name;
        baseFuel = dm.fuel;
      } else {
        model = modelForFuel(fuel);
      }
    }

    // Enter in a random active lane (player still has to sort most of them).
    const lane = Math.floor(Math.random() * laneCount());

    state.cars.push({
      id: state.nextId++,
      model: model,
      fuel: fuel,
      baseFuel: baseFuel, // normal paint colour for a dirty car (else null)
      isPolice: isPolice,
      lane,
      x: -CONFIG.car.width,
      y: laneCenterY(lane) - CONFIG.car.height / 2,
      width: CONFIG.car.width,
      height: CONFIG.car.height,
      status: "driving", // driving | queued | loading | leaving
      loadTimer: 0,
      result: null,      // 'correct' | 'wrong'
    });
  }

  function drivingCars() {
    return state.cars.filter((c) => c.status === "driving");
  }

  // The frontmost driving car (largest x) — the one the player steers.
  function activeCar() {
    let best = null;
    for (const c of state.cars) {
      if (c.status !== "driving") continue;
      if (!best || c.x > best.x) best = c;
    }
    return best;
  }

  // Don't spawn on top of a car still entering from the left edge.
  function entranceClear() {
    const minGap = CONFIG.car.width + 30;
    return !state.cars.some((c) => c.status === "driving" && c.x < minGap);
  }

  /* =========================================================================
     INPUT
     ========================================================================= */
  function handleKeyDown(evt) {
    switch (state.phase) {
      case "menu":          handleMenuKey(evt); break;
      case "briefing":      handleBriefingKey(evt); break;
      case "playing":       handlePlayKey(evt); break;
      case "levelComplete": handleLevelCompleteKey(evt); break;
      case "gameOver":      handleGameOverKey(evt); break;
      case "enterName":     handleNameKey(evt); break;
      case "leaderboard":   handleLeaderboardKey(evt); break;
    }
  }
  window.addEventListener("keydown", handleKeyDown);

  // Start menu: pick a difficulty mode.
  function handleMenuKey(evt) {
    const n = CONFIG.modeOrder.length;
    if (evt.key === "ArrowUp") {
      evt.preventDefault();
      state.menuIndex = (state.menuIndex - 1 + n) % n;
    } else if (evt.key === "ArrowDown") {
      evt.preventDefault();
      state.menuIndex = (state.menuIndex + 1) % n;
    } else if (evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
      evt.preventDefault();
      cycleLanguage(evt.key === "ArrowRight" ? 1 : -1);
    } else if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      state.mode = CONFIG.modeOrder[state.menuIndex];
      state.phase = "briefing"; // show the level-1 how-to-play box first
    }
  }

  // Level-1 briefing: Enter starts the game.
  function handleBriefingKey(evt) {
    if (evt.key === "Enter" || evt.key === " ") startGame();
  }

  // Playing: steer the active car (plus dev hotkeys).
  function handlePlayKey(evt) {
    if (CONFIG.debug && handleDebugKey(evt)) return;
    const car = activeCar();
    if (!car) return;
    if (evt.key === "ArrowUp") {
      evt.preventDefault();
      car.lane = Math.max(0, car.lane - 1);
    } else if (evt.key === "ArrowDown") {
      evt.preventDefault();
      car.lane = Math.min(laneCount() - 1, car.lane + 1);
    }
  }

  function handleLevelCompleteKey(evt) {
    if (CONFIG.debug && handleDebugKey(evt)) return;
    if (evt.key === "Enter" || evt.key === " ") advanceFromLevelComplete();
  }

  function handleGameOverKey(evt) {
    if (CONFIG.debug && handleDebugKey(evt)) return;
    if (evt.key === "Enter" || evt.key === " " || evt.key === "r" || evt.key === "R") {
      beginNameEntry(false);
    }
  }

  // Name entry: type a name for the leaderboard.
  function handleNameKey(evt) {
    if (evt.key === "Enter") {
      evt.preventDefault();
      submitName();
    } else if (evt.key === "Backspace") {
      evt.preventDefault();
      state.nameInput = state.nameInput.slice(0, -1);
    } else if (evt.key.length === 1 && /[A-Za-z0-9 ]/.test(evt.key)) {
      if (state.nameInput.length < CONFIG.maxNameLength) state.nameInput += evt.key;
    }
  }

  function handleLeaderboardKey(evt) {
    if (evt.key === "Enter" || evt.key === " ") state.phase = "menu";
  }

  // Returns true if the key was a recognised dev shortcut (and was handled).
  function handleDebugKey(evt) {
    const maxLevel = CONFIG.maxLevel;

    // Digit keys: 1-9 -> that level, 0 -> level 10.
    if (/^[0-9]$/.test(evt.key)) {
      jumpToLevel(evt.key === "0" ? 10 : Number(evt.key));
      return true;
    }
    if (evt.key === "n" || evt.key === "N") {
      jumpToLevel(Math.min(maxLevel, state.level + 1));
      return true;
    }
    if (evt.key === "b" || evt.key === "B") {
      jumpToLevel(Math.max(1, state.level - 1));
      return true;
    }
    // End the level now (E) to reach the result screen without waiting out the
    // timer. Unlike N (which jumps straight in), this shows the announcements.
    if (evt.key === "e" || evt.key === "E") {
      if (state.phase === "playing") state.timeLeft = 0;
      return true;
    }
    return false;
  }

  // Restart a level for testing. Keeps score; refills lives if you'd died so
  // the game is always immediately playable after a jump.
  function jumpToLevel(level) {
    if (state.lives <= 0) state.lives = maxLives();
    startLevel(level);
  }

  /* =========================================================================
     UPDATE
     ========================================================================= */
  function update(dt) {
    tickFlash(dt);
    if (state.phase !== "playing") return;

    const tuning = levelTuning();

    updateSpawning(dt, tuning);
    moveCars(dt, tuning);
    assignQueueSlots();
    state.cars = state.cars.filter((c) => !c._remove);

    // Level timer.
    state.timeLeft -= dt;
    if (state.timeLeft <= 0 && state.phase === "playing") {
      state.timeLeft = 0;
      state.phase = "levelComplete";
    }
  }

  function updateSpawning(dt, tuning) {
    if (state.level === 1) {
      // One car on the road at a time: wait until the road is clear, pause,
      // then send the next car in.
      if (drivingCars().length === 0) {
        state.spawnTimer += dt;
        if (state.spawnTimer >= CONFIG.level1SpawnGap) {
          state.spawnTimer = 0;
          spawnCar();
        }
      }
    } else {
      state.spawnTimer += dt;
      if (state.spawnTimer >= tuning.spawnInterval && entranceClear()) {
        state.spawnTimer = 0;
        spawnCar();
      }
    }
  }

  function moveCars(dt, tuning) {
    for (const car of state.cars) {
      // Vertical lane tween (matters while driving; harmless otherwise).
      const targetY = laneCenterY(car.lane) - car.height / 2;
      const dy = targetY - car.y;
      const stepY = CONFIG.car.laneSwitchSpeed * dt;
      car.y += Math.abs(dy) <= stepY ? dy : Math.sign(dy) * stepY;

      switch (car.status) {
        case "driving":
          car.x += tuning.carSpeed * dt;
          if (car.x + car.width >= goalLineX()) arriveAtStation(car);
          break;

        case "queued":
          // Shuffle horizontally toward the assigned queue slot.
          stepTowardX(car, car._slotX, CONFIG.car.dockSpeed * dt);
          break;

        case "loading":
          stepTowardX(car, bayX(), CONFIG.car.dockSpeed * dt);
          car.loadTimer -= dt;
          if (car.loadTimer <= 0) {
            // Finished loading: score the point and pull away.
            car.status = "leaving";
            scoreDelivery(car);
          }
          break;

        case "leaving":
          car.x += (tuning.carSpeed + 90) * dt;
          if (car.x > CONFIG.canvas.width + car.width) car._remove = true;
          break;
      }
    }
  }

  function stepTowardX(car, targetX, step) {
    const dx = targetX - car.x;
    car.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
  }

  // True if a lane's station has nobody queued or loading at it right now.
  function stationFree(lane) {
    return !state.cars.some(
      (c) => c.lane === lane && (c.status === "queued" || c.status === "loading")
    );
  }

  // A driving car has reached the station row.
  //   normal car: right fuel -> join the queue; wrong fuel -> miss.
  //   police car: rushing through, so it never queues. A FREE non-wash station
  //     lets it pass straight through for +1; a busy station (it would have to
  //     stop in the queue) or the carwash is a miss.
  function arriveAtStation(car) {
    if (car.isPolice) {
      const canPass = state.laneFuels[car.lane] !== "WASH" && stationFree(car.lane);
      if (canPass) {
        car.result = "correct";
        car.status = "leaving"; // straight out the far side, no loading
        scoreDelivery(car);
      } else {
        missCar(car);
      }
      return;
    }

    if (state.laneFuels[car.lane] === car.fuel) {
      car.result = "correct";
      car.status = "queued"; // slot + loading handled in assignQueueSlots()
    } else {
      missCar(car);
    }
  }

  // Award a point and the floating "+1" (police pass-through, or a finished
  // loading car).
  function scoreDelivery(car) {
    state.score += 1;
    state.deliveredThisLevel += 1;
    addFlash(car, COLORS.electric, "+1");
  }

  // Wrong delivery / blocked police: lose a life, flash, pull away, check end.
  function missCar(car) {
    car.result = "wrong";
    car.status = "leaving";
    state.lives -= 1;
    state.missedThisLevel += 1;
    addFlash(car, COLORS.danger, t("miss"));
    if (state.lives <= 0) {
      state.lives = 0;
      state.phase = "gameOver";
    }
  }

  // Recompute every station queue each frame: order docked cars front-to-back,
  // park them in slots, and start the front car loading once it reaches the bay.
  function assignQueueSlots() {
    state.laneFuels.forEach((_, lane) => {
      const docked = state.cars
        .filter(
          (c) => c.lane === lane && (c.status === "queued" || c.status === "loading")
        )
        .sort((a, b) => b.x - a.x); // frontmost (largest x) first

      docked.forEach((car, i) => {
        car._slotX = queueSlotX(i);
        if (i === 0 && car.status === "queued" && Math.abs(car.x - bayX()) < 2) {
          car.status = "loading";
          car.loadTimer = CONFIG.loadSeconds;
        }
      });
    });
  }

  /* =========================================================================
     FLASH (floating feedback text)
     ========================================================================= */
  function addFlash(car, color, text) {
    state.flash = { x: car.x + car.width / 2, y: car.y, color, text, life: 0.9 };
  }
  function tickFlash(dt) {
    if (!state.flash) return;
    state.flash.life -= dt;
    state.flash.y -= 30 * dt;
    if (state.flash.life <= 0) state.flash = null;
  }

  /* =========================================================================
     RENDER
     ========================================================================= */
  function render() {
    const { width, height } = CONFIG.canvas;
    ctx.clearRect(0, 0, width, height);

    // Non-gameplay screens own the whole canvas.
    if (state.phase === "menu") return drawMenu();
    if (state.phase === "briefing") return drawBackdrop(), drawBriefing();
    if (state.phase === "enterName") return drawBackdrop(), drawEnterName();
    if (state.phase === "leaderboard") return drawBackdrop(), drawLeaderboard();

    // Gameplay (and the overlays that sit on top of it).
    drawLanes();
    state.cars.forEach(drawCar);
    drawFlash();
    drawHud();

    if (state.phase === "levelComplete") drawLevelComplete();
    if (state.phase === "gameOver") drawGameOver();
    if (CONFIG.debug) drawDebugHint();
  }

  function drawBackdrop() {
    const { width, height } = CONFIG.canvas;
    ctx.fillStyle = COLORS.emerald; // Škoda emerald green
    ctx.fillRect(0, 0, width, height);
  }

  function drawDebugHint() {
    ctx.fillStyle = COLORS.hintFaint;
    ctx.font = font(TYPE.small);
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      "DEV: 1-9/0 jump to level · N next · B back · E end level",
      12,
      CONFIG.canvas.height - 8
    );
  }

  function drawLanes() {
    const { width } = CONFIG.canvas;
    const goal = goalLineX();
    const laneHeight = laneThickness();
    const bg = currentBg();

    // Painted scenery + asphalt fills the whole canvas; the lanes, dashes and
    // grass are part of the art, so we skip the procedural lane fills below.
    if (bg) ctx.drawImage(bg.img, 0, 0, CONFIG.canvas.width, CONFIG.canvas.height);

    state.laneFuels.forEach((fuelKey, i) => {
      const fuel = CONFIG.fuelTypes[fuelKey];
      const cy = laneCenterY(i);
      const laneTop = cy - laneHeight / 2;

      if (!bg) {
        ctx.fillStyle = i % 2 === 0 ? COLORS.surfaceAlt : COLORS.surface;
        ctx.fillRect(0, laneTop, width, laneHeight);

        // Lane centre guide.
        ctx.strokeStyle = COLORS.laneGuide;
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 12]);
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(goal, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Station: painted pump sprite if loaded (the art identifies the fuel,
      // so no box or label), otherwise the procedural coloured box + labels.
      const stand = stationSprite(fuelKey);
      if (stand) {
        // Pumps are drawn 15% smaller on the early levels (1–5) so the roomier
        // 2–3 lane layouts don't feel dominated by the tall pump art.
        const standScale = STATION_SCALE * (state.level <= 5 ? 0.85 : 1);
        const targetW = CONFIG.station.width * (state.level <= 5 ? 0.85 : 1);
        const targetH = laneHeight * standScale;
        const scale = Math.min(targetW / stand.sw, targetH / stand.sh);
        const dw = stand.sw * scale;
        const dh = stand.sh * scale;
        const dx = goal + (CONFIG.station.width - dw) / 2;
        const dy = cy - dh / 2;
        ctx.drawImage(stand.img, stand.sx, stand.sy, stand.sw, stand.sh, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = bg ? COLORS.stationBoxArt : COLORS.surfaceBox;
        ctx.fillRect(goal, laneTop + 6, CONFIG.station.width, laneHeight - 12);
        ctx.lineWidth = 4;
        ctx.strokeStyle = fuel.color;
        ctx.strokeRect(goal, laneTop + 6, CONFIG.station.width, laneHeight - 12);

        ctx.fillStyle = fuel.color;
        ctx.font = font(TYPE.label);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(standLabel(fuelKey), goal + CONFIG.station.width / 2, cy - 9);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = font(TYPE.small);
        ctx.fillText(fuelLabel(fuelKey), goal + CONFIG.station.width / 2, cy + 11);
      }
    });
  }

  // Brown mud blobs (fractions of the drawn sprite rect) for dirty cars.
  const MUD_SPOTS = [
    [0.20, 0.55, 0.10], [0.42, 0.70, 0.13], [0.60, 0.50, 0.09],
    [0.76, 0.66, 0.11], [0.50, 0.42, 0.08], [0.33, 0.62, 0.08],
  ];

  // Cars are drawn a bit larger than their hitbox so the artwork reads well.
  const SPRITE_SCALE = 1.44;

  // Pump sprites stand a bit taller than a single lane so they read clearly at
  // the road's edge (contain-fit into station.width × laneThickness·scale).
  // Kept modest so the five-lane finale's pumps only lightly overlap instead of
  // piling into a jumble.
  const STATION_SCALE = 1.25;

  // Draw a car sprite (cropped to its opaque box) contained and centred within
  // maxW × maxH at (cx, cy). When `dirty`, mud is painted onto the car body only
  // ('source-atop'), not the background. Shared by gameplay cars (drawCar) and
  // the unlock illustration on the level-complete screen.
  function drawCarContain(rec, cx, cy, maxW, maxH, dirty) {
    const scale = Math.min(maxW / rec.sw, maxH / rec.sh);
    const dw = rec.sw * scale, dh = rec.sh * scale;
    const dx = cx - dw / 2, dy = cy - dh / 2;
    if (dirty) {
      mudCanvas.width = Math.ceil(dw);
      mudCanvas.height = Math.ceil(dh);
      mudCtx.clearRect(0, 0, mudCanvas.width, mudCanvas.height);
      mudCtx.drawImage(rec.img, rec.sx, rec.sy, rec.sw, rec.sh, 0, 0, dw, dh);
      mudCtx.globalCompositeOperation = "source-atop";
      mudCtx.fillStyle = COLORS.mud;
      MUD_SPOTS.forEach(([fx, fy, fr]) => {
        mudCtx.beginPath();
        mudCtx.arc(dw * fx, dh * fy, dh * fr, 0, Math.PI * 2);
        mudCtx.fill();
      });
      mudCtx.globalCompositeOperation = "source-over";
      ctx.drawImage(mudCanvas, dx, dy);
    } else {
      ctx.drawImage(rec.img, rec.sx, rec.sy, rec.sw, rec.sh, dx, dy, dw, dh);
    }
  }

  function drawCar(car) {
    const sprite = carSprite(car);
    const isDirty = !car.isPolice && car.fuel === "WASH";

    if (sprite) {
      // Contain the cropped sprite into the hitbox, drawn a touch larger
      // (SPRITE_SCALE) for visual presence while leaving the hitbox (queue
      // spacing/collisions) unchanged.
      drawCarContain(
        sprite,
        car.x + car.width / 2,
        car.y + car.height / 2,
        car.width * SPRITE_SCALE,
        car.height * SPRITE_SCALE,
        isDirty
      );
    } else {
      // Fallback while the sprite is still loading: the old coloured block.
      const bodyColor = car.isPolice
        ? CONFIG.police.color
        : isDirty
        ? CONFIG.fuelTypes[car.baseFuel].color
        : CONFIG.fuelTypes[car.fuel].color;
      ctx.fillStyle = bodyColor;
      ctx.fillRect(car.x, car.y, car.width, car.height);
      if (isDirty) {
        ctx.fillStyle = COLORS.mud;
        MUD_SPOTS.forEach(([fx, fy, fr]) => {
          ctx.beginPath();
          ctx.arc(car.x + car.width * fx, car.y + car.height * fy, car.height * fr, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // Active (player-controlled) car: steer hints only (▲▼ in Škoda Electric
    // Green), with a dark outline so they read on the road and the sky.
    if (car === activeCar()) {
      const cx = car.x + car.width / 2;
      ctx.font = font(TYPE.label);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.outline;
      ctx.fillStyle = COLORS.electric;
      [["▲", car.y - 20], ["▼", car.y + car.height + 16]].forEach(([ch, y]) => {
        ctx.strokeText(ch, cx, y);
        ctx.fillText(ch, cx, y);
      });
    }

    // Loading countdown — washing for dirty cars, refuelling for the rest.
    // (Police never load: they rush straight through.) Drawn with a dark
    // outline so it reads on any car colour. The car itself is identified by
    // its sprite, so there's no model-name label.
    if (car.status === "loading") {
      const icon = car.fuel === "WASH" ? "🚿" : "⛽";
      const text = icon + " " + Math.ceil(car.loadTimer) + "s";
      const x = car.x + car.width / 2, y = car.y + car.height / 2;
      ctx.font = font(TYPE.small, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = COLORS.outlineStrong;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = COLORS.textBright;
      ctx.fillText(text, x, y);
    }
  }

  function drawFlash() {
    const f = state.flash;
    if (!f) return;
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 0.9));
    ctx.fillStyle = f.color;
    ctx.font = font(TYPE.label);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const { width } = CONFIG.canvas;

    // Emerald-green band, slightly translucent so the painted sky shows through
    // while the text stays readable; an electric-green accent line underneath.
    ctx.fillStyle = COLORS.hudBand;
    ctx.fillRect(0, 0, width, CONFIG.hudHeight);
    ctx.strokeStyle = COLORS.hudLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, CONFIG.hudHeight);
    ctx.lineTo(width, CONFIG.hudHeight);
    ctx.stroke();

    ctx.textBaseline = "middle";
    const midY = CONFIG.hudHeight / 2;

    // Score + mode (left).
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.label);
    ctx.fillText(t("score") + " " + state.score, 20, midY - 9);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(TYPE.small);
    ctx.fillText(modeLabel(state.mode), 20, midY + 13);

    // Level + time (centre).
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.label);
    ctx.fillText(t("level") + " " + state.level, width / 2, midY - 10);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(TYPE.small);
    ctx.fillText("⏱ " + Math.ceil(state.timeLeft) + "s", width / 2, midY + 12);

    // Lives (right).
    ctx.textAlign = "right";
    ctx.font = font(TYPE.body);
    let pips = "";
    for (let i = 0; i < maxLives(); i++) pips += i < state.lives ? "● " : "○ ";
    ctx.fillStyle = COLORS.danger;
    ctx.fillText(t("lives") + " " + pips.trim(), width - 20, midY);
  }

  function drawOverlay() {
    const { width, height } = CONFIG.canvas;
    ctx.fillStyle = COLORS.overlay; // dark emerald wash
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  // Illustrate the station(s) unlocking next level as car(s) -> pump, the same
  // style as the level-1 briefing. The carwash has no model of its own, so it
  // shows the open models as dirty cars (e.g. a muddy Fabia and Kodiaq at L3).
  // Draws a single row centred at yTop + 36; returns the y past the row.
  function drawUnlockGraphic(fuels, yTop) {
    const { width } = CONFIG.canvas;
    const next = state.level + 1;
    const cy = yTop + 36;

    ctx.textBaseline = "middle";
    fuels.forEach((fuelKey) => {
      // Cars feeding this station: the wash takes every open model (as dirty),
      // every other station takes its one matching model.
      const cars =
        fuelKey === "WASH"
          ? activeFuels(next)
              .filter((f) => f !== "WASH")
              .map((f) => ({ rec: carSprites[modelForFuel(f)], dirty: true }))
          : [{ rec: carSprites[modelForFuel(fuelKey)], dirty: false }];

      const carsCx = width / 2 - 150;
      cars.forEach((c, i) => {
        if (!c.rec || !c.rec.ready) return;
        const cx = carsCx + (i - (cars.length - 1) / 2) * 96;
        drawCarContain(c.rec, cx, cy, 92, 46, c.dirty);
      });

      ctx.fillStyle = COLORS.text;
      ctx.font = font(TYPE.body);
      ctx.textAlign = "center";
      ctx.fillText("→", width / 2 - 30, cy);

      const stRec = stationSprite(fuelKey);
      if (stRec) drawSpriteContain(stRec, width / 2 + 30, cy, 64, 74);

      ctx.fillStyle = COLORS.text;
      ctx.font = font(TYPE.label);
      ctx.textAlign = "left";
      ctx.fillText(standLabel(fuelKey) + " — " + fuelLabel(fuelKey), width / 2 + 70, cy);
    });

    ctx.textAlign = "center";
    return yTop + 90;
  }

  function drawLevelComplete() {
    const { width, height } = CONFIG.canvas;
    drawOverlay();

    const finished = state.level >= CONFIG.maxLevel;

    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.display);
    ctx.fillText(
      finished ? t("allComplete") : t("levelComplete", { n: state.level }),
      width / 2,
      height / 2 - 70
    );

    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.body);
    ctx.fillText(t("deliveredThis", { n: state.deliveredThisLevel }), width / 2, height / 2 - 14);
    ctx.fillText(t("missedThis", { n: state.missedThisLevel }), width / 2, height / 2 + 18);
    ctx.fillText(
      t("totalAndLives", { s: state.score, l: state.lives }),
      width / 2,
      height / 2 + 50
    );

    if (finished) {
      ctx.fillStyle = COLORS.electric;
      ctx.font = font(TYPE.body);
      ctx.fillText(t("pressAddScore"), width / 2, height / 2 + 104);
      return;
    }

    // Heads-up about what changes next level: a new station kind unlocking,
    // police cars arriving, faster traffic, plus the kid-mode life refill.
    const next = state.level + 1;
    const unlocked = fuelsUnlockedAt(next);

    // Text notices. The new-station unlock is named here and then shown
    // graphically (car -> pump) below, so it isn't repeated as a plain line.
    const notices = [];
    if (next === CONFIG.police.fromLevel) {
      notices.push(t("policeNotice"));
    }
    // Level 1 sends one car at a time; level 2 opens the spawn timer so several
    // drive at once. Flag that instead of (or alongside) any speed-up.
    if (next === 2) {
      notices.push(t("moreCars"));
    }
    if (levelSpeed(next) > levelSpeed(state.level)) {
      notices.push(t("fasterCars"));
    }
    if (modeConfig().refillPerLevel && state.lives < maxLives()) {
      notices.push(t("plusLife"));
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let y = height / 2 + 84;

    // New station: name it, then illustrate the matching car(s) -> the pump.
    if (unlocked.length > 0) {
      const names = unlocked
        .map((f) => standLabel(f) + " (" + fuelLabel(f) + ")")
        .join(", ");
      ctx.fillStyle = COLORS.electric;
      ctx.font = font(TYPE.label);
      ctx.fillText(t("newStation", { names: names }), width / 2, y);
      y = drawUnlockGraphic(unlocked, y + 16);
    }

    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.label);
    notices.forEach((n) => {
      ctx.fillText(n, width / 2, y);
      y += 26;
    });

    y += 14;
    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.body);
    ctx.fillText(t("pressEnterLevel", { n: next }), width / 2, y);
  }

  function drawGameOver() {
    const { width, height } = CONFIG.canvas;
    drawOverlay();

    ctx.fillStyle = COLORS.danger;
    ctx.font = font(TYPE.display);
    ctx.fillText(t("gameOver"), width / 2, height / 2 - 40);

    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.body);
    ctx.fillText(
      t("finalScore", { s: state.score, n: state.level }),
      width / 2,
      height / 2 + 12
    );

    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("pressAddScore"), width / 2, height / 2 + 56);
  }

  /* =========================================================================
     MENU / BRIEFING / NAME ENTRY / LEADERBOARD SCREENS
     ========================================================================= */
  function drawMenu() {
    const { width } = CONFIG.canvas;
    drawBackdrop();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Language selector (← / → cycles through the available languages).
    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.label);
    ctx.fillText("‹  " + LANG_NAMES[state.lang] + "  ›", width / 2, 34);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(TYPE.small);
    ctx.fillText(t("langHint"), width / 2, 58);

    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.h1);
    ctx.fillText(t("chooseMode"), width / 2, 96);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("menuHint"), width / 2, 130);

    // Mode cards.
    const cardW = 520, cardH = 78, gap = 18, startY = 170;
    CONFIG.modeOrder.forEach((key, i) => {
      const x = width / 2 - cardW / 2;
      const y = startY + i * (cardH + gap);
      const selected = i === state.menuIndex;

      ctx.fillStyle = selected ? COLORS.surfaceSel : COLORS.surface;
      ctx.fillRect(x, y, cardW, cardH);
      ctx.lineWidth = selected ? 4 : 2;
      ctx.strokeStyle = selected ? COLORS.electric : COLORS.emeraldLine;
      ctx.strokeRect(x, y, cardW, cardH);

      ctx.textAlign = "left";
      ctx.fillStyle = selected ? COLORS.electric : COLORS.text;
      ctx.font = font(TYPE.lead);
      ctx.fillText(modeLabel(key), x + 22, y + 28);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = font(TYPE.caption);
      ctx.fillText(modeBlurb(key), x + 22, y + 54);
    });

    // Top scores for the highlighted mode.
    const hlKey = CONFIG.modeOrder[state.menuIndex];
    const scores = loadScores(hlKey);
    const boardY = startY + CONFIG.modeOrder.length * (cardH + gap) + 18;

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.label);
    ctx.fillText(t("topScores", { mode: modeLabel(hlKey) }), width / 2, boardY);

    ctx.font = font(TYPE.caption);
    if (scores.length === 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText(t("noScoresMenu"), width / 2, boardY + 30);
    } else {
      scores.slice(0, 5).forEach((s, i) => {
        ctx.fillStyle = COLORS.textMuted;
        ctx.fillText(
          (i + 1) + ".  " + s.name + "  —  " + s.score,
          width / 2,
          boardY + 30 + i * 22
        );
      });
    }
  }

  // Draw a preloaded sprite record (cropped to its opaque box) contained and
  // centred within maxW × maxH at (cx, cy). Used by the briefing's car/pump rows.
  function drawSpriteContain(rec, cx, cy, maxW, maxH) {
    const scale = Math.min(maxW / rec.sw, maxH / rec.sh);
    const dw = rec.sw * scale, dh = rec.sh * scale;
    ctx.drawImage(rec.img, rec.sx, rec.sy, rec.sw, rec.sh, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  // Level-1 how-to-play box: the controls plus the stations and cars present
  // at the start (later levels announce their new arrivals on the result screen).
  function drawBriefing() {
    const { width, height } = CONFIG.canvas;
    const fuels = activeFuels(1);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.h1);
    ctx.fillText(t("howToPlay"), width / 2, 60);

    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.body);
    ctx.fillText(t("brief1"), width / 2, 106);
    ctx.fillText(t("brief2"), width / 2, 134);
    ctx.fillStyle = COLORS.danger;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("brief3"), width / 2, 168);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("matchThese"), width / 2, 212);

    // Car -> station rows for every kind open at level 1, drawn with the real
    // car and pump sprites so the briefing matches what's on the road. Sprites
    // fall back to a fuel-coloured swatch if they haven't finished loading.
    const rowY0 = 258, rowH = 84;
    const carCx = width / 2 - 230;
    const arrowX = width / 2 - 110;
    const stCx = width / 2 - 40;
    const labelX = width / 2 + 8;

    fuels.forEach((fuelKey, i) => {
      const fuel = CONFIG.fuelTypes[fuelKey];
      const cy = rowY0 + i * rowH;

      // Car: real sprite (cropped/contained) with its model name beneath.
      const carRec = carSprites[modelForFuel(fuelKey)];
      if (carRec && carRec.ready) {
        drawSpriteContain(carRec, carCx, cy - 8, 150, 50);
      } else {
        ctx.fillStyle = fuel.color;
        ctx.fillRect(carCx - 48, cy - 28, 96, 40);
      }
      ctx.fillStyle = COLORS.textMuted;
      ctx.font = font(TYPE.small, 700);
      ctx.textAlign = "center";
      ctx.fillText(modelForFuel(fuelKey), carCx, cy + 30);

      // Arrow.
      ctx.fillStyle = COLORS.text;
      ctx.font = font(TYPE.body);
      ctx.fillText("→", arrowX, cy);

      // Station: real pump sprite (the art identifies the fuel), with the
      // colour/fuel label to its right.
      const stRec = stationSprite(fuelKey);
      if (stRec) {
        drawSpriteContain(stRec, stCx, cy, 84, 74);
      } else {
        ctx.fillStyle = fuel.color;
        ctx.fillRect(stCx - 24, cy - 24, 48, 48);
        ctx.strokeStyle = COLORS.hairline;
        ctx.lineWidth = 1;
        ctx.strokeRect(stCx - 24, cy - 24, 48, 48);
      }

      ctx.fillStyle = COLORS.text;
      ctx.font = font(TYPE.label);
      ctx.textAlign = "left";
      ctx.fillText(standLabel(fuelKey) + " — " + fuelLabel(fuelKey), labelX, cy);
    });

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.body);
    ctx.fillText(t("pressEnterStart"), width / 2, height - 48);
  }

  function drawEnterName() {
    const { width, height } = CONFIG.canvas;
    const res = state.lastResult;
    const won = res && res.won;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = won ? COLORS.electric : COLORS.danger;
    ctx.font = font(TYPE.h1);
    ctx.fillText(won ? t("youFinished") : t("gameOver"), width / 2, height / 2 - 130);

    ctx.fillStyle = COLORS.text;
    ctx.font = font(TYPE.body);
    ctx.fillText(
      t("scoreMode", {
        s: res ? res.score : 0,
        mode: modeLabel(res ? res.mode : "kid"),
      }),
      width / 2,
      height / 2 - 86
    );

    ctx.fillStyle = COLORS.textDim;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("enterNamePrompt"), width / 2, height / 2 - 30);

    // Input box with a blinking caret.
    const boxW = 380, boxH = 54;
    const bx = width / 2 - boxW / 2, by = height / 2;
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.electric;
    ctx.strokeRect(bx, by, boxW, boxH);

    const caret = Math.floor(Date.now() / 500) % 2 === 0 ? "|" : "";
    ctx.fillStyle = COLORS.textBright;
    ctx.font = font(TYPE.lead);
    ctx.fillText(state.nameInput + caret, width / 2, by + boxH / 2);

    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("typeNameSave"), width / 2, by + boxH + 36);
  }

  function drawLeaderboard() {
    const { width, height } = CONFIG.canvas;
    const modeKey = state.lastResult ? state.lastResult.mode : state.mode;
    const board = state.lastBoard || loadScores(modeKey);

    ctx.textBaseline = "middle";

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.h1);
    ctx.fillText(t("leaderboard", { mode: modeLabel(modeKey) }), width / 2, 70);

    if (board.length === 0) {
      ctx.fillStyle = COLORS.textDim;
      ctx.font = font(TYPE.caption);
      ctx.fillText(t("noScores"), width / 2, 140);
    }

    const rowH = 34, startY = 130;
    board.forEach((s, i) => {
      const isMe = s === state._lastEntry;
      ctx.fillStyle = isMe ? COLORS.electric : COLORS.text;
      ctx.font = font(TYPE.body, isMe ? 700 : 400);
      const y = startY + i * rowH;

      ctx.textAlign = "left";
      ctx.fillText(i + 1 + ".", width / 2 - 230, y);
      ctx.fillText(s.name, width / 2 - 190, y);
      ctx.textAlign = "right";
      ctx.fillText(t("lvShort", { n: s.level }), width / 2 + 120, y);
      ctx.fillText(String(s.score), width / 2 + 230, y);
    });

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.electric;
    ctx.font = font(TYPE.caption);
    ctx.fillText(t("pressEnterMenu"), width / 2, height - 36);
  }

  /* =========================================================================
     LEADERBOARD  (persisted per mode in localStorage)
     ========================================================================= */
  function scoreKey(mode) {
    return "skoda_station_scores_" + mode;
  }

  function loadScores(mode) {
    try {
      const raw = localStorage.getItem(scoreKey(mode));
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return []; // storage unavailable (e.g. file:// restrictions)
    }
  }

  // Add a result and keep the top 10. Returns the trimmed, sorted list.
  function saveScore(mode, name, score, level) {
    const list = loadScores(mode);
    const entry = { name: name, score: score, level: level, date: Date.now() };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 10);
    try {
      localStorage.setItem(scoreKey(mode), JSON.stringify(top));
    } catch (e) {
      /* ignore write failures so the run can still end cleanly */
    }
    state._lastEntry = entry; // reference used to highlight it on the board
    return top;
  }

  /* =========================================================================
     FLOW CONTROL
     ========================================================================= */

  // Begin (or restart) a specific level. Lives/score are NOT reset here.
  function startLevel(level) {
    state.level = level;
    state.laneFuels = activeFuels(level); // open stations for this level
    state.phase = "playing";
    state.cars = [];
    state.spawnTimer = 0;
    state.timeLeft = CONFIG.levelDurationSeconds;
    state.deliveredThisLevel = 0;
    state.missedThisLevel = 0;
    state.flash = null;
    spawnCar(); // first car on the road immediately
  }

  // Full reset to a fresh game (level 1, full lives, zero score) for the
  // currently selected mode.
  function startGame() {
    state.score = 0;
    state.lives = maxLives();
    state.nextId = 1;
    startLevel(1);
  }

  // Enter pressed on the level-complete screen: finish the run after the final
  // level, otherwise refill a life (kid mode) and roll into the next level.
  function advanceFromLevelComplete() {
    if (state.level >= CONFIG.maxLevel) {
      beginNameEntry(true); // beat the whole game
      return;
    }
    if (modeConfig().refillPerLevel) {
      state.lives = Math.min(maxLives(), state.lives + 1);
    }
    startLevel(state.level + 1);
  }

  // A run has ended (won = finished level 10, or false = ran out of lives).
  // Capture the result and open the name-entry screen.
  function beginNameEntry(won) {
    state.lastResult = {
      mode: state.mode,
      score: state.score,
      level: state.level,
      won: won,
    };
    state.nameInput = "";
    state.phase = "enterName";
  }

  // Save the typed name + score to this mode's leaderboard, then show it.
  function submitName() {
    const res = state.lastResult;
    const name = state.nameInput.trim() || "Anonymous";
    state.lastBoard = saveScore(res.mode, name, res.score, res.level);
    state.lastSavedName = name;
    state.phase = "leaderboard";
  }

  /* =========================================================================
     MAIN LOOP / BOOTSTRAP
     ========================================================================= */
  let lastTime = 0;
  function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // Boot: restore the saved/detected language, sync the header, then show the
  // start menu where the player picks a language and mode to begin.
  state.lang = loadLang();
  applyDomLanguage();
  preloadBackgrounds();
  preloadCarSprites();
  preloadStationSprites();
  requestAnimationFrame(loop);
})();
