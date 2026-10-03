'use client';

import { useState, type FormEvent } from 'react';
import { useSession } from '@/lib/session';
import type { Club } from '@/lib/types';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function SettingsPanel({ club, onClubChanged }: { club: Club; onClubChanged: () => void }) {
  const { ep } = useSession();
  const [name, setName] = useState(club.name);
  const [description, setDescription] = useState(club.description ?? '');
  const { busy, error, notice, run } = useAction();

  async function save(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await ep.updateClub(club.id, { name: name.trim(), description: description.trim() || null });
      onClubChanged();
      return 'Club settings saved.';
    });
  }

  return (
    <form className="form" onSubmit={save} style={{ maxWidth: 520 }}>
      <h2 style={{ margin: 0 }}>Settings</h2>
      <label className="field">
        Club name
        <input
          required
          minLength={3}
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="field">
        Description
        <textarea
          rows={3}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <Feedback error={error} notice={notice} />
      <button className="btn primary" type="submit" disabled={busy}>
        Save
      </button>
      <p className="muted small">
        To hand the club over, use “Make owner” on a member in the Members tab.
      </p>
    </form>
  );
}
