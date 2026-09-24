// Real-world armed forces, used to build every country's starting army and navy.
//
// Figures are rounded public estimates (circa 2023–2024) in the spirit of the IISS Military
// Balance, Global Firepower and SIPRI; they are approximate and meant to give each country a
// recognisable military profile, not an order of battle. Countries not listed get a modest
// estimate from population and GDP (see `militaryOf`).
//
// Columns:
//   p  active personnel (thousands)      t  main battle tanks          a  artillery (towed, SP, rocket)
//   s  submarines                        d  destroyers & cruisers      f  frigates
//   c  corvettes & missile boats         pb patrol vessels             am amphibious / landing ships
//   cv fixed-wing aircraft carriers      m  missile forces 0–3         ad air defence 0–3
//   b  defence budget (US$ billion)
import { FACTION_MAP } from './factions';
import { UNIT_MAP } from './units';
import { TECH_MAP } from './techs';

export interface MilitaryStats {
  p: number;
  t: number;
  a: number;
  s: number;
  d: number;
  f: number;
  c: number;
  pb: number;
  am: number;
  cv: number;
  m: number;
  ad: number;
  b: number;
  /** true when the figures come from the table rather than the fallback estimate */
  real: boolean;
}

type Row = [p: number, t: number, a: number, s: number, d: number, f: number, c: number, pb: number, am: number, cv: number, m: number, ad: number, b: number];

