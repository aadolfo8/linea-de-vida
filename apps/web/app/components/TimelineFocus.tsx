import { createContext, useContext, useState, type ReactNode } from 'react';

const TimelineFocusContext = createContext<{
  focused: boolean;
  setFocused: (value: boolean) => void;
} | null>(null);

export function TimelineFocusProvider({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <TimelineFocusContext.Provider value={{ focused, setFocused }}>
      {children}
    </TimelineFocusContext.Provider>
  );
}

export function useTimelineFocus() {
  const context = useContext(TimelineFocusContext);
  if (!context) throw new Error('Timeline focus requires the timeline layout.');
  return context;
}
