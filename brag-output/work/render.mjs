// Renders the composition frame by frame.
//   node brag-output/work/render.mjs --stills 3,15.5,30   -> work/stills/<t>.png
//   node brag-output/work/render.mjs --full               -> work/video.mp4 (+ events.json)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const WORK = path.resolve("brag-output/work");
const FPS = 30;
const PORT = 3330;
const args = process.argv.slice(2);

// Data for the composition: capture manifest + Austin figures from the app's snapshot.
const manifest = JSON.parse(fs.readFileSync(path.join(WORK, "shots/manifest.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.resolve("src/data/austin-report.json"), "utf8"));
const austin = {
  total: report.totals.expiredResidential,
  remote: report.headline.remoteEligible,
  remotePct: report.headline.remoteEligiblePct,
  floorPct: report.headline.conservativeFloorPct,
  hvacPct: report.whatIf.remoteEligiblePctIfIncluded,
  snapshot: new Date(report.dataset.fetchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
};
fs.writeFileSync(path.join(WORK, "composition/data.js"), `window.MANIFEST = ${JSON.stringify(manifest)};\nwindow.AUSTIN = ${JSON.stringify(austin)};\n`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const server = http
  .createServer((req, res) => {
    const file = path.join(WORK, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(WORK) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT);

const browser = await chromium.launch();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`http://localhost:${PORT}/composition/index.html`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const draw = (page, t) =>
  page.evaluate(async (t) => {
    await window.renderAt(t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, t);

try {
  if (args[0] === "--stills") {
    const page = await openPage();
    const dir = path.join(WORK, "stills");
    fs.mkdirSync(dir, { recursive: true });
    for (const t of args[1].split(",").map(Number)) {
      await draw(page, t);
      await page.screenshot({ path: path.join(dir, `${t.toFixed(2)}.png`) });
      console.log(`still ${t}`);
    }
  } else if (args[0] === "--full") {
    const probe = await openPage();
    const events = await probe.evaluate(() => window.EVENTS);
    await probe.close();
    fs.writeFileSync(path.join(WORK, "events.json"), JSON.stringify(events, null, 2));
    const total = Math.round(events.duration * FPS);
    const workers = Math.max(2, Math.min(6, Math.floor(os.cpus().length / 2)));
    const per = Math.ceil(total / workers);
    const segDir = path.join(WORK, "segments");
    fs.mkdirSync(segDir, { recursive: true });
    const t0 = Date.now();
    let done = 0;
    await Promise.all(
      Array.from({ length: workers }, async (_, w) => {
        const from = w * per;
        const to = Math.min(total, from + per);
        const page = await openPage();
        const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", String(FPS), path.join(segDir, `seg${w}.mp4`)], { stdio: ["pipe", "inherit", "inherit"] });
        const closed = new Promise((r) => ff.on("close", r));
        for (let f = from; f < to; f++) {
          await draw(page, f / FPS);
          const buf = await page.screenshot({ type: "jpeg", quality: 94 });
          if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
          if (++done % 150 === 0) console.log(`  ${done}/${total} frames (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        }
        ff.stdin.end();
        await closed;
        await page.close();
      }),
    );
    fs.writeFileSync(path.join(segDir, "list.txt"), Array.from({ length: workers }, (_, w) => `file 'seg${w}.mp4'`).join("\n"));
    await new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(segDir, "list.txt"), "-c", "copy", path.join(WORK, "video.mp4")], { stdio: "inherit" });
      ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`concat failed ${c}`))));
    });
    console.log(`video.mp4: ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s with ${workers} workers`);
  }
} finally {
  await browser.close();
  server.close();
}
