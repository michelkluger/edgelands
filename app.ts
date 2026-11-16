// Runs fullscreen on the projector (Windows "Duplicate" display). Keys: C calibrate, V verify, E map edges, G play, L camera latency, Esc back.
import { SKIP, bitsFor, decode, fillHoles, lit } from "./calibrate";
import { beamOutside, edgeTiles, fromMap, toMap, type Level } from "./edges";
import { createGame, seeded, type GameEvent } from "./game";

type Calib = { proj: [number, number]; cam: [number, number]; decoded: number; lit: number };

const canvas = document.querySelector("canvas")!;
const ctx = canvas.getContext("2d")!;
const video = document.querySelector("video")!;
const grab = new OffscreenCanvas(1, 1);
const gctx = grab.getContext("2d", { willReadFrequently: true })!;

let calib: Calib | null = null;
let lut: Int16Array | null = null; // hole-filled camera→projector lookup, 2 values per camera pixel
let level: Level | null = null;
let game: ReturnType<typeof createGame> | null = null;
let mode: "idle" | "busy" | "verify" | "edges" | "game" = "idle";
let msg = "";
let track: MediaStreamTrack;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<void>((r) => video.requestVideoFrameCallback(() => r()));
const fill = (c: string) => ((ctx.fillStyle = c), ctx.fillRect(0, 0, canvas.width, canvas.height));

function resize() {
  canvas.width = Math.round(innerWidth * devicePixelRatio);
  canvas.height = Math.round(innerHeight * devicePixelRatio);
  if (mode === "idle") screen();
}

function screen() {
  fill("#222");
  ctx.fillStyle = "#fff";
  const size = Math.round(canvas.height / 28);
  ctx.font = `${size}px sans-serif`;
  const lines = [
    "C calibrate (room light off) · V verify · E map edges · H Haiku designs the level · G play · L camera latency · Esc back",
    "In game: R restart same level · Enter next round · 2 two players · H Haiku redesign · M mute",
    calib
      ? `Calibrated ${calib.proj.join("×")}: ${Math.round((100 * calib.decoded) / calib.lit)}% of the lit area mapped`
      : "Not calibrated yet",
    level ? `Edge map: ${level.solid.reduce((a, b) => a + b, 0)} tiles` : "No edge map yet (E)",
    msg,
  ];
  lines.forEach((l, i) => ctx.fillText(l, size, size * 2 * (i + 1)));
}

/** Freeze exposure, white balance and focus at their current auto values, or explain why not. */
async function lockCamera() {
  const caps = track.getCapabilities() as any, set = track.getSettings() as any, adv: any = {};
  if (caps.exposureMode?.includes("manual")) Object.assign(adv, { exposureMode: "manual" }, set.exposureTime && { exposureTime: set.exposureTime });
  if (caps.whiteBalanceMode?.includes("manual")) Object.assign(adv, { whiteBalanceMode: "manual" }, set.colorTemperature && { colorTemperature: set.colorTemperature });
  if (caps.focusMode?.includes("manual")) Object.assign(adv, { focusMode: "manual" }, set.focusDistance && { focusDistance: set.focusDistance });
  if (!Object.keys(adv).length) return "Camera can't lock exposure (auto stays on, results may be noisy)";
  try {
    await track.applyConstraints({ advanced: [adv] });
    return `Locked ${Object.keys(adv).filter((k) => k.endsWith("Mode")).join(", ")}`;
  } catch (e) {
    return `Exposure lock failed: ${e}`;
  }
}

function grayFrame(channel: "lum" | "red", w = video.videoWidth, h = video.videoHeight) {
  if (grab.width !== w || grab.height !== h) (grab.width = w), (grab.height = h);
  gctx.drawImage(video, 0, 0, w, h); // a smaller w×h downscales
  const d = gctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = channel === "red" ? d[i * 4] : (d[i * 4] + 2 * d[i * 4 + 1] + d[i * 4 + 2]) >> 2;
  return g;
}

/** Project something, wait until the camera has really seen it, return a grayscale frame. */
async function shoot(draw: () => void) {
  draw();
  await sleep(250);
  await nextFrame();
  await nextFrame();
  return grayFrame("lum");
}

function stripes(vertical: boolean, k: number, bits: number, inverse: boolean) {
  fill("#000");
  ctx.fillStyle = "#fff";
  const size = vertical ? canvas.width : canvas.height, step = 1 << SKIP;
  for (let c = 0; c < size; c += step)
    if (lit(c, k, bits) !== inverse) vertical ? ctx.fillRect(c, 0, step, canvas.height) : ctx.fillRect(0, c, canvas.width, step);
}

