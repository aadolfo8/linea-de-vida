import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { redirect } from 'next/navigation';
import LegacyOrganizarPage from './page';

describe('/organizar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /ordenar keeping the source and folder of the old link', async () => {
    await LegacyOrganizarPage({
      searchParams: Promise.resolve({ source: 's1', folder: 'f1', task: 'dates' }),
    });
    expect(redirect).toHaveBeenCalledWith('/ordenar?source=s1&folder=f1');
  });

  it('turns the old undated filter into the "Sin fecha" pile', async () => {
    await LegacyOrganizarPage({ searchParams: Promise.resolve({ filter: 'undated' }) });
    expect(redirect).toHaveBeenCalledWith('/ordenar?pile=undated');
  });

  it('redirects a bare /organizar to /ordenar', async () => {
    await LegacyOrganizarPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith('/ordenar');
  });
});
