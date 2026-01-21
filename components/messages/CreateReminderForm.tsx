'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, UserPlus, Info } from 'lucide-react';
import { toast } from 'sonner';
import { AssignRecipientsModal } from './AssignRecipientsModal';

interface CreateReminderFormProps {
  onSuccess?: () => void;
}

export function CreateReminderForm({ onSuccess }: CreateReminderFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  function handleOpenModal(e: React.FormEvent) {
    e.preventDefault();

    // Validation
    if (!subject.trim()) {
      toast.error('Subject is required');
      return;
    }

    if (!body.trim()) {
      toast.error('Message body is required');
      return;
    }

    setModalOpen(true);
  }

  async function handleSendToRecipients(employeeIds: string[]) {
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'REMINDER',
          subject,
          body,
          recipient_type: 'individual',
          recipient_user_ids: employeeIds
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send Reminder');
      }

      toast.success(`Reminder sent to ${data.recipients_created} employee(s)`);
      
      // Reset form
      setSubject('');
      setBody('');

      onSuccess?.();

    } catch (error) {
      console.error('Error sending Reminder:', error);
      throw error;
    }
  }

  return (
    <>
      <form onSubmit={handleOpenModal} className="space-y-6">
        {/* Info Alert */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Reminders are non-blocking informational messages. Recipients can dismiss them after reading and continue using the app normally.
          </AlertDescription>
        </Alert>

        {/* Subject */}
        <div className="space-y-2">
          <Label htmlFor="subject" className="text-foreground">
            Subject *
          </Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., Upcoming Site Inspection - Friday 3pm"
            required
            className="bg-white dark:bg-slate-900 border-border text-foreground"
          />
        </div>

        {/* Message Body */}
        <div className="space-y-2">
          <Label htmlFor="body" className="text-foreground">
            Message *
          </Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Enter the reminder message..."
            rows={8}
            required
            className="bg-white dark:bg-slate-900 border-border text-foreground"
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            This message will be shown in the notifications panel for 60 days.
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Choose Recipients
          </Button>
        </div>
      </form>

      {/* Assign Recipients Modal */}
      <AssignRecipientsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSend={handleSendToRecipients}
        messageSubject={subject}
        messageType="REMINDER"
      />
    </>
  );
}

