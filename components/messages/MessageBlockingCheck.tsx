'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BlockingMessageModal } from './BlockingMessageModal';
import { ReminderModal } from './ReminderModal';
import { Loader2 } from 'lucide-react';

interface PendingToolboxTalk {
  id: string;
  recipient_id: string;
  subject: string;
  body: string;
  sender_name: string;
  created_at: string;
}

interface PendingReminder {
  id: string;
  recipient_id: string;
  subject: string;
  body: string;
  sender_name: string;
  created_at: string;
}

interface AuthSessionCheckResponse {
  authenticated: boolean;
  profile?: {
    must_change_password?: boolean | null;
  } | null;
}

const MESSAGE_BOOTSTRAP_TIMEOUT_MS = 4000;
const REMINDER_ADVANCE_DELAY_MS = 300;

interface PendingMessagesResponse {
  success?: boolean;
  toolbox_talks?: PendingToolboxTalk[];
  reminders?: PendingReminder[];
}

/**
 * MessageBlockingCheck Component
 * 
 * Handles the blocking flow for Toolbox Talks and non-blocking Reminders
 * Priority: Password Change (handled by layout redirect) → Toolbox Talks → Reminders
 * 
 * This component should be placed in the dashboard layout to check on every page load
 */
export function MessageBlockingCheck() {
  const router = useRouter();
  const pathname = usePathname();
  const isDashboardPath = pathname?.startsWith('/dashboard') ?? false;
  
  const [checking, setChecking] = useState(false);
  const [pendingToolboxTalks, setPendingToolboxTalks] = useState<PendingToolboxTalk[]>([]);
  const [currentToolboxTalkIndex, setCurrentToolboxTalkIndex] = useState(0);
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>([]);
  const [showReminder, setShowReminder] = useState(false);

  const checkPendingMessages = useCallback(async (signal: AbortSignal) => {
    try {
      // First check if user needs to change password (this takes precedence)
      const sessionResponse = await fetch('/api/auth/session', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
        signal,
      });

      if (!sessionResponse.ok || signal.aborted) {
        return;
      }

      const session = (await sessionResponse.json()) as AuthSessionCheckResponse;

      if (signal.aborted) {
        return;
      }

      if (session.profile?.must_change_password) {
        // Password change takes priority - redirect handled by existing system
        router.push('/change-password');
        return;
      }

      // Fetch pending messages
      const response = await fetch('/api/messages/pending', { signal });
      if (!response.ok || signal.aborted) {
        if (!signal.aborted) {
          console.warn(`Pending messages API returned ${response.status}, skipping`);
        }
        return;
      }

      const data = (await response.json()) as PendingMessagesResponse;

      if (signal.aborted || !data.success) {
        return;
      }

      const talks = data.toolbox_talks || [];
      const reminders = data.reminders || [];

      setPendingToolboxTalks(talks);
      setCurrentToolboxTalkIndex(0);
      setPendingReminders(reminders);
      setShowReminder(talks.length === 0 && reminders.length > 0);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      console.error('Error checking pending messages:', error);
    } finally {
      if (!signal.aborted) {
        setChecking(false);
      }
    }
  }, [router]);

  useEffect(() => {
    if (!isDashboardPath) {
      setChecking(false);
      return;
    }

    const abortController = new AbortController();
    setChecking(true);
    void checkPendingMessages(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [checkPendingMessages, isDashboardPath, pathname]);

  useEffect(() => {
    if (!checking || !isDashboardPath) return;

    const timeoutId = window.setTimeout(() => {
      setChecking(false);
    }, MESSAGE_BOOTSTRAP_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [checking, isDashboardPath, pathname]);

  function handleToolboxTalkSigned() {
    // Move to next Toolbox Talk or finish
    if (currentToolboxTalkIndex + 1 < pendingToolboxTalks.length) {
      setCurrentToolboxTalkIndex(currentToolboxTalkIndex + 1);
    } else {
      // All Toolbox Talks signed, check if there are Reminders
      setPendingToolboxTalks([]);
      setCurrentToolboxTalkIndex(0);
      
      if (pendingReminders.length > 0) {
        setShowReminder(true);
      }
    }
  }

  function handleReminderDismissed() {
    // Remove the dismissed reminder from the list
    setShowReminder(false);
    setPendingReminders((currentReminders) => {
      const nextReminders = currentReminders.slice(1);

      // Show next reminder if any
      if (nextReminders.length > 0) {
        window.setTimeout(() => setShowReminder(true), REMINDER_ADVANCE_DELAY_MS);
      }

      return nextReminders;
    });
  }

  // Show loading state briefly while checking
  if (checking) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-white dark:bg-slate-900 rounded-lg p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading SquiresApp...</p>
        </div>
      </div>
    );
  }

  // Show blocking Toolbox Talk modal (if any pending)
  if (pendingToolboxTalks.length > 0) {
    const currentTalk = pendingToolboxTalks[currentToolboxTalkIndex];
    
    return (
      <BlockingMessageModal
        open={true}
        message={currentTalk}
        onSigned={handleToolboxTalkSigned}
        totalPending={pendingToolboxTalks.length}
        currentIndex={currentToolboxTalkIndex}
      />
    );
  }

  // Show non-blocking Reminder modal (if any pending)
  if (showReminder && pendingReminders.length > 0) {
    return (
      <ReminderModal
        open={true}
        onClose={() => setShowReminder(false)}
        message={pendingReminders[0]}
        onDismissed={handleReminderDismissed}
      />
    );
  }

  // No blocking messages
  return null;
}

