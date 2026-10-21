import { describe, expect, it } from 'vitest';
import { createPinchDetector, PINCH_THRESHOLD } from './pinch';

const wheel = (
  deltaY: number,
  time: number,
  extra: Partial<Parameters<ReturnType<typeof createPinchDetector>>[0]> = {},
) => ({
  ctrlKey: true,
  deltaY,
  deltaMode: 0,
  time,
  ...extra,
});

describe('pinch detector', () => {
  it('never touches events without ctrl', () => {
    const detect = createPinchDetector();
    expect(detect(wheel(4, 0, { ctrlKey: false }))).toBe('pass');
  });

  it('lets browser zoom-in through', () => {
    const detect = createPinchDetector();
    for (let time = 0; time < 400; time += 16) expect(detect(wheel(-3.5, time))).toBe('pass');
  });

  it('lets a ctrl + mouse wheel zoom the page, even with small steps', () => {
    const detect = createPinchDetector();
    // Whole lines (Firefox) and big pixel steps (Chrome) are mouse wheels.
    expect(detect(wheel(3, 0, { deltaMode: 1 }))).toBe('pass');
    expect(detect(wheel(100, 10))).toBe('pass');
    expect(detect(wheel(120, 20))).toBe('pass');
  });

  it('does not consume anything until the pinch clearly adds up', () => {
    const detect = createPinchDetector();
    let verdict = detect(wheel(2.5, 0));
    let time = 0;
    let steps = 1;
    while (verdict === 'accumulate') {
      time += 16;
      steps += 1;
      verdict = detect(wheel(2.5, time));
    }
    expect(verdict).toBe('consume');
    expect(steps * 2.5).toBeGreaterThan(PINCH_THRESHOLD);
    expect(steps).toBeGreaterThan(40);
  });

  it('forgets a slow, scattered zoom-out so it keeps zooming the page', () => {
    const detect = createPinchDetector();
    for (let index = 0; index < 100; index += 1)
      expect(detect(wheel(2.5, index * 400))).toBe('accumulate');
  });

  it('resets when the gesture turns into zoom-in', () => {
    const detect = createPinchDetector();
    for (let time = 0; time < 160; time += 16) detect(wheel(5, time));
    expect(detect(wheel(-2, 170))).toBe('pass');
    expect(detect(wheel(5, 180))).toBe('accumulate');
  });

  it('swallows the tail of a consumed pinch, then starts clean', () => {
    const detect = createPinchDetector();
    let time = 0;
    let verdict = detect(wheel(10, time));
    while (verdict === 'accumulate') verdict = detect(wheel(10, (time += 16)));
    expect(verdict).toBe('consume');
    expect(detect(wheel(8, time + 50))).toBe('swallow');
    expect(detect(wheel(-8, time + 100))).toBe('swallow');
    expect(detect(wheel(8, time + 600))).toBe('accumulate');
  });
});
