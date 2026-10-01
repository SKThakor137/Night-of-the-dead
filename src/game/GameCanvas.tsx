'use client';
import { useEffect, useRef, useState } from 'react';
import { GameManager } from './Systems/GameManager';
import { GameStore } from './Systems/GameStore';
import HUD from './UI/HUD';

export default function GameCanvas() {
  const rootRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameManager | null>(null);
  const [store] = useState(() => new GameStore());

  useEffect(() => {
    let cancelled = false;
    let game: GameManager | null = null;

    GameManager.create(rootRef.current!, store, () => cancelled).then(g => {
      if (!g) return;                          // aborted before anything was built
      if (cancelled) { g.dispose(); return; }  // unmounted while building
      game = g;
      gameRef.current = g;
    });

    return () => {
      cancelled = true;
      game?.dispose();
      gameRef.current = null;
    };
  }, [store]);

  return (
    <>
      <div id="game-root" ref={rootRef} />
      <HUD store={store} onPlay={() => gameRef.current?.requestLock()} onRestart={() => gameRef.current?.restart()} />
    </>
  );
}