// prettier-ignore
const TABLE: Record<string, Row> = {
  //        p     t      a      s   d   f   c    pb   am cv m  ad  b
  USA: [1330, 4640,  2900,  68, 86,  0, 25,  20, 31, 11, 3, 3, 916],
  CHN: [2035, 5000,  9500,  60, 50, 45, 75, 200, 55,  3, 3, 3, 296],
  RUS: [1150, 5000, 11000,  58, 14, 12, 80, 100, 18,  1, 3, 3, 109],
  IND: [1455, 4600,  9700,  17, 12, 13, 25, 130,  9,  2, 2, 2,  84],
  PRK: [1280, 4000, 17900,  70,  0,  2,150, 300, 20,  0, 3, 2,   4],
  KOR: [ 500, 2200,  5800,  22, 12, 15, 20,  80,  7,  0, 2, 2,  48],
  PAK: [ 654, 2600,  4500,   8,  0, 10, 10,  20,  0,  0, 2, 2, 8.5],
  IRN: [ 610, 1900,  6000,  19,  0,  7, 90, 150, 10,  0, 3, 2,  10],
  TUR: [ 355, 2200,  3000,  12,  0, 16, 10,  40,  5,  0, 1, 1,  16],
  EGY: [ 440, 2500,  4000,   8,  0, 13, 25,  50,  2,  0, 1, 2, 4.6],
  ISR: [ 170, 1300,  1000,   5,  0,  0,  7,  45,  0,  0, 2, 3,  27],
  SAU: [ 257, 1000,   800,   0,  0,  7,  8,  30,  0,  0, 1, 2,  76],
  GBR: [ 150,  227,   150,  10,  6, 11,  0,  25,  5,  2, 1, 2,  75],
  FRA: [ 203,  222,   150,   9, 11,  6,  0,  20,  3,  1, 1, 2,  61],
  DEU: [ 183,  300,   130,   6,  0, 11,  5,  10,  0,  0, 0, 2,  67],
  ITA: [ 165,  200,   150,   8,  4, 12, 10,  20,  3,  2, 0, 2,  36],
  JPN: [ 247,  500,   500,  24, 40,  6,  6,  10,  3,  2, 1, 3,  50],
  UKR: [ 800, 1200,  2500,   0,  0,  0,  1,  10,  0,  0, 1, 2,  65],
  POL: [ 164,  750,   600,   1,  0,  2,  1,   5,  5,  0, 1, 1,  32],
  GRC: [ 132, 1300,   600,  11,  0, 13, 17,  20,  5,  0, 1, 1,   8],
  ESP: [ 122,  320,   250,   2,  0, 11,  0,  20,  3,  1, 0, 1,  24],
  BRA: [ 366,  400,   400,   7,  0,  8,  2,  40,  3,  0, 0, 1,  23],
  MEX: [ 216,    0,   100,   0,  0,  7,  5, 100,  1,  0, 0, 0,  11],
  IDN: [ 400,  330,   400,   4,  0, 13, 20, 150, 10,  0, 0, 1,   9],
  VNM: [ 480, 1300,  3000,   6,  0,  9, 20,  50,  5,  0, 1, 2,   6],
  THA: [ 360,  400,   800,   0,  0,  7,  7,  50,  3,  1, 0, 1, 5.8],
  TWN: [ 169, 1000,  1600,   4,  4, 22, 30,  30,  5,  0, 1, 3,  17],
  AUS: [  60,   59,    54,   6,  3,  8,  0,  12,  3,  0, 0, 1,  32],
  CAN: [  68,   80,    60,   4,  0, 12,  0,  12,  0,  0, 0, 1,  27],
  DZA: [ 130, 1400,  1100,   6,  0,  8, 10,  20,  3,  0, 1, 2,  18],
  MAR: [ 196,  900,   600,   0,  0,  6,  2,  40,  2,  0, 0, 1, 5.2],
  NGA: [ 143,  250,   300,   0,  0,  2,  2,  80,  1,  0, 0, 0,   3],
  ETH: [ 150,  400,   500,   0,  0,  0,  0,   0,  0,  0, 0, 1, 1.1],
  IRQ: [ 193,  400,   500,   0,  0,  0,  0,  20,  0,  0, 0, 1, 7.6],
  SYR: [ 170, 1500,  2000,   0,  0,  0, 10,  10,  0,  0, 2, 2, 1.8],
  ARE: [  63,  350,   400,   0,  0,  0, 10,  40,  3,  0, 1, 2,  20],
  MMR: [ 406,  600,  1000,   2,  0,  5, 10,  60,  0,  0, 0, 1, 2.7],
  BGD: [ 163,  320,   800,   2,  0,  8,  6,  50,  2,  0, 0, 1,   4],
  PHL: [ 145,   10,   250,   0,  0,  4,  5,  60,  2,  0, 0, 0,   4],
  ARG: [  72,  230,   200,   1,  4,  0,  9,  15,  1,  0, 0, 0, 2.6],
  CHL: [  69,  250,   300,   4,  0,  8,  2,  30,  2,  0, 0, 1, 5.6],
  COL: [ 293,    0,   150,   4,  0,  4,  1,  60,  1,  0, 0, 0,  10],
  PER: [  81,  165,   300,   6,  0,  7,  6,  30,  2,  0, 0, 1, 2.2],
  VEN: [ 123,  190,   250,   2,  0,  6,  3,  30,  2,  0, 0, 1,   1],
  ZAF: [  73,  190,   200,   3,  0,  4,  0,  10,  0,  0, 0, 1, 2.9],
  KAZ: [  39,  350,   500,   0,  0,  0,  0,  20,  0,  0, 1, 1, 1.6],
  BLR: [  48,  500,   500,   0,  0,  0,  0,   0,  0,  0, 1, 2, 1.1],
  AZE: [  64,  500,   600,   0,  0,  0,  0,  20,  0,  0, 1, 1, 3.1],
  ARM: [  42,  150,   200,   0,  0,  0,  0,   0,  0,  0, 1, 1, 1.3],
  GEO: [  20,  120,   150,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.4],
  UZB: [  48,  340,   300,   0,  0,  0,  0,   0,  0,  0, 0, 1, 1.5],
  TKM: [  36,  650,   500,   0,  0,  0,  0,  10,  0,  0, 0, 1, 0.8],
  SGP: [  51,  170,   300,   4,  0,  6,  6,  10,  4,  0, 0, 2,  13],
  MYS: [ 113,   48,   200,   2,  0,  2,  6,  40,  1,  0, 0, 1,   4],
  SWE: [  24,  120,    50,   5,  0,  0,  7,  10,  0,  0, 0, 1, 8.7],
  NOR: [  25,   36,    24,   6,  0,  4,  6,  10,  0,  0, 0, 1, 8.7],
  FIN: [  24,  200,   700,   0,  0,  0,  8,  10,  0,  0, 0, 1, 4.8],
  NLD: [  34,   18,    60,   4,  0,  6,  0,   4,  2,  0, 0, 1,  16],
  DNK: [  15,   44,    20,   0,  0,  5,  0,  10,  0,  0, 0, 1,   8],
  BEL: [  23,    0,    14,   0,  0,  2,  0,   2,  0,  0, 0, 0,   7],
  PRT: [  27,   34,    60,   2,  0,  5,  2,  15,  0,  0, 0, 0, 4.2],
  ROU: [  70,  380,   800,   0,  0,  3,  4,  10,  0,  0, 1, 1,   5],
  HUN: [  30,   50,    40,   0,  0,  0,  0,   0,  0,  0, 0, 1, 4.5],
  CZE: [  26,   30,    90,   0,  0,  0,  0,   0,  0,  0, 0, 1, 4.5],
  SVK: [  17,   30,    30,   0,  0,  0,  0,   0,  0,  0, 0, 1, 2.8],
  SRB: [  28,  250,   300,   0,  0,  0,  0,   0,  0,  0, 0, 1, 1.5],
  BGR: [  37,   90,   300,   0,  0,  3,  3,   5,  0,  0, 0, 1, 1.3],
  HRV: [  15,   20,    60,   0,  0,  0,  0,  10,  0,  0, 0, 0, 1.3],
  AUT: [  23,   56,    30,   0,  0,  0,  0,   0,  0,  0, 0, 1,   4],
  CHE: [  20,  134,   130,   0,  0,  0,  0,   0,  0,  0, 0, 1,   6],
  IRL: [   8,    0,    24,   0,  0,  0,  0,   8,  0,  0, 0, 0, 1.2],
  LTU: [  23,    0,    50,   0,  0,  0,  0,   4,  0,  0, 0, 1,   2],
  LVA: [   7,    0,    50,   0,  0,  0,  0,   5,  0,  0, 0, 0, 1.3],
  EST: [   7,    0,    60,   0,  0,  0,  0,   3,  0,  0, 0, 0, 1.3],
  CUB: [  49,  900,  1000,   0,  0,  0,  3,  20,  0,  0, 0, 1, 0.2],
  JOR: [ 100,  400,   500,   0,  0,  0,  0,  10,  0,  0, 0, 1, 2.2],
  KWT: [  17,  290,   110,   0,  0,  0,  0,  20,  0,  0, 0, 2,   8],
  QAT: [  17,   60,    90,   0,  0,  0,  4,  20,  1,  0, 0, 2,  15],
  OMN: [  43,  117,   150,   0,  0,  0,  3,  10,  1,  0, 0, 1, 6.5],
  BHR: [   8,  180,   100,   0,  0,  1,  2,  10,  0,  0, 0, 1, 1.4],
  YEM: [  40,  100,   300,   0,  0,  0,  0,   5,  0,  0, 1, 0,   1],
  LBY: [  30,  200,   300,   0,  0,  0,  0,   5,  0,  0, 0, 0,   3],
  AFG: [ 150,   30,    50,   0,  0,  0,  0,   0,  0,  0, 0, 0,   1],
  SDN: [ 100,  300,   400,   0,  0,  0,  0,   5,  0,  0, 0, 0,   1],
  SDS: [  50,   80,    60,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.3],
  AGO: [ 107,  300,   500,   0,  0,  0,  0,  20,  0,  0, 0, 1, 1.3],
  COD: [ 134,  150,   300,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.8],
  KEN: [  24,   78,   100,   0,  0,  0,  0,  10,  0,  0, 0, 0, 1.1],
  TZA: [  27,   45,   150,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.9],
  UGA: [  45,  180,   150,   0,  0,  0,  0,   0,  0,  0, 0, 0,   1],
  ERI: [ 200,  250,   200,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.5],
  LKA: [ 255,   60,   200,   0,  0,  2,  0,  60,  0,  0, 0, 0, 1.5],
  NPL: [  96,    0,    50,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.4],
  MNG: [  10,  400,   300,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  NZL: [   9,    0,    24,   0,  0,  2,  0,   4,  1,  0, 0, 0,   3],
  ECU: [  40,   30,   100,   2,  0,  2,  6,  10,  0,  0, 0, 0, 2.8],
  BOL: [  34,    0,    60,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.5],
  URY: [  21,   15,    50,   0,  0,  2,  0,  10,  0,  0, 0, 0, 1.2],
  PRY: [  14,    0,    30,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.4],
  TUN: [  36,   80,   150,   0,  0,  0,  6,  20,  0,  0, 0, 0, 1.2],
  LBN: [  60,  200,   300,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.5],
  KGZ: [  11,  150,   200,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.2],
  TJK: [   9,   37,    50,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  ALB: [   8,    0,    20,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.4],
  MKD: [   8,    0,    40,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.3],
  MNE: [   2,    0,    10,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.1],
  BIH: [  10,   45,    60,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.2],
  SVN: [   7,   14,    20,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.9],
  MDA: [   6,    0,    30,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  CYP: [  12,  130,   150,   0,  0,  0,  0,   5,  0,  0, 0, 1, 0.5],
  KHM: [ 124,  200,   300,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.7],
  LAO: [  29,   30,    60,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  BRN: [   7,    0,    20,   0,  0,  0,  4,  10,  0,  0, 0, 0, 0.5],
  CMR: [  25,    0,    60,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.4],
  CIV: [  27,   10,    40,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.6],
  GHA: [  16,    0,    40,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.3],
  SEN: [  17,    0,    40,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.5],
  MLI: [  40,   10,    40,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.8],
  NER: [  33,    0,    30,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.4],
  TCD: [  35,   60,    40,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.4],
  BFA: [  11,    0,    30,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.8],
  SOM: [  15,    0,    20,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.1],
  ZWE: [  29,   40,   150,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  ZMB: [  15,   30,    60,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.4],
  MOZ: [  11,    0,    40,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.2],
  NAM: [   9,    0,    40,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.4],
  BWA: [   9,   50,    40,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.6],
  RWA: [  33,   30,    40,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.2],
  COG: [  10,   40,    40,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.3],
  GIN: [  10,   40,    40,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.2],
  MRT: [  16,   30,    40,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.2],
  DJI: [  10,    0,    20,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.1],
  DOM: [  56,    0,    30,   0,  0,  0,  0,  20,  0,  0, 0, 0, 0.5],
  GTM: [  18,    0,    30,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.4],
  HND: [  15,    0,    30,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.4],
  SLV: [  25,    0,    30,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.3],
  NIC: [  10,   60,    60,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.1],
  JAM: [   4,    0,     0,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.2],
  TTO: [   5,    0,     0,   0,  0,  0,  0,  10,  0,  0, 0, 0, 0.3],
  PSX: [  30,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.3],
  KOS: [   3,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  CYN: [   3,    0,    20,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.1],
  SAH: [   6,    0,    20,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  SOL: [  10,    0,    10,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.1],
  PNG: [   4,    0,     0,   0,  0,  0,  0,   4,  0,  0, 0, 0, 0.1],
  MDG: [  14,   12,    30,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.1],
  GAB: [   5,    0,    20,   0,  0,  0,  0,   8,  0,  0, 0, 0, 0.3],
  MWI: [  11,    0,    20,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  BDI: [  30,    0,    30,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.1],
  BEN: [   7,    0,    20,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.1],
  TGO: [   9,    2,    20,   0,  0,  0,  0,   2,  0,  0, 0, 0, 0.1],
  SLE: [   9,    0,    20,   0,  0,  0,  0,   2,  0,  0, 0, 0,   0],
  LBR: [   2,    0,     0,   0,  0,  0,  0,   2,  0,  0, 0, 0,   0],
  CAF: [   9,    0,    10,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  GNQ: [ 1.5,    0,    10,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.1],
  GUY: [   3,    0,    10,   0,  0,  0,  0,   5,  0,  0, 0, 0, 0.1],
  SUR: [   2,    0,    10,   0,  0,  0,  0,   3,  0,  0, 0, 0,   0],
  HTI: [ 0.5,    0,     0,   0,  0,  0,  0,   2,  0,  0, 0, 0,   0],
  FJI: [   4,    0,    10,   0,  0,  0,  0,   3,  0,  0, 0, 0,   0],
  MLT: [   2,    0,     0,   0,  0,  0,  0,   8,  0,  0, 0, 0, 0.1],
  LUX: [ 0.4,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0, 0.6],
  BTN: [   8,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  TLS: [   2,    0,     0,   0,  0,  0,  0,   2,  0,  0, 0, 0,   0],
  // No standing army: police or border guards only (one security-force unit in game).
  CRI: [ 0.5,    0,     0,   0,  0,  0,  0,   4,  0,  0, 0, 0,   0],
  PAN: [ 0.5,    0,     0,   0,  0,  0,  0,  10,  0,  0, 0, 0,   0],
  ISL: [ 0.2,    0,     0,   0,  0,  0,  0,   3,  0,  0, 0, 0,   0],
  VAT: [ 0.1,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  MCO: [ 0.2,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  AND: [ 0.1,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  LIE: [ 0.1,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
  SMR: [ 0.1,    0,     0,   0,  0,  0,  0,   0,  0,  0, 0, 0,   0],
};

const cache = new Map<string, MilitaryStats>();

/** Real-world military statistics for a country (table value or an estimate). */
export function militaryOf(id: string): MilitaryStats {
  let m = cache.get(id);
  if (m) return m;
  const row = TABLE[id];
  if (row) {
    const [p, t, a, s, d, f, c, pb, am, cv, mi, ad, b] = row;
    m = { p, t, a, s, d, f, c, pb, am, cv, m: mi, ad, b, real: true };
  } else {
    // Small states not in the table: ~0.07% of the population under arms, light equipment.
    const def = FACTION_MAP[id];
    const pop = def?.population ?? 1; // millions
    const gdp = def?.gdp ?? 1; // US$ billion
    const p = Math.max(0.3, Math.min(30, pop * 0.7));
    m = { p, t: 0, a: Math.round(p * 2), s: 0, d: 0, f: 0, c: 0, pb: 2, am: 0, cv: 0, m: 0, ad: 0, b: Math.round(gdp * 0.015 * 10) / 10, real: false };
  }
  cache.set(id, m);
  return m;
}

/** Equipment quality where income alone misleads (e.g. India's modern forces, North Korea's obsolete ones). */
const QUALITY_OVERRIDE: Record<string, number> = { IND: 2, PAK: 1, UKR: 2, PRK: 0, IRN: 1, EGY: 1, VNM: 1 };

/** Income level 0 (poor) … 3 (rich) from GDP per capita — drives equipment quality and costs. */
export function qualityOf(id: string): number {
  if (id in QUALITY_OVERRIDE) return QUALITY_OVERRIDE[id];
  const def = FACTION_MAP[id];
  const gdppc = def && def.population > 0 ? def.gdp / def.population : 5; // US$ thousand per person
  return gdppc >= 25 ? 3 : gdppc >= 8 ? 2 : gdppc >= 2.5 ? 1 : 0;
}

/** Soldiers and upkeep are cheaper in poorer countries. */
export const UPKEEP_BY_QUALITY = [0.5, 0.65, 0.85, 1];

export interface ForcePlan {
  land: Record<string, number>;
  naval: Record<string, number>;
  /** missile battery level for the capital (0 = none) */
  battery: number;
}

const sq = Math.sqrt;
const r = (x: number) => Math.round(x);

/** Translate real-world figures into game units (one unit ≈ a brigade / squadron). */
export function forcePlan(id: string): ForcePlan {
  const m = militaryOf(id);
  const q = qualityOf(id);
  const land: Record<string, number> = {};
  const naval: Record<string, number> = {};
  const add = (rec: Record<string, number>, type: string, n: number) => {
    if (n > 0) rec[type] = (rec[type] ?? 0) + n;
  };

  // Infantry: one unit per ~40k active troops, compressed for giant armies.
  const inf = Math.max(1, r(m.p <= 150 ? m.p / 45 : 3.3 + sq(m.p - 150) * 0.45));
  const mech = r(inf * [0, 0.12, 0.3, 0.45][q]);
  add(land, 'infantry', inf - mech);
  add(land, 'mech_infantry', mech);
  if (q >= 2 && m.p >= 100) add(land, 'elite_infantry', m.p >= 800 ? 2 : 1);

  // Armour: square-root scale, mix by equipment quality (poor armies field older, lighter tanks).
  const tanks = Math.floor(sq(m.t) / 4.4 + 0.3);
  const heavy = q === 3 ? r(tanks * 0.12) : 0;
  const medium = r(tanks * [0.25, 0.45, 0.6, 0.73][q]);
  add(land, 'heavy_tank', heavy);
  add(land, 'medium_tank', medium);
  add(land, 'light_tank', tanks - heavy - medium);

  // Artillery and missile forces.
  const arty = Math.floor(sq(m.a) / 8.5 + 0.2);
  const rockets = m.m >= 1 ? m.m + (m.a >= 3000 ? 1 : 0) : 0;
  add(land, 'artillery', arty);
  add(land, 'rocket_artillery', rockets);

  // Air defence, recon, engineers.
  add(land, 'anti_air', m.ad >= 2 ? m.ad * (m.p >= 300 ? 2 : 1) : m.ad === 1 && m.p >= 40 ? 1 : 0);
  if (m.p >= 150) add(land, 'recon', m.p >= 600 ? 2 : 1);
  if (m.p >= 150) add(land, 'engineer', 1);

  // Navy.
  add(naval, 'carrier', m.cv >= 1 ? Math.max(1, r(m.cv / 2)) : 0);
  const cruisers = id === 'USA' || id === 'CHN' ? 2 : id === 'RUS' ? 1 : 0;
  add(naval, 'cruiser', cruisers);
  add(naval, 'destroyer', m.d > 0 ? Math.max(1, r(sq(m.d)) - cruisers) : 0);
  add(naval, 'frigate', m.f > 0 ? Math.max(1, r(sq(m.f) * 0.8)) : 0);
  add(naval, 'submarine', m.s > 0 ? Math.max(1, r(m.s / (q === 0 ? 15 : 7))) : 0);
  add(naval, 'missile_ship', m.c >= 10 ? Math.min(4, Math.max(1, r(sq(m.c) / 3))) : 0);
  add(naval, 'patrol_boat', m.pb + m.c >= 8 ? Math.min(3, Math.max(1, r(sq(m.pb + m.c) / 5))) : 0);
  add(naval, 'transport', m.am > 0 ? Math.min(4, Math.max(1, r(sq(m.am) / 1.6))) : 0);

  return { land, naval, battery: m.m >= 3 ? 2 : m.m >= 1 ? 1 : 0 };
}

/** Headline numbers for the UI. */
export function militarySummary(id: string): { personnel: number; tanks: number; artillery: number; subs: number; majorShips: number; carriers: number; budget: number; real: boolean } {
  const m = militaryOf(id);
  return { personnel: m.p * 1000, tanks: m.t, artillery: m.a, subs: m.s, majorShips: m.d + m.f, carriers: m.cv, budget: m.b, real: m.real };
}

const HEAVY_ARMOUR = new Set(['USA', 'DEU', 'GBR', 'ISR', 'KOR', 'FRA', 'JPN']);
const QUIET_SUBS = new Set(['USA', 'RUS', 'GBR', 'FRA', 'JPN', 'DEU', 'KOR', 'SWE', 'AUS', 'CHN', 'ISR', 'ITA']);

/**
 * Technologies a country already fields in real life (applied at game start, prerequisites included).
 * Rich, modern militaries start further up the tree; poorer ones must research their way up.
 */
export function startingTechs(id: string): string[] {
  const m = militaryOf(id);
  const q = qualityOf(id);
  const want: string[] = [];
  if (q >= 1 || m.p >= 300) want.push('motorized');
  if (q >= 2) want.push('composite_armor', 'improved_rifles');
  if (q >= 3 && m.t >= 50) want.push('tank_guns', 'logistics');
  if (q >= 3 && m.p >= 60) want.push('recon_drones');
  if (q >= 2 && m.p >= 100) want.push('special_forces');
  if (HEAVY_ARMOUR.has(id)) want.push('heavy_armor');
  if (m.a >= 1500) want.push('artillery_doctrine');
  if (m.m >= 1) want.push('rocketry');
  if (m.d + m.f >= 6) want.push('naval_engineering');
  if (m.d >= 10 || m.cv >= 1) want.push('blue_water_navy');
  if (m.c >= 20 || m.d >= 10) want.push('naval_missiles');
  if (m.cv >= 1) want.push('carrier_aviation');
  if (m.s >= 5 || m.f >= 8) want.push('sonar');
  if (q >= 2 && m.s >= 5 && QUIET_SUBS.has(id)) want.push('sub_stealth');
  if (q >= 3 && m.d + m.f >= 10) want.push('point_defense');
  if (m.ad >= 2) want.push('air_defense');
  if (m.ad >= 3 || m.m >= 3) want.push('missile_guidance');
  if (q >= 3) want.push('mass_production');
  const out = new Set<string>();
  const addWithReqs = (t: string) => {
    const def = TECH_MAP[t];
    if (!def || def.future || out.has(t)) return;
    for (const r of def.requires) addWithReqs(r);
    out.add(t);
  };
  for (const t of want) addWithReqs(t);
  return [...out];
}

const valueCache = new Map<string, number>();

/**
 * Rough combat value of a country's starting forces, used for rankings: unit prices weighted by
 * equipment quality and technology level (so a large but obsolete army ranks below a modern one).
 */
export function armyValue(id: string): number {
  let v = valueCache.get(id);
  if (v !== undefined) return v;
  const plan = forcePlan(id);
  v = 0;
  for (const [type, n] of [...Object.entries(plan.land), ...Object.entries(plan.naval)]) v += (UNIT_MAP[type]?.cost.money ?? 100) * n;
  v *= [0.55, 0.7, 0.85, 1][qualityOf(id)] * (1 + startingTechs(id).length * 0.04);
  valueCache.set(id, v);
  return v;
}

export function unitCounts(id: string): { land: number; naval: number } {
  const plan = forcePlan(id);
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  return { land: sum(plan.land), naval: sum(plan.naval) };
}
