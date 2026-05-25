import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

const VERSION = "v1.9.14";
const ZIP_SHA256 = "DD4167D75CB04ABE618855B7C71F8658BD009F60C1A71835D134D2C11C939907";
const EXE_SHA256 = "923D57252E8139A69C52E4ACC1E399A640244A8EF457FD9B7267A25847D68F8C";
const URL = `https://github.com/AlexxIT/go2rtc/releases/download/${VERSION}/go2rtc_win64.zip`;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(rootDir, "vendor", "go2rtc");
const executablePath = join(vendorDir, "go2rtc.exe");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

async function validExistingExecutable() {
  if (!existsSync(executablePath)) return false;
  return sha256(await readFile(executablePath)) === EXE_SHA256;
}

async function main() {
  if (await validExistingExecutable()) {
    console.log(`go2rtc ${VERSION} ja esta preparado.`);
    return;
  }

  await mkdir(vendorDir, { recursive: true });
  const response = await fetch(URL);
  if (!response.ok) {
    throw new Error(`Falha ao baixar go2rtc: HTTP ${response.status}`);
  }

  const zip = Buffer.from(await response.arrayBuffer());
  if (sha256(zip) !== ZIP_SHA256) {
    throw new Error("Checksum do pacote go2rtc nao confere.");
  }

  const zipPath = join(vendorDir, "go2rtc.zip");
  const unpackDir = join(vendorDir, "unpacked");
  await writeFile(zipPath, zip);
  await rm(unpackDir, { recursive: true, force: true });
  await extract(zipPath, { dir: unpackDir });

  const extractedPath = join(unpackDir, "go2rtc.exe");
  if (sha256(await readFile(extractedPath)) !== EXE_SHA256) {
    throw new Error("Checksum do executavel go2rtc nao confere.");
  }

  await rm(executablePath, { force: true });
  await rename(extractedPath, executablePath);
  await rm(zipPath, { force: true });
  await rm(unpackDir, { recursive: true, force: true });
  console.log(`go2rtc ${VERSION} incorporado ao instalador.`);
}

await main();
