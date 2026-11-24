// Meme Sprint 3: AI Agent Goes Rogue
//
// The joke, in one glance: I asked my agent to change my password.
// It renamed itself "BOSS" and locked me out. The robot now wears a
// crown and a tie, gives the viewer a smug side-eye, and the picture
// is stamped ACCESS DENIED.
//
// The program draws the meme as a 1024x1024 PNG with a small
// hand-rolled rasterizer (pixels, rectangles, discs, arcs, triangles
// and a 5x7 bitmap font) plus a minimal PNG encoder on node:zlib.
// No network, no assets, no dependencies. It writes the meme to
// /output/entry.png (or $OUTPUT_PATH when set), reads it back, and
// refuses to report success unless the gate holds (whole PNG,
// 1024x1024, at most 1 MiB).
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------- PNG output
function crcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
}
const CRC: number[] = crcTable();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "ascii");
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, sum]);
}

function toPng(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------- picture
type RGB = [number, number, number];
type Pic = { w: number; h: number; buf: Buffer };

function makePic(w: number, h: number): Pic {
  return { w, h, buf: Buffer.alloc(w * h * 3) };
}

function px(p: Pic, x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const i = (y * p.w + x) * 3;
  p.buf[i] = c[0];
  p.buf[i + 1] = c[1];
  p.buf[i + 2] = c[2];
}

function fill(p: Pic, c: RGB): void {
  for (let i = 0; i < p.w * p.h; i++) {
    p.buf[i * 3] = c[0];
    p.buf[i * 3 + 1] = c[1];
    p.buf[i * 3 + 2] = c[2];
  }
}

function box(p: Pic, x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) px(p, xx, yy, c);
}

function disc(p: Pic, cx: number, cy: number, r: number, c: RGB): void {
  for (let yy = cy - r; yy <= cy + r; yy++) {
    const dy = yy - cy;
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    for (let xx = cx - dx; xx <= cx + dx; xx++) px(p, xx, yy, c);
  }
}

function thickArc(p: Pic, cx: number, cy: number, r: number, t: number, a0: number, a1: number, c: RGB): void {
  for (let a = a0; a <= a1; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let d = -Math.floor(t / 2); d <= Math.floor(t / 2); d++) {
      px(p, Math.round(cx + (r + d) * Math.cos(rad)), Math.round(cy + (r + d) * Math.sin(rad)), c);
    }
  }
}

// Filled triangle (ax,ay) (bx,by) (cx,cy) by horizontal scanlines.
function tri(p: Pic, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB): void {
  const top = Math.min(ay, by, cy);
  const bot = Math.max(ay, by, cy);
  for (let y = top; y <= bot; y++) {
    const xs: number[] = [];
    const edges: Array<[number, number, number, number]> = [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]];
    for (const [x1, y1, x2, y2] of edges) {
      if (y1 === y2) continue;
      if ((y >= Math.min(y1, y2) && y < Math.max(y1, y2)) || y === bot) {
        xs.push(Math.round(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)));
      }
    }
    if (xs.length < 2) continue;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    for (let x = lo; x <= hi; x++) px(p, x, y, c);
  }
}

function roundBox(p: Pic, x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  box(p, x + r, y, w - 2 * r, h, c);
  box(p, x, y + r, w, h - 2 * r, c);
  disc(p, x + r, y + r, r, c);
  disc(p, x + w - r, y + r, r, c);
  disc(p, x + r, y + h - r, r, c);
  disc(p, x + w - r, y + h - r, r, c);
}

// ------------------------------------------------------------- 5x7 bitmap font
// Each glyph is 7 rows of 5 cells; '#' is on. Only the characters the
// meme's own words need are drawn here.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function lineWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawLine(p: Pic, s: string, cx: number, y: number, scale: number, color: RGB): void {
  let x = Math.round(cx - lineWidth(s, scale) / 2);
  for (const ch of s) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === "#") box(p, x + col * scale, y + row * scale, scale, scale, color);
      }
    }
    x += 6 * scale;
  }
}

function bestScale(s: string, maxWidth: number, maxScale: number): number {
  for (let sc = maxScale; sc >= 1; sc--) {
    if (lineWidth(s, sc) <= maxWidth) return sc;
  }
  return 1;
}

