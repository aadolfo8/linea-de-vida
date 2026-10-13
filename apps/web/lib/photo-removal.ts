import { apiJson } from './api';

type RemovalResult = { id: string; status: 'REMOVED' | 'ABSENT' | 'FAILED' };

/** Keep unacknowledged IDs pending: a lost response can safely be retried. */
export async function removePhotosFromArchive(ids: string[]) {
  const pending = new Set(ids);
  const completed = new Set<string>();
  let removed = 0;
  let error: unknown;
  const unique = [...pending];
  for (let offset = 0; offset < unique.length; offset += 50) {
    const photoIds = unique.slice(offset, offset + 50);
    try {
      const response = await apiJson<{ results: RemovalResult[] }>('/photo-removals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoIds }),
      });
      for (const result of response.results) {
        if (!photoIds.includes(result.id) || !pending.has(result.id)) continue;
        if (result.status === 'REMOVED' || result.status === 'ABSENT') {
          pending.delete(result.id);
          completed.add(result.id);
          if (result.status === 'REMOVED') removed++;
        }
      }
    } catch (failure) {
      error = failure;
      break;
    }
  }
  return { pending, completed, removed, error };
}
