import { mkdir } from "node:fs/promises";
import index from "./index.html";

// PORT and DATA_DIR let a second copy (a git worktree) run beside the real one and read its calibration
const port = Number(process.env.PORT) || 3210;
const dir = process.env.DATA_DIR || `${import.meta.dir}/calibration`;
let designing = false; // one Haiku design run at a time
const maxBody = 16 << 20; // calibration is ~5 MB at 720p; a 1080p webcam roughly doubles it

// POSTs only from this page: other sites in the browser (cross-site requests, DNS rebinding) get 403.
// curl sends no sec-fetch-site/origin, so terminal testing still works.
function forbidden(req: Request) {
  const h = req.headers, host = h.get("host"), site = h.get("sec-fetch-site"), origin = h.get("origin");
  const sameOrigin = site ? site === "same-origin" : !origin || origin === `http://${host}`;
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) return new Response("bad host", { status: 403 });
  if (!sameOrigin) return new Response("cross-site", { status: 403 });
  if (Number(h.get("content-length")) > maxBody) return new Response("too large", { status: 413 });
  return null;
}

// Haiku's reply as an object: the whole output, else the first balanced {...} that parses (braces in strings skipped).
function firstObject(s: string) {
  try {
    return JSON.parse(s);
  } catch {}
  for (let start = s.indexOf("{"); start >= 0; start = s.indexOf("{", start + 1)) {
    let depth = 0, str = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (str) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') str = false;
      } else if (ch === '"') str = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error("no JSON object in reply");
}

// `bun start` (--open): open the browser too; if the games are already running, just open it again.
const url = `http://localhost:${port}`;
const open = () =>
  Bun.spawn(process.platform === "win32" ? ["cmd", "/c", "start", "", url] : [process.platform === "darwin" ? "open" : "xdg-open", url]);
if (process.argv.includes("--open") && (await fetch(url).then(() => true, () => false))) {
  console.log(`Already running: opening ${url}`);
  await open().exited;
  process.exit(0);
}

