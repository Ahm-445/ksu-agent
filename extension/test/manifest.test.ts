import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ADR 0001 rule 3: the manifest is the enforcement of "the Edugate and LMS hosts
// and storage only". Nothing else in the extension can widen it, so these tests
// read the file the browser reads.
const manifestUrl = new URL("../manifest.json", import.meta.url);
const srcDir = fileURLToPath(new URL("../src", import.meta.url));

type Manifest = {
  permissions?: string[];
  host_permissions?: string[];
  externally_connectable?: { matches?: string[] };
  content_scripts?: { matches: string[]; all_frames?: boolean }[];
  [key: string]: unknown;
};

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestUrl, "utf8")) as Manifest;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (extname(entry.name) === ".ts") {
      found.push(path);
    }
  }

  return found;
}

describe("the extension manifest", () => {
  it("asks for storage and nothing else", () => {
    expect(readManifest().permissions).toEqual(["storage"]);
  });

  it("reaches the Edugate and LMS hosts and no other site", () => {
    expect(readManifest().host_permissions).toEqual([
      "https://edugate.ksu.edu.sa/*",
      "https://lms.ksu.edu.sa/*",
    ]);
  });

  it("listens to the website's two origins and no other", () => {
    expect(readManifest().externally_connectable?.matches).toEqual([
      "http://localhost:3000/*",
      "https://ksu-agent-web.onrender.com/*",
    ]);
  });

  it("declares no permission the student cannot see at install", () => {
    const manifest = readManifest();

    expect(manifest).not.toHaveProperty("web_accessible_resources");
    expect(manifest).not.toHaveProperty("optional_permissions");
    expect(manifest).not.toHaveProperty("optional_host_permissions");
  });

  it("injects into the two KSU hosts only, in the top frame", () => {
    const scripts = readManifest().content_scripts ?? [];

    expect(scripts.flatMap((script) => script.matches)).toEqual([
      "https://edugate.ksu.edu.sa/*",
      "https://lms.ksu.edu.sa/*",
    ]);
    expect(scripts.map((script) => script.matches)).toEqual([
      ["https://edugate.ksu.edu.sa/*"],
      ["https://lms.ksu.edu.sa/*"],
    ]);

    const lms = scripts.find((script) =>
      script.matches.includes("https://lms.ksu.edu.sa/*"),
    );
    expect(lms?.all_frames).toBe(false);

    for (const script of scripts) {
      expect(script.all_frames).not.toBe(true);
    }
  });
});

describe("the extension source", () => {
  it("never reaches for the cookies or the network API", () => {
    const offenders: string[] = [];

    for (const path of sourceFiles(srcDir)) {
      const text = readFileSync(path, "utf8");

      for (const api of ["chrome.cookies", "chrome.webRequest"]) {
        if (text.includes(api)) {
          offenders.push(`${path}: ${api}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
