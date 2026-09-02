/**
 * Classroom configuration.
 *
 * Each room maps a friendly name to its ChMS event id. This drives the room
 * picker so setting up an iPad is "tap the room," not "type an event id."
 *
 * Two ways to configure, checked in this order:
 *   1. A ROOMS environment variable holding a JSON array (easiest on Vercel).
 *   2. rooms.json committed in the repo.
 * The first one that yields a valid, non-empty list wins.
 */

import roomsJson from '@/rooms.json';

export type Room = { id: string; name: string };

function clean(list: unknown): Room[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const id = String((r as any).id ?? '').trim();
      const name = String((r as any).name ?? '').trim();
      if (!/^\d+$/.test(id) || !name) return null;
      return { id, name };
    })
    .filter((r): r is Room => r !== null);
}

export function getRooms(): Room[] {
  const raw = process.env.ROOMS;
  if (raw) {
    try {
      const fromEnv = clean(JSON.parse(raw));
      if (fromEnv.length) return fromEnv;
    } catch {
      // fall through to rooms.json
    }
  }
  return clean(roomsJson);
}

export function getRoom(id: string): Room | undefined {
  const wanted = String(id).trim();
  return getRooms().find((r) => r.id === wanted);
}
