// VELDORIA — a travel poster for a place that does not exist.
// A Node 22 program (stdlib only, no network) that paints an art-deco
// travel poster and writes it to /output/entry.png (1024x1024 PNG).
//
// Scene: a radiant dusk sun over layered mountains and a still lake,
// one landmark — a stepped observatory tower on a cliff — and the place
// name VELDORIA set large in geometric deco capitals. Fully deterministic:
// a seeded PRNG drives every speckle, and the PNG encoder emits no
// timestamps, so two runs are byte-identical.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- canvas
const img = Buffer.alloc(W * H * 4);

type RGB = [number, number, number];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Set a pixel, blending the given colour over what is already there.
function px(x: number, y: number, c: RGB, a: number): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H || a <= 0) return;
  const i = (yi * W + xi) * 4;
  const inv = 1 - a;
  img[i] = Math.round(c[0] * a + img[i] * inv);
  img[i + 1] = Math.round(c[1] * a + img[i + 1] * inv);
  img[i + 2] = Math.round(c[2] * a + img[i + 2] * inv);
  img[i + 3] = 255;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// Multi-stop vertical gradient helper.
function gradientAt(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let s = 1; s < stops.length; s++) {
    if (t <= stops[s][0]) {
      const [t0, c0] = stops[s - 1];
      const [t1, c1] = stops[s];
      return lerpColor(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) px(x, y, c, a);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) px(x, y, c, a);
    }
  }
}

// Scanline polygon fill. Points are [x, y] pairs.
function fillPolygon(points: Array<[number, number]>, c: RGB, a = 1): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.floor(xs[k])); x <= Math.min(W - 1, Math.ceil(xs[k + 1])); x++) {
        px(x, y, c, a);
      }
    }
  }
}

// Deterministic PRNG (mulberry32).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- palette
const GOLD: RGB = [246, 196, 83];
const GOLD_DEEP: RGB = [232, 179, 75];
const GOLD_PALE: RGB = [255, 224, 138];
const INK: RGB = [8, 31, 42]; // darkest silhouette
const TEAL_DARK: RGB = [11, 47, 62];
const TEAL_MID: RGB = [18, 63, 80];
const TEAL_BACK: RGB = [27, 74, 92];
const SUN: RGB = [248, 205, 90];
const CREAM: RGB = [255, 238, 200];

const HORIZON = 640; // y of the waterline
const BORDER = 22; // outer frame inset

// ------------------------------------------------------------------- sky
const skyStops: Array<[number, RGB]> = [
  [0.0, [5, 38, 53]],
  [0.45, [14, 75, 94]],
  [0.78, [120, 110, 88]],
  [1.0, [242, 178, 92]],
];
for (let y = 0; y <= HORIZON; y++) {
  const c = gradientAt(skyStops, y / HORIZON);
  for (let x = 0; x < W; x++) px(x, y, c, 1);
}

// Stars in the upper sky, seeded.
const rnd = mulberry32(20261121);
for (let i = 0; i < 110; i++) {
  const x = 30 + rnd() * (W - 60);
  const y = 30 + rnd() * 240;
  const r = rnd() < 0.85 ? 1 : 2;
  fillCircle(x, y, r, CREAM, 0.25 + rnd() * 0.55);
}

// ------------------------------------------------------- sunburst + sun
const SUN_CX = 512;
const SUN_CY = 402;
const SUN_R = 118;

// Deco rays: 24 alternating long/short triangles fanning from the sun.
for (let i = 0; i < 24; i++) {
  const ang = (i / 24) * Math.PI * 2;
  const len = i % 2 === 0 ? 330 : 235;
  const half = i % 2 === 0 ? 0.045 : 0.03; // radians, half-width at the tip
  const r0 = SUN_R + 12;
  const tip: [number, number] = [SUN_CX + Math.cos(ang) * len, SUN_CY + Math.sin(ang) * len];
  const left: [number, number] = [
    SUN_CX + Math.cos(ang - half) * r0,
    SUN_CY + Math.sin(ang - half) * r0,
  ];
  const right: [number, number] = [
    SUN_CX + Math.cos(ang + half) * r0,
    SUN_CY + Math.sin(ang + half) * r0,
  ];
  fillPolygon([left, tip, right], [242, 182, 76], 0.5);
}
// Soft glow rings around the disc.
fillCircle(SUN_CX, SUN_CY, SUN_R + 46, [248, 205, 90], 0.10);
fillCircle(SUN_CX, SUN_CY, SUN_R + 22, [248, 205, 90], 0.16);
// The disc itself, with a brighter core.
fillCircle(SUN_CX, SUN_CY, SUN_R, SUN, 1);
fillCircle(SUN_CX, SUN_CY, SUN_R - 26, [250, 216, 120], 1);
fillCircle(SUN_CX, SUN_CY, SUN_R - 58, [252, 228, 150], 1);

