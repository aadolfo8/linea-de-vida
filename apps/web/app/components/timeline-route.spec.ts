import { describe, expect, it } from 'vitest';
import { routeFrom } from './TimelineExperience';

describe('timeline deep links', () => {
  it('parses the explicit year and month route without creating a day state', () => {
    expect(routeFrom('/timeline/2024/7')).toEqual({ year: 2024, month: 7, unknown: false });
    expect(routeFrom('/timeline/2024/7/14')).toEqual({ year: null, month: null, unknown: false });
  });

  it('uses a safe URL segment for YEAR precision without assigning a month', () => {
    expect(routeFrom('/timeline/2024/sin-mes')).toEqual({ year: 2024, month: null, unknown: true });
  });
});
