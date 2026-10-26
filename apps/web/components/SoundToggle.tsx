'use client';
import { useEffect, useState } from 'react';
import { isMuted, setMuted } from '../lib/sound';

export function SoundToggle() {
  const [m, setM] = useState(false);
  useEffect(() => setM(isMuted()), []);
  return <button className="btn btn-ghost" aria-label={m ? 'Turn sound on' : 'Turn sound off'} title={m ? 'Sound off' : 'Sound on'} onClick={() => { setMuted(!m); setM(!m); }}>{m ? '🔇' : '🔊'}</button>;
}
