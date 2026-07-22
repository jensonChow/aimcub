// Generates the Aimcub macOS app icon (build/icon.icns) from scratch: no image
// assets, no new npm dependencies. A 1024x1024 master PNG is composed entirely
// in-process (hand-rolled PNG encoder using node:zlib for DEFLATE + CRC32),
// then macOS `sips` downsamples it into the 10 sizes an .iconset needs and
// `iconutil` packs those into the final .icns. Requires macOS.
//
// PLACEHOLDER ICON: flat rounded-square, Glass accent blue (#0064cc, the
// light-theme --acc token from docs/memory/design-system.md) background, a
// plain geometric white "A" mark. Deliberately simple so a future real brand
// pass can drop in a replacement icon.icns without touching packaging config.
//
// Regenerate with:
//   node apps/desktop/scripts/generate-icon.mjs
//
// This writes apps/desktop/build/icon.icns, which is committed — CI and
// `pnpm --filter @app/desktop run pack`/`dist` consume the committed file and
// never invoke this script.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import zlib from "node:zlib";

const SIZE = 1024;
const SUPERSAMPLE = 3; // 3x3 subsamples per pixel for anti-aliased edges

// Rounded-square silhouette, sized like Apple's Big Sur+ icon content grid
// (content roughly 824/1024 of the canvas, centered).
const SQUARE_MARGIN = 100;
const SQUARE_X0 = SQUARE_MARGIN;
const SQUARE_X1 = SIZE - SQUARE_MARGIN;
const SQUARE_Y0 = SQUARE_MARGIN;
const SQUARE_Y1 = SIZE - SQUARE_MARGIN;
const CORNER_RADIUS = 185;

const ACCENT = { r: 0x00, g: 0x64, b: 0xcc }; // design-system.md light --acc
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

// The "A" mark: two straight-stroke legs meeting at a shared apex, plus a
// crossbar. Built from simple convex-quad/rect containment tests (a union of
// shapes) rather than font glyphs or a hole-cut polygon, so the geometry is
// exact and deterministic.
const APEX = { x: 512, y: 330 };
const LEFT_FOOT = { x: 365, y: 734 };
const RIGHT_FOOT = { x: 659, y: 734 };
const LEG_WIDTH = 100;
const CROSSBAR_Y0 = 572;
const CROSSBAR_Y1 = 632;
const CROSSBAR_OVERLAP = 26; // extend past each leg's centerline so the join has no seam

function insideRoundedSquare(x, y) {
  if (x < SQUARE_X0 || x > SQUARE_X1 || y < SQUARE_Y0 || y > SQUARE_Y1) return false;
  const nearLeft = x < SQUARE_X0 + CORNER_RADIUS;
  const nearRight = x > SQUARE_X1 - CORNER_RADIUS;
  const nearTop = y < SQUARE_Y0 + CORNER_RADIUS;
  const nearBottom = y > SQUARE_Y1 - CORNER_RADIUS;
  let cx;
  let cy;
  if (nearLeft && nearTop) {
    cx = SQUARE_X0 + CORNER_RADIUS;
    cy = SQUARE_Y0 + CORNER_RADIUS;
  } else if (nearRight && nearTop) {
    cx = SQUARE_X1 - CORNER_RADIUS;
    cy = SQUARE_Y0 + CORNER_RADIUS;
  } else if (nearLeft && nearBottom) {
    cx = SQUARE_X0 + CORNER_RADIUS;
    cy = SQUARE_Y1 - CORNER_RADIUS;
  } else if (nearRight && nearBottom) {
    cx = SQUARE_X1 - CORNER_RADIUS;
    cy = SQUARE_Y1 - CORNER_RADIUS;
  } else {
    return true;
  }
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= CORNER_RADIUS * CORNER_RADIUS;
}

function strokeQuad(p1, p2, width) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    { x: p1.x + nx, y: p1.y + ny },
    { x: p2.x + nx, y: p2.y + ny },
    { x: p2.x - nx, y: p2.y - ny },
    { x: p1.x - nx, y: p1.y - ny },
  ];
}

function insideConvexQuad(quad, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function centerX(top, bottom, y) {
  const t = (y - top.y) / (bottom.y - top.y);
  return top.x + (bottom.x - top.x) * t;
}

const leftLeg = strokeQuad(APEX, LEFT_FOOT, LEG_WIDTH);
const rightLeg = strokeQuad(APEX, RIGHT_FOOT, LEG_WIDTH);

function insideCrossbar(x, y) {
  if (y < CROSSBAR_Y0 || y > CROSSBAR_Y1) return false;
  const midY = (CROSSBAR_Y0 + CROSSBAR_Y1) / 2;
  const left = centerX(APEX, LEFT_FOOT, midY) - CROSSBAR_OVERLAP;
  const right = centerX(APEX, RIGHT_FOOT, midY) + CROSSBAR_OVERLAP;
  return x >= left && x <= right;
}

function insideMark(x, y) {
  return insideConvexQuad(leftLeg, x, y) || insideConvexQuad(rightLeg, x, y) || insideCrossbar(x, y);
}

function renderPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = px + (sx + 0.5) / SUPERSAMPLE;
          const y = py + (sy + 0.5) / SUPERSAMPLE;
          if (!insideRoundedSquare(x, y)) continue;
          const color = insideMark(x, y) ? WHITE : ACCENT;
          r += color.r;
          g += color.g;
          b += color.b;
          a += 255;
        }
      }
      const idx = (py * SIZE + px) * 4;
      pixels[idx] = Math.round(r / samples);
      pixels[idx + 1] = Math.round(g / samples);
      pixels[idx + 2] = Math.round(b / samples);
      pixels[idx + 3] = Math.round(a / samples);
    }
  }
  return pixels;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc(size * (1 + stride));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0; // filter type: None
    pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

const ICONSET_SIZES = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

function main() {
  if (process.platform !== "darwin") {
    process.stderr.write("generate-icon.mjs requires macOS (uses sips + iconutil).\n");
    process.exit(1);
  }

  const masterPixels = renderPixels();
  const masterPng = encodePng(masterPixels, SIZE);

  const workDir = mkdtempSync(path.join(tmpdir(), "aimcub-icon-"));
  try {
    const masterPath = path.join(workDir, "master.png");
    writeFileSync(masterPath, masterPng);

    const iconsetDir = path.join(workDir, "Aimcub.iconset");
    mkdirSync(iconsetDir);
    for (const [name, size] of ICONSET_SIZES) {
      const outPath = path.join(iconsetDir, name);
      if (size === SIZE) {
        copyFileSync(masterPath, outPath);
      } else {
        execFileSync("sips", ["-z", String(size), String(size), masterPath, "--out", outPath], { stdio: "pipe" });
      }
    }

    const icnsPath = path.join(workDir, "Aimcub.icns");
    execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], { stdio: "pipe" });

    const buildDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "build");
    mkdirSync(buildDir, { recursive: true });
    const destPath = path.join(buildDir, "icon.icns");
    copyFileSync(icnsPath, destPath);
    process.stdout.write(`Wrote ${destPath}\n`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
