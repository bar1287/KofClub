'use client';

import { useEffect, useRef } from 'react';
import { usePrefs } from '../prefs-context';
import { sounds } from '../sound';
import { soundsFor } from './sounds';
import type { TableState } from './state';

/** Plays the table's sounds when the player has them on (roadmap W1.6). */
export function useTableSounds(state: TableState): void {
  const { prefs } = usePrefs();
  const prev = useRef(state);
  useEffect(() => {
    const kinds = soundsFor(prev.current, state);
    prev.current = state;
    if (!prefs.sound) return;
    for (const kind of kinds) sounds.play(kind, prefs.volume);
  }, [state, prefs.sound, prefs.volume]);
}
