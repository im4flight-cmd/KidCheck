'use client';

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

export default function RoomBoard({
  roomId,
  initialName,
  occurrence = '',
}: {
  roomId: string;
  initialName: string;
  occurrence?: string;
}) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const ctrlRef = useRef<AbortController | null>(null);

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
        // Keep the last good roster on screen, note the problem quietly.
        setStatus(String(json.error));
      } else {
        setRoster(json as Roster);
        setStatus('');
      }
    } catch (err) {
      // An abort is either an unmount or our own timeout; stay quiet and let
      // the next tick retry rather than flashing an error at people.
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
  const stale = status !== '';

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
          <ul className="roster">
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
              </li>
            ))}
          </ul>
        ) : roster ? (
          <div className="state">
            <CheckMark />
            <div className="state-text">No one checked in yet</div>
            <div className="state-sub">Names appear here the moment a child is checked into this room.</div>
          </div>
        ) : (
          <div className="state">
            <div className="state-text">Cannot load the roster</div>
            <div className="state-sub">{status || 'Trying again shortly.'}</div>
          </div>
        )}
      </main>

      <footer className="board-footer">
        <span className={stale ? 'live stale' : 'live'}>
          <span className="dot" />
          {stale ? 'Reconnecting' : `Live, updates every ${Math.round(REFRESH_MS / 1000)}s`}
        </span>
        <span className="updated">{updated ? `Updated ${updated}` : ''}</span>
        <span className="status">{stale ? status : ''}</span>
      </footer>
    </div>
  );
}
