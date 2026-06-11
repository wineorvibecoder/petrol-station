/* ===========================================================================
   Škoda Charging & Refueling Station — game logic (Phase 3)

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
     CONFIG
     ========================================================================= */
  const CONFIG = {
    canvas: { width: 960, height: 600 },
    hudHeight: 70,

    fuelTypes: {
      ELECTRIC: { label: "Electric", color: "#4ba82e", standLabel: "Green" },
      PETROL:   { label: "Petrol",   color: "#d6453b", standLabel: "Red"   },
      DIESEL:   { label: "Diesel",   color: "#454b54", standLabel: "Black" },
      CNG:      { label: "CNG",      color: "#3a78c2", standLabel: "Blue"  },
      // The carwash is modelled as just another "fuel": dirty cars (brown for
      // now; later a normal colour with brown spots) must reach the wash bay.
      WASH:     { label: "Carwash",  color: "#7a5230", standLabel: "Wash"  },
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

    // Police cars: a finale twist. They have no fuel — steer one into any
    // FREE station of any kind EXCEPT the carwash. Parking it on an occupied
    // station, or in the carwash, is a miss (-1 life). A good park scores +1.
    police: {
      fromLevel: 10,    // police cars start appearing at this level
      chance: 0.35,     // share of spawns that are police (when eligible)
      color: "#1f2d5a", // dark police blue
    },

    carModels: {
      ENYAQ:   { name: "Enyaq",   fuel: "ELECTRIC" },
      FABIA:   { name: "Fabia",   fuel: "PETROL"   },
      KODIAQ:  { name: "Kodiaq",  fuel: "DIESEL"   },
      OCTAVIA: { name: "Octavia", fuel: "CNG"      },
      DIRTY:   { name: "Dirty",   fuel: "WASH"     },
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
    //   racing — for adults: 3 lives, no refills. Same speed as kid for now;
    //            speedScale is here so it can be tuned later during testing.
    modeOrder: ["kid", "racing"],
    modes: {
      kid: {
        label: "Kid mode",
        blurb: "Relaxed · 5 lives · +1 life after every level",
        lives: 5,
        refillPerLevel: true,
        speedScale: 1,
      },
      racing: {
        label: "Racing mode",
        blurb: "For grown-ups · 3 lives · no refills",
        lives: 3,
        refillPerLevel: false,
        speedScale: 1,
      },
    },

    maxLevel: 10,        // final level; finishing it completes the run
    maxNameLength: 12,   // leaderboard name length cap

    // Dev/testing aids. Set to false for a release build to disable the
    // level-skip hotkeys and the on-screen hint.
    debug: true,

    // Difficulty. Level 1 is event-driven (one driving car at a time); from
    // level 2 onward cars also arrive on a shrinking timer.
    level1SpawnGap: 0.6,       // pause before the next car on level 1
    base: { carSpeed: 120 },
    perLevel: {
      carSpeedStep: 20,
      carSpeedMax: 300,
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

  /* =========================================================================
     GEOMETRY HELPERS
     ========================================================================= */
  function laneCount() {
    return state.laneFuels.length;
  }

  function laneCenterY(laneIndex) {
    const top = CONFIG.hudHeight;
    const laneHeight = (CONFIG.canvas.height - top) / laneCount();
    return top + laneHeight * laneIndex + laneHeight / 2;
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
  function levelTuning() {
    const scale = modeConfig().speedScale;
    const carSpeed =
      Math.min(
        CONFIG.perLevel.carSpeedMax,
        CONFIG.base.carSpeed + (state.level - 1) * CONFIG.perLevel.carSpeedStep
      ) * scale;
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
  function spawnCar() {
    // From the police level on, a share of arrivals are police cars: no fuel,
    // park at any free non-wash station. Otherwise pick a deliverable fuel
    // (its station is open) and the matching model.
    let model, fuel, isPolice;
    if (state.level >= CONFIG.police.fromLevel && Math.random() < CONFIG.police.chance) {
      isPolice = true;
      model = "Police";
      fuel = "POLICE"; // sentinel; never matches a lane fuel
    } else {
      isPolice = false;
      const fuels = state.laneFuels;
      fuel = fuels[Math.floor(Math.random() * fuels.length)];
      const modelKey = Object.keys(CONFIG.carModels).find(
        (k) => CONFIG.carModels[k].fuel === fuel
      );
      model = CONFIG.carModels[modelKey].name;
    }

    // Enter in a random active lane (player still has to sort most of them).
    const lane = Math.floor(Math.random() * laneCount());

    state.cars.push({
      id: state.nextId++,
      model: model,
      fuel: fuel,
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
    } else if (evt.key === "Enter" || evt.key === " ") {
      evt.preventDefault();
      state.mode = CONFIG.modeOrder[state.menuIndex];
      startGame();
    }
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
            state.score += 1;
            state.deliveredThisLevel += 1;
            car.status = "leaving";
            addFlash(car, "#4ba82e", "+1");
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

  // A driving car has reached the station row. Correct lane -> join the queue;
  // wrong lane -> miss (lose a life) and pull away. A police car is "correct"
  // when parked at any FREE station that is not the carwash.
  function arriveAtStation(car) {
    const correct = car.isPolice
      ? state.laneFuels[car.lane] !== "WASH" && stationFree(car.lane)
      : state.laneFuels[car.lane] === car.fuel;
    if (correct) {
      car.result = "correct";
      car.status = "queued"; // slot + loading handled in assignQueueSlots()
    } else {
      car.result = "wrong";
      car.status = "leaving";
      state.lives -= 1;
      state.missedThisLevel += 1;
      addFlash(car, "#d6453b", "MISS!");
      if (state.lives <= 0) {
        state.lives = 0;
        state.phase = "gameOver";
      }
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
    ctx.fillStyle = "#1a1d21";
    ctx.fillRect(0, 0, width, height);
  }

  function drawDebugHint() {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "12px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      "DEV: 1-9/0 jump to level · N next · B back",
      12,
      CONFIG.canvas.height - 8
    );
  }

  function drawLanes() {
    const { width } = CONFIG.canvas;
    const goal = goalLineX();
    const laneHeight =
      (CONFIG.canvas.height - CONFIG.hudHeight) / laneCount();

    state.laneFuels.forEach((fuelKey, i) => {
      const fuel = CONFIG.fuelTypes[fuelKey];
      const cy = laneCenterY(i);
      const laneTop = CONFIG.hudHeight + laneHeight * i;

      ctx.fillStyle = i % 2 === 0 ? "#2b2f36" : "#262a30";
      ctx.fillRect(0, laneTop, width, laneHeight);

      // Lane centre guide.
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(goal, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Station block.
      ctx.fillStyle = "#30343c";
      ctx.fillRect(goal, laneTop + 6, CONFIG.station.width, laneHeight - 12);
      ctx.lineWidth = 4;
      ctx.strokeStyle = fuel.color;
      ctx.strokeRect(goal, laneTop + 6, CONFIG.station.width, laneHeight - 12);

      ctx.fillStyle = fuel.color;
      ctx.font = "bold 18px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fuel.standLabel, goal + CONFIG.station.width / 2, cy - 9);
      ctx.fillStyle = "#aab0b8";
      ctx.font = "13px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(fuel.label, goal + CONFIG.station.width / 2, cy + 11);
    });
  }

  function drawCar(car) {
    // Police cars have no fuel type; everything else uses its fuel colour.
    const bodyColor = car.isPolice
      ? CONFIG.police.color
      : CONFIG.fuelTypes[car.fuel].color;

    ctx.fillStyle = bodyColor;
    ctx.fillRect(car.x, car.y, car.width, car.height);

    // Police light bar: red/blue strip across the roof.
    if (car.isPolice) {
      const barW = car.width * 0.5;
      const barX = car.x + (car.width - barW) / 2;
      ctx.fillStyle = "#d6453b";
      ctx.fillRect(barX, car.y + 3, barW / 2, 6);
      ctx.fillStyle = "#3a78c2";
      ctx.fillRect(barX + barW / 2, car.y + 3, barW / 2, 6);
    }

    // Active (player-controlled) car: outline + steer hints.
    if (car === activeCar()) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffd400";
      ctx.strokeRect(car.x - 2, car.y - 2, car.width + 4, car.height + 4);
      ctx.fillStyle = "#ffd400";
      ctx.font = "bold 16px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("▲", car.x + car.width / 2, car.y - 14);
      ctx.fillText("▼", car.x + car.width / 2, car.y + car.height + 14);
    }

    // Model label.
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(car.model, car.x + car.width / 2, car.y + car.height / 2 - 6);

    // Loading countdown — parking for police, washing for dirty cars,
    // refuelling for everything else.
    if (car.status === "loading") {
      const icon = car.isPolice ? "🚓" : car.fuel === "WASH" ? "🚿" : "⛽";
      ctx.font = "12px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(
        icon + " " + Math.ceil(car.loadTimer) + "s",
        car.x + car.width / 2,
        car.y + car.height / 2 + 9
      );
    }
  }

  function drawFlash() {
    const f = state.flash;
    if (!f) return;
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 0.9));
    ctx.fillStyle = f.color;
    ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const { width } = CONFIG.canvas;

    ctx.fillStyle = "#1a1d21";
    ctx.fillRect(0, 0, width, CONFIG.hudHeight);
    ctx.strokeStyle = "#3c424b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, CONFIG.hudHeight);
    ctx.lineTo(width, CONFIG.hudHeight);
    ctx.stroke();

    ctx.textBaseline = "middle";
    const midY = CONFIG.hudHeight / 2;

    // Score + mode (left).
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8eaed";
    ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Score " + state.score, 20, midY - 9);
    ctx.fillStyle = "#9aa0a6";
    ctx.font = "13px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(modeConfig().label, 20, midY + 13);

    // Level + time (centre).
    ctx.textAlign = "center";
    ctx.fillStyle = "#4ba82e";
    ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Level " + state.level, width / 2, midY - 10);
    ctx.fillStyle = "#9aa0a6";
    ctx.font = "14px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("⏱ " + Math.ceil(state.timeLeft) + "s", width / 2, midY + 12);

    // Lives (right).
    ctx.textAlign = "right";
    ctx.font = "20px 'Segoe UI', Arial, sans-serif";
    let pips = "";
    for (let i = 0; i < maxLives(); i++) pips += i < state.lives ? "● " : "○ ";
    ctx.fillStyle = "#d6453b";
    ctx.fillText("Lives " + pips.trim(), width - 20, midY);
  }

  function drawOverlay() {
    const { width, height } = CONFIG.canvas;
    ctx.fillStyle = "rgba(0,0,0,0.74)";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  function drawLevelComplete() {
    const { width, height } = CONFIG.canvas;
    drawOverlay();

    const finished = state.level >= CONFIG.maxLevel;

    ctx.fillStyle = "#4ba82e";
    ctx.font = "bold 46px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(
      finished ? "ALL LEVELS COMPLETE!" : "LEVEL " + state.level + " COMPLETE",
      width / 2,
      height / 2 - 70
    );

    ctx.fillStyle = "#e8eaed";
    ctx.font = "22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Delivered this level: " + state.deliveredThisLevel, width / 2, height / 2 - 14);
    ctx.fillText("Missed this level: " + state.missedThisLevel, width / 2, height / 2 + 18);
    ctx.fillText(
      "Total score: " + state.score + "    ·    Lives: " + state.lives,
      width / 2,
      height / 2 + 50
    );

    if (finished) {
      ctx.fillStyle = "#ffd400";
      ctx.font = "20px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("Press Enter to add your score", width / 2, height / 2 + 104);
      return;
    }

    // Heads-up about what changes next level: a new station kind unlocking
    // and/or police cars arriving, plus the kid-mode life refill.
    const next = state.level + 1;
    const unlocked = fuelsUnlockedAt(next);
    const notices = [];
    if (unlocked.length > 0) {
      const names = unlocked
        .map((f) => CONFIG.fuelTypes[f].standLabel + " (" + CONFIG.fuelTypes[f].label + ")")
        .join(", ");
      notices.push("New station unlocked: " + names + "!");
    }
    if (next === CONFIG.police.fromLevel) {
      notices.push("Police cars! Park them at any free station — not the wash.");
    }
    if (modeConfig().refillPerLevel && state.lives < maxLives()) {
      notices.push("+1 life for finishing the level!");
    }

    ctx.fillStyle = "#4ba82e";
    ctx.font = "bold 20px 'Segoe UI', Arial, sans-serif";
    notices.forEach((n, i) => ctx.fillText(n, width / 2, height / 2 + 90 + i * 26));

    ctx.fillStyle = "#ffd400";
    ctx.font = "20px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(
      "Press Enter for Level " + next,
      width / 2,
      height / 2 + 90 + notices.length * 26 + 14
    );
  }

  function drawGameOver() {
    const { width, height } = CONFIG.canvas;
    drawOverlay();

    ctx.fillStyle = "#d6453b";
    ctx.font = "bold 48px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("GAME OVER", width / 2, height / 2 - 40);

    ctx.fillStyle = "#e8eaed";
    ctx.font = "24px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(
      "Final score: " + state.score + "   ·   reached Level " + state.level,
      width / 2,
      height / 2 + 12
    );

    ctx.fillStyle = "#ffd400";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Press Enter to add your score", width / 2, height / 2 + 56);
  }

  /* =========================================================================
     MENU / NAME ENTRY / LEADERBOARD SCREENS
     ========================================================================= */
  function drawMenu() {
    const { width } = CONFIG.canvas;
    drawBackdrop();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "#4ba82e";
    ctx.font = "bold 40px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Choose your mode", width / 2, 92);

    ctx.fillStyle = "#9aa0a6";
    ctx.font = "16px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("↑ / ↓ to choose · Enter to start", width / 2, 128);

    // Mode cards.
    const cardW = 520, cardH = 78, gap = 18, startY = 170;
    CONFIG.modeOrder.forEach((key, i) => {
      const m = CONFIG.modes[key];
      const x = width / 2 - cardW / 2;
      const y = startY + i * (cardH + gap);
      const selected = i === state.menuIndex;

      ctx.fillStyle = selected ? "#2f3a2a" : "#262a30";
      ctx.fillRect(x, y, cardW, cardH);
      ctx.lineWidth = selected ? 4 : 2;
      ctx.strokeStyle = selected ? "#4ba82e" : "#3c424b";
      ctx.strokeRect(x, y, cardW, cardH);

      ctx.textAlign = "left";
      ctx.fillStyle = selected ? "#ffd400" : "#e8eaed";
      ctx.font = "bold 24px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(m.label, x + 22, y + 28);
      ctx.fillStyle = "#aab0b8";
      ctx.font = "15px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(m.blurb, x + 22, y + 54);
    });

    // Top scores for the highlighted mode.
    const hlKey = CONFIG.modeOrder[state.menuIndex];
    const scores = loadScores(hlKey);
    const boardY = startY + CONFIG.modeOrder.length * (cardH + gap) + 18;

    ctx.textAlign = "center";
    ctx.fillStyle = "#e8eaed";
    ctx.font = "bold 18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Top scores — " + CONFIG.modes[hlKey].label, width / 2, boardY);

    ctx.font = "15px 'Segoe UI', Arial, sans-serif";
    if (scores.length === 0) {
      ctx.fillStyle = "#9aa0a6";
      ctx.fillText("No scores yet — be the first!", width / 2, boardY + 30);
    } else {
      scores.slice(0, 5).forEach((s, i) => {
        ctx.fillStyle = "#cfd3d8";
        ctx.fillText(
          (i + 1) + ".  " + s.name + "  —  " + s.score,
          width / 2,
          boardY + 30 + i * 22
        );
      });
    }
  }

  function drawEnterName() {
    const { width, height } = CONFIG.canvas;
    const res = state.lastResult;
    const won = res && res.won;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = won ? "#4ba82e" : "#d6453b";
    ctx.font = "bold 40px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(won ? "YOU FINISHED!" : "GAME OVER", width / 2, height / 2 - 130);

    ctx.fillStyle = "#e8eaed";
    ctx.font = "22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(
      "Score " + (res ? res.score : 0) +
        "  ·  " + CONFIG.modes[res ? res.mode : "kid"].label,
      width / 2,
      height / 2 - 86
    );

    ctx.fillStyle = "#9aa0a6";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Enter your name for the leaderboard:", width / 2, height / 2 - 30);

    // Input box with a blinking caret.
    const boxW = 380, boxH = 54;
    const bx = width / 2 - boxW / 2, by = height / 2;
    ctx.fillStyle = "#262a30";
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#4ba82e";
    ctx.strokeRect(bx, by, boxW, boxH);

    const caret = Math.floor(Date.now() / 500) % 2 === 0 ? "|" : "";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(state.nameInput + caret, width / 2, by + boxH / 2);

    ctx.fillStyle = "#ffd400";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Type your name, then press Enter to save", width / 2, by + boxH + 36);
  }

  function drawLeaderboard() {
    const { width, height } = CONFIG.canvas;
    const modeKey = state.lastResult ? state.lastResult.mode : state.mode;
    const board = state.lastBoard || loadScores(modeKey);

    ctx.textBaseline = "middle";

    ctx.textAlign = "center";
    ctx.fillStyle = "#4ba82e";
    ctx.font = "bold 36px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Leaderboard — " + CONFIG.modes[modeKey].label, width / 2, 70);

    if (board.length === 0) {
      ctx.fillStyle = "#9aa0a6";
      ctx.font = "18px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("No scores yet.", width / 2, 140);
    }

    const rowH = 34, startY = 130;
    board.forEach((s, i) => {
      const isMe = s === state._lastEntry;
      ctx.fillStyle = isMe ? "#ffd400" : "#e8eaed";
      ctx.font = (isMe ? "bold " : "") + "20px 'Segoe UI', Arial, sans-serif";
      const y = startY + i * rowH;

      ctx.textAlign = "left";
      ctx.fillText(i + 1 + ".", width / 2 - 230, y);
      ctx.fillText(s.name, width / 2 - 190, y);
      ctx.textAlign = "right";
      ctx.fillText("Lv " + s.level, width / 2 + 120, y);
      ctx.fillText(String(s.score), width / 2 + 230, y);
    });

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd400";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Press Enter for the menu", width / 2, height - 36);
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

  // Boot straight to the start menu; the player picks a mode to begin.
  requestAnimationFrame(loop);
})();