async function png(g: Uint8Array, w: number, h: number) {
  const c = new OffscreenCanvas(w, h), x = c.getContext("2d")!, img = x.createImageData(w, h);
  for (let i = 0; i < g.length; i++) img.data.set([g[i], g[i], g[i], 255], i * 4);
  x.putImageData(img, 0, 0);
  return c.convertToBlob({ type: "image/png" });
}

/** Real fullscreen, so no tabs or taskbar get projected and the canvas size matches between calibrate and play. */
async function fullscreen() {
  if (document.fullscreenElement) return;
  await document.documentElement.requestFullscreen().catch(() => {});
  await sleep(600); // wait for the resize event
}

/** Light the wall white and freeze the camera on it. Returns the lock status message. */
async function lightUp() {
  await fullscreen();
  // release an earlier lock, so the wait below really re-exposes for this room's light
  const caps = track.getCapabilities() as any, auto: any = {};
  for (const k of ["exposureMode", "whiteBalanceMode", "focusMode"]) if (caps[k]?.includes("continuous")) auto[k] = "continuous";
  await track.applyConstraints({ advanced: [auto] }).catch(() => {});
  fill("#fff");
  await sleep(4000); // let auto-exposure settle, and the browser's "now full screen" toast fade, before capturing
  return lockCamera();
}

async function calibrate() {
  if (!track) return ((msg = "No camera: calibration needs the webcam"), screen());
  mode = "busy";
  const lockMsg = await lightUp();
  const black = await shoot(() => fill("#000"));
  const white = await shoot(() => fill("#fff"));
  const pairs = async (vertical: boolean) => {
    const bits = bitsFor(vertical ? canvas.width : canvas.height), out: [Uint8Array, Uint8Array][] = [];
    for (let k = 0; k < bits; k++) out.push([await shoot(() => stripes(vertical, k, bits, false)), await shoot(() => stripes(vertical, k, bits, true))]);
    return out;
  };
  const cols = await pairs(true), rows = await pairs(false);
  const cw = video.videoWidth, ch = video.videoHeight;
  const { map, lit: litN, decoded } = decode(black, white, cols, rows);
  if (decoded < 1000) {
    msg = `${lockMsg}. Only ${decoded} camera pixels decoded. Does the webcam see the projection? Is the room light off?`;
    mode = "idle";
    return screen();
  }
  calib = { proj: [canvas.width, canvas.height], cam: [cw, ch], decoded, lit: litN };
  lut = fillHoles(map, cw, ch);
  const form = new FormData();
  form.set("json", JSON.stringify(calib));
  form.set("black", await png(black, cw, ch));
  form.set("white", await png(white, cw, ch));
  form.set("map", new Blob([map.buffer]));
  const saved = await fetch("/calibration", { method: "POST", body: form }).then((r) => r.ok, () => false);
  // the beam touching the camera frame's border = part of the projection is outside the camera's view
  let onBorder = 0;
  for (let x = 0; x < cw; x++) onBorder += Number(map[2 * x] >= 0) + Number(map[2 * ((ch - 1) * cw + x)] >= 0);
  for (let y = 0; y < ch; y++) onBorder += Number(map[2 * y * cw] >= 0) + Number(map[2 * (y * cw + cw - 1)] >= 0);
  const hint =
    onBorder > 20 ? " ⚠ The projection runs off the edge of the webcam view: turn the laptop until the whole projection is visible, then press C again."
    : litN < cw * ch * 0.1 ? " ⚠ The projection fills under 10% of the webcam view: point the webcam at it (or move closer), then press C again."
    : decoded / litN < 0.6 ? " Under 60% mapped: check the webcam sees the whole beam and the room is dark, then press C again."
    : "";
  msg = `${lockMsg}. ${saved ? "Saved. Press V to verify." : "SAVE FAILED (check the server console); calibration kept until reload."}${hint}`;
  mode = "idle";
  screen();
}