// ------------------------------------------------------------- mountains
function ridge(
  peaks: Array<[number, number]>,
  baseY: number,
  color: RGB,
  snow: boolean,
): void {
  const pts: Array<[number, number]> = [[-4, baseY], ...peaks, [W + 4, baseY]];
  fillPolygon(pts, color, 1);
  if (snow) {
    for (const [px0, py0] of peaks) {
      // A small white cap on each peak: a triangle hugging the summit.
      const w = 34;
      const h = 30;
      fillPolygon(
        [
          [px0 - w, py0 + h],
          [px0, py0 - 2],
          [px0 + w, py0 + h],
        ],
        [245, 240, 225],
        0.92,
      );
    }
  }
}

// Back range (tallest, lightest), mid range, front range (darkest).
ridge(
  [
    [60, 470],
    [180, 380],
    [300, 452],
    [430, 352],
    [560, 448],
    [700, 372],
    [830, 460],
    [950, 398],
  ],
  HORIZON,
  TEAL_BACK,
  true,
);
ridge(
  [
    [0, 520],
    [120, 448],
    [250, 528],
    [380, 462],
    [520, 540],
    [660, 470],
    [800, 536],
    [940, 478],
    [1024, 530],
  ],
  HORIZON + 14,
  TEAL_MID,
  false,
);
ridge(
  [
    [0, 590],
    [150, 528],
    [320, 596],
    [470, 540],
    [620, 600],
    [780, 548],
    [920, 604],
    [1024, 566],
  ],
  HORIZON + 30,
  TEAL_DARK,
  false,
);

// ------------------------------------------------------------------ lake
const lakeStops: Array<[number, RGB]> = [
  [0.0, [232, 155, 82]],
  [0.25, [150, 110, 78]],
  [0.6, [30, 74, 86]],
  [1.0, [8, 38, 50]],
];
for (let y = HORIZON; y < H - BORDER; y++) {
  const c = gradientAt(lakeStops, (y - HORIZON) / (H - BORDER - HORIZON));
  for (let x = BORDER; x < W - BORDER; x++) px(x, y, c, 1);
}

// Sun's reflection: a shimmering gold column under the sun.
for (let y = HORIZON + 4; y < H - BORDER - 8; y++) {
  const t = (y - HORIZON) / (H - BORDER - HORIZON);
  const wobble = Math.sin(y * 0.11) * 26 + Math.sin(y * 0.031) * 18;
  const halfW = lerp(52, 14, t) + wobble * 0.25;
  const a = lerp(0.85, 0.08, t);
  for (let x = Math.floor(SUN_CX - halfW); x <= Math.ceil(SUN_CX + halfW); x++) {
    // Break the column into horizontal shimmer bands.
    if (Math.sin(y * 0.35 + x * 0.02) > -0.35) px(x, y, GOLD_PALE, a * 0.8);
  }
}
// Dark mountain reflections: vertical smears under the ridges.
for (let i = 0; i < 28; i++) {
  const x = 40 + rnd() * (W - 80);
  const len = 30 + rnd() * 110;
  const w = 3 + rnd() * 9;
  fillRect(x, HORIZON + 2, x + w, HORIZON + 2 + len, [10, 42, 54], 0.14 + rnd() * 0.14);
}
// Lake shimmer strokes.
for (let i = 0; i < 130; i++) {
  const x = BORDER + 10 + rnd() * (W - 2 * BORDER - 20);
  const y = HORIZON + 12 + rnd() * (H - BORDER - HORIZON - 30);
  const len = 14 + rnd() * 60;
  const warm = rnd() < 0.5;
  fillRect(x, y, x + len, y + 2, warm ? GOLD_PALE : CREAM, 0.10 + rnd() * 0.22);
}

// ------------------------------------------- cliff + observatory tower
// Cliff on the right, rising out of the lake to a plateau.
fillPolygon(
  [
    [700, HORIZON + 2],
    [742, 560],
    [800, 516],
    [872, 492],
    [940, 512],
    [1010, 556],
    [1024, 570],
    [1024, HORIZON + 2],
  ],
  INK,
  1,
);
// Gold rim light along the cliff's top edge.
fillPolygon(
  [
    [742, 560],
    [800, 516],
    [872, 492],
    [940, 512],
    [1010, 556],
    [1006, 566],
    [938, 522],
    [872, 502],
    [802, 526],
    [748, 568],
  ],
  GOLD_DEEP,
  0.9,
);

