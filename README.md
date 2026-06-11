# Škoda Charging & Refueling Station

A 2D top-down time-management browser game built with **pure Vanilla JavaScript, the HTML5 Canvas API, and CSS3** — no frameworks, no libraries, no build tools.

Škoda cars enter from the left across four lanes, each lane ending in a fuel station. Steer the highlighted (frontmost) car with **↑ / ↓** into the lane whose station matches its fuel. When a car reaches its station it joins that station's queue — and you take control of the next car. The car at the front of a queue loads for 3 seconds, then drives off and scores you a point. Send a car to the wrong station and it's a miss: you lose a life.

## Cars & stations

| Car | Needs | Station |
| --- | --- | --- |
| Škoda Fabia | Petrol | Red |
| Škoda Kodiaq | Diesel | Black |
| Škoda Octavia G-TEC | CNG | Blue |
| Škoda Enyaq | Electric (BEV) | Green |
| Any model, but muddy | A wash | Carwash |
| Police car (blue, lights) | Rush through any free station except the carwash | — |

## Languages

The UI is available in **English, Čeština, and Deutsch**. On the start menu, cycle the language with **← / →**; the choice is remembered in `localStorage` (and a first-time visitor's browser language is detected automatically). Škoda model names stay as-is across languages.

## Modes

Pick a mode on the start menu (**↑ / ↓** to choose, **Enter** to continue), then a short **how-to-play screen** shows the controls and the stations/cars present at level 1 before the game begins.

- **Kid mode** — relaxed: **5 lives**, **+1 life after every finished level** (capped at 5), and a **gentle speed ramp** that only speeds up on quiet levels: it *holds* its speed whenever a new element arrives (carwash, CNG, electric, police), reaching 220 by the finale.
- **Racing mode** — for grown-ups: **3 lives**, no refills, and a **faster ramp** (starts at 150, climbs to 300) using the same hold-on-new-element rule. Each mode's per-level car speed is an explicit `speedByLevel` table that's easy to hand-tune.

## Leaderboard

When a run ends — either by running out of lives or by finishing level 10 — you can type a name and save your **total score** (the sum across all levels you played) to a leaderboard. Boards are kept **separately for Kid and Racing modes** and persist in the browser via `localStorage`. The top scores for the highlighted mode are previewed on the start menu.

## Controls

- **↑ / ↓** — move the highlighted car up/down a lane (and navigate the menu)
- **Enter** — confirm menu choice · advance from the result screen · save your name
- **Backspace** — edit your name on the name-entry screen

## Scoring & difficulty

- **+1 point** for each car that finishes loading and leaves.
- **Lives depend on the mode** (5 in Kid mode, 3 in Racing); **−1 life** for every car sent to the wrong station. Zero lives = Game Over.
- Each **level lasts 60 seconds**, then a result screen shows your stats and a heads-up about what the next level brings — a new station, police cars, faster traffic, and (in Kid mode) the +1 life. Press Enter to continue. Lives and score carry across levels.
- **Level 1** is gentle — one car on the road at a time. From level 2 on, cars arrive more frequently and drive faster.
- **Stations unlock over time:** Red (Petrol) and Black (Diesel) from the start, the **Carwash at level 3** (dirty brown cars start arriving then), **Blue (CNG) at level 6**, and **Green (BEV/Electric) at level 9**. Only cars whose station is open will appear.
- **Car mix:** once the carwash is open, **~10% of cars are dirty**; the rest are split evenly across the other open fuels (so Petrol/Diesel stay roughly 50:50). Tunable via `CONFIG.dirtyChance`.
- A **dirty car is a normal model** (Fabia, Kodiaq, Octavia, Enyaq) that's just muddy — it keeps its model name **and its normal paint colour**, but wears brown mud splatter and must go to the carwash. So a red, petrol-coloured car covered in mud still needs the wash, not the red pump — spot the mud, not just the colour. That's the extra challenge.
- **Level 10 adds police cars** (about 1 in 6 arrivals): a police car has no fuel and is rushing to a case, so it must **pass straight through a station — no loading**. Steer it into **any free station of any kind except the carwash** and it rushes through for +1. If that station is busy (a car is queued or loading there) the police car would be forced to stop in the queue — that's a miss; sending it to the carwash is a miss too. Each miss costs a life.

## Run it

Just open `index.html` in a browser (built and tested for Microsoft Edge on Windows 11). No server or build step required.

## Files

- `index.html` — entry point and canvas
- `style.css` — layout and theming
- `game.js` — game loop, state, input, rendering
