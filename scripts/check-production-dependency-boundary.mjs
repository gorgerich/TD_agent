import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TOOLING_ONLY_PACKAGES = ["braces", "micromatch", "fast-glob", "@next/eslint-plugin-next", "eslint-config-next"];

export function assertProductionTraceBoundary(manifestPath, trace) {
  if (!trace || !Array.isArray(trace.files) || !trace.files.every(file => typeof file === "string")) {
    throw new Error("Invalid production dependency trace");
  }
  for (const file of trace.files) {
    const resolved = path.resolve(path.dirname(manifestPath), file).replaceAll("\\", "/");
    for (const name of TOOLING_ONLY_PACKAGES) {
      if (resolved.includes(`/node_modules/${name}/`)) throw new Error(`Tooling-only dependency in production trace: ${name}`);
    }
  }
}

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(target));
    else if (entry.name.endsWith(".nft.json")) files.push(target);
  }
  return files;
}

export async function checkProductionDependencyBoundary(root = process.cwd()) {
  const manifests = await collect(path.join(root, ".next/server"));
  if (!manifests.length) throw new Error("Production dependency traces are missing");
  const nextServer = path.join(root, ".next/next-server.js.nft.json");
  try { await readFile(nextServer); manifests.push(nextServer); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const manifest of manifests) assertProductionTraceBoundary(manifest, JSON.parse(await readFile(manifest, "utf8")));
  return { manifests: manifests.length, forbiddenPackages: TOOLING_ONLY_PACKAGES, matches: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkProductionDependencyBoundary().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
