'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { sounds } from '@/lib/sound';
import {
  CARD_BACKS,
  FELTS,
  isPremiumCardBack,
  isPremiumFelt,
  type CardBack,
  type Felt,
  type Motion,
} from '@/lib/prefs';
import { usePrefs } from '@/lib/prefs-context';

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sound, deck, felt, card back and motion settings (kept in this browser). */
export function PreferencesForm() {
  const { prefs, update, premium, checkPremium } = usePrefs();
  useEffect(() => checkPremium(), [checkPremium]);
  // Premium themes (T2): selectable once unlocked.
  const option = (value: string, premiumOption: boolean) => (
    <option key={value} value={value} disabled={premiumOption && premium !== true}>
      {label(value)}
      {premiumOption ? ' ★' : ''}
    </option>
  );
  return (
    <div className="stack prefs" style={{ gap: 10 }} data-testid="preferences">
      <label className="row small">
        <input
          type="checkbox"
          name="sound"
          checked={prefs.sound}
          onChange={(e) => update({ sound: e.target.checked })}
        />
        Sounds (your turn, cards, chips, wins)
      </label>
      <label className="row small">
        Volume
        <input
          type="range"
          name="volume"
          min={0}
          max={1}
          step={0.1}
          value={prefs.volume}
          disabled={!prefs.sound}
          onChange={(e) => update({ volume: Number(e.target.value) })}
        />
        <button
          type="button"
          className="btn small"
          disabled={!prefs.sound}
          onClick={() => sounds.play('turn', prefs.volume)}
        >
          Test
        </button>
      </label>
      <label className="row small">
        <input
          type="checkbox"
          name="fourColorDeck"
          checked={prefs.fourColorDeck}
          onChange={(e) => update({ fourColorDeck: e.target.checked })}
        />
        Four-color deck (blue diamonds, green clubs)
      </label>
      <label className="row small">
        Felt
        <select
          name="felt"
          value={prefs.felt}
          onChange={(e) => update({ felt: e.target.value as Felt })}
        >
          {FELTS.map((f) => option(f, isPremiumFelt(f)))}
        </select>
        Card back
        <select
          name="cardBack"
          value={prefs.cardBack}
          onChange={(e) => update({ cardBack: e.target.value as CardBack })}
        >
          {CARD_BACKS.map((b) => option(b, isPremiumCardBack(b)))}
        </select>
      </label>
      {premium === false && (
        <p className="muted small" data-testid="premium-locked">
          ★ Premium felts and card backs: <Link href="/store">unlock them in the store</Link> (looks
          only).
        </p>
      )}
      <label className="row small">
        Animations
        <select
          name="motion"
          value={prefs.motion}
          onChange={(e) => update({ motion: e.target.value as Motion })}
        >
          <option value="auto">As the system setting</option>
          <option value="reduced">Reduced</option>
        </select>
      </label>
    </div>
  );
}
