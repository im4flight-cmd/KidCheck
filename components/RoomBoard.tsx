'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Attendee = { id: string; name: string; guardian?: string; phone?: string };
type Roster = {
  room: string;
  occurrence: string;
  updated: string;
  count: number;
  checkedIn: Attendee[];
  cached?: boolean;
};

const REFRESH_MS = 20000;
const FETCH_TIMEOUT_MS = 15000;
const PIN_KEY = 'cfc_page_pin';

function initialOf(name: string): string {
  const n = (name || '').trim();
  return n ? n.charAt(0).toUpperCase() : '?';
}

function CheckMark() {
  return (
    <svg className="state-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" stroke="#d0b060" strokeWidth="1.4" opacity="0.7" />
      <path d="M7 12.5l3.2 3.2L17 9" stroke="#d0b060" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockMark() {
  return (
    <svg className="state-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" stroke="#d0b060" strokeWidth="1.4" opacity="0.7" />
      <path d="M12 7v5l3.4 2" stroke="#d0b060" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RoomBoard({
  roomId,
  initialName,
  occurrence = '',
  paging = false,
}: {
  roomId: string;
  initialName: string;
  occurrence?: string;
  paging?: boolean;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [status, setStatus] = useState('');
  const [statusCode, setStatusCode] = useState('');
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const ctrlRef = useRef<AbortController | null>(null);

  // Paging state
  const [pageTarget, setPageTarget] = useState<Attendee | null>(null);
  const [pin, setPin] = useState('');
  const [sending, setSending] = useState(false);
  const [pageError, setPageError] = useState('');
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'test' } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PIN_KEY);
      if (saved) setPin(saved);
    } catch {
      /* private mode, ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return; // never let polls stack up
    inFlight.current = true;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const qs = occurrence ? `&occurrence=${encodeURIComponent(occurrence)}` : '';
      const res = await fetch(`/api/roster?room=${encodeURIComponent(roomId)}${qs}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      const json = await res.json();
      if (json && json.error) {
        setStatus(String(json.error));
        setStatusCode(json.code ? String(json.code) : '');
      } else {
        setRoster(json as Roster);
        setStatus('');
        setStatusCode('');
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setStatus('Reconnecting…');
      }
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      setLoading(false);
    }
  }, [roomId, occurrence]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      ctrlRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const roomName = roster?.room || initialName || 'Classroom';
  const people = roster?.checkedIn ?? [];
  const count = roster?.count ?? 0;
  const updated = roster?.updated
    ? new Date(roster.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  const notConfigured = statusCode === 'not_configured';
  const stale = status !== '' && !notConfigured;

  function openPage(p: Attendee) {
    setPageError('');
    setPageTarget(p);
  }

  async function sendPage() {
    if (!pageTarget) return;
    setSending(true);
    setPageError('');
    try {
      const res = await fetch('/api/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomName, childId: pageTarget.id, pin }),
      });
      const json = await res.json();
      if (json?.error) {
        setPageError(String(json.error));
      } else {
        try {
          localStorage.setItem(PIN_KEY, pin);
        } catch {
          /* ignore */
        }
        const who = json.guardian || 'the parent';
        const text = json.throttled
          ? `Already texted ${who} a moment ago`
          : json.dryRun
            ? `Test only: would text ${who} at ${json.toMasked}`
            : `Text sent to ${who}`;
        setToast({ text, kind: json.dryRun ? 'test' : 'ok' });
        setPageTarget(null);
        window.setTimeout(() => setToast(null), 5000);
      }
    } catch {
      setPageError('Could not reach the text service.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="screen">
      <header className="board-header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/brand/cfc-wordmark-white.png" alt="Country Faith Church" />
          <div className="titles">
            <p className="kicker">Checked In</p>
            <h1 className="room-name">{roomName}</h1>
          </div>
        </div>
        {roster && (
          <div className="count-badge">
            <span className="num">{count}</span>
            <span className="label">{count === 1 ? 'child' : 'children'}</span>
          </div>
        )}
      </header>

      <main
        className="board-main"
        aria-live="polite"
        aria-label={`Children checked in at ${roomName}`}
      >
        {loading && !roster ? (
          <div className="state">
            <div className="state-text">Loading&hellip;</div>
          </div>
        ) : people.length > 0 ? (
          <ul className={paging ? 'roster has-paging' : 'roster'}>
            {people.map((p) => (
              <li className="person" key={p.id || p.name}>
                <span className="avatar" aria-hidden="true">
                  {initialOf(p.name)}
                </span>
                <span className="person-text">
                  <span className="person-name">{p.name}</span>
                  {(p.guardian || p.phone) && (
                    <span className="person-contact">
                      {p.guardian}
                      {p.guardian && p.phone ? ' · ' : ''}
                      {p.phone && <span className="contact-phone">{p.phone}</span>}
                    </span>
                  )}
                </span>
                {paging && (
                  <button
                    className="page-btn"
                    onClick={() => openPage(p)}
                    aria-label={`Text ${p.name}'s parent`}
                  >
                    Text parent
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : roster ? (
          <div className="state">
            <CheckMark />
            <div className="state-text">No kids checked in at this time</div>
            <div className="state-sub">Names appear here the moment a child is checked into this room.</div>
          </div>
        ) : notConfigured ? (
          <div className="state">
            <ClockMark />
            <div className="state-text">Almost ready</div>
            <div className="state-sub">
              This screen will show live check-ins as soon as the church&rsquo;s check-in
              system is connected.
            </div>
            <div className="state-note">{status}</div>
          </div>
        ) : (
          <div className="state">
            <div className="state-text">Cannot load the roster</div>
            <div className="state-sub">{status || 'Trying again shortly.'}</div>
          </div>
        )}
      </main>

      <footer className="board-footer">
        <Link href="/" className="rooms-link" aria-label="Back to the room list">‹ Back to rooms</Link>
        <span className={notConfigured ? 'live setup' : stale ? 'live stale' : 'live'}>
          <span className="dot" />
          {notConfigured
            ? 'Waiting for setup'
            : stale
              ? 'Reconnecting'
              : `Live, updates every ${Math.round(REFRESH_MS / 1000)}s`}
        </span>
        <span className="updated">{updated ? `Updated ${updated}` : ''}</span>
        <span className="status">{stale ? status : ''}</span>
      </footer>

      {pageTarget && (
        <div className="modal-overlay" onClick={() => !sending && setPageTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Text a parent</h2>
            <p className="modal-sub">
              Send a text asking <strong>{pageTarget.guardian || 'the parent'}</strong> to come to{' '}
              <strong>{roomName}</strong> for <strong>{pageTarget.name}</strong>?
            </p>
            <label className="pin-label">
              Staff PIN
              <input
                className="pin-input"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus
              />
            </label>
            {pageError && <div className="modal-error">{pageError}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setPageTarget(null)} disabled={sending}>
                Cancel
              </button>
              <button className="btn btn-gold" onClick={sendPage} disabled={sending || !pin}>
                {sending ? 'Sending…' : 'Send text'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
