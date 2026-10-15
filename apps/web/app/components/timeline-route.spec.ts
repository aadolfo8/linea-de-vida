import { describe, expect, it } from 'vitest';
import { parseTimelineRoute } from './timeline-model';

describe('timeline deep links', () => {
  it('parses the explicit year and month route without creating a day state', () => {
    expect(parseTimelineRoute('/timeline/2024/7')).toEqual({
      year: 2024,
      month: 7,
      unknown: false,
      invalid: false,
    });
    expect(parseTimelineRoute('/timeline/2024/7/14').invalid).toBe(true);
  });

  it('uses a safe URL segment for YEAR precision without assigning a month', () => {
    expect(parseTimelineRoute('/timeline/2024/sin-mes')).toEqual({
      year: 2024,
      month: null,
      unknown: true,
      invalid: false,
    });
  });
});
