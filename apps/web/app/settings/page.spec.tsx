import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { redirect } from 'next/navigation';
import LegacySettingsPage from './page';

describe('/settings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /ajustes', async () => {
    await LegacySettingsPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith('/ajustes');
  });

  it('keeps the Drive consent notice it used to receive', async () => {
    await LegacySettingsPage({ searchParams: Promise.resolve({ oauth: 'drive-connected' }) });
    expect(redirect).toHaveBeenCalledWith('/ajustes?oauth=drive-connected');
  });
});