/** L: flash the wall white and time until a camera frame shows it (projector + camera lag, what webcam input will feel). */
async function latency() {
  if (!track) return ((msg = "No camera: the latency meter needs the webcam"), screen());
  mode = "busy";
  await fullscreen();
  const mean = (g: Uint8Array) => g.reduce((a, b) => a + b, 0) / g.length;
  const white = mean(await shoot(() => fill("#fff"))), times: number[] = [];
  for (let k = 0; k < 5; k++) {
    const black = mean(await shoot(() => fill("#000")));
    if (white - black < 10) break; // the camera doesn't see the projection
    fill("#fff");
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      await nextFrame();
      const t = performance.now();
      if (mean(grayFrame("lum", 160, 90)) > (black + white) / 2) { times.push(t - t0); break; } // 160×90: fast enough per frame
    }
  }
  msg = times.length
    ? `Camera latency ≈ ${Math.round(times.reduce((a, b) => a + b) / times.length)} ms over ${times.length} flashes (jump timing windows are 100 ms)`
    : "Latency: the camera never saw the white flash. Does it see the projection?";
  mode = "idle";
  screen();
}

function notReady() {
  if (!calib || !lut) return "Calibrate first (C)";
  if (video.videoWidth !== calib.cam[0] || canvas.width !== calib.proj[0] || canvas.height !== calib.proj[1])
    return "Camera or screen resolution changed since calibration: press C again";
  return "";
}

/** Photograph the wall under white light and turn its sharp edges into platform tiles. */
async function mapEdges() {
  if (notReady()) return ((msg = notReady()), screen());
  mode = "busy";
  await lightUp();
  // average 8 frames: single webcam frames carry sensor noise and projector flicker bands that look like fake edges
  const sum = new Uint32Array(calib!.cam[0] * calib!.cam[1]);
  const first = await shoot(() => fill("#fff"));
  for (let k = 0; k < 8; k++) {
    const g = k ? (await nextFrame(), grayFrame("lum")) : first;
    for (let i = 0; i < sum.length; i++) sum[i] += g[i];
  }
  lastWhite = Uint8Array.from(sum, (v) => v >> 3);
  const photo = new FormData();
  photo.set("png", await png(lastWhite, calib!.cam[0], calib!.cam[1]));
  photo.set("raw", new Blob([lastWhite]));
  await fetch("/photo", { method: "POST", body: photo }).catch(() => {});
  // projector or camera moved since C? Then the camera→projector map is wrong and every edge lands in the wrong place.
  // Good scans put 1–15% of the beam outside the calibrated area (a lit arm in front of the wall); moved ones 55–95%.
  const outside = beamOutside(lastWhite, lut!);
  if (outside > 0.3) {
    lastWhite = null;
    mode = "idle";
    msg = `⚠ The projection moved since calibration (${Math.round(outside * 100)}% of the beam is outside the calibrated area): press C, then E`;
    return screen();
  }
  mode = "edges";
  minGrad = 18; // a new scan starts at the default sensitivity, not at the last scan's +/− setting
  await retune(0);
}

/** Recompute edges from the last capture at a new sensitivity (+ / − keys), save, redraw. No recapture needed. */
let lastWhite: Uint8Array | null = null, minGrad = 18;
async function retune(delta: number) {
  if (!lastWhite || !calib || !lut) return ((msg = "Press E to capture the wall first"), showEdges());
  minGrad = Math.max(4, minGrad + delta);
  // calibration size, not canvas size: the lookup table maps to it even if fullscreen was left meanwhile
  level = edgeTiles(lastWhite, calib.cam[0], calib.cam[1], lut, calib.proj[0], calib.proj[1], 8, minGrad);
  const saved = await fetch("/level", { method: "POST", body: JSON.stringify({ tile: level.tile, map: toMap(level) }) }).then((r) => r.ok, () => false);
  msg = saved ? "" : "Edge map SAVE FAILED (check the server console)";
  showEdges();
}

/** Glowing tiles on the black wall: they should sit exactly on the real edges. */
function showEdges() {
  if (!level) return;
  const T = level.tile;
  fill("#000");
  ctx.shadowColor = "#00e5ff";
  ctx.shadowBlur = T;
  ctx.fillStyle = "#00e5ff";
  for (let i = 0; i < level.solid.length; i++) if (level.solid[i]) ctx.fillRect((i % level.cols) * T, Math.floor(i / level.cols) * T, T, T);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#888";
  ctx.font = `${2 * T}px sans-serif`;
  ctx.fillText(
    `${level.solid.reduce((a, b) => a + b, 0)} edge tiles · threshold ${minGrad} (+ more edges, − fewer) · E rescan · G play · Esc back ${msg && "· " + msg}`,
    3 * T,
    canvas.height - 3 * T,
  );
}

