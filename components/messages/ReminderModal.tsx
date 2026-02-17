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

  // Auto-dismiss (mark as read) when the modal opens — fire-and-forget
  useEffect(() => {
    if (!open || hasDismissed.current) return;
    hasDismissed.current = true;

    fetch(`/api/messages/${message.recipient_id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (res.ok) onDismissed();
      })
      .catch(() => {
        // Silently fail — the notification will stay unread and can be retried
      });
  }, [open, message.recipient_id, onDismissed]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
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
            onClick={onClose}
            className="border-border text-muted-foreground hover:bg-accent"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
