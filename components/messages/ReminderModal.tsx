'use client';

import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell } from 'lucide-react';

interface ReminderModalProps {
  open: boolean;
  onClose: () => void;
  message: {
    id: string;
    recipient_id: string;
    subject: string;
    body: string;
    sender_name: string;
    created_at: string;
  };
  onDismissed: () => void;
}

export function ReminderModal({
  open,
  onClose,
  message,
  onDismissed
}: ReminderModalProps) {
  const hasDismissed = useRef(false);

  // Auto-dismiss (mark as read) silently when the modal opens — fire-and-forget.
  // Does NOT close the modal; the user reads at their own pace and closes manually.
  useEffect(() => {
    if (!open || hasDismissed.current) return;
    hasDismissed.current = true;

    fetch(`/api/messages/${message.recipient_id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      // Silently fail — the notification stays unread and can be retried next time
    });
  }, [open, message.recipient_id]);

  // When the user closes the modal, notify the parent so it can refresh/advance
  function handleClose() {
    if (hasDismissed.current) {
      onDismissed();
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded">
              <Bell className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg text-foreground">
                {message.subject}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                From: {message.sender_name} &middot; {new Date(message.created_at).toLocaleDateString()}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Message Body */}
        <ScrollArea className="max-h-[50vh] w-full rounded-md border border-border p-4">
          <div className="text-sm text-foreground whitespace-pre-wrap">
            {message.body}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            className="border-border text-muted-foreground hover:bg-accent"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
