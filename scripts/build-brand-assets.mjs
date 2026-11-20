#!/usr/bin/env node
/**
 * Builds the images the site ships (src/assets/) from the files kept in brand/.
 *
 * brand/autheo/ holds the official Autheo marks exactly as downloaded from the media
 * kit; brand/SOURCES.json records where each came from and its SHA-256, and this script
 * refuses to run if a file no longer matches. The marks are only ever scaled down
 * uniformly: no recolouring, cropping, effects or redrawing. The favicons place the
 * logomark, unchanged, on a transparent square because browsers need a square image.
 *
 * brand/hero/ holds the two homepage illustrations as supplied. They are re-encoded as
 * WebP at their own size: nothing is resampled, so the line work is not blurred.
 *
 * Run with `npm run assets:brand`. The output is committed, so a normal build does not
 * need to run this.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sources = JSON.parse(readFileSync(join(root, "brand", "SOURCES.json"), "utf8"));

function verified(file) {
  const entry = sources.files.find((candidate) => candidate.file === file);
  if (!entry) throw new Error(`${file} is not listed in brand/SOURCES.json`);
  const path = join(root, "brand", file);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== entry.sha256) throw new Error(`${file} does not match the SHA-256 recorded in brand/SOURCES.json`);
  return path;
}

function target(file) {
  const path = join(root, "src", "assets", file);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const PNG = { compressionLevel: 9, palette: false };

async function scaled(from, to, size) {
  await sharp(verified(from)).resize({ ...size, fit: "inside", kernel: "lanczos3" }).png(PNG).toFile(target(to));
}

async function favicon(from, to, edge) {
  await sharp(verified(from)).resize({ width: edge, height: edge, fit: "contain", background: TRANSPARENT, kernel: "lanczos3" }).png(PNG).toFile(target(to));
}

async function hero(from, to) {
  await sharp(verified(from)).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(target(to));
}

copyFileSync(verified("autheo/Autheo-Logo-2.svg"), target("brand/autheo-wordmark-ultramarine.svg"));
await scaled("autheo/Autheo-Logo-White-copy.png", "brand/autheo-wordmark-white.png", { width: 800 });
await scaled("autheo/Autheo-Logo-Icon-2.png", "brand/autheo-logomark-ultramarine.png", { height: 192 });
await scaled("autheo/Autheo-Logo-Icon-White.png", "brand/autheo-logomark-white.png", { height: 192 });
await favicon("autheo/Autheo-Logo-Icon-2.png", "brand/favicon-light.png", 96);
await favicon("autheo/Autheo-Logo-Icon-White.png", "brand/favicon-dark.png", 96);
await hero("hero/close-desk-hero-day.jpg", "hero/close-desk-hero-day.webp");
await hero("hero/close-desk-hero-night.jpg", "hero/close-desk-hero-night.webp");

for (const file of [
  "brand/autheo-wordmark-ultramarine.svg",
  "brand/autheo-wordmark-white.png",
  "brand/autheo-logomark-ultramarine.png",
  "brand/autheo-logomark-white.png",
  "brand/favicon-light.png",
  "brand/favicon-dark.png",
  "hero/close-desk-hero-day.webp",
  "hero/close-desk-hero-night.webp",
]) {
  console.log(`${String(statSync(target(file)).size).padStart(7)} bytes  src/assets/${file}`);
}
