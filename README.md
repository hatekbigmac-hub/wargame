# Steel Meridian — Global War Strategy

A 2D real-time global war strategy game that runs entirely in the browser. Pick any of **196 real countries** on a map with real borders, build armies and fleets, prepare offensives, ship troops across the sea, hunt submarines, fire missiles, research technology — and deal with AI neighbours that mobilise, declare war and sue for peace.

Built with **Phaser 3**, **TypeScript** and **Vite**. It has no backend and no external art or audio files: sprites, effects, sounds and music are generated at runtime, and the map is built from bundled Natural Earth data.

The interface is in **English** by default; **Russian** can be selected under *Settings → Language*.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run simtest    # headless AI-vs-AI soak test of the whole simulation
npm run qa         # browser gameplay test (needs `npm run dev` running and Playwright installed)
npm run i18n:check # lists UI strings that have no Russian translation
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
| Missile strike | **Missile Strike** button in the top bar or M, then click a target |
| Prepare an offensive | O (or *Prepare Offensive*), then click the target city |
| Board a transport · unload | Right-click your transport with land units selected (or B) · right-click a coast with the transport selected (or U) |
| Return aircraft to base | L |
| Center the camera · cycle idle units | C · Tab |
| Control groups | Ctrl + 1–9 to assign, 1–9 to recall |
| Pause · change speed | Space · + / − (or the 1× 2× 4× buttons) |
| Research | R |
| Quick save · quick load | F5 · F9 |
| Field manual · debug overlay | F1 · F3 or ` |

**War and peace:** the world starts at peace. An AI country that feels strong picks a weaker neighbour, **mobilises** troops on the border (you get a warning, a countdown chip under the top bar and red arrows on the map), and **declares war** about two days later. Wars end in ceasefires; AI countries may offer you one. The Diplomacy window (globe button) lists every country with search and filters, and lets you declare war, propose a ceasefire and answer peace offers.

**Offensives:** select land units, press *Prepare Offensive* (O) and click a foreign city. The troops march to a staging area on your side of the border and prepare there — up to **+25% attack** after 24 hours. Launch the operation from the chip under the top bar; war is declared for you (after a confirmation) if you are not already at war.

**Missiles:** press **Missile Strike** in the top bar (the number shows how many launchers are ready) and click an enemy unit or city. The nearest ready launcher in range fires — city missile batteries (every major capital starts with one), Missile Launchers and Missile Ships.

**Crossing the sea:** land units never swim. Build a **Transport Ship** in a port; it carries up to 6 infantry, tank or artillery units. Right-click the transport with troops selected to board, then select the transport and right-click a coast to land them. If the transport sinks, everyone aboard is lost.

**Capturing a city:** bring its defences down to zero (artillery, tanks, ships and missiles all help), then move land units inside with no defenders present. The capture ring fills up and the city switches sides, and its territory changes colour on the map.

**Winning:** control 60% of the world's cities or eliminate every rival. You lose if you lose all of your cities.

## Features

- **World map:** the real world with 196 countries and their real (de facto) borders, 517 real cities, lakes, rivers, mountain ranges, straits and canals, an animated ocean with depth shading, atlas-style country names, front lines and fog of war. There are five map layers: political, terrain, resources, military and strategic value.
- **Countries:** every country is playable. A searchable country picker shows capital, cities, ports, neighbours, the country's real armed forces and its world military ranking.
- **Real-world militaries:** each country starts with forces derived from approximate real figures (active personnel, tanks, artillery, submarines, destroyers and frigates, corvettes, amphibious ships, aircraft carriers, missile forces, air defence and defence budget; `src/data/military.ts`, rounded public estimates circa 2023–24). One game unit stands for roughly a brigade or squadron, on a square-root scale so that great powers lead clearly without micro-states disappearing. Equipment quality follows income level (older, lighter tanks in poorer armies), modern militaries start with the technologies they already field, only countries with real missile forces get capital missile batteries (the player always gets one), and a defence budget pays for the standing forces so large armies stay affordable.
- **Cities:** each has its own population, industry, resources, port/airport, defences, garrison, a production queue and 11 upgradeable buildings (factories, power plants, mines, refineries, farms, barracks, shipyards, fortifications, radar, missile batteries and research labs).
- **Land units (11 types):** infantry, mechanized infantry, elite infantry, recon, engineers, light, medium and heavy tanks, artillery, missile launchers and anti-air. Tank turrets rotate independently of the hull.
- **Naval units (8 types):** patrol boats, transport ships, frigates, destroyers, cruisers, missile ships, submarines and aircraft carriers. Transports carry up to 6 land units; the AI uses them for seaborne invasions.
- **Aviation (5 types):** fighter jets, strike aircraft, strategic bombers, attack helicopters and transport helicopters (2 infantry units, over any terrain or sea). Aircraft fly straight lines, circle over their targets (helicopters hover), burn fuel while airborne and return on their own to the nearest airfield or carrier to refuel and repair. They are built in cities with an airport or an Air Base, shot down by anti-air, warships, fighters and city flak, cannot capture cities and cannot be hit by missiles in flight. Every country starts with an air force scaled from its real one, and the AI uses fighters for air cover, strike aircraft and helicopters against troops, and bombers against cities.
- **Submarines:** stay hidden until an enemy ship with sonar gets close, show up when they fire, and use torpedoes.
- **Missiles:** fly an arcing path with a smoke trail, can be intercepted by anti-air, frigates and cruisers, and explode on impact.
- **Combat:** one system handles land, naval, city and air-strike combat. Damage is data-driven, terrain gives cover, and units gain veterancy. Damaged units repair while they sit in friendly cities or ports, faster with engineers nearby, and the **Repair** order sends them to the nearest base.
- **Economy:** money, metal, fuel, food, electricity and industrial capacity, plus upkeep, shortages and a commodity market.
- **Technology:** 31 technologies in four branches (Army, Navy, Air & Missiles, Industry), including jet aircraft, rotary wing, strategic bombing, aerial refuelling and stealth aircraft.
- **AI:** each country defends threatened cities, saves up for a planned army mix, researches and builds infrastructure. Strong countries plan wars (target choice, mobilisation, declaration), run land offensives and amphibious operations with transports, patrol and hunt at sea, fire missiles, and make peace when a war drags on or goes badly.
- **Diplomacy:** peace by default, declarations of war, ceasefires, AI peace offers and mobilisation warnings.
- **Localisation:** English and Russian UI, including country and city names (`src/i18n.ts`, `src/i18n.ru.ts`).
- **World events:** 14 data-driven events, including booms, shortages, strikes, unrest, rebellions, oil discoveries and volunteers.
- **Save/load:** versioned, validated and compact saves in localStorage, with 3 slots, an autosave and quick save/load.
- **Audio:** sound effects and generative ambient music synthesised with Web Audio. Real samples can be added with `AudioManager.registerSample()`.
- **VFX:** explosions, smoke, fire, sparks, debris, water splashes, ship wakes, missile trails, torpedo bubbles, interception beams, shockwaves, scorch marks, capture bursts and damage numbers.
- **Debug overlay (F3):** FPS, simulation step time, pathfinding and AI timings, visibility statistics and cheats. Set `DEBUG_ALLOWED` in `src/config.ts` to `false` to remove it.

## Architecture

```
src/
  config.ts            world projection, constants, debug flag
  core/                types, event bus, RNG/noise, spatial hash, game state, Simulation orchestrator, settings
  i18n.ts, i18n.ru.ts  localisation (English keys, Russian dictionary)
  data/                data-driven content: world.json (countries, cities, lakes, rivers), factions, units, buildings, techs, events
  military/            player offensive planning (staging, preparation, launch)
  map/                 WorldGeo (grid, terrain, regions), Pathfinding (A*), MapRenderer (terrain/territory/fog)
  units/               UnitSystem (orders, movement), UnitViews (sprites)
  combat/              CombatSystem (visibility, sonar, targeting, projectiles, missiles, damage)
  cities/              CitySystem (defence, capture), CityViews
  economy/             EconomySystem (income, upkeep, power, market)
  production/          ProductionSystem (queues)
  technology/          TechSystem (research, modifiers, unit stats)
  diplomacy/           war declarations, ceasefires, peace offers
  ai/                  AISystem (war planning, mobilisation, offensives, amphibious ops, economy)
  events/              WorldEventSystem
  effects/             procedural Textures, Effects (particles & projectiles)
  audio/               AudioManager (Web Audio synthesis + music)
  input/               InputController (camera & commands)
  save/                SaveSystem
  ui/                  DOM overlay: HUD, windows, menus, dialogs
  scenes/              Boot, Menu, Game
scripts/               world data builder, headless sim test, i18n check and browser QA helpers (dev only)
```

The **simulation** (`core/Simulation.ts` and every system it owns) does not depend on Phaser or the DOM. It runs at a fixed 10 Hz and emits events that the views, effects, audio and UI subscribe to. This separation is why `npm run simtest` can play whole AI-vs-AI wars in Node, and it is also the natural place to hook in multiplayer later.

**Map data:** `scripts/build-world-data.mjs` downloads Natural Earth 1:50m countries, populated places, lakes and rivers, groups territories by sovereign state, simplifies the shapes and writes `src/data/world.json` (about 560 KB). The game only uses the bundled JSON, so no network access is needed at runtime.

**Adding content:** units, buildings, technologies and world events are appended to the matching data file; UI strings go through `t()` and get a Russian entry in `src/i18n.ru.ts`. No system code needs to change.

**Room to grow:** alliances, trade, sanctions and espionage (on top of the relations map), more languages (add a dictionary next to `i18n.ru.ts`), and nuclear technology.

## Credits

Map data made with [Natural Earth](https://www.naturalearthdata.com/) (public domain). Borders show de facto control and are not a political statement. Fonts: Oxanium and Rajdhani (SIL OFL).