const held = new Set<string>();
let last = 0, acc = 0, round = 1, players = 1;
let raf = 0; // the one running draw loop (game or verify): a restart cancels it instead of stacking a second loop
let seed = newSeed(); // one seed per round: R replays the exact same level (twist, exit, start); a new round or G rolls a new one
function newSeed() {
  return (Math.random() * 2 ** 32) >>> 0;
}
async function startGame() {
  if (!level) return ((msg = "Map the edges first (E)"), screen());
  // fetched fresh each start, so a plan the director just wrote applies without a reload
  const plan = await fetch("/director").then((r) => (r.ok ? r.json() : null), () => null).catch(() => null);
  game = createGame(level, seeded(seed), plan, { players, round });
  game.state.best = Number(store(bestKey())) || 0;
  game.state.secretsTotal = Number(store("secrets")) || 0;
  mode = "game";
  last = acc = 0;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(gameFrame);
}

/** H: the local server asks Claude Haiku to design a level for the last E scan (takes about a minute). */
let toastUntil = 0;
async function design() {
  const redraw = () => (mode === "edges" ? showEdges() : mode === "idle" ? screen() : undefined);
  msg = "Haiku is designing a level for this wall… (about a minute)";
  redraw();
  const res = await fetch("/design", { method: "POST" }).catch((e) => new Response(String(e), { status: 599 }));
  const play = mode === "game" ? "R" : "G";
  msg = res.ok ? `Haiku designed "${(await res.json()).name}": press ${play} to play it` : `Haiku design failed: ${(await res.text()).slice(0, 160)}`;
  toastUntil = performance.now() + 8000; // in a game the message shows as a banner for 8 s
  redraw();
}

const bestKey = () => `best:r${round}:p${players}`;
/** localStorage can throw (private window, blocked storage): best times are a nicety, never a crash. */
function store(key: string, value?: string) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {}
  return null;
}

function inputs() {
  const h = (...codes: string[]) => codes.some((c) => held.has(c));
  if (players === 1) return [{ left: h("ArrowLeft", "KeyA"), right: h("ArrowRight", "KeyD"), jump: h("Space", "ArrowUp", "KeyW"), down: h("ArrowDown", "KeyS") }];
  return [
    { left: h("KeyA"), right: h("KeyD"), jump: h("KeyW", "Space"), down: h("KeyS") },
    { left: h("ArrowLeft"), right: h("ArrowRight"), jump: h("ArrowUp"), down: h("ArrowDown") },
  ];
}

