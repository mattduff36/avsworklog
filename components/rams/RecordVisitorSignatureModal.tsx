'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus } from 'lucide-react';
import { SignaturePad } from '@/components/forms/SignaturePad';
import { toast } from 'sonner';

interface RecordVisitorSignatureModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  documentId: string;
  documentTitle: string;
}

export function RecordVisitorSignatureModal({
  open,
  onClose,
  onSuccess,
  documentId,
  documentTitle,
}: RecordVisitorSignatureModalProps) {
  const [visitorName, setVisitorName] = useState('');
  const [visitorCompany, setVisitorCompany] = useState('');
  const [visitorRole, setVisitorRole] = useState('');
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!visitorName.trim()) {
      toast.error('Please enter visitor name');
      return;
    }

    if (!signatureData) {
      toast.error('Please capture visitor signature');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch('/api/rams/visitor-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          visitor_name: visitorName,
          visitor_company: visitorCompany || null,
          visitor_role: visitorRole || null,
          signature_data: signatureData,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to record visitor signature');
      }

      toast.success('Visitor signature recorded successfully');
      handleClose();
      onSuccess();
    } catch (error) {
      console.error('Error recording visitor signature:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to record signature');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setVisitorName('');
      setVisitorCompany('');
      setVisitorRole('');
      setSignatureData(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Record Visitor Signature
          </DialogTitle>
          <DialogDescription>
            Capture signature from a visitor or contractor for: <strong>{documentTitle}</strong>
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
          {/* Visitor Details */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="visitor-name">
                Visitor Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="visitor-name"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                placeholder="e.g., John Smith"
                required
                disabled={submitting}
                className="text-white "
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="visitor-company">Company</Label>
              <Input
                id="visitor-company"
                value={visitorCompany}
                onChange={(e) => setVisitorCompany(e.target.value)}
                placeholder="e.g., ABC Construction Ltd"
                disabled={submitting}
                className="text-white "
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="visitor-role">Role</Label>
              <Input
                id="visitor-role"
                value={visitorRole}
                onChange={(e) => setVisitorRole(e.target.value)}
                placeholder="e.g., Site Supervisor, Contractor"
                disabled={submitting}
                className="text-white "
              />
            </div>
          </div>

          {/* Signature Pad */}
          <div className="space-y-2">
            <Label>
              Signature <span className="text-destructive">*</span>
            </Label>
            <SignaturePad
              onSave={(signature) => {
                setSignatureData(signature);
                // Validate and submit form
                if (!visitorName.trim()) {
                  toast.error('Please enter visitor name');
                  return;
                }
                // Trigger form submission
                if (formRef.current) {
                  formRef.current.requestSubmit();
                }
              }}
              onCancel={handleClose}
              disabled={submitting}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

