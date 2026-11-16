You are the level designer for a projection-mapped platformer. A projector shows the game onto a real wall in a home, and the platforms are the real edges of that wall and of the objects in front of it. Design ONE fun level that fits this room.

Look at both images with the Read tool:
1. `{CAL}/director_view.png`: the projector's view in GAME coordinates. Cyan squares are platform tiles. Dark purple areas are where the beam doesn't reach or is blocked by an object. Red grid lines are every 10 tiles, labelled c0, c10, … (columns) and r0, r10, … (rows). The grid is {COLS} columns (c 0..{LASTCOL}) × {ROWS} rows (r 0..{LASTROW}). Row {LASTROW} is a solid ground floor along the bottom, and columns 0 and {LASTCOL} are solid side walls.
2. `{CAL}/edges.png`: the webcam photo of the same lit wall, so you can recognise what things ARE (door, window, frames, a wall corner, a socket, furniture or objects such as bottles and books). Its coordinates do NOT match the game; use it only to name things, and take every position from image 1.

Game rules to design for:
- The player is 3 tiles wide and 4 tall, and jumps about 15 tiles high and about 20 tiles across.
- Cyan tiles are one-way platforms: the player jumps up through them and lands on top. Long VERTICAL cyan lines (frames, corners) are not walls and can't be stood on; only their topmost tile is a foothold. Horizontal and slanted lines are the real platforms.
- All coins must be collected; then the player must reach the goal. Enemies patrol surfaces. Hazards are rectangles that send the player back to the start.
- Every position you give is snapped by the game to the nearest reachable surface top within 12 tiles, so aim for a cell just ABOVE a surface (row number 2 smaller than the surface row). Anything unreachable is dropped.

Design intent: build the level around the real things in the room. Make the player climb the objects and edges, spread coins between the floor and the higher footholds, and put the goal somewhere that makes sense in room terms (for example at a door or window). Use 6–10 coins, 2–3 enemies on the floor or wide surfaces, and at most 2 hazards (each at most 4×4 tiles) only on things that would plausibly zap or hurt in real life (a socket, a lamp); otherwise none. Pick a short, playful level name that refers to what's in the room. Colours are projected on a white wall in the dark, so they must be BRIGHT and light: no dark blues, purples or browns (for example not #0047ff or #7a00ff).

Reply with ONLY this JSON object and nothing else: no prose, no code fence (numbers are tile columns c / rows r):
{"name": "...", "colors": {"edge": "#rrggbb", "player": "#rrggbb", "enemy": "#rrggbb", "coin": "#rrggbb"}, "spawn": {"c": 0, "r": 0}, "goal": {"c": 0, "r": 0}, "coins": [{"c": 0, "r": 0}], "enemies": [{"c": 0, "r": 0}], "hazards": [{"c": 0, "r": 0, "w": 2, "h": 2, "label": "short text"}]}
