# Škoda Charging & Refueling Station

A 2D top-down time-management browser game built with **pure Vanilla JavaScript, the HTML5 Canvas API, and CSS3** — no frameworks, no libraries, no build tools.

Arriving Škoda cars wait in a queue and must be routed to the correct fuel stand: select the front car, then click a matching empty stand. The car drives over, refuels, and leaves — freeing the stand.

## Cars & stands

| Car | Fuel | Stand |
| --- | --- | --- |
| Škoda Enyaq | Electric | Green |
| Škoda Fabia | Petrol | Red |
| Škoda Kodiaq | Diesel | Black |
| Škoda Octavia G-TEC | CNG | Blue |

> **Phase 1** ships the Green and Red stands (Electric + Petrol). Diesel and CNG are wired into the config and activate as soon as their stands are added.

## Run it

Just open `index.html` in a browser (built and tested for Microsoft Edge on Windows 11). No server or build step required.

## Files

- `index.html` — entry point and canvas
- `style.css` — layout and theming
- `game.js` — game loop, state, input, rendering
