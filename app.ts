// Runs fullscreen on the projector (Windows "Duplicate" display). Menu: arrows + Enter, or a letter: each game has one (games/index.ts), C calibrate, V verify, E map edges, H Haiku level, G Edge Runner; Esc back.
import { SKIP, bitsFor, decode, fillHoles, lit, switchTime } from "./calibrate";
import { beamOutside, edgeTiles, fromMap, toMap, type Level } from "./edges";
import { BACKDROP } from "./catch";
import { createGame, seeded, type GameEvent } from "./game";
import { GAMES } from "./games";
import { drawMenu, menuLayout, moveSel, type MenuItem } from "./menu";
import { shadowMask } from "./shadow";
import { fakeMask, type GameDef, type WallGame } from "./wall";

type Calib = { proj: [number, number]; cam: [number, number]; decoded: number; lit: number; latency?: number }; // latency: ms, projector → camera

const canvas = document.querySelector("canvas")!;
const ctx = canvas.getContext("2d")!;
const video = document.querySelector("video")!;
const grab = new OffscreenCanvas(1, 1);
const gctx = grab.getContext("2d", { willReadFrequently: true })!;

let calib: Calib | null = null;
let lut: Int16Array | null = null; // hole-filled camera→projector lookup, 2 values per camera pixel
let level: Level | null = null;
let game: ReturnType<typeof createGame> | null = null;
let mode: "idle" | "busy" | "verify" | "edges" | "game" | "wall" = "idle";
let msg = "";
let track: MediaStreamTrack;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// next camera frame, or give up after 500 ms: a camera that stops delivering frames must not freeze C or E forever
const nextFrame = () => new Promise<void>((r) => (video.requestVideoFrameCallback(() => r()), setTimeout(r, 500)));
const fill = (c: string) => ((ctx.fillStyle = c), ctx.fillRect(0, 0, canvas.width, canvas.height));

function resize() {
  canvas.width = Math.round(innerWidth * devicePixelRatio);
  canvas.height = Math.round(innerHeight * devicePixelRatio);
  if (mode === "idle") screen();
}

let sel = 0; // highlighted menu item
function menuItems(): MenuItem[] {
  const cal = !calib || !lut ? "Calibrate first (C)" : "", cam = track ? "" : "Needs the webcam", edges = level ? "" : "Map the edges first (E)";
  const games = GAMES.map((d): MenuItem => {
    const best = Number(store(`best:${d.id}`)) || 0;
    return { id: d.id, key: d.key, title: d.title, sub: d.sub + (best ? ` · best ${best}` : ""), hint: d.hint, blocked: d.input === "shadow" ? cam || cal : edges, kind: d.input };
  });
  return [
    { id: "runner", key: "G", kind: "keys", title: "Edge Runner", sub: "Jump along your room's real edges · 1–2 players", blocked: edges, hint: "←→ move · Space jump · ↓ drop · 2 two players · M mute · R retry" },
    ...games.filter((g) => g.kind === "keys"),
    ...games.filter((g) => g.kind === "shadow"),
    { id: "c", key: "C", kind: "setup", title: "Calibrate", sub: "Map projector to camera with stripes. Room light off, about 40 s", blocked: cam },
    { id: "v", key: "V", kind: "setup", title: "Verify", sub: "Live camera edges drawn back onto the wall: they should sit on the real ones", blocked: cam || cal },
    { id: "e", key: "E", kind: "setup", title: "Map edges", sub: "Scan the wall's edges into the level every game plays on", blocked: cam || cal },
    { id: "h", key: "H", kind: "setup", title: "Haiku level", sub: "Claude Haiku designs an Edge Runner level for this wall (about a minute)", blocked: edges },
  ];
}

