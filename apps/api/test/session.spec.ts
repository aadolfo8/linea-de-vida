import { describe, expect, it } from 'vitest';
import { decodeSession, encodeSession, SESSION_MAX_AGE_MS } from '../src/auth';

describe('session cookie value', () => {
  const now = Date.UTC(2026, 10, 12);

  it('round-trips the user id and issue time', () => {
    expect(decodeSession(encodeSession('user.with.dots', now), now)).toEqual({
      userId: 'user.with.dots',
      issuedAt: now,
      legacy: false,
    });
  });

  it('expires after 30 days and rejects timestamps from the future', () => {
    const value = encodeSession('u1', now);
    expect(decodeSession(value, now + SESSION_MAX_AGE_MS - 1_000)).not.toBeNull();
    expect(decodeSession(value, now + SESSION_MAX_AGE_MS + 2_000)).toBeNull();
    expect(decodeSession(encodeSession('u1', now + 3_600_000), now)).toBeNull();
  });

  it('accepts a legacy bare user id once so nobody is logged out by the upgrade', () => {
    expect(decodeSession('cm123abc', now)).toEqual({
      userId: 'cm123abc',
      issuedAt: now,
      legacy: true,
    });
    expect(decodeSession('', now)).toBeNull();
    expect(decodeSession(undefined, now)).toBeNull();
  });
});
