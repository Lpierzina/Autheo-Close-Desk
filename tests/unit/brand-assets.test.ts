import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const bytes = (file: string) => readFileSync(path.join(root, file));

interface Source {
  file: string;
  what: string;
  from: string;
  sha256: string;
}

const sources = (JSON.parse(bytes("brand/SOURCES.json").toString("utf8")) as { files: Source[] }).files;

/**
 * The logos are Autheo's own files, kept unmodified in brand/autheo/, and the site
 * ships copies of them rather than linking to the media kit.
 */
describe("brand assets", () => {
  it("keeps every official file exactly as it was downloaded", () => {
    expect(sources.map((source) => source.file).sort()).toEqual([
      "autheo/Autheo-Logo-2.svg",
      "autheo/Autheo-Logo-Icon-2.png",
      "autheo/Autheo-Logo-Icon-White.png",
      "autheo/Autheo-Logo-White-copy.png",
      "hero/close-desk-hero-day.jpg",
      "hero/close-desk-hero-night.jpg",
    ]);
    for (const source of sources) {
      const digest = createHash("sha256").update(bytes(path.join("brand", source.file))).digest("hex");
      expect(digest, source.file).toBe(source.sha256);
    }
    // Nothing in brand/ is unaccounted for.
    const kept = ["autheo", "hero"].flatMap((dir) => readdirSync(path.join(root, "brand", dir)).map((name) => `${dir}/${name}`));
    expect(kept.sort()).toEqual(sources.map((source) => source.file).sort());
  });

  it("ships the vector wordmark byte for byte, with nothing in it that loads or runs", () => {
    const shipped = bytes("src/assets/brand/autheo-wordmark-ultramarine.svg");
    expect(shipped.equals(bytes("brand/autheo/Autheo-Logo-2.svg"))).toBe(true);
    const svg = shipped.toString("utf8");
    expect(svg).not.toMatch(/<script|<image|<use|<foreignObject|href=|url\(|@import|\bon\w+=/i);
  });

  it("ships only the wordmark, the logomark, their favicons and the two hero images", () => {
    expect(readdirSync(path.join(root, "src/assets/brand")).sort()).toEqual([
      "autheo-logomark-ultramarine.png",
      "autheo-logomark-white.png",
      "autheo-wordmark-ultramarine.svg",
      "autheo-wordmark-white.png",
      "favicon-dark.png",
      "favicon-light.png",
    ]);
    expect(readdirSync(path.join(root, "src/assets/hero")).sort()).toEqual(["close-desk-hero-day.webp", "close-desk-hero-night.webp"]);
    // The placeholder "A" icon is gone. The media kit's THEO token symbol (Autheo-Icon-blackbg.png) is not a logo and is not kept.
    expect(existsSync(path.join(root, "src/app/icon.svg"))).toBe(false);
    expect(sources.map((source) => source.file)).not.toContain("autheo/Autheo-Icon-blackbg.png");
  });

  it("does not recolour, distort or decorate the marks in code", () => {
    const brand = bytes("src/components/brand.tsx").toString("utf8");
    expect(brand).not.toMatch(/\b(filter|invert|brightness|hue-rotate|drop-shadow|blur|opacity|scale-|rotate-|skew-)/);
    expect(bytes("src/app/globals.css").toString("utf8")).not.toMatch(/filter\s*:/);
  });
});
