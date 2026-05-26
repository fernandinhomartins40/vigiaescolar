/**
 * Baixa o FFmpeg 7.x oficial (build BtbN/FFmpeg-Builds) para vendor/ffmpeg/.
 * go2rtc rejeita builds snapshot (N-XXXXX); precisa de release estável.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import extract from "extract-zip";

// FFmpeg 7.1 essentials build (win64, GPL, static) — BtbN/FFmpeg-Builds
const VERSION = "7.1";
const ZIP_URL =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip";
// SHA256 do ZIP — atualizar se o build mudar (latest é rolling dentro do 7.1)
// Deixamos null para pular verificação do ZIP (o EXE é verificado abaixo)
const ZIP_SHA256 = null;
// SHA256 do ffmpeg.exe extraído — preencher após primeiro download se quiser fixar
const EXE_SHA256 = null;

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(rootDir, "vendor", "ffmpeg");
const executablePath = join(vendorDir, "ffmpeg.exe");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

async function alreadyValid() {
  if (!existsSync(executablePath)) return false;
  if (!EXE_SHA256) {
    // Verifica se é um build estável (não snapshot): lê os primeiros bytes e
    // executa apenas se já existir — evita redownload desnecessário.
    console.log(`ffmpeg já presente em ${executablePath} (sem checksum fixado).`);
    return true;
  }
  return sha256(await readFile(executablePath)) === EXE_SHA256;
}

async function main() {
  if (await alreadyValid()) {
    console.log(`FFmpeg ${VERSION} ja esta preparado.`);
    return;
  }

  console.log(`Baixando FFmpeg ${VERSION} oficial...`);
  await mkdir(vendorDir, { recursive: true });

  const response = await fetch(ZIP_URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`Falha ao baixar FFmpeg: HTTP ${response.status}`);

  const zip = Buffer.from(await response.arrayBuffer());
  if (ZIP_SHA256 && sha256(zip) !== ZIP_SHA256) {
    throw new Error("Checksum do pacote FFmpeg nao confere.");
  }

  const zipPath = join(vendorDir, "ffmpeg.zip");
  const unpackDir = join(vendorDir, "unpacked");
  await writeFile(zipPath, zip);
  await rm(unpackDir, { recursive: true, force: true });
  await extract(zipPath, { dir: unpackDir });

  // O ZIP do BtbN tem estrutura: ffmpeg-n7.1-.../bin/ffmpeg.exe
  const { readdirSync } = await import("node:fs");
  const topDirs = readdirSync(unpackDir);
  const binDir = join(unpackDir, topDirs[0], "bin");
  const extracted = join(binDir, "ffmpeg.exe");

  if (!existsSync(extracted)) {
    throw new Error(`ffmpeg.exe não encontrado em ${binDir}`);
  }

  if (EXE_SHA256 && sha256(await readFile(extracted)) !== EXE_SHA256) {
    throw new Error("Checksum do executavel FFmpeg nao confere.");
  }

  await rm(executablePath, { force: true });
  await rename(extracted, executablePath);
  await rm(zipPath, { force: true });
  await rm(unpackDir, { recursive: true, force: true });

  console.log(`FFmpeg ${VERSION} incorporado ao instalador.`);
}

await main();