Bun.serve({
  hostname: "127.0.0.1", // camera page: keep it off the LAN
  port,
  development: true,
  idleTimeout: 255, // seconds (Bun's max): POST /design waits for Haiku, about a minute
  maxRequestBodySize: maxBody, // also covers chunked bodies, which forbidden() can't size
  routes: {
    "/": index,
    "/calibration": {
      GET: async () => {
        const f = Bun.file(`${dir}/calibration.json`);
        return (await f.exists()) ? new Response(f) : new Response("not calibrated", { status: 404 });
      },
      POST: async (req) => {
        const no = forbidden(req);
        if (no) return no;
        const form = await req.formData();
        const json = form.get("json"), black = form.get("black"), white = form.get("white"), map = form.get("map");
        if (typeof json !== "string" || !(black instanceof Blob) || !(white instanceof Blob) || !(map instanceof Blob))
          return new Response("expected json, black, white, map", { status: 400 });
        try {
          JSON.parse(json); // never overwrite a good calibration with garbage
        } catch {
          return new Response("bad json", { status: 400 });
        }
        await mkdir(dir, { recursive: true });
        await Promise.all([
          Bun.write(`${dir}/calibration.json`, json),
          Bun.write(`${dir}/black.png`, black),
          Bun.write(`${dir}/white.png`, white),
          Bun.write(`${dir}/map.bin`, map),
        ]);
        return new Response("ok");
      },
    },
    "/calibration/map": async () => {
      const f = Bun.file(`${dir}/map.bin`);
      return (await f.exists()) ? new Response(f) : new Response("no map", { status: 404 });
    },
    // photo of the lit wall from the last E scan: input for the Haiku level director
    // E scan: the PNG for the Haiku director, plus an archive copy (raw grayscale + the calibration it was mapped with)
    // under calibration/scans/<time>/, so edge detection can be scored against many walls (tools/edge_eval.ts).
    "/photo": {
      POST: async (req) => {
        const no = forbidden(req);
        if (no) return no;
        const form = await req.formData();
        const png = form.get("png"), raw = form.get("raw");
        if (!(png instanceof Blob) || !(raw instanceof Blob) || !png.size || !raw.size) return new Response("expected png + raw", { status: 400 });
        await mkdir(dir, { recursive: true });
        await Bun.write(`${dir}/edges.png`, png);
        const scan = `${dir}/scans/${new Date().toISOString().replace(/[:.]/g, "-")}`;
        await mkdir(scan, { recursive: true });
        await Promise.all([
          Bun.write(`${scan}/edges.png`, png),
          Bun.write(`${scan}/white.gray`, raw),
          Bun.write(`${scan}/map.bin`, Bun.file(`${dir}/map.bin`)),
          Bun.write(`${scan}/calibration.json`, Bun.file(`${dir}/calibration.json`)),
        ]);
        return new Response("ok");
      },
    },
    "/director": async () => {
      const f = Bun.file(`${dir}/director.json`);
      // a plan older than level.json was made for another scan (or before a +/- retune of this one): stale
      const fresh = (await f.exists()) && f.lastModified >= Bun.file(`${dir}/level.json`).lastModified;
      return fresh ? new Response(f) : new Response("no plan", { status: 404 });
    },
    // H in the page: render the projector view, ask Claude Haiku (headless Claude Code, the user's own login) for a
    // level plan, save it. Haiku gets the Read tool only; its JSON reply is parsed here, never trusted to write files.
    "/design": {
      POST: async (req) => {
        const no = forbidden(req);
        if (no) return no;
        if (designing) return new Response("Haiku is already designing", { status: 409 });
        designing = true;
        try {
          const cwd = import.meta.dir;
          const view = Bun.spawn(["uv", "run", "--no-project", "--python", "3.13", "--with", "pillow", "python", "-I", "tools/director_view.py"], { cwd, stdout: "pipe", stderr: "pipe" });
          if (await view.exited) return new Response(`view render failed: ${await new Response(view.stderr).text()}`, { status: 500 });
          const { map } = await Bun.file(`${dir}/level.json`).json();
          const prompt = (await Bun.file(`${cwd}/tools/director_prompt.md`).text())
            .replaceAll("{CAL}", dir)
            .replaceAll("{COLS}", `${map[0].length}`)
            .replaceAll("{ROWS}", `${map.length}`)
            .replaceAll("{LASTCOL}", `${map[0].length - 1}`)
            .replaceAll("{LASTROW}", `${map.length - 1}`);
          // --safe-mode: no CLAUDE.md, memory, plugins, hooks or MCP, but still the user's OAuth login (--bare drops it)
          const claude = Bun.spawn(["claude", "-p", prompt, "--model", "haiku", "--safe-mode", "--tools", "Read", "--output-format", "text"], { cwd, stdout: "pipe", stderr: "pipe" });
          const timer = setTimeout(() => claude.kill(), 240_000);
          const [out, code] = await Promise.all([new Response(claude.stdout).text(), claude.exited]);
          clearTimeout(timer);
          if (code) return new Response(`claude exited ${code}: ${(await new Response(claude.stderr).text()).slice(0, 300)}`, { status: 502 });
          const plan = firstObject(out);
          if (typeof plan !== "object" || plan === null || Array.isArray(plan)) throw new Error("not a JSON object");
          await Bun.write(`${dir}/director.json`, JSON.stringify(plan)); // game.ts validates/snaps every field on load
          return Response.json({ name: String(plan.name ?? "untitled").slice(0, 60) });
        } catch (e) {
          return new Response(`design failed: ${e}`, { status: 502 });
        } finally {
          designing = false;
        }
      },
    },
    "/level": {
      GET: async () => {
        const f = Bun.file(`${dir}/level.json`);
        return (await f.exists()) ? new Response(f) : new Response("no level", { status: 404 });
      },
      POST: async (req) => {
        const no = forbidden(req);
        if (no) return no;
        const body = await req.json().catch(() => null);
        const ok =
          Number.isInteger(body?.tile) &&
          Array.isArray(body.map) &&
          body.map.length > 0 &&
          body.map.every((r: unknown) => typeof r === "string" && r.length === body.map[0].length && /^[#.]+$/.test(r));
        if (!ok) return new Response("expected { tile, map: equal-length rows of # and . }", { status: 400 });
        await mkdir(dir, { recursive: true });
        await Bun.write(`${dir}/level.json`, JSON.stringify(body));
        return new Response("ok");
      },
    },
  },
});

console.log(`Edgelands on ${url} (Ctrl+C to stop)`);
if (process.argv.includes("--open")) open();
