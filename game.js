/* ===========================================================================
   Škoda Charging & Refueling Station — game logic (Phase 2: lane-switcher)

   Pure Vanilla JS + Canvas 2D. No frameworks, no build step.
   Open index.html directly in a browser to run.

   GAMEPLAY
     Cars stream in from the left, each in one of four horizontal lanes.
     Each lane ends in a fixed fuel station:
        lane 0 -> Green (Electric)
        lane 1 -> Red   (Petrol)
        lane 2 -> Black (Diesel)
        lane 3 -> Blue  (CNG)
     The frontmost car (closest to the stations) is "active" and highlighted.
     Press Up / Down to hop the active car between lanes. Get each car into the
     lane whose station matches its fuel before it reaches the right edge.
        Correct station  -> +score, quick refuel, drives off.
        Wrong station    -> lose a life, flash, drives off.
     As you clear cars the level rises: cars spawn faster and drive quicker.
     Lose all lives -> Game Over (press R to restart).

   ARCHITECTURE (modular, logic separated from drawing)
     CONFIG    - tunable constants & data tables
     state     - the single mutable game-state object
     levelTuning() - derives spawn rate / speed from current level
     Spawner   - decides when/what cars enter
     Input     - keyboard handling (lane switch + restart)
     update()  - advances the simulation (movement + per-car state machine)
     render()  - draws everything from current state (no game logic)
     loop()    - requestAnimationFrame driver

   Each car runs a small state machine:
     'driving' -> 'refueling' -> 'leaving' -> (removed)
   =========================================================================== */

