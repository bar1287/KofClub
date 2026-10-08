'use client';

import { sounds } from '@/lib/sound';
import { CARD_BACKS, FELTS, type CardBack, type Felt, type Motion } from '@/lib/prefs';
import { usePrefs } from '@/lib/prefs-context';

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sound, deck, felt, card back and motion settings (kept in this browser). */
export function PreferencesForm() {
  const { prefs, update } = usePrefs();
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
          {FELTS.map((f) => (
            <option key={f} value={f}>
              {label(f)}
            </option>
          ))}
        </select>
        Card back
        <select
          name="cardBack"
          value={prefs.cardBack}
          onChange={(e) => update({ cardBack: e.target.value as CardBack })}
        >
          {CARD_BACKS.map((b) => (
            <option key={b} value={b}>
              {label(b)}
            </option>
          ))}
        </select>
      </label>
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
