'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
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
  const supabase = createClient();
  
  const [checking, setChecking] = useState(true);
  const [pendingToolboxTalks, setPendingToolboxTalks] = useState<PendingToolboxTalk[]>([]);
  const [currentToolboxTalkIndex, setCurrentToolboxTalkIndex] = useState(0);
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>([]);
  const [showReminder, setShowReminder] = useState(false);

  useEffect(() => {
    checkPendingMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkPendingMessages() {
    try {
      // First check if user needs to change password (this takes precedence)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setChecking(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('must_change_password')
        .eq('id', user.id)
        .single();

      if (profile?.must_change_password) {
        // Password change takes priority - redirect handled by existing system
        router.push('/change-password');
        return;
      }

      // Fetch pending messages
      const response = await fetch('/api/messages/pending');
      const data = await response.json();

      if (data.success) {
        const talks = data.toolbox_talks || [];
        const reminders = data.reminders || [];

        setPendingToolboxTalks(talks);
        setPendingReminders(reminders);

        // If there are pending Toolbox Talks, show them first (blocking)
        // Otherwise, show first Reminder if any (non-blocking)
        if (talks.length === 0 && reminders.length > 0) {
          setShowReminder(true);
        }
      }
    } catch (error) {
      console.error('Error checking pending messages:', error);
    } finally {
      setChecking(false);
    }
  }

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
    setPendingReminders(pendingReminders.slice(1));
    setShowReminder(false);
    
    // Show next reminder if any
    if (pendingReminders.length > 1) {
      setTimeout(() => setShowReminder(true), 300);
    }
  }

  // Show loading state briefly while checking
  if (checking) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-white dark:bg-slate-900 rounded-lg p-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Checking for messages...</p>
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

