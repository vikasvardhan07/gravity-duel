# Gravity Duel

A real-time 2-player duel that runs in any browser. **One input: hold to push away from the black hole, release to fall in.**

- Move closer to the well and you speed up; move out and you slow down (angular momentum is conserved).
- Grab shards (+1, gold +3). Touch the black hole or the red rim and you're out for 2s.
- Bump your rival — if they fall into the red within 2.5s, you score a **KO +2**.
- 90 seconds. The rim **shrinks** for the last 30s. Tied? **Sudden death.**

Play: Quick Match, a private room link for a friend, or Practice vs Bot (so you can try it solo).

## Run
    npm install && npm start     # http://localhost:3000
    npm test                     # balance sim + network integration test

## Architecture
- `game.js` — authoritative simulation (60 Hz) + bot. No I/O, unit-testable.
- `server.js` — HTTP static + WebSocket rooms, matchmaking queue, reconnect (15s grace), forfeit, 30 Hz snapshots.
- `public/` — canvas client: interpolation, particles, synthesized audio (no assets), touch/mouse/keyboard input.
