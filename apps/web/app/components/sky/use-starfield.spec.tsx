// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStarfield } from './use-starfield';

function Sky({ reduced }: { reduced: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  useStarfield(ref, reduced);
  return <canvas ref={ref} />;
}

describe('useStarfield', () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: FrameRequestCallback[];
  let ctx: Record<string, ReturnType<typeof vi.fn>>;
  const makeContext = () => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  });

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    ctx = makeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('paints once and keeps animating when motion is allowed', async () => {
    await act(async () => root.render(<Sky reduced={false} />));

    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
  });

  it('paints a still sky and schedules no frames under reduced motion', async () => {
    await act(async () => root.render(<Sky reduced />));

    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
  });
});
