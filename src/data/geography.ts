// Supplementary geography in lon/lat pairs (flattened [lon, lat, ...]): straits, mountain
// ranges and biome zones. Coastlines, borders, lakes and rivers come from world.json.

export interface GeoShape {
  name: string;
  pts: number[];
}

export interface GeoLine {
  name: string;
  pts: number[];
  width?: number; // degrees
  high?: boolean;
  bridge?: boolean;
}

export interface BiomeZone {
  kind: 'desert' | 'jungle' | 'ice' | 'forest' | 'steppe';
  lon: number;
  lat: number;
  rx: number;
  ry: number;
  strength: number;
}

/**
 * Narrow straits carved as navigable water. `bridge` straits (bridges, tunnels, canals with
 * land crossings) can also be crossed by land units; others need transport ships.
 */
export const STRAITS: GeoLine[] = [
  { name: 'Gibraltar', pts: [-7, 35.9, -5.7, 35.95, -4.6, 36.1] },
  { name: 'Bosphorus', pts: [25.8, 39.9, 26.5, 40.35, 27.5, 40.7, 28.9, 40.95, 29.2, 41.35], bridge: true },
  { name: 'Suez', pts: [32.35, 31.5, 32.45, 30.4, 32.6, 29.7, 33.2, 28.5, 34, 27.5], bridge: true },
  { name: 'Danish Straits', pts: [10.9, 57.4, 10.95, 56.3, 10.95, 55.3, 11.5, 54.7], bridge: true },
  { name: 'Oresund', pts: [12.2, 56.4, 12.75, 55.9, 12.8, 55.3], bridge: true },
  { name: 'English Channel', pts: [-5, 49.6, -1, 50.15, 1.3, 50.95, 2.3, 51.5], bridge: true },
  { name: 'North Channel', pts: [-5.2, 54.2, -5.55, 55.0, -6.2, 55.7] },
  { name: 'Irish Sea', pts: [-5.8, 51.4, -5.5, 52.5, -5.0, 53.6, -4.9, 54.2] },
  { name: 'Hormuz', pts: [55.2, 26.2, 56.3, 26.65, 57.2, 25.9] },
  { name: 'Bab el Mandeb', pts: [42.4, 13.9, 43.35, 12.55, 44.2, 11.9] },
  { name: 'Gulf of Finland', pts: [22.5, 59.7, 26, 59.95, 29.4, 60.0] },
  { name: 'Tsugaru', pts: [139.6, 41.5, 141.9, 41.55], bridge: true },
  { name: 'Kanmon', pts: [130.6, 34.1, 131.2, 33.8], bridge: true },
  { name: 'Sunda', pts: [105.3, -5.4, 105.6, -6.3] },
  { name: 'Malacca', pts: [97.5, 5.5, 100.2, 3.2, 102.8, 1.3, 104.6, 1.1] },
  { name: 'Panama Canal', pts: [-79.95, 9.5, -79.7, 9.1, -79.45, 8.75], bridge: true },
  { name: 'Cook Strait', pts: [174.1, -40.9, 174.7, -41.5] },
  { name: 'Kerch', pts: [36.5, 45.6, 36.6, 45.0], bridge: true },
  { name: 'Messina', pts: [15.55, 38.4, 15.6, 37.95], bridge: true },
  { name: 'Tatar Strait', pts: [141.2, 53.5, 141.5, 51.5] },
  { name: 'La Perouse', pts: [141.6, 45.8, 142.3, 45.6] },
  { name: 'Palk Strait', pts: [79.3, 9.6, 79.8, 9.2, 80.0, 10.0] },
  { name: 'Belle Isle', pts: [-57.5, 51.2, -56.2, 51.9] },
  { name: 'Strait of Georgia', pts: [-123.6, 48.4, -124.3, 49.4, -125.3, 50.2] },
  { name: 'Dardanelles', pts: [26.2, 40.0, 26.6, 40.3], bridge: true },
  { name: 'Johor', pts: [103.6, 1.42, 104.0, 1.42], bridge: true },
  { name: 'Bass Strait', pts: [144.5, -39.4, 146.5, -39.8, 148, -39.9] },
];

