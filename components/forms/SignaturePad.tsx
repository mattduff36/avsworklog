'use client';

import { useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { X, Check, RotateCcw } from 'lucide-react';

interface SignaturePadProps {
  onSave: (signature: string) => void;
  onCancel: () => void;
  initialValue?: string | null;
}

export function SignaturePad({ onSave, onCancel, initialValue }: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);

  useEffect(() => {
    if (initialValue && sigCanvas.current) {
      sigCanvas.current.fromDataURL(initialValue);
    }
  }, [initialValue]);

  const handleClear = () => {
    sigCanvas.current?.clear();
  };

  const handleSave = () => {
    if (sigCanvas.current?.isEmpty()) {
      alert('Please provide a signature');
      return;
    }
    const dataURL = sigCanvas.current?.toDataURL('image/png');
    if (dataURL) {
      onSave(dataURL);
    }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Sign below</label>
        <div className="border-2 border-dashed rounded-md bg-white">
          <SignatureCanvas
            ref={sigCanvas}
            canvasProps={{
              className: 'w-full h-48 md:h-64',
              style: { touchAction: 'none' }
            }}
            backgroundColor="white"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Sign with your finger or mouse
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
        >
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
        >
          <Check className="h-4 w-4 mr-2" />
          Save Signature
        </Button>
      </div>
    </Card>
  );
}

export default SignaturePad;

