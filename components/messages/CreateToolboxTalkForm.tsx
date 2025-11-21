'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, UserPlus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { AssignRecipientsModal } from './AssignRecipientsModal';

interface CreateToolboxTalkFormProps {
  onSuccess?: () => void;
}

export function CreateToolboxTalkForm({ onSuccess }: CreateToolboxTalkFormProps) {
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
          type: 'TOOLBOX_TALK',
          subject,
          body,
          recipient_type: 'individual',
          recipient_user_ids: employeeIds
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send Toolbox Talk');
      }

      toast.success(`Toolbox Talk sent to ${data.recipients_created} employee(s)`);
      
      // Reset form
      setSubject('');
      setBody('');

      onSuccess?.();

    } catch (error) {
      console.error('Error sending Toolbox Talk:', error);
      throw error;
    }
  }

  return (
    <>
      <form onSubmit={handleOpenModal} className="space-y-6">
        {/* Warning Alert */}
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Important:</strong> Toolbox Talks are high-priority, blocking messages. Recipients will not be able to use the app until they read and sign the message.
          </AlertDescription>
        </Alert>

        {/* Subject */}
        <div className="space-y-2">
          <Label htmlFor="subject" className="text-slate-900 dark:text-white">
            Subject *
          </Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., Safety Protocol Update - PPE Requirements"
            required
            className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
          />
        </div>

        {/* Message Body */}
        <div className="space-y-2">
          <Label htmlFor="body" className="text-slate-900 dark:text-white">
            Message *
          </Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Enter the full Toolbox Talk message..."
            rows={10}
            required
            className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
          />
          <p className="text-xs text-slate-500 dark:text-slate-500">
            This message will be displayed to employees who must sign it.
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
          <Button
            type="submit"
            className="bg-red-600 hover:bg-red-700 text-white"
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
        messageType="TOOLBOX_TALK"
      />
    </>
  );
}

