'use client';
import dynamic from 'next/dynamic';

// Three.js / Rapier need the browser, so never render on the server.
const GameCanvas = dynamic(() => import('@/game/GameCanvas'), { ssr: false });

export default function Page() {
  return <GameCanvas />;
}
