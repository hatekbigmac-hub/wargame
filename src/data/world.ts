// Typed access to the generated real-world dataset (see scripts/build-world-data.mjs).
import raw from './world.json';

export interface WorldCountry {
  id: string;
  name: string;
  ru: string;
  cont: string;
  pop: number; // millions
  gdp: number; // billions USD
  lx: number; // label lon
  ly: number; // label lat
  col: number; // palette index
  nb: string[]; // land neighbours
  polys: number[][][]; // polygons -> rings -> [lon,lat,...]
}

/** [name, nameRu, lon, lat, countryId, size 1-4, industry 1-5, capital 0|1, resourceTags] */
export type WorldCityRow = [string, string, number, number, string, number, number, number, string];

export interface WorldData {
  source: string;
  countries: WorldCountry[];
  cities: WorldCityRow[];
  lakes: number[][];
  rivers: number[][];
}

export const WORLD = raw as unknown as WorldData;
