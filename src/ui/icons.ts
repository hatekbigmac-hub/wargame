// Inline SVG icon set (no external assets, crisp at any size).
const svg = (body: string, color = 'currentColor') =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.15em">${body}</svg>`;

export const ICONS = {
  money: svg('<circle cx="12" cy="12" r="9" fill="#e8b44c33"/><path d="M15 8.5c-.8-1-2-1.5-3-1.5-1.8 0-3 1-3 2.3 0 3.2 6 1.8 6 5 0 1.4-1.3 2.4-3 2.4-1.2 0-2.4-.5-3.2-1.5M12 5v14"/>', '#f2c35a'),
  metal: svg('<path d="M4 16l3-7h10l3 7z" fill="#9fb4c833"/><path d="M4 16h16M7 9l2-4h6l2 4"/>', '#a9bed2'),
  fuel: svg('<path d="M12 3c3 4.5 6 7.5 6 11a6 6 0 01-12 0c0-3.5 3-6.5 6-11z" fill="#3a2a5a55"/>', '#b48cff'),
  food: svg('<path d="M12 21V8M12 12c-3 0-5-2-5-5 3 0 5 2 5 5zM12 12c3 0 5-2 5-5-3 0-5 2-5 5zM12 17c-3 0-5-2-5-5 3 0 5 2 5 5zM12 17c3 0 5-2 5-5-3 0-5 2-5 5z"/>', '#b9dd5a'),
  power: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="#ffd84a44"/>', '#ffd84a'),
  industry: svg('<path d="M3 21V11l5 3V11l5 3V7l4 0v14z" fill="#ff9a4a33"/><path d="M17 7V3h3v18"/>', '#ff9a4a'),
  research: svg('<path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/><path d="M7.5 15h9"/>', '#6fd3ff'),
  market: svg('<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 006 0zM19 7l-3 7a3 3 0 006 0zM8 21h8"/>', '#e8b44c'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', '#8fd0ff'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
  move: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  attack: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>', '#ff7a6a'),
  stop: svg('<rect x="6" y="6" width="12" height="12" fill="currentColor"/>'),
  hold: svg('<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>'),
  missile: svg('<path d="M5 19l4-1 9-9a3 3 0 00-4-4l-9 9-1 4zM14 6l4 4M5 19l-2 2"/>', '#ff9a6a'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>', '#ff8a80'),
  city: svg('<path d="M3 21h18M5 21V9l5-3v15M10 21V4l9 4v13M13 10h3M13 14h3M7 12h1M7 16h1"/>'),
  repair: svg('<path d="M14 7a4 4 0 00-5 5L3 18l3 3 6-6a4 4 0 005-5l-3 3-3-3z"/>', '#7de08f'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  select: svg('<rect x="3" y="3" width="18" height="18" stroke-dasharray="4 3"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>'),
  star: svg('<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" fill="currentColor"/>', '#e8b44c'),
  shield: svg('<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" fill="#6fd3ff33"/>', '#6fd3ff'),
  sword: svg('<path d="M14 4h6v6L9 21l-3-3zM5 14l5 5M3 21l3-3"/>', '#ff9a8a'),
  anchor: svg('<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H3a9 9 0 0018 0h-2M8 11h8"/>'),
  plane: svg('<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 4M12 17h.01"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  garrison: svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5"/>'),
};

export type IconName = keyof typeof ICONS;

export const RES_ICON: Record<string, string> = {
  money: ICONS.money,
  metal: ICONS.metal,
  fuel: ICONS.fuel,
  food: ICONS.food,
  power: ICONS.power,
  industry: ICONS.industry,
};
