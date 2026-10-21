// ESM hooks for `node --import`:
//  1. `bun:test` -> this package's shim
//  2. `.css` imports -> empty module (component sources import their CSS)
//  3. `?url` / `?raw` asset imports -> module exporting the resolved path string
const CSS_STUB = "export default {};\n";
const urlStub = (p) => `export default ${JSON.stringify(p)};\n`;

export async function resolve(specifier, context, next) {
  if (specifier === "bun:test") {
    return { url: new URL("./bun-test-shim.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.endsWith("?url") || specifier.endsWith("?raw")) {
    const clean = specifier.replace(/\?(url|raw)$/, "");
    const resolved = await next(clean, context).catch(() => null);
    const stubUrl = new URL(
      `./asset-stub.mjs?target=${encodeURIComponent(resolved?.url ?? clean)}`,
      import.meta.url,
    );
    return { url: stubUrl.href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".css")) {
    return { format: "module", source: CSS_STUB, shortCircuit: true };
  }
  if (url.startsWith(new URL("./asset-stub.mjs", import.meta.url).href)) {
    const target = new URL(url).searchParams.get("target") ?? "";
    return { format: "module", source: urlStub(target), shortCircuit: true };
  }
  return next(url, context);
}
