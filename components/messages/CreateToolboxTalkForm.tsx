'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { UserPlus, AlertTriangle, Upload, File, X } from 'lucide-react';
import { toast } from 'sonner';
import { ToolboxTalkAssignDialog } from './ToolboxTalkAssignDialog';

interface CreateToolboxTalkFormProps {
  onSuccess?: () => void;
}

export function CreateToolboxTalkForm({ onSuccess }: CreateToolboxTalkFormProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are allowed');
      e.target.value = '';
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      e.target.value = '';
      return;
    }

    setPdfFile(file);
  }

  function handleRemoveFile() {
    setPdfFile(null);
    const fileInput = document.getElementById('pdf-upload') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  }

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
      // Use FormData to support file upload
      const formData = new FormData();
      formData.append('type', 'TOOLBOX_TALK');
      formData.append('subject', subject);
      formData.append('body', body);
      formData.append('recipient_type', 'individual');
      formData.append('recipient_user_ids', JSON.stringify(employeeIds));
      
      if (pdfFile) {
        formData.append('pdf_file', pdfFile);
      }

      const response = await fetch('/api/messages', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send Toolbox Talk');
      }

      toast.success(`Toolbox Talk sent to ${data.recipients_created} employee(s)`);
      
      // Reset form
      setSubject('');
      setBody('');
      setPdfFile(null);

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
          <Label htmlFor="subject" className="text-foreground">
            Subject *
          </Label>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., Safety Protocol Update - PPE Requirements"
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
            placeholder="Enter the full Toolbox Talk message..."
            rows={10}
            required
            className="bg-white dark:bg-slate-900 border-border text-foreground"
          />
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            This message will be displayed to employees who must sign it.
          </p>
        </div>

        {/* PDF Attachment (Optional) */}
        <div className="space-y-2">
          <Label htmlFor="pdf-upload" className="text-foreground">
            PDF Attachment (Optional)
          </Label>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            Attach a PDF document for employees to read before signing. Maximum 10MB.
          </p>

          {!pdfFile ? (
            <div className="relative">
              <Input
                id="pdf-upload"
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('pdf-upload')?.click()}
                className="h-20 w-full border-2 border-dashed border-border transition-all hover:border-avs-yellow hover:bg-avs-yellow/10"
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-6 w-6" />
                  <span className="font-medium">Choose PDF to upload</span>
                  <span className="text-xs text-muted-foreground">Click to browse</span>
                </div>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 border rounded-md bg-slate-50 dark:bg-slate-800 border-border">
              <File className="h-8 w-8 text-avs-yellow shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{pdfFile.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(pdfFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemoveFile}
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button
            type="submit"
            className="bg-avs-yellow text-slate-900 shadow-md transition-all duration-200 hover:bg-avs-yellow-hover hover:shadow-lg active:scale-95"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Choose Recipients
          </Button>
        </div>
      </form>

      <ToolboxTalkAssignDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSend={handleSendToRecipients}
        subject={subject}
      />
    </>
  );
}

