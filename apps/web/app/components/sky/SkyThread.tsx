'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { compactHeaderGeometry, periodHeaderGeometry } from './constellation-layout';
import { clamp } from './rng';
import { useSky, useSkyFrame, useSkyMeasure } from './SkyStage';

type Thread = {
  d: string;
  nodes: { x: number; y: number; undated: boolean }[];
  width: number;
  height: number;
  first: number;
  last: number;
};

/** One line joining every group's node; it draws itself as you travel. */
export function SkyThread({ keys }: { keys: string[] }) {
  const { engine, orientation, reduced } = useSky();
  const horizontal = orientation === 'horizontal';
  const [thread, setThread] = useState<Thread | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const lengthRef = useRef(0);

  const rebuild = useCallback(() => {
    const points = keys.flatMap((key) => {
      const item = engine.itemByKey(key);
      if (!item?.measured) return [];
      return [
        {
          x: item.x + Number(item.el.dataset.nodeX ?? 0),
          y: item.y + Number(item.el.dataset.nodeY ?? 0),
          undated: item.el.dataset.undated === 'true',
        },
      ];
    });
    if (points.length < 2) {
      setThread((current) => (current ? null : current));
      return;
    }
    let d = `M${points[0]!.x},${points[0]!.y}`;
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      d += horizontal
        ? ` C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}`
        : ` C${from.x},${(from.y + to.y) / 2} ${to.x},${(from.y + to.y) / 2} ${to.x},${to.y}`;
    }
    const axis = horizontal ? 'x' : 'y';
    const next: Thread = {
      d,
      nodes: points,
      width: horizontal ? engine.trackLength : window.innerWidth,
      height: horizontal ? window.innerHeight : engine.trackLength,
      first: points[0]![axis],
      last: points[points.length - 1]![axis],
    };
    setThread((current) =>
      current &&
      current.d === next.d &&
      current.width === next.width &&
      current.height === next.height
        ? current
        : next,
    );
  }, [engine, horizontal, keys]);

  useSkyMeasure(rebuild);
  useLayoutEffect(() => {
    rebuild();
  }, [rebuild]);

  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    lengthRef.current = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0;
    path.style.strokeDasharray = reduced ? '' : String(lengthRef.current);
    path.style.strokeDashoffset = reduced ? '' : String(lengthRef.current);
  }, [reduced, thread]);

  useSkyFrame((frame) => {
    const path = pathRef.current;
    if (!path || !thread || reduced || !lengthRef.current) return;
    const progress = clamp(
      (frame.current + frame.length * 0.85 - thread.first) /
        Math.max(1, thread.last - thread.first),
    );
    path.style.strokeDashoffset = (lengthRef.current * (1 - progress)).toFixed(1);
  });

  if (!thread) return null;
  return (
    <>
      <svg
        className="sky-thread"
        width={thread.width}
        height={thread.height}
        aria-hidden="true"
        focusable="false"
      >
        <path ref={pathRef} d={thread.d} />
      </svg>
      {thread.nodes.map((node, index) => (
        <span
          key={index}
          className="sky-node"
          data-undated={node.undated}
          style={{ left: node.x, top: node.y }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/** The big outline numeral that leads a deeper list, e.g. the year above its months. */
export function PeriodHeader({
  itemKey,
  title,
  meta,
  compact = false,
}: {
  itemKey: string;
  title: string;
  meta: React.ReactNode;
  /** A longer title (a month and its year) that may wrap, e.g. at the month depth. */
  compact?: boolean;
}) {
  const { viewport, orientation } = useSky();
  const horizontal = orientation === 'horizontal';
  if (compact) {
    const compactHeader = compactHeaderGeometry(viewport, orientation);
    return (
      <div
        className="sky-head"
        data-key={itemKey}
        style={
          horizontal
            ? { width: compactHeader.length, height: '100%', marginLeft: compactHeader.margin }
            : { height: compactHeader.length, marginTop: compactHeader.margin }
        }
      >
        <h1
          style={{
            fontSize: compactHeader.size,
            top: compactHeader.titleTop,
            width: compactHeader.titleWidth,
            whiteSpace: 'normal',
            left: horizontal ? 0 : 'max(16px, 6vw)',
          }}
        >
          {title}
        </h1>
        <p style={{ top: compactHeader.metaTop, left: horizontal ? 4 : 'max(18px, 6vw)' }}>
          {meta}
        </p>
      </div>
    );
  }
  const header = periodHeaderGeometry(viewport, orientation);
  return (
    <div
      className="sky-head"
      data-key={itemKey}
      style={
        horizontal
          ? { width: header.length, height: '100%', marginLeft: header.margin }
          : { height: header.length, marginTop: header.margin }
      }
    >
      <h1
        style={{
          fontSize: header.size,
          ...(horizontal
            ? { left: 0, bottom: header.numeralBottom }
            : { left: 'max(16px, 6vw)', top: 0 }),
        }}
      >
        {title}
      </h1>
      <p
        style={
          horizontal
            ? { left: 6, top: header.metaTop }
            : { left: 'max(18px, 6vw)', top: header.metaTop }
        }
      >
        {meta}
      </p>
    </div>
  );
}
