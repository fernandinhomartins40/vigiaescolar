import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(appRoot, "release");
const versionedName = `VigiaEscolar-Gateway-Setup-${packageJson.version}.exe`;
const stableName = "VigiaEscolar-Gateway-Setup.exe";

await copyFile(join(releaseDir, versionedName), join(releaseDir, stableName));
console.log(`Download alias created: release/${stableName}`);
