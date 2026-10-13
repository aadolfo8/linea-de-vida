import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ apiJson: vi.fn() }));
import { apiJson } from './api';
import { removePhotosFromArchive } from './photo-removal';

const request = vi.mocked(apiJson);
describe('archive batch removal', () => {
  beforeEach(() => vi.resetAllMocks());

  it('keeps only failed IDs selected and accepts already absent photos', async () => {
    request.mockResolvedValue({
      results: [
        { id: 'a', status: 'REMOVED' },
        { id: 'b', status: 'FAILED' },
        { id: 'c', status: 'ABSENT' },
      ],
    });
    const result = await removePhotosFromArchive(['a', 'b', 'c']);
    expect([...result.pending]).toEqual(['b']);
    expect([...result.completed]).toEqual(['a', 'c']);
    expect(result.removed).toBe(1);
  });

  it('uses bounded batches and preserves successes if a later request fails', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => String(index));
    request.mockResolvedValueOnce({
      results: ids.slice(0, 50).map((id) => ({ id, status: 'REMOVED' })),
    });
    request.mockRejectedValueOnce(new Error('offline'));
    const result = await removePhotosFromArchive(ids);
    expect(result.completed.size).toBe(50);
    expect(result.pending.size).toBe(51);
    expect(result.error).toBeInstanceOf(Error);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1]!.body as string).photoIds).toHaveLength(50);
  });

  it('safely retries an unknown outcome and ignores unrequested or duplicate results', async () => {
    request.mockRejectedValueOnce(new Error('response lost'));
    const first = await removePhotosFromArchive(['a', 'a']);
    expect([...first.pending]).toEqual(['a']);
    request.mockResolvedValueOnce({
      results: [
        { id: 'a', status: 'ABSENT' },
        { id: 'a', status: 'REMOVED' },
        { id: 'foreign', status: 'REMOVED' },
      ],
    });
    const retried = await removePhotosFromArchive([...first.pending]);
    expect(retried.pending.size).toBe(0);
    expect([...retried.completed]).toEqual(['a']);
    expect(retried.removed).toBe(0);
  });

  it('retains missing acknowledgements rather than pretending they succeeded', async () => {
    request.mockResolvedValue({ results: [] });
    expect([...(await removePhotosFromArchive(['a'])).pending]).toEqual(['a']);
  });
});
