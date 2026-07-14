import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FocusEventHandler,
  KeyboardEventHandler,
  PointerEventHandler,
} from 'react';

interface UsePressHoldOptions {
  durationMs: number;
  disabled?: boolean;
  onComplete: () => void;
}

interface PressHoldHandlers {
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onPointerLeave: PointerEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  onKeyUp: KeyboardEventHandler<HTMLButtonElement>;
  onBlur: FocusEventHandler<HTMLButtonElement>;
}

interface UsePressHoldResult {
  holding: boolean;
  handlers: PressHoldHandlers;
}

export function usePressHold({
  durationMs,
  disabled = false,
  onComplete,
}: UsePressHoldOptions): UsePressHoldResult {
  const timeoutRef = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);

  const cancel = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || timeoutRef.current !== null) return;
    setHolding(true);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setHolding(false);
      onComplete();
    }, durationMs);
  }, [disabled, durationMs, onComplete]);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  return {
    holding: disabled ? false : holding,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onKeyDown: (event) => {
        if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
        event.preventDefault();
        start();
      },
      onKeyUp: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        cancel();
      },
      onBlur: cancel,
    },
  };
}