(function () {
  "use strict";

  /* =========================================================================
     CONFIG — all tunables live here.
     ========================================================================= */
  const CONFIG = {
    canvas: { width: 960, height: 600 },
    hudHeight: 70, // top strip reserved for score / level / lives

    // Fuel types map a car to the station that can serve it.
    fuelTypes: {
      ELECTRIC: { key: "ELECTRIC", label: "Electric", color: "#4ba82e", standLabel: "Green" },
      PETROL:   { key: "PETROL",   label: "Petrol",   color: "#d6453b", standLabel: "Red"   },
      DIESEL:   { key: "DIESEL",   label: "Diesel",   color: "#454b54", standLabel: "Black" },
      CNG:      { key: "CNG",      label: "CNG",      color: "#3a78c2", standLabel: "Blue"  },
    },

    // Lane order, top to bottom. Each lane is permanently tied to one fuel.
    laneFuels: ["ELECTRIC", "PETROL", "DIESEL", "CNG"],

    // Car model -> fuel type. Every fuel here has a lane, so all are spawnable.
    carModels: {
      ENYAQ:   { name: "Enyaq",   fuel: "ELECTRIC" },
      FABIA:   { name: "Fabia",   fuel: "PETROL"   },
      KODIAQ:  { name: "Kodiaq",  fuel: "DIESEL"   },
      OCTAVIA: { name: "Octavia", fuel: "CNG"      },
    },

    car: {
      width: 84,
      height: 40,
      laneSwitchSpeed: 520, // vertical px/sec while hopping lanes (smoothness)
    },

    station: { width: 124 }, // drawn at the right edge; left edge = goal line

    refuelSeconds: 0.8, // brief pause at the station before driving off

    lives: 3,
    points: { correct: 10, wrongPenalty: 5 },
    carsPerLevel: 6, // successful dockings needed to advance a level

    // Base difficulty at level 1; levelTuning() scales these up per level.
    base: {
      spawnInterval: 2.2, // seconds between spawns
      carSpeed: 150,      // horizontal px/sec
    },
    perLevel: {
      spawnIntervalStep: 0.18, // subtract per level
      spawnIntervalMin: 0.75,  // floor
      carSpeedStep: 14,        // add per level
      carSpeedMax: 320,        // cap
    },
  };

  /* =========================================================================
     CANVAS SETUP
     ========================================================================= */
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  /* =========================================================================
     STATE — the single source of truth.
     ========================================================================= */
  const state = {
    cars: [],
    nextId: 1,
    spawnTimer: 0,
    score: 0,
    level: 1,
    lives: CONFIG.lives,
    clearedThisLevel: 0, // successful dockings counted toward the next level
    gameOver: false,
    flash: null, // transient feedback marker { x, y, color, life, text }
  };

  /* =========================================================================
     GEOMETRY HELPERS
     ========================================================================= */

  // Y of a lane's vertical center, given the lane index.
  function laneCenterY(laneIndex) {
    const top = CONFIG.hudHeight;
    const laneHeight = (CONFIG.canvas.height - top) / CONFIG.laneFuels.length;
    return top + laneHeight * laneIndex + laneHeight / 2;
  }

  // X where the stations begin — crossing this resolves a car (match check).
  function goalLineX() {
    return CONFIG.canvas.width - CONFIG.station.width;
  }

  /* =========================================================================
     LEVEL TUNING — difficulty derived from state.level.
     ========================================================================= */
  function levelTuning() {
    const lvl = state.level - 1; // level 1 => no scaling
    const spawnInterval = Math.max(
      CONFIG.perLevel.spawnIntervalMin,
      CONFIG.base.spawnInterval - lvl * CONFIG.perLevel.spawnIntervalStep
    );
    const carSpeed = Math.min(
      CONFIG.perLevel.carSpeedMax,
      CONFIG.base.carSpeed + lvl * CONFIG.perLevel.carSpeedStep
    );
    return { spawnInterval, carSpeed };
  }

  /* =========================================================================
     SPAWNER
     ========================================================================= */

  function spawnCar() {
    const keys = Object.keys(CONFIG.carModels);
    const model = CONFIG.carModels[keys[Math.floor(Math.random() * keys.length)]];

    // Start in a random lane so the player usually has to correct it.
    const lane = Math.floor(Math.random() * CONFIG.laneFuels.length);

    const car = {
      id: state.nextId++,
      model: model.name,
      fuel: model.fuel,
      lane,
      x: -CONFIG.car.width,
      y: laneCenterY(lane) - CONFIG.car.height / 2,
      width: CONFIG.car.width,
      height: CONFIG.car.height,
      status: "driving", // driving | refueling | leaving
      refuelTimer: 0,
      result: null,       // 'correct' | 'wrong' once resolved
    };
    state.cars.push(car);
  }

  // Maintain a minimum horizontal gap so freshly spawned cars don't overlap
  // a car that is still entering from the left.
  function laneIsClearToSpawn() {
    const minGap = CONFIG.car.width + 30;
    return !state.cars.some((c) => c.status === "driving" && c.x < minGap);
  }

  /* =========================================================================
     ACTIVE CAR — the frontmost still-driving car (largest x), player-steered.
     ========================================================================= */
  function activeCar() {
    let best = null;
    for (const c of state.cars) {
      if (c.status !== "driving") continue;
      if (!best || c.x > best.x) best = c;
    }
    return best;
  }

  /* =========================================================================
     INPUT — keyboard.
     ========================================================================= */
  function handleKeyDown(evt) {
    // Restart from the Game Over screen.
    if (state.gameOver) {
      if (evt.key === "r" || evt.key === "R" || evt.key === "Enter") {
        resetGame();
      }
      return;
    }

    const car = activeCar();
    if (!car) return;

    if (evt.key === "ArrowUp") {
      evt.preventDefault();
      car.lane = Math.max(0, car.lane - 1);
    } else if (evt.key === "ArrowDown") {
      evt.preventDefault();
      car.lane = Math.min(CONFIG.laneFuels.length - 1, car.lane + 1);
    }
  }
  window.addEventListener("keydown", handleKeyDown);

  /* =========================================================================
     UPDATE — advance the simulation by dt seconds.
     ========================================================================= */
  function update(dt) {
    if (state.gameOver) {
      tickFlash(dt);
      return;
    }

    const tuning = levelTuning();

    // Spawner.
    state.spawnTimer += dt;
    if (state.spawnTimer >= tuning.spawnInterval && laneIsClearToSpawn()) {
      state.spawnTimer = 0;
      spawnCar();
    }

    for (const car of state.cars) {
      // Smoothly tween toward the current lane's center (vertical lane hops).
      const targetY = laneCenterY(car.lane) - car.height / 2;
      const dy = targetY - car.y;
      const stepY = CONFIG.car.laneSwitchSpeed * dt;
      car.y += Math.abs(dy) <= stepY ? dy : Math.sign(dy) * stepY;

      switch (car.status) {
        case "driving":
          car.x += tuning.carSpeed * dt;
          if (car.x + car.width >= goalLineX()) resolveCar(car);
          break;
        case "refueling":
          car.refuelTimer -= dt;
          if (car.refuelTimer <= 0) car.status = "leaving";
          break;
        case "leaving":
          // Drive on off the right edge, then flag for removal.
          car.x += (tuning.carSpeed + 80) * dt;
          if (car.x > CONFIG.canvas.width + car.width) car._remove = true;
          break;
      }
    }

    state.cars = state.cars.filter((c) => !c._remove);
    tickFlash(dt);
  }

  // A car has reached the station at the end of its lane: score it.
  function resolveCar(car) {
    const laneFuel = CONFIG.laneFuels[car.lane];
    const correct = laneFuel === car.fuel;

    if (correct) {
      car.result = "correct";
      car.status = "refueling";
      car.refuelTimer = CONFIG.refuelSeconds;
      state.score += CONFIG.points.correct;
      addFlash(car, "#4ba82e", "+" + CONFIG.points.correct);

      // Level progression.
      state.clearedThisLevel++;
      if (state.clearedThisLevel >= CONFIG.carsPerLevel) {
        state.clearedThisLevel = 0;
        state.level++;
      }
    } else {
      car.result = "wrong";
      car.status = "leaving"; // no refuel; it just pulls away
      state.score = Math.max(0, state.score - CONFIG.points.wrongPenalty);
      state.lives--;
      addFlash(car, "#d6453b", "WRONG!");
      if (state.lives <= 0) {
        state.lives = 0;
        state.gameOver = true;
      }
    }
  }

  /* =========================================================================
     FLASH — short-lived feedback text near a docking car.
     ========================================================================= */
  function addFlash(car, color, text) {
    state.flash = {
      x: car.x + car.width / 2,
      y: car.y,
      color,
      text,
      life: 0.9,
    };
  }

  function tickFlash(dt) {
    if (!state.flash) return;
    state.flash.life -= dt;
    state.flash.y -= 30 * dt; // float upward
    if (state.flash.life <= 0) state.flash = null;
  }

  /* =========================================================================
     RENDER — draw current state. No game logic here.
     ========================================================================= */
  function render() {
    const { width, height } = CONFIG.canvas;
    ctx.clearRect(0, 0, width, height);

    drawLanes();
    state.cars.forEach(drawCar);
    drawFlash();
    drawHud();
    if (state.gameOver) drawGameOver();
  }

  function drawLanes() {
    const { width } = CONFIG.canvas;
    const goal = goalLineX();
    const laneHeight =
      (CONFIG.canvas.height - CONFIG.hudHeight) / CONFIG.laneFuels.length;

    CONFIG.laneFuels.forEach((fuelKey, i) => {
      const fuel = CONFIG.fuelTypes[fuelKey];
      const cy = laneCenterY(i);
      const laneTop = CONFIG.hudHeight + laneHeight * i;

      // Alternating lane background for readability.
      ctx.fillStyle = i % 2 === 0 ? "#2b2f36" : "#262a30";
      ctx.fillRect(0, laneTop, width, laneHeight);

      // Dashed centre guide line along the lane.
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 12]);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(goal, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Station block at the right end of the lane.
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

    // Body.
    ctx.fillStyle = fuel.color;
    ctx.fillRect(car.x, car.y, car.width, car.height);

    // Highlight the active (player-controlled) car + show steer hints.
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
    ctx.fillText(car.model, car.x + car.width / 2, car.y + car.height / 2);
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

    // HUD strip background.
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

    // Level (centre).
    ctx.textAlign = "center";
    ctx.fillStyle = "#4ba82e";
    ctx.fillText("Level " + state.level, width / 2, midY);

    // Lives (right) as filled/empty pips.
    ctx.textAlign = "right";
    ctx.font = "20px 'Segoe UI', Arial, sans-serif";
    let pips = "";
    for (let i = 0; i < CONFIG.lives; i++) pips += i < state.lives ? "● " : "○ ";
    ctx.fillStyle = "#d6453b";
    ctx.fillText("Lives " + pips.trim(), width - 20, midY);
  }

  function drawGameOver() {
    const { width, height } = CONFIG.canvas;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "#d6453b";
    ctx.font = "bold 48px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("GAME OVER", width / 2, height / 2 - 50);

    ctx.fillStyle = "#e8eaed";
    ctx.font = "24px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(
      "Final score: " + state.score + "   ·   Level " + state.level,
      width / 2,
      height / 2 + 4
    );

    ctx.fillStyle = "#9aa0a6";
    ctx.font = "18px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Press R to play again", width / 2, height / 2 + 48);
  }

  /* =========================================================================
     RESET / MAIN LOOP / BOOTSTRAP
     ========================================================================= */
  function resetGame() {
    state.cars = [];
    state.nextId = 1;
    state.spawnTimer = 0;
    state.score = 0;
    state.level = 1;
    state.lives = CONFIG.lives;
    state.clearedThisLevel = 0;
    state.gameOver = false;
    state.flash = null;
    spawnCar(); // start with one car already on the road
  }

  let lastTime = 0;
  function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function init() {
    resetGame();
    requestAnimationFrame(loop);
  }

  init();
})();
