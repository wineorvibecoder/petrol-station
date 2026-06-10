# Škoda Charging & Refueling Station

A 2D top-down time-management browser game built with **pure Vanilla JavaScript, the HTML5 Canvas API, and CSS3** — no frameworks, no libraries, no build tools.

Škoda cars stream in from the left across four lanes, each lane ending in a fuel station. Steer the highlighted (frontmost) car with **↑ / ↓** into the lane whose station matches its fuel. Correct station = points and a refuel; wrong station = a lost life. The longer you survive, the faster the cars come.

## Cars & stands

| Car | Fuel | Stand |
| --- | --- | --- |
| Škoda Enyaq | Electric | Green |
| Škoda Fabia | Petrol | Red |
| Škoda Kodiaq | Diesel | Black |
| Škoda Octavia G-TEC | CNG | Blue |

## Controls

- **↑ / ↓** — move the highlighted car up/down a lane
- **R** — restart after Game Over

## Difficulty

You start with 3 lives. Every few cars delivered correctly, the level rises: cars spawn more frequently and drive faster. Lose all your lives and it's Game Over.

## Run it

Just open `index.html` in a browser (built and tested for Microsoft Edge on Windows 11). No server or build step required.

## Files

- `index.html` — entry point and canvas
- `style.css` — layout and theming
- `game.js` — game loop, state, input, rendering
