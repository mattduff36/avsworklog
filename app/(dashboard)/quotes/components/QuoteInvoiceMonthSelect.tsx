'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatInvoiceMonth, getQuoteInvoiceMonths } from '@/lib/quotes/quote-invoice-month';

export function QuoteInvoiceMonthSelect({ id, value, createdAt, disabled, invalid, className, onChange }: {
  id: string;
  value: string;
  createdAt: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const months = getQuoteInvoiceMonths(createdAt);
  return (
    <Select value={value.slice(0, 7)} onValueChange={month => onChange(`${month}-01`)} disabled={disabled} required>
      <SelectTrigger id={id} className={className} aria-required="true" aria-invalid={invalid || undefined}>
        <SelectValue placeholder="Select invoice month" />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[min(var(--radix-select-content-available-height),256px)] md:max-h-[min(var(--radix-select-content-available-height),256px)] [&_[data-radix-select-viewport]]:[scrollbar-width:thin]! [&_[data-radix-select-viewport]::-webkit-scrollbar]:block!">
        {months.map(month => <SelectItem key={month} value={month}>{formatInvoiceMonth(month)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
