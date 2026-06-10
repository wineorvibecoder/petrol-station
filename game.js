/* ===========================================================================
   Škoda Charging & Refueling Station — game logic (Phase 1)

   Pure Vanilla JS + Canvas 2D. No frameworks, no build step.
   Open index.html directly in a browser to run.

   Architecture overview (kept modular so timers/score/more stands drop in
   cleanly in later phases):

     CONFIG   - tunable constants & data tables (fuel types, sizes, speeds)
     state    - the single mutable game-state object
     Spawner  - decides when/what cars enter the queue
     Input    - translates clicks into selection / move commands
     update() - advances simulation (car movement + per-car state machine)
     render() - draws everything from current state (no logic here)
     loop()   - requestAnimationFrame driver tying update+render together

   Each Car runs a tiny state machine:
     'queued' -> 'moving' -> 'refueling' -> 'leaving' -> (removed)
   =========================================================================== */

(function () {
  "use strict";

  /* =========================================================================
     CONFIG — all tunables live here.
     ========================================================================= */
  const CONFIG = {
    canvas: { width: 960, height: 600 },

    // Fuel types map a car to the stand that can serve it.
    // `color` is shared between a car and its matching stand for clarity.
    fuelTypes: {
      ELECTRIC: { key: "ELECTRIC", label: "Electric", color: "#4ba82e", standLabel: "Green" },
      PETROL:   { key: "PETROL",   label: "Petrol",   color: "#d6453b", standLabel: "Red"   },
      // DIESEL / CNG defined for later phases (no stands yet, so not spawned).
      DIESEL:   { key: "DIESEL",   label: "Diesel",   color: "#2b2f36", standLabel: "Black" },
      CNG:      { key: "CNG",      label: "CNG",      color: "#3a78c2", standLabel: "Blue"  },
    },

    // Car model -> fuel type. Only models whose stand exists get spawned.
    carModels: {
      ENYAQ:   { name: "Enyaq",   fuel: "ELECTRIC" },
      FABIA:   { name: "Fabia",   fuel: "PETROL"   },
      KODIAQ:  { name: "Kodiaq",  fuel: "DIESEL"   },
      OCTAVIA: { name: "Octavia", fuel: "CNG"      },
    },

    car:   { width: 80, height: 44, speed: 240 }, // speed in px/second
    stand: { width: 120, height: 80 },

    queue: {
      x: 60,        // left margin of the queue column
      topY: 120,    // y of the first (front) car
      gap: 16,      // vertical gap between queued cars
    },

    refuelSeconds: 3,   // how long a car sits at a stand
    maxCarsOnScreen: 4, // spawner cap for Phase 1
    spawnInitial: 2,    // cars present at start
    spawnIntervalSeconds: 4, // try to add a car this often (up to the cap)
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
    cars: [],            // all active cars (any state)
    stands: [],          // fixed list of fuel stands
    selectedCarId: null, // id of the car the player has picked, or null
    nextId: 1,           // monotonic id generator
    spawnTimer: 0,       // seconds accumulator for the spawner
  };

  /* =========================================================================
     FACTORY HELPERS
     ========================================================================= */

  // Build the two Phase 1 stands (Green = Electric, Red = Petrol).
  function createStands() {
    const { width: cw } = CONFIG.canvas;
    const sw = CONFIG.stand.width;
    const standX = cw - sw - 80; // right side, with margin
    return [
      makeStand("ELECTRIC", standX, 140),
      makeStand("PETROL", standX, 320),
    ];
  }

  function makeStand(fuelKey, x, y) {
    return {
      fuel: fuelKey,
      x, y,
      width: CONFIG.stand.width,
      height: CONFIG.stand.height,
      occupantId: null, // id of the car currently parked here, or null
    };
  }

  // Create a car of a given model and append it to the queue.
  function spawnCar(modelKey) {
    const model = CONFIG.carModels[modelKey];
    const car = {
      id: state.nextId++,
      model: model.name,
      fuel: model.fuel,
      // Position is the car's top-left corner in canvas coordinates.
      x: -CONFIG.car.width, // start just off the left edge for a drive-in feel
      y: 0,
      width: CONFIG.car.width,
      height: CONFIG.car.height,
      status: "queued",     // queued | moving | refueling | leaving
      target: null,         // { x, y } movement goal, or null
      standRef: null,       // stand object once assigned
      refuelTimer: 0,       // counts down while refueling
    };
    state.cars.push(car);
    return car;
  }

  /* =========================================================================
     QUEUE MANAGEMENT
     ========================================================================= */

  // Cars still waiting to be assigned, in arrival order.
  function queuedCars() {
    return state.cars.filter((c) => c.status === "queued");
  }

  // Recompute the target slot for every queued car so they line up neatly.
  // The front car is index 0 (top of the column).
  function reflowQueue() {
    const q = queuedCars();
    q.forEach((car, i) => {
      car.target = {
        x: CONFIG.queue.x,
        y: CONFIG.queue.topY + i * (CONFIG.car.height + CONFIG.queue.gap),
      };
    });
  }

  // The front (first) waiting car — the only one selectable per the spec.
  function frontCar() {
    return queuedCars()[0] || null;
  }

  /* =========================================================================
     SPAWNER
     ========================================================================= */

  // Only spawn models whose matching stand currently exists on the board.
  function spawnableModelKeys() {
    const availableFuels = new Set(state.stands.map((s) => s.fuel));
    return Object.keys(CONFIG.carModels).filter((k) =>
      availableFuels.has(CONFIG.carModels[k].fuel)
    );
  }

  function trySpawn() {
    if (state.cars.length >= CONFIG.maxCarsOnScreen) return;
    const keys = spawnableModelKeys();
    if (keys.length === 0) return;
    const pick = keys[Math.floor(Math.random() * keys.length)];
    spawnCar(pick);
    reflowQueue();
  }

  /* =========================================================================
     INPUT — pointer handling.
     ========================================================================= */

  // Convert a DOM mouse event into logical canvas coordinates, accounting for
  // any CSS scaling of the canvas element.
  function eventToCanvas(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }

  function handleClick(evt) {
    const { x, y } = eventToCanvas(evt);

    // 1) If we clicked the front waiting car, select (or re-select) it.
    const front = frontCar();
    if (front && pointInRect(x, y, front)) {
      state.selectedCarId = front.id;
      return;
    }

    // 2) If a car is selected, check for a click on a matching empty stand.
    if (state.selectedCarId != null) {
      const car = state.cars.find((c) => c.id === state.selectedCarId);
      if (car) {
        const stand = state.stands.find((s) => pointInRect(x, y, s));
        if (stand && stand.occupantId === null && stand.fuel === car.fuel) {
          assignCarToStand(car, stand);
          state.selectedCarId = null;
          return;
        }
      }
    }

    // 3) Clicking empty space clears the current selection.
    state.selectedCarId = null;
  }

  // Send a car toward a stand and reserve that stand immediately so it can't
  // be double-booked.
  function assignCarToStand(car, stand) {
    stand.occupantId = car.id;
    car.standRef = stand;
    car.status = "moving";
    // Aim for the stand center so the car visually sits inside it.
    car.target = {
      x: stand.x + (stand.width - car.width) / 2,
      y: stand.y + (stand.height - car.height) / 2,
    };
    reflowQueue(); // remaining queued cars shuffle forward
  }

  canvas.addEventListener("click", handleClick);

  /* =========================================================================
     UPDATE — advance the simulation by dt seconds.
     ========================================================================= */

  function update(dt) {
    // Spawner tick.
    state.spawnTimer += dt;
    if (state.spawnTimer >= CONFIG.spawnIntervalSeconds) {
      state.spawnTimer = 0;
      trySpawn();
    }

    // Per-car state machine.
    for (const car of state.cars) {
      switch (car.status) {
        case "queued":
        case "moving":
        case "leaving":
          stepTowardTarget(car, dt);
          break;
        case "refueling":
          car.refuelTimer -= dt;
          if (car.refuelTimer <= 0) startLeaving(car);
          break;
      }
    }

    // Remove cars that have driven fully off-screen.
    state.cars = state.cars.filter((c) => !c._remove);
  }

  // Move a car toward car.target at a fixed speed. Returns true on arrival.
  function stepTowardTarget(car, dt) {
    if (!car.target) return true;
    const dx = car.target.x - car.x;
    const dy = car.target.y - car.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = CONFIG.car.speed * dt;

    if (dist <= stepLen || dist === 0) {
      // Snap to target and fire the per-status arrival handler.
      car.x = car.target.x;
      car.y = car.target.y;
      onArrive(car);
      return true;
    }

    car.x += (dx / dist) * stepLen;
    car.y += (dy / dist) * stepLen;
    return false;
  }

  // Called when a car reaches car.target.
  function onArrive(car) {
    if (car.status === "moving") {
      // Reached the stand — begin refueling.
      car.status = "refueling";
      car.refuelTimer = CONFIG.refuelSeconds;
      car.target = null;
    } else if (car.status === "leaving") {
      // Reached the off-screen exit — flag for removal.
      car._remove = true;
    }
    // 'queued' arrivals just settle into their slot; nothing else to do.
  }

  // Free the stand and send the car driving off the right edge.
  function startLeaving(car) {
    if (car.standRef) {
      car.standRef.occupantId = null;
      car.standRef = null;
    }
    car.status = "leaving";
    car.target = { x: CONFIG.canvas.width + car.width, y: car.y };
  }

  /* =========================================================================
     RENDER — draw current state. No game logic here.
     ========================================================================= */

  function render() {
    const { width, height } = CONFIG.canvas;
    ctx.clearRect(0, 0, width, height);

    drawBackground();
    state.stands.forEach(drawStand);
    state.cars.forEach(drawCar);
  }

  function drawBackground() {
    const { width, height } = CONFIG.canvas;

    // Queue lane label.
    ctx.fillStyle = "#1f2329";
    ctx.fillRect(40, 90, CONFIG.car.width + 40, height - 130);
    ctx.fillStyle = "#6b7280";
    ctx.font = "16px 'Segoe UI', Arial, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText("QUEUE", 52, 80);

    // Stands area label.
    ctx.fillText("STANDS", width - CONFIG.stand.width - 80, 80);
  }

  function drawStand(stand) {
    const fuel = CONFIG.fuelTypes[stand.fuel];

    // Stand pad: subtle fill, colored border to signal its fuel type.
    ctx.fillStyle = "#30343c";
    ctx.fillRect(stand.x, stand.y, stand.width, stand.height);
    ctx.lineWidth = 4;
    ctx.strokeStyle = fuel.color;
    ctx.strokeRect(stand.x, stand.y, stand.width, stand.height);

    // Highlight stands the selected car is allowed to use.
    const selectedCar = state.cars.find((c) => c.id === state.selectedCarId);
    const isValidTarget =
      selectedCar &&
      stand.occupantId === null &&
      stand.fuel === selectedCar.fuel;
    if (isValidTarget) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(stand.x - 3, stand.y - 3, stand.width + 6, stand.height + 6);
      ctx.setLineDash([]);
    }

    // Labels.
    ctx.fillStyle = fuel.color;
    ctx.font = "bold 16px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fuel.standLabel, stand.x + stand.width / 2, stand.y + 26);
    ctx.fillStyle = "#aab0b8";
    ctx.font = "13px 'Segoe UI', Arial, sans-serif";
    ctx.fillText(fuel.label, stand.x + stand.width / 2, stand.y + 46);
  }

  function drawCar(car) {
    const fuel = CONFIG.fuelTypes[car.fuel];

    // Body.
    ctx.fillStyle = fuel.color;
    ctx.fillRect(car.x, car.y, car.width, car.height);

    // Selection outline on the chosen car.
    if (car.id === state.selectedCarId) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffd400";
      ctx.strokeRect(car.x - 2, car.y - 2, car.width + 4, car.height + 4);
    }

    // Model label (white text reads on every fuel color used here).
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(car.model, car.x + car.width / 2, car.y + car.height / 2 - 6);

    // While refueling, show a tiny countdown so the wait is legible.
    if (car.status === "refueling") {
      ctx.font = "12px 'Segoe UI', Arial, sans-serif";
      ctx.fillText(
        "⛽ " + Math.ceil(car.refuelTimer) + "s",
        car.x + car.width / 2,
        car.y + car.height / 2 + 10
      );
    }
    ctx.textBaseline = "alphabetic"; // reset shared state
  }

  /* =========================================================================
     MAIN LOOP — requestAnimationFrame with delta time.
     ========================================================================= */

  let lastTime = 0;

  function loop(timestamp) {
    // dt in seconds; clamp to avoid huge jumps after a tab is backgrounded.
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  /* =========================================================================
     BOOTSTRAP
     ========================================================================= */

  function init() {
    state.stands = createStands();

    // Seed the queue with a couple of cars.
    for (let i = 0; i < CONFIG.spawnInitial; i++) {
      const keys = spawnableModelKeys();
      spawnCar(keys[i % keys.length]);
    }
    reflowQueue();
    // Snap initial cars straight to their queue slots (no drive-in on frame 1).
    queuedCars().forEach((c) => {
      if (c.target) {
        c.x = c.target.x;
        c.y = c.target.y;
      }
    });

    requestAnimationFrame(loop);
  }

  init();
})();
