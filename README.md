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
| Dirty car (brown) | A wash | Carwash |

## Controls

- **↑ / ↓** — move the highlighted car up/down a lane
- **Enter** — start the next level from the result screen
- **R** — restart after Game Over

## Scoring & difficulty

- **+1 point** for each car that finishes loading and leaves.
- **3 lives**; **−1 life** for every car sent to the wrong station. Zero lives = Game Over.
- Each **level lasts 60 seconds**, then a result screen shows your stats; press Enter to continue. Lives and score carry across levels.
- **Level 1** is gentle — one car on the road at a time. From level 2 on, cars arrive more frequently and drive faster.
- **Stations unlock over time:** Red (Petrol) and Black (Diesel) from the start, **Blue (CNG) at level 3**, **Green (BEV/Electric) at level 6**, and the **Carwash at level 9** (dirty brown cars start arriving then). Only cars whose station is open will appear.
- **Level 10 is a doubled finale:** every open kind gets two stations/lanes (10 lanes in all).

## Run it

Just open `index.html` in a browser (built and tested for Microsoft Edge on Windows 11). No server or build step required.

## Files

- `index.html` — entry point and canvas
- `style.css` — layout and theming
- `game.js` — game loop, state, input, rendering
