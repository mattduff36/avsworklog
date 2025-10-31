'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
  const [signature, setSignature] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const signaturePadRef = useRef<any>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signature) {
      toast.error('Please provide your signature');
      return;
    }

    setLoading(true);

    try {
      // Extract just the document ID from the assignment (we need to determine the endpoint)
      // Since we're calling /api/rams/[id]/sign, we need the document ID
      // But we only have assignment_id. Let's modify the approach:
      
      const response = await fetch(`/api/rams/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assignment_id: assignmentId,
          signature_data: signature,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign document');
      }

      toast.success('Document signed successfully');

      onSuccess();
    } catch (error) {
      console.error('Sign error:', error);
      toast.error(error instanceof Error ? error.message : 'Signature failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
    }
    setSignature('');
  };

  const handleClose = () => {
    if (loading) return;
    handleClear();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Confirm RAMS Acknowledgment</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{documentTitle}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Confirmation Text */}
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 p-4">
              <div className="text-sm text-blue-900 dark:text-blue-100 space-y-1">
                <p>By signing, you confirm that you have:</p>
                <ul className="list-disc ml-5 mt-2 space-y-1">
                  <li>Read the entire document</li>
                  <li>Understood the safety requirements</li>
                  <li>Agree to follow the method statement</li>
                </ul>
              </div>
            </div>

            {/* Signature Pad */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">
                Your Signature <span className="text-destructive">*</span>
              </label>
              <SignaturePad
                ref={signaturePadRef}
                onSave={setSignature}
                label=""
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={loading || !signature}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !signature}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Confirm Signature
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

