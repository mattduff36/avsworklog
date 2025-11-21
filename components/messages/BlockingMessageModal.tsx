'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface BlockingMessageModalProps {
  open: boolean;
  message: {
    id: string;
    recipient_id: string;
    subject: string;
    body: string;
    sender_name: string;
    created_at: string;
  };
  onSigned: () => void;
  totalPending: number;
  currentIndex: number;
}

export function BlockingMessageModal({
  open,
  message,
  onSigned,
  totalPending,
  currentIndex
}: BlockingMessageModalProps) {
  const [signing, setSigning] = useState(false);

  async function handleSign(signatureData: string) {
    setSigning(true);

    try {
      const response = await fetch(`/api/messages/${message.recipient_id}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          signature_data: signatureData
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign message');
      }

      toast.success('Toolbox Talk signed successfully');
      onSigned();

    } catch (error) {
      console.error('Error signing message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sign message');
    } finally {
      setSigning(false);
    }
  }

  // This modal cannot be closed by user - they must sign
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 border-red-600 dark:border-red-600 flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-xl text-red-600">Toolbox Talk - Action Required</DialogTitle>
          <DialogDescription className="text-slate-600 dark:text-slate-400">
            From: <strong>{message.sender_name}</strong> • {new Date(message.created_at).toLocaleDateString()}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator if multiple */}
        {totalPending > 1 && (
          <div className="px-6 -mt-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Message {currentIndex + 1} of {totalPending}
            </p>
          </div>
        )}

        <ScrollArea className="flex-1 px-6">
          <div className="pb-6 space-y-4">
            {/* Simple one-line warning */}
            <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-900 dark:text-amber-100">
                Please read and sign this Toolbox Talk to continue using the app.
              </AlertDescription>
            </Alert>

            {/* Message Subject */}
            <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 border-l-4 border-red-600">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{message.subject}</h3>
            </div>

            {/* Message Body - Dynamic height */}
            <div className="max-h-[300px] overflow-y-auto w-full rounded-md border border-slate-200 dark:border-slate-700 p-4">
              <div className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
                {message.body}
              </div>
            </div>

            {/* Signature Section - Always visible like RAMS */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-900 dark:text-white">
                Your Signature <span className="text-destructive">*</span>
              </label>
              
              <SignaturePad
                onSave={handleSign}
                onCancel={() => {}}
                disabled={signing}
                variant="toolbox-talk"
              />

              {signing && (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording signature...
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

