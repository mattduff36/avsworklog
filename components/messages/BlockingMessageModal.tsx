'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { Loader2, AlertTriangle, Shield } from 'lucide-react';
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
  const [showSignature, setShowSignature] = useState(false);
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

  function handleReadAndSign() {
    setShowSignature(true);
  }

  // This modal cannot be closed by user - they must sign
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] bg-white dark:bg-slate-900 border-red-600 dark:border-red-600"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-red-100 dark:bg-red-950 rounded">
              <Shield className="h-6 w-6 text-red-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl text-red-600">⚠️ Toolbox Talk - Action Required</DialogTitle>
              <DialogDescription className="text-slate-600 dark:text-slate-400">
                From: <strong>{message.sender_name}</strong> • {new Date(message.created_at).toLocaleDateString()}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Progress indicator if multiple */}
        {totalPending > 1 && (
          <div className="px-6 -mt-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Message {currentIndex + 1} of {totalPending}
            </p>
          </div>
        )}

        <div className="px-6 pb-6 space-y-4">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>You must read and sign this Toolbox Talk before continuing to use the app.</strong>
              <br />
              This is important safety information that requires your acknowledgement.
            </AlertDescription>
          </Alert>

          {/* Message Subject */}
          <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 border-l-4 border-red-600">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{message.subject}</h3>
          </div>

          {/* Message Body */}
          <ScrollArea className="h-[200px] w-full rounded-md border border-slate-200 dark:border-slate-700 p-4">
            <div className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">
              {message.body}
            </div>
          </ScrollArea>

          {/* Signature Section */}
          {!showSignature ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                By clicking below, you confirm that you have read and understood this Toolbox Talk. You will be asked to provide your electronic signature.
              </p>
              <Button 
                onClick={handleReadAndSign}
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                size="lg"
              >
                I Have Read This - Continue to Sign
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  <strong>Electronic Signature Required</strong>
                  <br />
                  Please sign below to confirm you have read and understood this Toolbox Talk.
                </p>
              </div>
              
              <SignaturePad
                onSave={handleSign}
                onCancel={() => setShowSignature(false)}
                disabled={signing}
              />

              {signing && (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recording signature...
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

