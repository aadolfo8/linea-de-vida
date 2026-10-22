import { apiJson, json } from '../api';
import type { TimelinePhotoPage } from '../../app/components/timeline-model';
import type { CoverScope, CoversResponse } from './model';

export const CANDIDATE_PAGE = 60;

const body = (year: number, scope: CoverScope) => ({
  kind: scope.kind,
  year,
  ...(scope.kind === 'MONTH' ? { month: scope.month } : {}),
});

/** The photos a cover can be made of: the ones the timeline shows in that very group. */
const candidatesPath = (year: number, scope: CoverScope) =>
  scope.kind === 'YEAR'
    ? `/photos?year=${year}`
    : scope.kind === 'UNKNOWN_MONTH'
      ? `/timeline/years/${year}/unknown-month/photos?`
      : `/timeline/years/${year}/months/${scope.month}/photos?`;

export const coversApi = {
  list: (year: number) => apiJson<CoversResponse>(`/covers?year=${year}`),

  save: (year: number, scope: CoverScope, photoIds: readonly string[]) =>
    apiJson<{ photoIds: string[] }>('/covers', json('PUT', { ...body(year, scope), photoIds })),

  /** Back to the automatic cover. */
  reset: (year: number, scope: CoverScope) =>
    apiJson<{ photoIds: string[] }>('/covers', json('DELETE', body(year, scope))),

  candidates: (year: number, scope: CoverScope, cursor: string | null) => {
    const path = candidatesPath(year, scope);
    const query = `limit=${CANDIDATE_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    return apiJson<TimelinePhotoPage>(`${path}${path.endsWith('?') ? '' : '&'}${query}`);
  },
};
