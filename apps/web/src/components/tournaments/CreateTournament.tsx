'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { GAME_TYPES, gameName, type GameType } from '@/lib/games';
import { useSession } from '@/lib/session';
import type { CreateTournamentRequest, TournamentDetail } from '@/lib/types';

type StartMode = CreateTournamentRequest['startMode'];

const NUMBER_FIELDS = [
  ['buyIn', 'Buy-in (club chips)', 0],
  ['startingStack', 'Starting stack', 100],
  ['smallBlind', 'Level 1 small blind', 1],
  ['bigBlind', 'Level 1 big blind', 2],
  ['levelDurationSec', 'Level length (s)', 10],
  ['seatsPerTable', 'Seats per table', 2],
  ['minPlayers', 'Min players', 2],
  ['maxPlayers', 'Max players', 2],
  ['actionTimeoutSec', 'Turn time (s)', 5],
] as const;

type NumberField = (typeof NUMBER_FIELDS)[number][0];

/** Staff form creating a tournament (the API validates everything). */
export function CreateTournament({
  clubId,
  onCreated,
}: {
  clubId: string;
  onCreated: (t: TournamentDetail) => void;
}) {
  const { ep } = useSession();
  const [name, setName] = useState('');
  const [gameType, setGameType] = useState<GameType>('NLHE');
  const [startMode, setStartMode] = useState<StartMode>('SIT_AND_GO');
  const [startsAt, setStartsAt] = useState('');
  const [nums, setNums] = useState<Record<NumberField, number>>({
    buyIn: 100,
    startingStack: 1500,
    smallBlind: 10,
    bigBlind: 20,
    levelDurationSec: 300,
    seatsPerTable: 6,
    minPlayers: 2,
    maxPlayers: 6,
    actionTimeoutSec: 20,
  });
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const num = (k: NumberField) => (e: ChangeEvent<HTMLInputElement>) =>
    setNums({ ...nums, [k]: Math.trunc(Number(e.target.value)) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: CreateTournamentRequest = { name: name.trim(), gameType, startMode, ...nums };
      if (startMode === 'SCHEDULED') body.startsAt = new Date(startsAt).toISOString();
      const t = await ep.createTournament(clubId, body, key);
      setKey(newIdempotencyKey());
      setName('');
      onCreated(t);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form stack" onSubmit={submit} data-testid="create-tournament">
      <div className="row">
        <label className="field">
          Tournament name
          <input
            name="tournamentName"
            required
            minLength={3}
            maxLength={56}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Tournament game
          <select
            name="tournamentGame"
            value={gameType}
            onChange={(e) => setGameType(e.target.value as GameType)}
          >
            {GAME_TYPES.map((g) => (
              <option key={g} value={g}>
                {gameName(g)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Start
          <select
            name="startMode"
            value={startMode}
            onChange={(e) => setStartMode(e.target.value as StartMode)}
          >
            <option value="SIT_AND_GO">Sit &amp; Go (when full)</option>
            <option value="SCHEDULED">Scheduled</option>
          </select>
        </label>
        {startMode === 'SCHEDULED' && (
          <label className="field">
            Starts at
            <input
              type="datetime-local"
              name="startsAt"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {NUMBER_FIELDS.map(([k, label, minimum]) => (
          <label className="field" key={k}>
            {label}
            <input type="number" name={k} min={minimum} value={nums[k]} onChange={num(k)} />
          </label>
        ))}
      </div>
      <p className="muted small">
        Blinds rise every level (×1.5, ×2, ×3, … of level 1). Prizes are paid in club chips from the
        buy-ins; tournament chips have no value outside the tournament.
      </p>
      <ErrorAlert error={error} />
      <button className="btn primary" type="submit" disabled={busy}>
        Create tournament
      </button>
    </form>
  );
}