export const MOUNTAINS: GeoLine[] = [
  { name: 'Alaska Range', pts: [-153, 62.3, -148, 63.3, -142, 62], width: 1.4, high: true },
  { name: 'Coast Mountains', pts: [-136, 59.5, -130, 55.5, -125, 51.5], width: 1.3 },
  { name: 'Rockies', pts: [-128, 59, -122, 54, -117, 50, -112, 46, -109, 43, -106.5, 40, -106, 36, -105.5, 33], width: 2.2, high: true },
  { name: 'Sierra Nevada', pts: [-122, 41, -120, 38.5, -118.3, 36], width: 1.0 },
  { name: 'Sierra Madre', pts: [-109, 29, -105.5, 25, -103, 21.5, -99, 19, -96, 17], width: 1.4 },
  { name: 'Appalachians', pts: [-85, 34.2, -81, 37, -78.5, 39.5, -76, 41.5, -73, 43.5, -70.5, 45.2], width: 1.2 },
  { name: 'Andes', pts: [-73.5, 10, -75.8, 5, -78, 0, -79, -5, -76.5, -10, -72.5, -15, -68.5, -19.5, -68.2, -24, -69.8, -29, -70.2, -34, -71.3, -39, -72.2, -44, -73.2, -49, -72.5, -53], width: 2.0, high: true },
  { name: 'Guiana Highlands', pts: [-65, 5, -61, 5.3, -58, 4.2], width: 1.2 },
  { name: 'Pyrenees', pts: [-1.6, 43, 0.8, 42.7, 2.8, 42.5], width: 0.8 },
  { name: 'Alps', pts: [5.8, 44.2, 7, 45.8, 8.5, 46.3, 10.5, 46.5, 12.5, 47, 15.3, 47.4], width: 1.3, high: true },
  { name: 'Apennines', pts: [9.5, 44.3, 12, 43.3, 14, 41.8, 15.8, 40.3, 16.2, 38.8], width: 0.8 },
  { name: 'Dinaric Alps', pts: [15, 45.2, 17.5, 43.8, 19.5, 42.5, 20.8, 40.5], width: 1.0 },
  { name: 'Carpathians', pts: [17.5, 49.3, 20.5, 49.3, 23.5, 48.5, 25.2, 47.4, 25.8, 45.8, 23.5, 45.4, 22.2, 44.9], width: 1.0 },
  { name: 'Scandinavian Mts', pts: [6.5, 60, 8.5, 61.8, 12, 63.2, 14.5, 65.8, 17, 67.8, 20, 69.2], width: 1.4 },
  { name: 'Caucasus', pts: [37.5, 44.4, 41, 43.3, 44, 42.6, 46.5, 41.9, 49, 41.1], width: 1.1, high: true },
  { name: 'Urals', pts: [60, 68, 60.2, 64, 59.5, 60, 59, 56.5, 58.5, 53, 58.5, 50.5], width: 1.3 },
  { name: 'Taurus', pts: [29.5, 37, 33, 36.9, 36.5, 37.6, 40, 38.3, 43.5, 38.6], width: 1.1 },
  { name: 'Zagros', pts: [44.5, 36.5, 47, 34, 49.5, 32, 52, 30, 55, 28.3, 57.5, 27.5], width: 1.4 },
  { name: 'Elburz', pts: [47.5, 37.5, 50, 36.6, 53.5, 36.4, 57, 37.2], width: 0.9 },
  { name: 'Hindu Kush', pts: [64.5, 34.2, 68, 34.8, 71, 35.8, 73.5, 36.6], width: 1.4, high: true },
  { name: 'Pamir', pts: [71, 38.5, 73.5, 38.8, 75.5, 38], width: 1.4, high: true },
  { name: 'Himalayas', pts: [73.5, 35, 76.5, 33.5, 79.5, 31, 82.5, 29.4, 85, 28.2, 88, 27.8, 91, 28, 94, 28.6, 96.5, 28.7], width: 1.8, high: true },
  { name: 'Tibetan Plateau', pts: [80, 33.8, 84, 33.3, 88, 32.8, 92, 32.5, 96, 31.8, 99, 30.5], width: 2.4 },
  { name: 'Kunlun', pts: [76, 36.6, 80, 36, 84, 36, 88, 36.2, 92, 36, 96, 35.5, 100, 35], width: 1.3, high: true },
  { name: 'Tian Shan', pts: [69, 41.8, 73, 41.8, 77, 42, 80, 42.3, 84, 43, 88, 43.3, 92, 43.5], width: 1.4, high: true },
  { name: 'Altai', pts: [83.5, 50.5, 87, 49.8, 90, 48.7, 93, 47.7, 97, 46.8], width: 1.3 },
  { name: 'Sayan', pts: [89, 52.8, 94, 52.4, 98.5, 52, 102.5, 51.5], width: 1.2 },
  { name: 'Verkhoyansk', pts: [127, 70, 129.5, 67, 133, 64, 136.5, 61.5], width: 1.4 },
  { name: 'Chersky', pts: [138, 68.5, 143, 66.5, 148, 64.5, 153, 62.8], width: 1.4 },
  { name: 'Kamchatka Range', pts: [158, 57.5, 159.5, 55.5, 158.5, 53.5], width: 0.9, high: true },
  { name: 'Greater Khingan', pts: [120, 52, 120.5, 48, 119, 44.5], width: 1.0 },
  { name: 'Qinling', pts: [103, 34.2, 106, 33.9, 109, 33.8, 111.5, 33.6], width: 0.9 },
  { name: 'Yunnan Hills', pts: [98.5, 26, 101.5, 26.5, 104.5, 26.3, 108, 25.7, 111, 25.3], width: 1.2 },
  { name: 'Annamite', pts: [103.5, 20, 105.5, 17.5, 107.5, 15, 108, 12.5], width: 0.9 },
  { name: 'Western Ghats', pts: [73.8, 20, 74.2, 16, 75.2, 12.5, 76.8, 9.5], width: 0.7 },
  { name: 'Japanese Alps', pts: [136.5, 35, 137.8, 36, 138.8, 37.3, 140.2, 39.5, 140.8, 41], width: 0.6 },
  { name: 'Atlas', pts: [-9, 31, -6, 32, -3, 33.2, 0, 34.3, 3, 35.6, 7, 35.6, 9.5, 35.8], width: 1.1 },
  { name: 'Ethiopian Highlands', pts: [37.3, 14.5, 38.5, 12, 39.2, 9.5, 38.5, 7, 37, 6], width: 1.6 },
  { name: 'East African Rift', pts: [30, 0.5, 29.5, -3, 30.5, -7, 33.5, -9.5, 35.5, -13], width: 1.0 },
  { name: 'Drakensberg', pts: [26.5, -32.5, 28.5, -30.5, 29.8, -28.5, 30.8, -25.5], width: 1.0 },
  { name: 'Hejaz', pts: [35.5, 28.5, 37.5, 25.5, 39.5, 22, 41.8, 18.5, 43.8, 15], width: 1.0 },
  { name: 'Great Dividing Range', pts: [144.8, -15.5, 146, -19.5, 148.3, -23, 150.5, -27, 151, -30.5, 149.8, -34, 148.2, -36.5, 146, -37.5], width: 1.1 },
  { name: 'Southern Alps', pts: [167.5, -45.8, 169.5, -44.2, 171.3, -43, 172.8, -41.9], width: 0.8, high: true },
  { name: 'New Guinea Highlands', pts: [136, -3.8, 139.5, -4.3, 143, -5.5, 145.5, -6.3, 147.5, -8], width: 1.0, high: true },
  { name: 'Brooks Range', pts: [-162, 68.3, -155, 68.2, -148, 68.4, -142, 69], width: 1.0 },
];

