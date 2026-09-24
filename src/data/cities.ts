import type { CityDef } from '../core/types';
import { WORLD } from './world';

// Capitals and major cities of every country (Natural Earth populated places).
// Port status is decided by the map builder from the actual coastline.
export const CITY_DEFS: CityDef[] = WORLD.cities.map(([name, ru, lon, lat, owner, size, industry, capital, tags]) => ({
  name,
  ru,
  lon,
  lat,
  owner,
  size,
  industry,
  port: true,
  airport: size >= 3,
  capital: capital === 1,
  trade: size >= 4 || (capital === 1 && industry >= 4),
  tags,
}));
