'use client';
import { useSyncExternalStore } from 'react';
import type { GameStore } from '../Systems/GameStore';

interface Props {
  store: GameStore;
  onPlay: () => void;
  onRestart: () => void;
}

/** Reads the store (written by the game loop). Re-renders only when a HUD value actually changes. */
export default function HUD({ store, onPlay, onRestart }: Props) {
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const ready = s.phase !== 'loading';

  return (
    <>
      {(s.phase === 'playing' || s.phase === 'dead') && (
        <>
          {/* Damage feedback */}
          {s.damageTick > 0 && <div key={s.damageTick} className="dmg-flash" />}
          <div className="low-hp" style={{ opacity: Math.max(0, (40 - s.health) / 40) }} />

          {/* Health (top-left) */}
          <div className="health">
            <div className="health-label">HEALTH <b>{s.health}</b></div>
            <div className="health-bar"><div style={{ width: `${(s.health / s.maxHealth) * 100}%` }} /></div>
          </div>

          {/* Zombies (top-center) */}
          <div className="topbar">
            <span>WAVE <b>{s.wave || '-'}</b></span>
            <span>SCORE <b>{s.score}</b></span>
            <span>ZOMBIES <b>{s.remaining}</b></span>
          </div>

          {/* Wave banner */}
          {s.banner && s.phase === 'playing' && (
            <div key={s.banner} className="banner">
              <h2>{s.banner}</h2>
              <div>{s.bannerSub}</div>
            </div>
          )}

          {/* Crosshair */}
          <div className={'crosshair' + (s.weaponKind === 'melee' ? ' melee' : '')}>
            <i /><i /><i /><i />
            {s.hitTick > 0 && <b key={s.hitTick} className={'hitmarker' + (s.killTick > 0 ? ' kill' : '')} />}
          </div>

          {/* Ammo (bottom-right) */}
          <div className="ammo">
            <div className="ammo-name">{s.weaponName}</div>
            {s.weaponKind === 'ranged' ? (
              <div className="ammo-count">
                <span className={s.ammo === 0 ? 'empty' : ''}>{s.ammo}</span>
                <small> / {s.reserve}</small>
              </div>
            ) : <div className="ammo-count">—</div>}
            {s.reloading && <div className="reloading">RELOADING…</div>}
          </div>

          <div className="torch">[F] FLASHLIGHT <b className={s.flashlight ? 'on' : ''}>{s.flashlight ? 'ON' : 'OFF'}</b></div>

          {/* Weapon slots */}
          <div className="slots">
            {s.slots.map((n, i) => (
              <span key={n} className={i === s.slot ? 'on' : ''}>{i + 1} {n}</span>
            ))}
          </div>
        </>
      )}

      <div className="vignette" />
      {s.showFps && <div className="fps">{s.fps} FPS</div>}

      {s.phase === 'dead' && (
        <div className="overlay dead">
          <h1>GAME OVER</h1>
          <div className="stats">
            <div>SCORE <b>{s.finalScore}</b></div>
            <div>WAVE REACHED <b>{s.finalWave}</b></div>
          </div>
          <button className="btn" onClick={onRestart}>RESTART</button>
        </div>
      )}

      {!s.locked && s.phase !== 'dead' && (
        <div className="overlay" onClick={ready ? onPlay : undefined} style={{ cursor: ready ? 'pointer' : 'default' }}>
          <h1>NIGHT OF THE DEAD</h1>
          <div className="big">{!ready ? 'Loading physics…' : s.phase === 'menu' ? 'Click to play' : 'PAUSED — click to resume'}</div>
          <div className="help">
            WASD move · Shift sprint · Space jump · Mouse look<br />
            Left click shoot / stab · R reload · F flashlight<br />1 / 2 or mouse wheel switch weapon · F3 FPS · Esc release mouse
          </div>
        </div>
      )}
    </>
  );
}
