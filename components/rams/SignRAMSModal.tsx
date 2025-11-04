'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import SignaturePad from '@/components/forms/SignaturePad';

interface SignRAMSModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  assignmentId: string;
  documentTitle: string;
}

export function SignRAMSModal({
  open,
  onClose,
  onSuccess,
  assignmentId,
  documentTitle,
}: SignRAMSModalProps) {
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState('');

  const handleSaveSignature = async (signature: string) => {
    if (!signature) {
      toast.error('Please provide your signature');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/rams/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignment_id: assignmentId,
          signature_data: signature,
          comments: comments.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign document');
      }

      toast.success('Document signed successfully');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Sign error:', error);
      toast.error(error instanceof Error ? error.message : 'Signature failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <DialogHeader>
          <DialogTitle>Confirm RAMS Acknowledgment</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{documentTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Confirmation Text */}
          <div className="rounded-md bg-blue-900/20 border border-blue-800/30 p-4">
            <div className="text-sm text-blue-100 space-y-1">
              <p>By signing, you confirm that you have:</p>
              <ul className="list-disc ml-5 mt-2 space-y-1">
                <li>Read the entire document</li>
                <li>Understood the safety requirements</li>
                <li>Agree to follow the method statement</li>
              </ul>
            </div>
          </div>

          {/* Comments (Optional) */}
          <div className="grid gap-2">
            <Label htmlFor="comments" className="text-sm font-medium text-slate-900 dark:text-white">
              Comments (Optional)
            </Label>
            <Textarea
              id="comments"
              placeholder="Add any comments or observations about this RAMS document..."
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              disabled={loading}
              rows={3}
              className="resize-none bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>

          {/* Signature Pad */}
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-900 dark:text-white">
              Your Signature <span className="text-destructive">*</span>
            </label>
            <SignaturePad
              onSave={handleSaveSignature}
              onCancel={handleClose}
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Signing document...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