export const BIOME_ZONES: BiomeZone[] = [
  { kind: 'ice', lon: -41, lat: 74, rx: 15, ry: 9, strength: 1.3 },
  { kind: 'desert', lon: -5, lat: 23, rx: 13, ry: 7.5, strength: 1.2 },
  { kind: 'desert', lon: 12, lat: 24, rx: 12, ry: 7.5, strength: 1.2 },
  { kind: 'desert', lon: 27, lat: 23, rx: 8, ry: 7, strength: 1.2 },
  { kind: 'desert', lon: 46, lat: 23, rx: 9, ry: 6.5, strength: 1.2 },
  { kind: 'desert', lon: 40.5, lat: 31.5, rx: 4.5, ry: 2.5, strength: 0.9 },
  { kind: 'desert', lon: 57, lat: 31.5, rx: 6, ry: 4, strength: 0.9 },
  { kind: 'desert', lon: 71, lat: 27, rx: 3.5, ry: 3, strength: 0.9 },
  { kind: 'desert', lon: 83, lat: 39, rx: 7, ry: 2.5, strength: 1.1 },
  { kind: 'desert', lon: 104, lat: 43, rx: 9, ry: 3.5, strength: 1.0 },
  { kind: 'steppe', lon: 62, lat: 46, rx: 12, ry: 4, strength: 1.0 },
  { kind: 'steppe', lon: 105, lat: 47, rx: 10, ry: 3, strength: 0.8 },
  { kind: 'desert', lon: 21, lat: -23, rx: 5, ry: 5, strength: 1.0 },
  { kind: 'desert', lon: 15, lat: -23, rx: 2.2, ry: 5.5, strength: 1.0 },
  { kind: 'desert', lon: 126, lat: -25, rx: 9, ry: 6.5, strength: 1.1 },
  { kind: 'desert', lon: 137, lat: -26, rx: 6, ry: 5, strength: 1.0 },
  { kind: 'desert', lon: -113, lat: 32.5, rx: 4.5, ry: 4, strength: 1.0 },
  { kind: 'desert', lon: -105, lat: 28.5, rx: 3.5, ry: 3, strength: 0.9 },
  { kind: 'desert', lon: -69.8, lat: -23, rx: 1.6, ry: 5.5, strength: 1.1 },
  { kind: 'steppe', lon: -68, lat: -45, rx: 3.5, ry: 5.5, strength: 0.9 },
  { kind: 'steppe', lon: -102, lat: 40, rx: 5, ry: 8, strength: 0.8 },
  { kind: 'desert', lon: 46, lat: 7, rx: 4, ry: 4, strength: 0.8 },
  { kind: 'jungle', lon: -63, lat: -4, rx: 13, ry: 7.5, strength: 1.2 },
  { kind: 'jungle', lon: 20, lat: 0, rx: 10, ry: 5.5, strength: 1.2 },
  { kind: 'jungle', lon: -6, lat: 7, rx: 8, ry: 2.5, strength: 0.9 },
  { kind: 'jungle', lon: 102, lat: 13, rx: 5, ry: 8, strength: 0.9 },
  { kind: 'jungle', lon: 112, lat: -2, rx: 15, ry: 5.5, strength: 1.2 },
  { kind: 'jungle', lon: 142, lat: -5, rx: 8, ry: 3, strength: 1.1 },
  { kind: 'jungle', lon: -86, lat: 13, rx: 5, ry: 4, strength: 0.9 },
  { kind: 'jungle', lon: 122, lat: 10, rx: 5, ry: 6, strength: 0.9 },
  { kind: 'forest', lon: -82, lat: 38, rx: 9, ry: 7, strength: 0.8 },
  { kind: 'forest', lon: -48, lat: -25, rx: 5, ry: 5, strength: 0.6 },
  { kind: 'forest', lon: 115, lat: 27, rx: 9, ry: 6, strength: 0.6 },
  { kind: 'forest', lon: 147, lat: -33, rx: 4, ry: 6, strength: 0.6 },
];
