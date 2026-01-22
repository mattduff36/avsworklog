'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);

    try {
      const response = await fetch(`/api/messages/${message.recipient_id}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to dismiss reminder');
      }

      toast.success('Reminder acknowledged');
      onDismissed();
      onClose();

    } catch (error) {
      // Don't log network/validation errors - user already sees toast
      // console.error('Error dismissing reminder:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to dismiss reminder');
    } finally {
      setDismissing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded">
              <Bell className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg text-foreground">Reminder</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                From: <strong>{message.sender_name}</strong> • {new Date(message.created_at).toLocaleDateString()}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Message Subject */}
          <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border-l-4 border-blue-500">
            <h3 className="text-base font-semibold text-foreground">{message.subject}</h3>
          </div>

          {/* Message Body */}
          <ScrollArea className="h-[200px] w-full rounded-md border border-border p-4">
            <div className="text-sm text-foreground whitespace-pre-wrap">
              {message.body}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={dismissing}
            className="border-border text-muted-foreground hover:bg-accent"
          >
            Close
          </Button>
          <Button
            onClick={handleDismiss}
            disabled={dismissing}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {dismissing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Acknowledging...
              </>
            ) : (
              'Acknowledge & Dismiss'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