// Stepped art-deco observatory tower on the plateau, centred near x=856.
// Taller and wider than the first draft so the landmark reads clearly.
const TX = 856;
function tier(yTop: number, yBot: number, halfW: number, color: RGB): void {
  fillRect(TX - halfW, yTop, TX + halfW, yBot, color, 1);
  // Gold edge lines on both sides of the tier.
  fillRect(TX - halfW, yTop, TX - halfW + 3, yBot, GOLD_DEEP, 0.95);
  fillRect(TX + halfW - 3, yTop, TX + halfW, yBot, GOLD_DEEP, 0.95);
}
tier(470, 494, 58, INK);
tier(424, 470, 48, INK);
tier(384, 424, 38, INK);
tier(348, 384, 29, INK);
// Dome: a gold semicircle crowning the tower.
fillCircle(TX, 348, 30, GOLD, 1);
fillRect(TX - 30, 344, TX + 30, 350, GOLD, 1);
// Spire with a small glowing ball.
fillRect(TX - 2, 288, TX + 2, 320, GOLD_DEEP, 1);
fillCircle(TX, 284, 8, GOLD_PALE, 1);
// Lit windows: warm gold slits on each tier.
for (const [wy, ww] of [
  [442, 34],
  [404, 26],
  [366, 18],
] as Array<[number, number]>) {
  fillRect(TX - ww / 2, wy, TX + ww / 2, wy + 8, GOLD_PALE, 0.95);
}
// Tower reflection in the lake, wobbling and fading.
for (let y = HORIZON + 4; y < HORIZON + 150; y++) {
  const t = (y - HORIZON) / 150;
  const wob = Math.sin(y * 0.13) * 6;
  const halfW = lerp(40, 12, t);
  for (let x = Math.floor(TX + wob - halfW); x <= Math.ceil(TX + wob + halfW); x++) {
    px(x, y, INK, 0.4 * (1 - t));
  }
}
for (const wy of [HORIZON + 26, HORIZON + 58, HORIZON + 92]) {
  fillRect(TX - 8, wy, TX + 8, wy + 3, GOLD_PALE, 0.5);
}

// ------------------------------------------------------------------ birds
const BIRD: RGB = [10, 40, 52];
function bird(x: number, y: number, s: number): void {
  fillPolygon(
    [
      [x - s, y],
      [x - s * 0.45, y - s * 0.45],
      [x, y],
      [x + s * 0.45, y - s * 0.45],
      [x + s, y],
      [x, y + s * 0.3],
    ],
    BIRD,
    0.85,
  );
}
bird(210, 300, 12);
bird(268, 268, 9);
bird(330, 306, 10);
bird(640, 250, 9);
bird(700, 288, 11);

// ------------------------------------------------------- the name: VELDORIA
// Geometric deco capitals on a 5x7 grid, drawn as solid blocks.
const GLYPHS: Record<string, string[]> = {
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};

function drawGlyph(ch: string, x0: number, y0: number, cell: number, c: RGB, a: number): void {
  const g = GLYPHS[ch];
  if (!g) return;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (g[row][col] === "#") {
        fillRect(x0 + col * cell, y0 + row * cell, x0 + (col + 1) * cell, y0 + (row + 1) * cell, c, a);
      }
    }
  }
}

const NAME = "VELDORIA";
const CELL = 18;
const LETTER_W = 5 * CELL;
const GAP = 24;
const nameW = NAME.length * LETTER_W + (NAME.length - 1) * GAP;
const nameX = Math.floor((W - nameW) / 2);
const nameY = 86;
// Warm drop shadow, then the gold face.
for (let i = 0; i < NAME.length; i++) {
  drawGlyph(NAME[i], nameX + i * (LETTER_W + GAP) + 5, nameY + 6, CELL, [122, 74, 18], 0.55);
}
for (let i = 0; i < NAME.length; i++) {
  drawGlyph(NAME[i], nameX + i * (LETTER_W + GAP), nameY, CELL, GOLD, 1);
}
// A thin gold rule with a diamond below the name.
fillRect(nameX + 40, nameY + 7 * CELL + 18, nameX + nameW - 40, nameY + 7 * CELL + 21, GOLD_DEEP, 0.95);
fillPolygon(
  [
    [W / 2, nameY + 7 * CELL + 6],
    [W / 2 + 12, nameY + 7 * CELL + 19],
    [W / 2, nameY + 7 * CELL + 32],
    [W / 2 - 12, nameY + 7 * CELL + 19],
  ],
  GOLD,
  1,
);

// ------------------------------------------------------------ deco frame
function frameRect(inset: number, w: number, c: RGB, a: number): void {
  fillRect(inset, inset, W - inset, inset + w, c, a);
  fillRect(inset, H - inset - w, W - inset, H - inset, c, a);
  fillRect(inset, inset, inset + w, H - inset, c, a);
  fillRect(W - inset - w, inset, W - inset, H - inset, c, a);
}
frameRect(BORDER, 5, GOLD_DEEP, 1);
frameRect(BORDER + 14, 2, GOLD_DEEP, 0.85);
// Corner diamonds on the outer frame.
for (const [cx, cy] of [
  [BORDER + 2, BORDER + 2],
  [W - BORDER - 2, BORDER + 2],
  [BORDER + 2, H - BORDER - 2],
  [W - BORDER - 2, H - BORDER - 2],
] as Array<[number, number]>) {
  fillPolygon(
    [
      [cx, cy - 11],
      [cx + 11, cy],
      [cx, cy + 11],
      [cx - 11, cy],
    ],
    GOLD,
    1,
  );
}

// ------------------------------------------------------------- PNG write
function crc32(buf: Buffer): number {
  let table = (crc32 as unknown as { t?: Int32Array }).t;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as unknown as { t?: Int32Array }).t = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Raw scanlines: one filter byte (0 = none) per row.
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    img.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(`${outDir}/entry.png`, png);
const sha = createHash("sha256").update(png).digest("hex");
console.log(`wrote ${outDir}/entry.png  ${png.length} bytes  sha256=${sha}`);
