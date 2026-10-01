# Night of the Dead

## Status: Phase 6 — COMPLETE GAME (includes Phases 1-5)

```bash
npm install
npm run dev
```
Open http://localhost:3000 and click "Click to play".

Controls: WASD move · Shift sprint · Space jump · Mouse look · LMB shoot · R reload · Esc release mouse

Phase 6: instanced environment (windows, lane marks, poles, trees), frozen static matrices, real dynamic
barrels/crates (push them, shoot them), ruined walls, detailed zombie models (blood, hair, brute armor),
zombies rise from the ground, limping/lurching variation, random death falls, distance LOD
(far zombies are hidden and not animated), heartbeat at low health, F3 shows FPS.

Phase 5: knife (key 2 / wheel; short-range cone hit, cooldown), flashlight (F), stars, 3D zombie audio
(growls, attacks, hurt, death), footsteps, wind, wave sting.
Controls: WASD, Shift, Space, LMB attack, R reload, F flashlight, 1/2 or wheel switch weapon.

Phase 4: wave system. Wave 1 = 5 zombies, wave 2 = 10, wave 3 = 15, wave 4 = faster zombies,
wave 5+ = stronger zombies (more health/damage). Clearing a wave gives score, +20 health, +30 pistol ammo.
Score: +10 per hit, kill bonus by zombie type (walker 100 / runner 150 / brute 300), +50 headshot kill.
Zombies: IDLE → DETECT → CHASE → ATTACK → TAKE_DAMAGE → DEAD. Game over shows score and wave reached.

## Adding a weapon
1. Add a `WeaponDef` in `src/game/Weapons/WeaponDefs.ts` (damage, cooldown, auto, pellets, ammo...).
2. In `GameManager.create`: `.register(new Gun(MY_DEF))`. It appears in the HUD and on keys 1-9 automatically.
