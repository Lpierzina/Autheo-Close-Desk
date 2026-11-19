import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, sha256Bytes } from "@/domain/sha256";

const reference = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("SHA-256 without a platform API", () => {
  it("matches the published test vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches Node for every length around the block boundaries", () => {
    for (let length = 0; length <= 200; length += 1) {
      const bytes = randomBytes(length);
      expect(sha256Bytes(bytes), `length ${length}`).toBe(reference(bytes));
    }
  });

  it("matches Node for large and non-ASCII input", () => {
    const large = randomBytes(1_048_577);
    expect(sha256Bytes(large)).toBe(reference(large));
    const text = "Résidence Rivière · 河畔公寓 · €100,000.00 · 🏢";
    expect(sha256(text)).toBe(reference(new TextEncoder().encode(text)));
  });
});
