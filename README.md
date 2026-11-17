# Edgelands

Games that live on your wall: a projector draws them, a webcam maps the room's real edges into levels and turns your shadow into a controller.

## Start

Needs [Bun](https://bun.sh) and Chrome or Edge (camera access).

| OS | Start |
|---|---|
| Windows | double-click `start.cmd` |
| macOS | double-click `start.command` |
| Linux | `./start.sh` |
| any | `bun start` |

It serves http://localhost:3210 and opens it in your browser; if it's already running, it just opens the page again. Set the projector to mirror the screen (Windows: Win+P → Duplicate), then use the menu: arrows + Enter, or the letters.

First time: **C** calibrate (room light off), **E** map the edges, then **G** Edge Runner or **S** Shadow Catch.

Development: `bun run dev` (hot reload), `bun test`.
