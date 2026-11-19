// Verifies the Edge and Firefox store builds produced by `pnpm zip:edge` and
// `pnpm zip:firefox`. Run after `pnpm build` so the Chrome output exists for
// comparison.

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strFromU8 } from "fflate";

import {
  readReleaseDirectoryEntries,
  readValidatedReleaseZipEntries,
  validateEdgeManifest,
  validateFirefoxManifest,
  validateReleaseEntryNames,
  validateSidePanelAssetText,
  validateTargetArtifactParity,
} from "./artifact-contract.mjs";

const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const zipName = (suffix) =>
  resolve(".output", `${packageJson.name}-${packageJson.version}-${suffix}.zip`);

function fail(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label}:\n- ${errors.join("\n- ")}`);
  }
}

async function readZipFiles(path) {
  const archive = readValidatedReleaseZipEntries(
    new Uint8Array(await readFile(path)),
  );
  return Object.fromEntries(
    Object.entries(archive).filter(([entry]) => !entry.endsWith("/")),
  );
}

function panelText(entries, panelPath) {
  return Object.entries(entries)
    .filter(
      ([name]) =>
        name === panelPath ||
        name.startsWith("assets/") ||
        name.startsWith("chunks/"),
    )
    .map(([, bytes]) => strFromU8(bytes))
    .join("\n");
}

async function verifyTarget({ label, directory, zipSuffix, validateManifest }) {
  const output = await readReleaseDirectoryEntries(resolve(directory));
  const zip = await readZipFiles(zipName(zipSuffix));
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));

  fail(validateManifest(manifest), `${label} manifest`);
  fail(validateTargetArtifactParity({ zip, output }), `${label} ZIP`);
  fail(
    validateSidePanelAssetText(panelText(zip, "sidepanel.html")),
    `${label} panel assets`,
  );
  return manifest;
}

const chromeManifest = JSON.parse(
  await readFile(resolve(".output/chrome-mv3/manifest.json"), "utf8"),
);

await verifyTarget({
  label: "Edge",
  directory: ".output/edge-mv3",
  zipSuffix: "edge",
  validateManifest: (manifest) =>
    validateEdgeManifest(manifest, chromeManifest, packageJson.version),
});

await verifyTarget({
  label: "Firefox",
  directory: ".output/firefox-mv3",
  zipSuffix: "firefox",
  validateManifest: (manifest) =>
    validateFirefoxManifest(manifest, packageJson.version),
});

// AMO requires the source code of minified builds. The sources archive must
// hold only files that are committed to the repository, so nothing local
// (notes, env files, scratch output) can ride along to Mozilla.
const sources = await readZipFiles(zipName("sources"));
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean),
);
const sourceNames = Object.keys(sources);
const sourceErrors = validateReleaseEntryNames(sourceNames);
for (const name of sourceNames) {
  if (!tracked.has(name)) {
    sourceErrors.push(`Sources ZIP contains an untracked file: ${name}.`);
    continue;
  }
  // A tracked file with uncommitted edits would ship code that is not in the
  // repository, so each archived file must match its committed version.
  let committed;
  try {
    committed = execFileSync("git", ["show", `HEAD:${name}`], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    sourceErrors.push(`Sources ZIP contains ${name}, which is not committed yet.`);
    continue;
  }
  if (!Buffer.from(sources[name]).equals(committed)) {
    sourceErrors.push(
      `Sources ZIP has uncommitted changes in ${name}; commit them first.`,
    );
  }
}
for (const required of ["package.json", "pnpm-lock.yaml", "wxt.config.ts"]) {
  if (!(required in sources)) {
    sourceErrors.push(`Sources ZIP is missing ${required}.`);
  }
}
fail(sourceErrors, "Firefox sources ZIP");

console.log("AI Limits Edge and Firefox builds verified");
