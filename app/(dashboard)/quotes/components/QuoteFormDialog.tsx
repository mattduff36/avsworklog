'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, GripVertical } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { toast } from 'sonner';
import type { Quote, QuoteFormData, QuoteLineItem } from '../types';

interface Customer {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  default_validity_days: number;
}

interface QuoteFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: QuoteFormData, isEdit: boolean) => Promise<void>;
  quote?: Quote | null;
  customers: Customer[];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return 'XX';
  return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
}

const EMPTY_LINE_ITEM: QuoteLineItem = {
  description: '',
  quantity: 1,
  unit: '',
  unit_rate: 0,
  line_total: 0,
  sort_order: 0,
};

export function QuoteFormDialog({ open, onClose, onSubmit, quote, customers }: QuoteFormDialogProps) {
  const { profile } = useAuth();
  const isEditing = !!quote;

  const [form, setForm] = useState<QuoteFormData>({
    customer_id: '',
    requester_initials: '',
    quote_date: new Date().toISOString().slice(0, 10),
    attention_name: '',
    attention_email: '',
    subject_line: '',
    project_description: '',
    salutation: '',
    validity_days: 30,
    signoff_name: '',
    signoff_title: '',
    custom_footer_text: '',
    line_items: [{ ...EMPTY_LINE_ITEM }],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (quote) {
      setForm({
        customer_id: quote.customer_id,
        requester_initials: quote.requester_initials || '',
        quote_date: quote.quote_date,
        attention_name: quote.attention_name || '',
        attention_email: quote.attention_email || '',
        subject_line: quote.subject_line || '',
        project_description: quote.project_description || '',
        salutation: quote.salutation || '',
        validity_days: quote.validity_days,
        signoff_name: quote.signoff_name || '',
        signoff_title: quote.signoff_title || '',
        custom_footer_text: quote.custom_footer_text || '',
        line_items: quote.line_items && quote.line_items.length > 0
          ? quote.line_items.map((li, i) => ({ ...li, sort_order: i }))
          : [{ ...EMPTY_LINE_ITEM }],
      });
    } else {
      const initials = profile?.full_name ? getInitials(profile.full_name) : 'XX';
      setForm({
        customer_id: '',
        requester_initials: initials,
        quote_date: new Date().toISOString().slice(0, 10),
        attention_name: '',
        attention_email: '',
        subject_line: '',
        project_description: '',
        salutation: '',
        validity_days: 30,
        signoff_name: profile?.full_name || '',
        signoff_title: '',
        custom_footer_text: '',
        line_items: [{ ...EMPTY_LINE_ITEM }],
      });
    }
  }, [quote, open, profile]);

  function updateField<K extends keyof QuoteFormData>(key: K, value: QuoteFormData[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleCustomerChange(customerId: string) {
    const customer = customers.find(c => c.id === customerId);
    setForm(prev => ({
      ...prev,
      customer_id: customerId,
      attention_name: customer?.contact_name || prev.attention_name,
      attention_email: customer?.contact_email || prev.attention_email,
      validity_days: customer?.default_validity_days || prev.validity_days,
      salutation: customer?.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : prev.salutation,
    }));
  }

  function updateLineItem(idx: number, field: keyof QuoteLineItem, value: string | number) {
    setForm(prev => {
      const items = [...prev.line_items];
      const item = { ...items[idx], [field]: value };
      item.line_total = Math.round(Number(item.quantity) * Number(item.unit_rate) * 100) / 100;
      items[idx] = item;
      return { ...prev, line_items: items };
    });
  }

  function addLineItem() {
    setForm(prev => ({
      ...prev,
      line_items: [...prev.line_items, { ...EMPTY_LINE_ITEM, sort_order: prev.line_items.length }],
    }));
  }

  function removeLineItem(idx: number) {
    setForm(prev => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== idx).map((li, i) => ({ ...li, sort_order: i })),
    }));
  }

  const subtotal = form.line_items.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unit_rate), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit(form, isEditing);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save quote';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-700 text-white">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-white">
              {isEditing ? 'Edit Quote' : 'New Quote'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {isEditing ? 'Modify quote details and line items.' : 'Create a new customer quotation.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Customer & Requester */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Customer *</Label>
                <Select value={form.customer_id} onValueChange={handleCustomerChange}>
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Requester Initials</Label>
                <Input
                  value={form.requester_initials}
                  onChange={e => updateField('requester_initials', e.target.value.toUpperCase().slice(0, 10))}
                  placeholder="GH"
                  maxLength={10}
                  className="bg-slate-800 border-slate-600 font-mono"
                />
                <p className="text-xs text-muted-foreground">Auto-generated from your name. Override if needed.</p>
              </div>
            </div>

            {/* Quote header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.quote_date}
                  onChange={e => updateField('quote_date', e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Validity (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.validity_days}
                  onChange={e => updateField('validity_days', parseInt(e.target.value) || 30)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            {/* Attention */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>For the attention of</Label>
                <Input
                  value={form.attention_name}
                  onChange={e => updateField('attention_name', e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={form.attention_email}
                  onChange={e => updateField('attention_email', e.target.value)}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Salutation</Label>
              <Input
                value={form.salutation}
                onChange={e => updateField('salutation', e.target.value)}
                placeholder="Dear Phil,"
                className="bg-slate-800 border-slate-600"
              />
            </div>

            {/* Subject / Description */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Subject Line *</Label>
                <Input
                  value={form.subject_line}
                  onChange={e => updateField('subject_line', e.target.value)}
                  placeholder="e.g. Supply of Fence Panels & Accessories"
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <div className="space-y-2">
                <Label>Project Description</Label>
                <Textarea
                  value={form.project_description}
                  onChange={e => updateField('project_description', e.target.value)}
                  placeholder="e.g. Saint-Gobain Newark"
                  rows={2}
                  className="bg-slate-800 border-slate-600"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="border-t border-slate-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-muted-foreground">Line Items</h4>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem} className="border-slate-600 text-muted-foreground hover:bg-slate-700/50">
                  <Plus className="h-3 w-3 mr-1" /> Add Item
                </Button>
              </div>

              <div className="space-y-2">
                {/* Header */}
                <div className="hidden sm:grid grid-cols-[1fr_80px_80px_100px_100px_40px] gap-2 text-xs font-semibold text-muted-foreground px-1">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Unit</span>
                  <span>Rate (£)</span>
                  <span className="text-right">Total</span>
                  <span></span>
                </div>

                {form.line_items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_80px_80px_100px_100px_40px] gap-2 items-center bg-slate-800/30 rounded-lg p-2 sm:p-1">
                    <div className="flex items-center gap-1">
                      <GripVertical className="h-4 w-4 text-slate-600 hidden sm:block flex-shrink-0" />
                      <Input
                        value={item.description}
                        onChange={e => updateLineItem(idx, 'description', e.target.value)}
                        placeholder="Item description"
                        className="bg-slate-800 border-slate-600 h-8 text-sm"
                      />
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={item.quantity}
                      onChange={e => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="bg-slate-800 border-slate-600 h-8 text-sm"
                    />
                    <Input
                      value={item.unit}
                      onChange={e => updateLineItem(idx, 'unit', e.target.value)}
                      placeholder="each"
                      className="bg-slate-800 border-slate-600 h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unit_rate}
                      onChange={e => updateLineItem(idx, 'unit_rate', parseFloat(e.target.value) || 0)}
                      className="bg-slate-800 border-slate-600 h-8 text-sm"
                    />
                    <div className="text-right font-semibold text-white text-sm pr-1">
                      £{(Number(item.quantity) * Number(item.unit_rate)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLineItem(idx)}
                      disabled={form.line_items.length <= 1}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}

                {/* Subtotal */}
                <div className="flex justify-end pt-2 pr-12">
                  <div className="text-sm">
                    <span className="text-muted-foreground mr-4">Subtotal (excl. VAT)</span>
                    <span className="font-bold text-white">
                      £{subtotal.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sign-off */}
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">Sign-off</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={form.signoff_name}
                    onChange={e => updateField('signoff_name', e.target.value)}
                    placeholder="George Healey"
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={form.signoff_title}
                    onChange={e => updateField('signoff_title', e.target.value)}
                    placeholder="Contracts Manager"
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="border-slate-600 text-muted-foreground">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !form.customer_id || !form.subject_line.trim()}
              className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow/90 font-semibold"
            >
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : isEditing ? 'Update Quote' : 'Create Quote'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
