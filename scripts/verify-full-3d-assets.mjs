import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RELEASE_PATH = "data/full-3d-release.json";

async function main() {
  const bytes = await readFile(resolve(RELEASE_PATH));
  const data = JSON.parse(bytes.toString("utf8"));
  if (data.status === "fallback-only") {
    if (data.runtimeManifest !== null) throw new Error("fallback-only runtimeManifest must be null");
    console.log("FULL_3D_VERIFICATION_OK fallback-only");
    return;
  }
  if (data.status === "ready") {
    if (!data.runtimeManifest || data.runtimeManifest.publicPath !== "/assets/full-3d/runtime.json") throw new Error("ready runtimeManifest invalid");
    console.log("FULL_3D_VERIFICATION_OK ready");
    return;
  }
  throw new Error("Unsupported status");
}

await main().catch(e => { console.error(e.message); process.exitCode = 1; });
