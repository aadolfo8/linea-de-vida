'use client';

import { useRef, useState } from 'react';
import { useSky, useSkyFrame } from './SkyStage';

export type SkyRailEntry = {
  /** Matches the key of the registered item this entry jumps to. */
  key: string;
  label: string;
  /** Compact label for the slim rail of narrow screens, where `label` is hidden. */
  short?: string | null;
  small?: string | null;
  aria: string;
  /** Empty periods stay visible but cannot be selected. */
  disabled?: boolean;
};

/** Jump rail: vertical at the right while travelling vertically, at the bottom otherwise. */
export function SkyRail({
  entries,
  label = 'Saltar a',
}: {
  entries: SkyRailEntry[];
  label?: string;
}) {
  const { engine } = useSky();
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const latest = useRef<string | null>(null);

  useSkyFrame((frame) => {
    const middle = frame.current + frame.length * 0.5;
    let key: string | null = null;
    for (const entry of entries) {
      if (entry.disabled) continue;
      const item = engine.itemByKey(entry.key);
      if (item && item.o <= middle) key = entry.key;
    }
    key ??= entries.find((entry) => !entry.disabled && engine.itemByKey(entry.key))?.key ?? null;
    if (key === latest.current) return;
    latest.current = key;
    setCurrentKey(key);
  });

  return (
    <nav className="sky-rail" aria-label={label}>
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          disabled={entry.disabled}
          data-short={entry.short ? 'true' : undefined}
          aria-label={entry.aria}
          aria-current={entry.key === currentKey ? 'true' : undefined}
          onClick={() => {
            const item = engine.itemByKey(entry.key);
            if (item) engine.scrollToItem(item);
          }}
        >
          <span>{entry.label}</span>
          {entry.short ? <i className="sky-short">{entry.short}</i> : null}
          {entry.small ? <small>{entry.small}</small> : null}
        </button>
      ))}
    </nav>
  );
}
