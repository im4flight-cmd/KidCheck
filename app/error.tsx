'use client';

import { useEffect } from 'react';

/**
 * Route-level error boundary. A classroom iPad is unattended, so instead of a
 * blank white screen on an unexpected render error, show a calm, on-brand
 * message and quietly attempt to recover on its own after a few seconds.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log for diagnostics; nothing sensitive is ever shown on the room screen.
    console.error('Display error boundary:', error);
    const timer = setTimeout(() => reset(), 5000);
    return () => clearTimeout(timer);
  }, [error, reset]);

  return (
    <div className="screen">
      <main className="board-main">
        <div className="state">
          <div className="state-text">Just a moment</div>
          <div className="state-sub">
            The display hit a snag and is recovering on its own. It will refresh in a
            few seconds.
          </div>
          <button className="btn btn-gold" onClick={() => reset()}>
            Reload now
          </button>
        </div>
      </main>
    </div>
  );
}
