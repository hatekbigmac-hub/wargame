# Steel Meridian — Global War Strategy

A 2D real-time global war strategy game that runs entirely in the browser. Pick one of nine fictional world powers, take control of cities across an Earth-inspired map, build armies and fleets, hunt submarines, fire missiles, research technology, and fight an AI that is doing all of the same.

Built with **Phaser 3**, **TypeScript** and **Vite**. It has no backend and no external art or audio files: the map, sprites, effects, sounds and music are all generated at runtime.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run simtest    # headless AI-vs-AI soak test of the whole simulation
```

The production build is a static site. Asset paths are relative (`base: './'`), so the `dist/` folder works from a domain root, a GitHub Pages sub-path, Netlify, Vercel or any static host.

### Deploying to GitHub Pages
`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main`. To turn it on, open **Settings → Pages** in the repository and set **Source: GitHub Actions**.

## How to play

| Action | Control |
|---|---|
| Select a unit or city | Left click |
| Add to the selection / box select | Shift + click / Shift + drag |
| Select every unit of one type on screen | Double click |
| Move · attack a unit · assault a city | Right click |
| Pan the map | Left, right or middle drag · arrow keys · screen edges |
| Zoom | Mouse wheel · Q / E |
| Attack-move | A, then click |
| Stop · hold position | S · H |
| Missile strike | M, then click a target |
| Center the camera · cycle idle units | C · Tab |
| Control groups | Ctrl + 1–9 to assign, 1–9 to recall |
| Pause · change speed | Space · + / − (or the 1× 2× 4× buttons) |
| Research | R |
| Quick save · quick load | F5 · F9 |
| Field manual · debug overlay | F1 · F3 or ` |

**Capturing a city:** bring its defences down to zero (artillery, tanks, ships and missiles all help), then move land units inside with no defenders present. The capture ring fills up and the city switches sides, and its territory changes colour on the map.

**Winning:** control 60% of the world's cities or eliminate every rival. You lose if you lose all of your cities.

## Features

- **World map:** a stylised Earth with 9 factions, 212 cities, fractal coastlines, biomes, mountain ranges, rivers, straits and canals, an animated ocean with depth shading, organic territory borders, and fog of war. There are five map layers: political, terrain, resources, military and strategic value.
- **Cities:** each has its own population, industry, resources, port/airport, defences, garrison, a production queue and 11 upgradeable buildings (factories, power plants, mines, refineries, farms, barracks, shipyards, fortifications, radar, missile batteries and research labs).
- **Land units (11 types):** infantry, mechanized infantry, elite infantry, recon, engineers, light, medium and heavy tanks, artillery, missile launchers and anti-air. Tank turrets rotate independently of the hull.
- **Naval units (7 types):** patrol boats, frigates, destroyers, cruisers, missile ships, submarines and aircraft carriers. Land units board transports automatically when they cross water.
- **Submarines:** stay hidden until an enemy ship with sonar gets close, show up when they fire, and use torpedoes.
- **Missiles:** fly an arcing path with a smoke trail, can be intercepted by anti-air, frigates and cruisers, and explode on impact.
- **Combat:** one system handles land, naval, city and air-strike combat. Damage is data-driven, terrain gives cover, and units gain veterancy.
- **Economy:** money, metal, fuel, food, electricity and industrial capacity, plus upkeep, shortages and a commodity market.
- **Technology:** 28 technologies in four branches (Army, Navy, Air & Missiles, Industry). Air units are prepared as future content.
- **AI:** each faction defends threatened cities, saves up for a planned army mix, researches, builds infrastructure, runs attack operations, patrols and hunts at sea, and fires missiles.
- **Diplomacy:** basic war and ceasefire.
- **World events:** 14 data-driven events, including booms, shortages, strikes, unrest, rebellions, oil discoveries and volunteers.
- **Save/load:** versioned and validated saves in localStorage, with 3 slots, an autosave and quick save/load.
- **Audio:** sound effects and generative ambient music synthesised with Web Audio. Real samples can be added with `AudioManager.registerSample()`.
- **VFX:** explosions, smoke, fire, sparks, debris, water splashes, ship wakes, missile trails, torpedo bubbles, interception beams, shockwaves, scorch marks, capture bursts and damage numbers.
- **Debug overlay (F3):** FPS, simulation step time, pathfinding and AI timings, visibility statistics and cheats. Set `DEBUG_ALLOWED` in `src/config.ts` to `false` to remove it.

## Architecture

```
src/
  config.ts            world projection, constants, debug flag
  core/                types, event bus, RNG/noise, spatial hash, game state, Simulation orchestrator, settings
  data/                data-driven content: factions, cities, units, buildings, techs, events, geography
  map/                 WorldGeo (grid, terrain, regions), Pathfinding (A*), MapRenderer (terrain/territory/fog)
  units/               UnitSystem (orders, movement), UnitViews (sprites)
  combat/              CombatSystem (visibility, sonar, targeting, projectiles, missiles, damage)
  cities/              CitySystem (defence, capture), CityViews
  economy/             EconomySystem (income, upkeep, power, market)
  production/          ProductionSystem (queues)
  technology/          TechSystem (research, modifiers, unit stats)
  diplomacy/           war / ceasefire
  ai/                  AISystem (priority-based strategic AI)
  events/              WorldEventSystem
  effects/             procedural Textures, Effects (particles & projectiles)
  audio/               AudioManager (Web Audio synthesis + music)
  input/               InputController (camera & commands)
  save/                SaveSystem
  ui/                  DOM overlay: HUD, windows, menus, dialogs
  scenes/              Boot, Menu, Game
scripts/               headless sim test and browser QA helpers (dev only)
```

The **simulation** (`core/Simulation.ts` and every system it owns) does not depend on Phaser or the DOM. It runs at a fixed 10 Hz and emits events that the views, effects, audio and UI subscribe to. This separation is why `npm run simtest` can play whole AI-vs-AI wars in Node, and it is also the natural place to hook in multiplayer later.

**Adding content:** add a faction in `data/factions.ts` and give it cities in `data/cities.ts`. Add units, buildings, technologies and world events by appending entries to the matching data file. No system code needs to change.

**Room to grow:** air units (`domain: 'air'` definitions and future techs already exist), alliances, trade, sanctions and espionage (on top of the relations map), radar and advanced air defence (the detection and interception systems are already in place), and nuclear technology.
