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

    // On these levels every open kind gets two stations/lanes instead of one
    // (e.g. Petrol, Petrol, Diesel, Diesel). Level 10 is the doubled finale.
    doubleLevels: [10],

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

    lives: 3,

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
    phase: "playing", // 'playing' | 'levelComplete' | 'gameOver'
    laneFuels: [],    // active stations top-to-bottom; set per level
    cars: [],
    nextId: 1,
    spawnTimer: 0,
    level: 1,
    score: 0,
    lives: CONFIG.lives,
    timeLeft: CONFIG.levelDurationSeconds,
    deliveredThisLevel: 0,
    missedThisLevel: 0,
    flash: null, // { x, y, color, text, life }
  };

  /* =========================================================================
     STATION UNLOCKS
     ========================================================================= */
  // Lanes (top-to-bottom) for the given level: every open fuel, doubled on
  // the configured "double" levels (each kind gets two adjacent stations).
  function activeFuels(level) {
    const open = CONFIG.stations
      .filter((s) => level >= s.unlockLevel)
      .map((s) => s.fuel);

    if (!CONFIG.doubleLevels.includes(level)) return open;

    const doubled = [];
    open.forEach((fuel) => doubled.push(fuel, fuel));
    return doubled;
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
    const carSpeed = Math.min(
      CONFIG.perLevel.carSpeedMax,
      CONFIG.base.carSpeed + (state.level - 1) * CONFIG.perLevel.carSpeedStep
    );
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
    // Only spawn cars whose station is currently open, so every car is
    // deliverable. Pick a fuel from the active set, then its model.
    const fuels = state.laneFuels;
    const fuel = fuels[Math.floor(Math.random() * fuels.length)];
    const modelKey = Object.keys(CONFIG.carModels).find(
      (k) => CONFIG.carModels[k].fuel === fuel
    );
    const model = CONFIG.carModels[modelKey];

    // Enter in a random active lane (player still has to sort most of them).
    const lane = Math.floor(Math.random() * laneCount());

    state.cars.push({
      id: state.nextId++,
      model: model.name,
      fuel: model.fuel,
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
    if (state.phase === "gameOver") {
      if (evt.key === "r" || evt.key === "R" || evt.key === "Enter") startGame();
      return;
    }
    if (state.phase === "levelComplete") {
      if (evt.key === "Enter" || evt.key === " ") startLevel(state.level + 1);
      return;
    }

    // Playing: steer the active car.
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
  window.addEventListener("keydown", handleKeyDown);

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

  // A driving car has reached the station row. Correct lane -> join the queue;
  // wrong lane -> miss (lose a life) and pull away.
  function arriveAtStation(car) {
    const correct = state.laneFuels[car.lane] === car.fuel;
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

    drawLanes();
    state.cars.forEach(drawCar);
    drawFlash();
    drawHud();

    if (state.phase === "levelComplete") drawLevelComplete();
    if (state.phase === "gameOver") drawGameOver();
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
    const fuel = CONFIG.fuelTypes[car.fuel];

    ctx.fillStyle = fuel.color;
    ctx.fillRect(car.x, car.y, car.width, car.height);

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

    // Loading countdown — washing for dirty cars, refuelling for the rest.
    if (car.status === "loading") {
      const icon = car.fuel === "WASH" ? "🚿" : "⛽";
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

    // Score (left).
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8eaed";
    ctx.font = "bold 22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Score " + state.score, 20, midY);

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
    for (let i = 0; i < CONFIG.lives; i++) pips += i < state.lives ? "● " : "○ ";
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

    ctx.fillStyle = "#4ba82e";
    ctx.font = "bold 46px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("LEVEL " + state.level + " COMPLETE", width / 2, height / 2 - 70);

    ctx.fillStyle = "#e8eaed";
    ctx.font = "22px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Delivered this level: " + state.deliveredThisLevel, width / 2, height / 2 - 14);
    ctx.fillText("Missed this level: " + state.missedThisLevel, width / 2, height / 2 + 18);
    ctx.fillText(
      "Total score: " + state.score + "    ·    Lives: " + state.lives,
      width / 2,
      height / 2 + 50
    );

    // Heads-up about what changes in the upcoming level: a new station kind
    // unlocking, and/or every station kind being doubled.
    const next = state.level + 1;
    const unlocked = fuelsUnlockedAt(next);
    let notice = null;
    if (unlocked.length > 0) {
      const names = unlocked
        .map((f) => CONFIG.fuelTypes[f].standLabel + " (" + CONFIG.fuelTypes[f].label + ")")
        .join(", ");
      notice = "New station unlocked: " + names + "!";
    } else if (CONFIG.doubleLevels.includes(next)) {
      notice = "Double stations — two of every kind!";
    }
    if (notice) {
      ctx.fillStyle = "#4ba82e";
      ctx.font = "bold 20px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(notice, width / 2, height / 2 + 90);
    }

    ctx.fillStyle = "#ffd400";
    ctx.font = "20px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Press Enter for Level " + (state.level + 1), width / 2, height / 2 + 124);
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

    ctx.fillStyle = "#9aa0a6";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Press R to play again", width / 2, height / 2 + 56);
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

  // Full reset to a fresh game (level 1, full lives, zero score).
  function startGame() {
    state.score = 0;
    state.lives = CONFIG.lives;
    state.nextId = 1;
    startLevel(1);
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

  startGame();
  requestAnimationFrame(loop);
})();
