'use client';

import { PreferencesForm } from '@/components/PreferencesForm';

export function TableSettingsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal aria-labelledby="settings-title">
      <div className="panel dialog stack">
        <h2 id="settings-title">Table settings</h2>
        <PreferencesForm />
        <p className="muted small">Saved in this browser.</p>
        <div>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