function gameFrame(now: number) {
  if (mode !== "game" || !game) return;
  acc = Math.min(acc + (last ? now - last : 0), 100); // cap catch-up after a stall
  last = now;
  for (; acc >= 1000 / 60; acc -= 1000 / 60) {
    game.step(inputs());
    for (const ev of game.state.events) sfx(ev);
    if (game.state.events.includes("secret")) store("secrets", String(++game.state.secretsTotal));
    if (game.state.events.includes("win") && (!game.state.best || game.state.frames < game.state.best))
      (game.state.best = game.state.frames), store(bestKey(), String(game.state.frames));
  }
  // the level is in projector px; stretch it to the canvas (1:1 when fullscreen on the projector, still playable in a window)
  ctx.setTransform(canvas.width / (level!.cols * level!.tile), 0, 0, canvas.height / (level!.rows * level!.tile), 0, 0);
  game.draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (performance.now() < toastUntil) { // banner for H in a game: designing… / designed
    ctx.font = `${Math.round(canvas.height / 32)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, canvas.height * 0.06, canvas.width, canvas.height / 18);
    ctx.fillStyle = "#7df9ff";
    ctx.fillText(msg, canvas.width / 2, canvas.height * 0.06 + canvas.height / 26);
    ctx.textAlign = "start";
  }
  raf = requestAnimationFrame(gameFrame);
}

// Tiny synthesized sound effects: no audio files. The context starts on the first key press (browser autoplay rule).
// Soft on purpose: sine/triangle only (no buzzy square/saw), quiet, short, through a low-pass, and no sound for
// constant actions (landing, turret shots). M mutes, remembered across reloads.
let audio: AudioContext | null = null, out: AudioNode | null = null;
let muted = store("muted") === "1";
const SOUNDS: Partial<Record<GameEvent, [OscillatorType, number, number, number, number]>> = {
  // wave, start Hz, end Hz, seconds, volume
  coin: ["sine", 880, 1175, 0.09, 0.05],
  stomp: ["triangle", 260, 130, 0.1, 0.06],
  ouch: ["triangle", 240, 120, 0.22, 0.07],
  win: ["triangle", 523, 1047, 0.45, 0.06],
  secret: ["sine", 1047, 2093, 0.35, 0.05],
  power: ["sine", 440, 880, 0.25, 0.06],
  shield: ["triangle", 660, 330, 0.18, 0.06],
};
const lastPlayed: Partial<Record<GameEvent, number>> = {};
function sfx(ev: GameEvent) {
  const sound = SOUNDS[ev];
  if (!audio || muted || !sound) return;
  const [type, f0, f1, dur, vol] = sound, t = audio.currentTime;
  if (t - (lastPlayed[ev] ?? -1) < 0.06) return; // magnet collecting 5 coins at once = one blip, not a machine gun
  lastPlayed[ev] = t;
  if (!out) {
    const lp = audio.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    lp.connect(audio.destination);
    out = lp;
  }
  const osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01); // 10 ms fade-in: no click
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let wall: ImageData, base: Uint8ClampedArray;
function verify() {
  if (notReady()) return ((msg = notReady()), screen());
  mode = "verify";
  wall = ctx.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < wall.data.length; i += 4) wall.data.set([255, 0, 0, 255], i);
  base = wall.data.slice();
  cancelAnimationFrame(raf);
  verifyFrame();
}

// The wall is lit red and edges are read from the camera's red channel only. The overlay adds green
// (red + green = yellow), so it never shows up in that channel. Without this the camera would see its own lines and feed back.
function verifyFrame() {
  if (mode !== "verify" || !calib || !lut) return;
  const [w, h] = calib.cam, W = canvas.width, Hh = canvas.height, g = grayFrame("red"), d = wall.data;
  d.set(base);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      if (gx * gx + gy * gy < 10000) continue;
      const u = lut[2 * i], v = lut[2 * i + 1];
      if (u < 0) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = Math.round(u) + dx, py = Math.round(v) + dy;
          if (px >= 0 && py >= 0 && px < W && py < Hh) d[(py * W + px) * 4 + 1] = 255;
        }
    }
  ctx.putImageData(wall, 0, 0);
  raf = requestAnimationFrame(verifyFrame);
}

// Full reload when the code changes: a hot-swapped module left the page running stale edge code once.
if (import.meta.hot) import.meta.hot.on("bun:afterUpdate", () => location.reload());

addEventListener("resize", resize);
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("keydown", (e) => {
  audio ??= new AudioContext();
  if (mode === "busy") return;
  if (mode === "game") {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyR") return void startGame();
    if (e.code === "KeyM") return void store("muted", (muted = !muted) ? "1" : "0");
    if (e.code === "KeyH") return void ((toastUntil = Infinity), design()); // banner stays until Haiku answers
    if (e.code === "Enter" && game?.state.won) return void (round++, (seed = newSeed()), startGame());
    if (e.code === "Digit2") return void ((players = players === 1 ? 2 : 1), (round = 1), (seed = newSeed()), startGame());
    if (e.code !== "Escape") return void held.add(e.code);
  }
  const k = e.key.toLowerCase();
  if (k === "c") calibrate();
  else if (k === "v") fullscreen().then(verify);
  else if (k === "e") fullscreen().then(mapEdges); // before mapEdges' size check, which Esc's fullscreen exit would fail
  else if (k === "l") latency();
  else if (mode === "edges" && (k === "+" || k === "-")) retune(k === "+" ? -2 : 2); // + = more edges (lower threshold)
  else if (k === "g") (round = 1), (seed = newSeed()), fullscreen().then(startGame);
  else if (k === "h") design();
  else if (k === "escape") (mode = "idle"), (msg = ""), screen();
});

resize();
// Saved calibration and level first: the game itself needs no camera.
calib = await fetch("/calibration").then((r) => (r.ok ? r.json() : null), () => null);
if (calib?.lit) {
  const buf = await fetch("/calibration/map").then((r) => (r.ok ? r.arrayBuffer() : null), () => null);
  if (buf) lut = fillHoles(new Int16Array(buf), calib.cam[0], calib.cam[1]);
} else calib = null; // pre-lookup-table calibration file: recalibrate
const saved = await fetch("/level").then((r) => (r.ok ? r.json() : null), () => null);
if (saved) level = fromMap(saved.tile, saved.map);
screen();
if (location.hash.startsWith("#play")) (round = Number(location.hash.split("=")[1]) || 1), startGame(); // #play or #play=3: straight into a round (also for headless screenshots)
try {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
  video.srcObject = stream;
  await video.play();
  track = stream.getVideoTracks()[0];
  msg = `Camera ${video.videoWidth}×${video.videoHeight} ready`;
} catch (e) {
  msg = `No camera (${e}): playing works, C/V/E need the camera`;
}
if (mode === "idle") screen();
