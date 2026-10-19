import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

describe("PWA shell", () => {
  it("advertises install metadata from the document head", async () => {
    const html = await readProjectFile("index.html");

    expect(html).toContain("<title>Suzy TV</title>");
    expect(html).toContain('name="apple-mobile-web-app-title" content="Suzy TV"');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('name="mobile-web-app-capable"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
  });

  it("declares a standalone app manifest with maskable icons", async () => {
    const manifest = JSON.parse(await readProjectFile("public/manifest.webmanifest"));

    expect(manifest.name).toBe("Suzy TV");
    expect(manifest.short_name).toBe("Suzy TV");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("landscape");
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }),
        expect.objectContaining({
          src: "/maskable-icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "maskable"
        })
      ])
    );
  });

  it("registers a same-origin service worker without caching API progress calls", async () => {
    const main = await readProjectFile("src/main.jsx");
    const worker = await readProjectFile("public/sw.js");

    expect(main).toContain("registerServiceWorker");
    expect(worker).toContain("CACHE_NAME");
    expect(worker).toContain("event.request.mode === \"navigate\"");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain("event.respondWith(fetch(event.request))");
  });
});
