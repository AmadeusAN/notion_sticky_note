import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const icons = join(root, "src-tauri", "icons");
const temp = mkdtempSync(join(tmpdir(), "sticky-note-icons-"));
const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");

function generate(source, directory, sizes = []) {
  const args = [cli, "icon", join(icons, source), "--output", directory];
  for (const size of sizes) args.push("--png", String(size));
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Icon generation failed for ${source}`);
}

try {
  const main = join(temp, "main");
  const small = join(temp, "small");
  const tray = join(temp, "tray");
  generate("app.svg", main);
  generate("app-small.svg", small, [16, 20, 24]);
  generate("tray.svg", tray, [32]);

  // Keep only desktop assets; platform-specific mobile output stays in temp.
  for (const name of ["32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.icns"]) {
    copyFileSync(join(main, name), join(icons, name));
  }
  for (const size of [16, 20, 24]) {
    copyFileSync(join(small, `${size}x${size}.png`), join(icons, `${size}x${size}.png`));
  }
  copyFileSync(join(tray, "32x32.png"), join(icons, "tray.png"));

  // Preserve Tauri's desktop frames, substituting deliberately simpler art at
  // tiny sizes instead of relying on a blurry downsample of the large icon.
  const source = readFileSync(join(main, "icon.ico"));
  if (source.readUInt16LE(0) !== 0 || source.readUInt16LE(2) !== 1) {
    throw new Error("Tauri did not produce a valid ICO");
  }
  const frames = [];
  for (let i = 0; i < source.readUInt16LE(4); i++) {
    const start = 6 + i * 16;
    const directory = Buffer.from(source.subarray(start, start + 16));
    const size = directory[0] || 256;
    const length = directory.readUInt32LE(8);
    const offset = directory.readUInt32LE(12);
    if (offset + length > source.length) throw new Error("Truncated ICO frame");
    let image = source.subarray(offset, offset + length);
    if (size === 16 || size === 24) {
      image = readFileSync(join(small, `${size}x${size}.png`));
      directory[2] = 0;
      directory.writeUInt16LE(1, 4);
      directory.writeUInt16LE(32, 6);
    }
    frames.push({ size, directory, image });
  }
  if (!frames.some((frame) => frame.size === 20)) {
    const directory = Buffer.alloc(16);
    directory[0] = directory[1] = 20;
    directory.writeUInt16LE(1, 4);
    directory.writeUInt16LE(32, 6);
    frames.push({ size: 20, directory, image: readFileSync(join(small, "20x20.png")) });
  }
  // Tauri recommends 32px first; Windows chooses the appropriate remaining frame.
  frames.sort((a, b) => (a.size === 32 ? 0 : a.size) - (b.size === 32 ? 0 : b.size));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    frame.directory.writeUInt32LE(frame.image.length, 8);
    frame.directory.writeUInt32LE(offset, 12);
    frame.directory.copy(header, 6 + i * 16);
    offset += frame.image.length;
  }
  writeFileSync(join(icons, "icon.ico"), Buffer.concat([header, ...frames.map((frame) => frame.image)]));
  console.log(`Desktop ICO frames: ${frames.map((frame) => frame.size).join(", ")}px`);
  console.log("Application and tray icons regenerated.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