function screen() {
  const status = [
    { ok: !!track, label: track ? `Camera ${video.videoWidth}×${video.videoHeight}` : "No camera" },
    calib
      ? { ok: true, label: `Calibrated · ${Math.round((100 * calib.decoded) / calib.lit)}% mapped${calib.latency ? ` · ${calib.latency} ms lag` : ""}` }
      : { ok: false, label: "Not calibrated" },
    level ? { ok: true, label: `Edge map · ${level.solid.reduce((a, b) => a + b, 0)} tiles` } : { ok: false, label: "No edge map" },
  ];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawMenu(ctx, canvas.width, canvas.height, menuItems(), sel, status, level, msg);
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

/**
 * Project something, wait until the camera has really seen it, return a grayscale frame.
 * With `lag`, also time how long the change takes to reach the camera (projector + camera + browser): sample small frames
 * during the wait and record when the frame has moved halfway from the old picture to the new one. C's stripe switches
 * give ~36 such samples for free, with no extra flashing.
 */
async function shoot(draw: () => void, lag?: number[]) {
  const before = lag && grayFrame("lum", 160, 90);
  draw();
  const t0 = performance.now(), seen: [number, Uint8Array][] = [];
  // 450 ms per picture: C's stripes change about twice a second, under the 3-per-second photosensitivity limit
  while (performance.now() - t0 < 450) {
    if (!before) { await sleep(450); break; }
    await nextFrame();
    seen.push([performance.now() - t0, grayFrame("lum", 160, 90)]);
  }
  await nextFrame();
  await nextFrame();
  const t = before ? switchTime(before, seen) : undefined;
  if (t !== undefined) lag!.push(t);
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
  await fullscreen();
  fill("#000");
  ctx.fillStyle = "#ccc";
  ctx.font = `${Math.round(canvas.height / 26)}px sans-serif`;
  ctx.fillText("Calibrating: black-and-white stripes for about 20 s, changing twice a second.", canvas.height / 20, canvas.height * 0.4);
  ctx.fillText("If you are sensitive to flashing light, look away now. Starting in 3 s…", canvas.height / 20, canvas.height * 0.4 + canvas.height / 16);
  await sleep(3000);
  const lockMsg = await lightUp();
  const lag: number[] = [];
  const black = await shoot(() => fill("#000"));
  const white = await shoot(() => fill("#fff"));
  const pairs = async (vertical: boolean) => {
    const bits = bitsFor(vertical ? canvas.width : canvas.height), out: [Uint8Array, Uint8Array][] = [];
    for (let k = 0; k < bits; k++) out.push([await shoot(() => stripes(vertical, k, bits, false), lag), await shoot(() => stripes(vertical, k, bits, true), lag)]);
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
  lag.sort((a, b) => a - b);
  const latency = lag.length >= 5 ? Math.round(lag[lag.length >> 1]) : undefined; // median: robust to a missed frame
  calib = { proj: [canvas.width, canvas.height], cam: [cw, ch], decoded, lit: litN, latency };
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
  const lagMsg = latency ? ` Camera latency ≈ ${latency} ms (from ${lag.length} stripe switches).` : "";
  msg = `${lockMsg}. ${saved ? "Saved. Press V to verify." : "SAVE FAILED (check the server console); calibration kept until reload."}${lagMsg}${hint}`;
  mode = "idle";
  screen();
}

/** L: flash the wall white and time until a camera frame shows it (projector + camera lag, what webcam input will feel). */
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

// ---- Wall games (games/index.ts): one runner for keyboard and shadow games ----
const SW = 640, SH = 360; // camera frames for shadow input are downscaled: plenty for 8 px tiles, cheap per frame
let wallDef: GameDef | null = null, wallGame: WallGame | null = null, grid: [number, number, number] = [0, 0, 8], bestSaved = false;
let shadowRef: Uint8Array | null = null, mask: Uint8Array | null = null, freshFrame = false, demo = false;
const pressed = new Set<string>();

/** Shadow games photograph the empty lit wall first (fresh = you step out of the light; R reuses the photo). */
async function startWall(def: GameDef, fresh: boolean) {
  demo = location.hash.startsWith("#game="); // test hook: no camera, a fake swaying shadow instead
  if (def.input === "shadow" && !demo) {
    if (!track) return ((msg = `No camera: ${def.title} needs the webcam`), screen());
    if (notReady()) return ((msg = notReady()), screen());
  } else if (def.input === "keys" && !level) return ((msg = "Map the edges first (E)"), screen());
  cancelAnimationFrame(raf);
  if (def.input === "shadow" && !demo && (fresh || !shadowRef)) {
    mode = "busy";
    for (let n = 3; n > 0; n--) { // steady backdrop + a countdown: no flashing
      fill(BACKDROP);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(canvas.height / 14)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`Step out of the light… ${n}`, canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "start";
      await sleep(1000);
    }
    fill(BACKDROP);
    await sleep(300);
    await lockCamera(); // the empty-wall photo and every live frame need the same exposure
    const sum = new Uint32Array(SW * SH);
    for (let k = 0; k < 6; k++) {
      await nextFrame();
      const g = grayFrame("lum", SW, SH);
      for (let i = 0; i < sum.length; i++) sum[i] += g[i];
    }
    shadowRef = Uint8Array.from(sum, (v) => v / 6);
  }
  // shadow games use the calibrated projector grid (the mask's), keyboard games the edge map's
  const T = level?.tile ?? 8;
  const [pw, ph] = def.input === "shadow" && calib ? calib.proj : level ? [level.cols * T, level.rows * T] : [canvas.width, canvas.height];
  const cols = Math.ceil(pw / T), rows = Math.ceil(ph / T);
  grid = [cols, rows, T];
  wallDef = def;
  const lv = level && level.cols === cols && level.rows === rows ? level : null;
  wallGame = def.create({ cols, rows, T, level: lv, rand: seeded(newSeed()), best: Number(store(`best:${def.id}`)) || 0 });
  mask = null;
  bestSaved = false;
  mode = "wall";
  last = acc = 0;
  held.clear();
  pressed.clear();
  if (def.input === "shadow" && !demo) {
    const watch = () => ((freshFrame = true), mode === "wall" && video.requestVideoFrameCallback(watch));
    video.requestVideoFrameCallback(watch);
  }
  raf = requestAnimationFrame(wallFrame);
}

function wallFrame(now: number) {
  if (mode !== "wall" || !wallGame || !wallDef) return;
  const [cols, rows, T] = grid;
  if (wallDef.input === "shadow") {
    if (demo) mask = fakeMask(cols, rows, now / (1000 / 60));
    else if (freshFrame && shadowRef && lut && calib) { // one shadow mask per camera frame, not per display frame
      freshFrame = false;
      mask = shadowMask(grayFrame("lum", SW, SH), shadowRef, lut, calib.cam[0], calib.cam[0] / SW, cols, rows, T);
    }
  }
  acc = Math.min(acc + (last ? now - last : 0), 100);
  last = now;
  for (; acc >= 1000 / 60; acc -= 1000 / 60) {
    wallGame.step({ held, pressed, mask });
    pressed.clear();
    for (const ev of wallGame.state.events) sfx(ev);
    const st = wallGame.state;
    if (st.over && !bestSaved) { // a finished round: keep the best score
      bestSaved = true;
      const best = Number(store(`best:${wallDef.id}`)) || 0;
      if (st.score > 0 && (!best || (wallDef.lowerIsBetter ? st.score < best : st.score > best))) store(`best:${wallDef.id}`, String(st.score));
    }
  }
  ctx.setTransform(canvas.width / (cols * T), 0, 0, canvas.height / (rows * T), 0, 0);
  wallGame.draw(ctx, mask);
  if (demo && mask) { // the fake player's shadow, as the real one would look on the wall
    ctx.fillStyle = "rgba(20,22,30,0.75)";
    for (let t = 0; t < mask.length; t++) if (mask[t]) ctx.fillRect((t % cols) * T, Math.floor(t / cols) * T, T, T);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  raf = requestAnimationFrame(wallFrame);
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
  if (mode === "wall") { // R and M are reserved: games never use them
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Backspace", "Enter"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyR") return void startWall(wallDef!, false);
    if (e.code === "KeyM") return void store("muted", (muted = !muted) ? "1" : "0");
    if (e.code !== "Escape") return void (e.repeat || pressed.add(e.code), held.add(e.code));
  }
  if (mode === "game") {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyR") return void startGame();
    if (e.code === "KeyM") return void store("muted", (muted = !muted) ? "1" : "0");
    if (e.code === "KeyH") return void ((toastUntil = Infinity), design()); // banner stays until Haiku answers
    if (e.code === "Enter" && game?.state.won) return void (round++, (seed = newSeed()), startGame());
    if (e.code === "Digit2") return void ((players = players === 1 ? 2 : 1), (round = 1), (seed = newSeed()), startGame());
    if (e.code !== "Escape") return void held.add(e.code);
  }
  if (mode === "idle" && e.key.startsWith("Arrow")) return void ((sel = moveSel(sel, e.key, menuLayout(menuItems()))), screen());
  if (mode === "idle" && e.key === "Enter") {
    const it = menuItems()[sel], def = GAMES.find((d) => d.id === it.id);
    if (it.blocked) return void ((msg = it.blocked), screen());
    return void (def ? fullscreen().then(() => startWall(def, true)) : run(it.key!.toLowerCase()));
  }
  run(e.key.toLowerCase());
});

function run(k: string) {
  if (k === "c") calibrate();
  else if (k === "v") fullscreen().then(verify);
  else if (k === "e") fullscreen().then(mapEdges); // before mapEdges' size check, which Esc's fullscreen exit would fail
  else if (mode === "edges" && (k === "+" || k === "-")) retune(k === "+" ? -2 : 2); // + = more edges (lower threshold)
  else if (k === "g") (round = 1), (seed = newSeed()), fullscreen().then(startGame);
  else if (k === "h") design();
  else if (GAMES.some((d) => d.key?.toLowerCase() === k)) fullscreen().then(() => startWall(GAMES.find((d) => d.key?.toLowerCase() === k)!, true));
  else if (k === "escape") (mode = "idle"), (msg = ""), screen();
}

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
const hashGame = GAMES.find((d) => location.hash === `#game=${d.id}`); // #game=<id>: straight into a wall game (tests, screenshots)
if (hashGame) startWall(hashGame, true);
if (location.hash.startsWith("#play")) (round = Number(location.hash.split("=")[1]) || 1), startGame(); // #play or #play=3: straight into a round (also for headless screenshots)
try {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
  video.srcObject = stream;
  await video.play();
  track = stream.getVideoTracks()[0];
  msg = ""; // the camera chip on the menu says it
} catch (e) {
  const why: Record<string, string> = {
    NotAllowedError: "Camera blocked: click the camera icon in the address bar → Allow, then reload (Windows: also Settings → Privacy → Camera → let desktop apps use it)",
    NotReadableError: "Camera busy: another app or tab is using it (Teams, Zoom, a second Edgelands tab or browser). Close it, then reload",
    NotFoundError: "No webcam found: plug one in, then reload",
    OverconstrainedError: "The webcam refused the requested resolution",
  };
  msg = `${why[(e as Error).name] ?? `No camera (${e})`} · Edge Runner works without it`;
  // the camera is only requested at load: once it's allowed in the address bar, reload by ourselves
  navigator.permissions?.query({ name: "camera" as PermissionName }).then((p) => (p.onchange = () => p.state === "granted" && location.reload()), () => {});
}
if (mode === "idle") screen();
