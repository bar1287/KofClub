'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { CHAT_EMOJI, CHAT_TEXT_MAX } from '@/lib/table/chat';
import type { TableChatHandle } from '@/lib/table/useTableChat';
import type { ChatMessage } from '@/lib/types';

interface Props {
  chat: TableChatHandle;
  myUserId: string | null;
  /** The realtime connection is open. */
  live: boolean;
}

/**
 * Table chat: recent messages, a message box and reactions. Players can
 * mute others (only for themselves) and report a message to club staff.
 */
export function TableChat({ chat, myUserId, live }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const count = chat.messages.length;

  // Keep the newest message in view.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setSending(true);
    const ok = await chat.say(message);
    setSending(false);
    if (ok) setText('');
  }

  const mutedNames = Object.values(chat.muted);
  return (
    <div className="panel chat" data-testid="chat">
      <h3>Chat</h3>
      {!chat.enabled ? (
        <p className="muted small">Chat is turned off in this club.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <ol ref={logRef} className="chat-log" aria-live="polite" data-testid="chat-log">
            {chat.loaded && count === 0 && <li className="muted small">No messages yet.</li>}
            {chat.messages.map((m) => (
              <li key={m.id} className="chat-line" data-testid="chat-message">
                <strong>{m.username}</strong> <span className="chat-text">{m.text}</span>
                {m.userId !== myUserId && (
                  <span className="chat-tools">
                    <button
                      type="button"
                      className="btn link small"
                      onClick={() => chat.mute(m.userId, m.username)}
                      aria-label={`Mute ${m.username}`}
                    >
                      Mute
                    </button>
                    <button
                      type="button"
                      className="btn link small"
                      onClick={() => setReporting(m)}
                      aria-label={`Report message from ${m.username}`}
                    >
                      Report
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {mutedNames.length > 0 && (
            <p className="muted small" data-testid="chat-muted">
              Muted: {mutedNames.join(', ')}.{' '}
              <button type="button" className="btn link small" onClick={chat.unmuteAll}>
                Unmute all
              </button>
            </p>
          )}
          {chat.canSend && (
            <>
              <div className="reactions" role="group" aria-label="Reactions">
                {CHAT_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="reaction"
                    disabled={!live}
                    onClick={() => chat.react(emoji)}
                    aria-label={`React ${emoji}`}
                    data-testid={`react-${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <form className="chat-form" onSubmit={submit}>
                <input
                  name="chatMessage"
                  aria-label="Chat message"
                  placeholder="Say something nice"
                  maxLength={CHAT_TEXT_MAX}
                  autoComplete="off"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (chat.error) chat.clearError();
                  }}
                />
                <button
                  className="btn small primary"
                  type="submit"
                  disabled={!live || sending || !text.trim()}
                >
                  Send
                </button>
              </form>
            </>
          )}
          <ErrorAlert error={chat.error} />
        </div>
      )}
      {reporting && (
        <ReportDialog message={reporting} chat={chat} onClose={() => setReporting(null)} />
      )}
    </div>
  );
}

function ReportDialog({
  message,
  chat,
  onClose,
}: {
  message: ChatMessage;
  chat: TableChatHandle;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await chat.report(message.id, reason.trim() || undefined);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal aria-labelledby="report-title">
      <form className="panel form dialog stack" onSubmit={submit}>
        <h2 id="report-title">Report message</h2>
        <blockquote className="chat-quote">
          <strong>{message.username}</strong> {message.text}
        </blockquote>
        {done ? (
          <div className="alert ok" role="status">
            Thanks. Club staff will review it.
          </div>
        ) : (
          <label className="field">
            Reason (optional)
            <input
              name="reportReason"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <ErrorAlert error={error} />
        <div className="row">
          {!done && (
            <button className="btn primary" type="submit" disabled={busy}>
              Report
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>
      </form>
    </div>
  );
}
