'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validateAndNormalizePlantSerialNumber } from '@/lib/utils/plant-serial-number';

interface InventorySerialNumberFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

export function InventorySerialNumberField({
  id,
  value,
  onChange,
}: InventorySerialNumberFieldProps) {
  const [error, setError] = useState('');

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Serial Number</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => {
          setError('');
          onChange(event.target.value);
        }}
        onBlur={() => {
          const result = validateAndNormalizePlantSerialNumber(value);
          if (!result.valid) {
            setError(result.error || 'Serial Number must contain only letters and numbers');
            return;
          }
          setError('');
          onChange(result.value || '');
        }}
        placeholder="Optional"
        autoCapitalize="characters"
        spellCheck={false}
        className="bg-slate-800 border-slate-600"
      />
      {error ? (
        <p className="text-xs text-red-300">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Optional. Letters and numbers only; saved in uppercase.
        </p>
      )}
    </div>
  );
}
