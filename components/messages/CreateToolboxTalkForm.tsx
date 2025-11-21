'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Send, AlertTriangle, Users } from 'lucide-react';
import { toast } from 'sonner';

interface CreateToolboxTalkFormProps {
  onSuccess?: () => void;
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admins' },
  { value: 'manager', label: 'Managers' },
  { value: 'employee-civils', label: 'Civils Employees' },
  { value: 'employee-plant', label: 'Plant Employees' },
  { value: 'employee-transport', label: 'Transport Employees' },
  { value: 'employee-office', label: 'Office Employees' },
  { value: 'employee-workshop', label: 'Workshop Employees' },
];

export function CreateToolboxTalkForm({ onSuccess }: CreateToolboxTalkFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipientType, setRecipientType] = useState<'role' | 'all_staff'>('role');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  function handleRoleToggle(roleValue: string) {
    if (selectedRoles.includes(roleValue)) {
      setSelectedRoles(selectedRoles.filter(r => r !== roleValue));
    } else {
      setSelectedRoles([...selectedRoles, roleValue]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
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

    if (recipientType === 'role' && selectedRoles.length === 0) {
      toast.error('Please select at least one role or choose "All Staff"');
      return;
    }

    setSending(true);

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
          recipient_type: recipientType,
          recipient_roles: recipientType === 'role' ? selectedRoles : undefined
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
      setSelectedRoles([]);
      setRecipientType('role');

      onSuccess?.();

    } catch (error) {
      console.error('Error sending Toolbox Talk:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send Toolbox Talk');
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
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
          disabled={sending}
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
          disabled={sending}
          className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
        />
        <p className="text-xs text-slate-500 dark:text-slate-500">
          This message will be displayed to employees who must sign it.
        </p>
      </div>

      {/* Recipients */}
      <div className="space-y-4">
        <Label className="text-slate-900 dark:text-white">Recipients *</Label>

        {/* All Staff Option */}
        <div className="flex items-center space-x-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <Checkbox
            id="all-staff"
            checked={recipientType === 'all_staff'}
            onCheckedChange={(checked) => {
              if (checked) {
                setRecipientType('all_staff');
                setSelectedRoles([]);
              } else {
                setRecipientType('role');
              }
            }}
            disabled={sending}
          />
          <label
            htmlFor="all-staff"
            className="text-sm font-medium text-slate-900 dark:text-white cursor-pointer flex items-center gap-2"
          >
            <Users className="h-4 w-4" />
            Send to All Staff
          </label>
        </div>

        {/* Role Selection */}
        {recipientType === 'role' && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">Or select specific roles:</p>
            <div className="grid grid-cols-2 gap-3">
              {ROLE_OPTIONS.map((role) => (
                <div
                  key={role.value}
                  className="flex items-center space-x-2 p-2 rounded border border-slate-200 dark:border-slate-700"
                >
                  <Checkbox
                    id={`role-${role.value}`}
                    checked={selectedRoles.includes(role.value)}
                    onCheckedChange={() => handleRoleToggle(role.value)}
                    disabled={sending}
                  />
                  <label
                    htmlFor={`role-${role.value}`}
                    className="text-sm text-slate-900 dark:text-white cursor-pointer flex-1"
                  >
                    {role.label}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {recipientType === 'all_staff' && (
          <p className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <Users className="h-4 w-4" />
            This Toolbox Talk will be sent to all employees
          </p>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <Button
          type="submit"
          disabled={sending}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Send Toolbox Talk
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

