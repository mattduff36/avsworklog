'use client';

import type { CSSProperties } from 'react';

interface AbsenceScrollingMessageProps {
  message: string | null;
  className?: string;
}

export function AbsenceScrollingMessage({ message, className = '' }: AbsenceScrollingMessageProps) {
  const trimmedMessage = message?.trim() || '';

  if (!trimmedMessage) {
    return null;
  }

  const animationDurationSeconds = Math.min(Math.max(trimmedMessage.length * 0.35, 14), 36);

  return (
    <div
      className={`mt-4 border-t border-white/15 pt-3 ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label="Absence announcement"
    >
      <div className="relative overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div
          className="absence-message-track inline-block whitespace-nowrap pl-[100%] text-sm text-purple-50/95"
          style={
            {
              '--absence-message-duration': `${animationDurationSeconds}s`,
            } as CSSProperties
          }
        >
          <span className="font-medium">{trimmedMessage}</span>
        </div>
      </div>

      <style>{`
        .absence-message-track {
          animation: absence-message-scroll var(--absence-message-duration) linear infinite;
          will-change: transform;
        }

        @keyframes absence-message-scroll {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-100%);
          }
        }
      `}</style>
    </div>
  );
}
