import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  apiJson: vi.fn(),
}));

import { apiJson } from '../api';
import { BATCH_LIMIT, orderingApi } from './client';

const failure = (status: number) => new ApiError(status, 'REQUEST_FAILED', 'failed', null, null);
const ok = (ids: string[]) => ({ results: ids.map((id) => ({ id, status: 'UPDATED' })) });
const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`);

describe('orderingApi batches', () => {
  beforeEach(() => vi.mocked(apiJson).mockReset());

  it('throws an expired session so the screen can sign out', async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(failure(401));
    const error = await orderingApi.hide(['a']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  it('throws an error that happened before anything was applied', async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(failure(429));
    const error = await orderingApi.hide(['a']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(429);
  });

  it('turns only a later failed chunk into FAILED rows', async () => {
    const all = ids(BATCH_LIMIT + 2);
    vi.mocked(apiJson)
      .mockResolvedValueOnce(ok(all.slice(0, BATCH_LIMIT)))
      .mockRejectedValueOnce(failure(500));
    const { results } = await orderingApi.hide(all);
    expect(results).toHaveLength(all.length);
    expect(results.slice(-2)).toEqual([
      { id: all.at(-2), status: 'FAILED' },
      { id: all.at(-1), status: 'FAILED' },
    ]);
  });

  it('still throws a session that expires halfway', async () => {
    vi.mocked(apiJson)
      .mockResolvedValueOnce(ok(ids(BATCH_LIMIT)))
      .mockRejectedValueOnce(failure(401));
    await expect(orderingApi.hide(ids(BATCH_LIMIT + 1))).rejects.toMatchObject({ status: 401 });
  });
});