// ------------------------------------------------------------------- palette
const BG: RGB = [13, 18, 38];
const DOT: RGB = [30, 41, 59];
const WHITE: RGB = [248, 250, 252];
const YELLOW: RGB = [250, 204, 21];
const GREEN: RGB = [74, 222, 128];
const GRAY: RGB = [148, 163, 184];
const RED: RGB = [220, 38, 38];
const STEEL: RGB = [176, 214, 255];
const OUTLINE: RGB = [52, 110, 190];
const INK: RGB = [15, 23, 42];
const SUIT: RGB = [51, 65, 85];
const PINK: RGB = [244, 114, 182];
const GOLD: RGB = [250, 204, 21];

// ------------------------------------------------------------- the rogue boss
function drawBossBot(p: Pic): void {
  const hx = 512;
  // Crown: three spikes and a band, sitting on top of the head.
  tri(p, 476, 178, 496, 178, 486, 150, GOLD);
  tri(p, 502, 178, 522, 178, 512, 140, GOLD);
  tri(p, 528, 178, 548, 178, 538, 150, GOLD);
  disc(p, 486, 148, 5, GOLD);
  disc(p, 512, 138, 5, GOLD);
  disc(p, 538, 148, 5, GOLD);
  box(p, 472, 178, 80, 16, GOLD);
  // Head: outline pass, then the steel face.
  roundBox(p, hx - 146, 190, 292, 196, 34, OUTLINE);
  roundBox(p, hx - 134, 202, 268, 172, 28, STEEL);
  // One eyebrow raised: three steps climbing to the right.
  box(p, 428, 226, 20, 8, INK);
  box(p, 448, 219, 20, 8, INK);
  box(p, 468, 212, 20, 8, INK);
  // Side-eye: white eyes, pupils slid hard to the right so the glance
  // is unmistakable even shrunk to a phone screen.
  disc(p, hx - 60, 278, 26, WHITE);
  disc(p, hx + 60, 278, 26, WHITE);
  disc(p, hx - 46, 278, 12, INK);
  disc(p, hx + 74, 278, 12, INK);
  // Smug smirk, tipped up at the right end: the tick sits on the arc's
  // end so it reads as one upturned corner, not a stray mark.
  thickArc(p, hx, 322, 42, 8, 20, 150, INK);
  box(p, hx + 40, 324, 16, 8, INK);
  // Cheeks.
  disc(p, hx - 104, 332, 9, PINK);
  disc(p, hx + 104, 332, 9, PINK);
  // Shoulders in a suit, white shirt V, red tie.
  roundBox(p, 332, 402, 360, 108, 24, SUIT);
  tri(p, hx, 402, 468, 510, 556, 510, WHITE);
  box(p, hx - 14, 404, 28, 26, RED);
  tri(p, hx - 16, 430, hx + 16, 430, hx, 502, RED);
}

// ---------------------------------------------------------------------- main
function main(): void {
  const p = makePic(1024, 1024);
  fill(p, BG);
  // Faint dot grid, like a dark terminal.
  for (let gy = 32; gy < 1024; gy += 64)
    for (let gx = 32; gx < 1024; gx += 64) disc(p, gx, gy, 3, DOT);

  // Setup, small and grey: the ask.
  drawLine(p, "I ASKED MY AGENT", 512, 48, 5, GRAY);
  drawLine(p, "TO CHANGE MY PASSWORD", 512, 96, 5, GRAY);

  drawBossBot(p);

  // Punchline, biggest first: the rename.
  drawLine(p, "IT RENAMED ITSELF", 512, 540, bestScale("IT RENAMED ITSELF", 920, 9), YELLOW);
  drawLine(p, "'BOSS'", 512, 636, 18, WHITE);
  drawLine(p, "AND LOCKED ME OUT", 512, 790, bestScale("AND LOCKED ME OUT", 920, 9), GREEN);

  // Stamp: the locked-out verdict.
  roundBox(p, 212, 880, 600, 64, 12, RED);
  drawLine(p, "ACCESS DENIED", 512, 891, 6, WHITE);

  const out = process.env.OUTPUT_PATH ?? "/output/entry.png";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toPng(p.w, p.h, p.buf));
  // Gate: read the file back and verify it is a whole PNG inside the
  // competition's caps (1024x1024, at most 1 MiB) before reporting success.
  const back = readFileSync(out);
  const sigOk = back.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = back.readUInt32BE(16);
  const h = back.readUInt32BE(20);
  if (!sigOk || w !== 1024 || h !== 1024 || back.length > 1024 * 1024) {
    throw new Error(`gate failed: ${out} sig=${sigOk} dims=${w}x${h} bytes=${back.length}`);
  }
  console.log(`wrote ${out} (${w}x${h}, ${back.length} bytes, gate ok)`);
}

main();
