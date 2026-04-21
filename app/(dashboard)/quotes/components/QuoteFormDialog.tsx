'use client';

import { useEffect, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils/cn';
import { toast } from 'sonner';
import type { Quote, QuoteFormData, QuoteLineItem, QuoteManagerOption } from '../types';

interface Customer {
  id: string;
  company_name: string;
  short_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  default_validity_days: number;
}

interface ApproverOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface QuoteFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: QuoteFormData, isEdit: boolean) => Promise<void>;
  quote?: Quote | null;
  customers: Customer[];
  managerOptions: QuoteManagerOption[];
  approvers: ApproverOption[];
  initialCustomerId?: string | null;
}

const EMPTY_LINE_ITEM: QuoteLineItem = {
  description: '',
  quantity: 1,
  unit: '',
  unit_rate: 0,
  line_total: 0,
  sort_order: 0,
};

type QuoteFieldErrors = Record<string, string>;

function buildAddress(customer?: Customer): string {
  if (!customer) return '';
  return [
    customer.address_line_1,
    customer.address_line_2,
    [customer.city, customer.county].filter(Boolean).join(', ') || null,
    customer.postcode,
  ]
    .filter(Boolean)
    .join('\n');
}

export function QuoteFormDialog({
  open,
  onClose,
  onSubmit,
  quote,
  customers,
  managerOptions,
  approvers,
  initialCustomerId,
}: QuoteFormDialogProps) {
  const { profile } = useAuth();
  const isEditing = !!quote;
  const wasOpenRef = useRef(false);
  const lastDialogKeyRef = useRef<string | null>(null);

  const defaultManager = managerOptions.find(option => option.profile_id === profile?.id) || managerOptions[0];
  const dialogKey = quote ? `edit:${quote.id}` : `new:${initialCustomerId || ''}`;

  const [form, setForm] = useState<QuoteFormData>({
    customer_id: '',
    manager_profile_id: '',
    requester_initials: '',
    quote_date: new Date().toISOString().slice(0, 10),
    attention_name: '',
    attention_email: '',
    site_address: '',
    subject_line: '',
    project_description: '',
    salutation: '',
    validity_days: 30,
    manager_name: '',
    manager_email: '',
    approver_profile_id: '',
    signoff_name: '',
    signoff_title: '',
    custom_footer_text: '',
    version_notes: '',
    start_date: '',
    start_alert_days: '',
    line_items: [{ ...EMPTY_LINE_ITEM }],
  });
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<QuoteFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  function clearFieldError(field: string) {
    setFieldErrors(prev => {
      if (!(field in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function getFieldClassName(field: string) {
    return cn(
      'bg-slate-800',
      fieldErrors[field] ? 'border-red-500 focus-visible:ring-red-500/30' : 'border-slate-600'
    );
  }

  function getSelectClassName(field: string) {
    return cn(
      'bg-slate-800',
      fieldErrors[field] ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-600'
    );
  }

  function renderFieldError(field: string) {
    if (!fieldErrors[field]) {
      return null;
    }

    return <p className="text-xs text-red-300">{fieldErrors[field]}</p>;
  }

  function isMeaningfulLineItem(item: QuoteLineItem) {
    return Boolean(
      item.description.trim()
      || item.unit.trim()
      || Number(item.unit_rate) !== 0
      || Number(item.quantity) !== 1
    );
  }

  function validateForm(currentForm: QuoteFormData): QuoteFieldErrors {
    const nextErrors: QuoteFieldErrors = {};

    if (!currentForm.customer_id) {
      nextErrors.customer_id = 'Select a customer.';
    }

    if (!currentForm.manager_profile_id) {
      nextErrors.manager_profile_id = 'Select a manager.';
    }

    currentForm.line_items.forEach((item, index) => {
      if (isMeaningfulLineItem(item) && !item.description.trim()) {
        nextErrors[`line_items.${index}.description`] = 'Enter a description for this line item.';
      }
    });

    return nextErrors;
  }

  function applyManager(profileId: string, currentForm: QuoteFormData): QuoteFormData {
    const selected = managerOptions.find(option => option.profile_id === profileId);
    if (!selected) return currentForm;

    return {
      ...currentForm,
      manager_profile_id: selected.profile_id,
      requester_initials: selected.initials,
      manager_name: currentForm.manager_name || selected.profile?.full_name || selected.signoff_name || '',
      manager_email: selected.manager_email || selected.profile?.email || currentForm.manager_email,
      approver_profile_id: currentForm.approver_profile_id || selected.approver_profile_id || '',
      signoff_name: currentForm.signoff_name || selected.signoff_name || selected.profile?.full_name || '',
      signoff_title: currentForm.signoff_title || selected.signoff_title || '',
    };
  }

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    const shouldInitialize = !wasOpenRef.current || lastDialogKeyRef.current !== dialogKey;
    if (!shouldInitialize) {
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    if (quote) {
      setForm({
        customer_id: quote.customer_id,
        manager_profile_id: quote.requester_id || '',
        requester_initials: quote.requester_initials || '',
        quote_date: quote.quote_date,
        attention_name: quote.attention_name || '',
        attention_email: quote.attention_email || '',
        site_address: quote.site_address || '',
        subject_line: quote.subject_line || '',
        project_description: quote.project_description || '',
        salutation: quote.salutation || '',
        validity_days: quote.validity_days,
        manager_name: quote.manager_name || '',
        manager_email: quote.manager_email || '',
        approver_profile_id: quote.approver_profile_id || '',
        signoff_name: quote.signoff_name || '',
        signoff_title: quote.signoff_title || '',
        custom_footer_text: quote.custom_footer_text || '',
        version_notes: quote.version_notes || '',
        start_date: quote.start_date || '',
        start_alert_days: quote.start_alert_days || '',
        line_items: quote.line_items && quote.line_items.length > 0
          ? quote.line_items.map((li, i) => ({ ...li, sort_order: i }))
          : [{ ...EMPTY_LINE_ITEM }],
      });
    } else {
      const next = applyManager(defaultManager?.profile_id || '', {
        customer_id: '',
        manager_profile_id: defaultManager?.profile_id || '',
        requester_initials: defaultManager?.initials || 'XX',
        quote_date: new Date().toISOString().slice(0, 10),
        attention_name: '',
        attention_email: '',
        site_address: '',
        subject_line: '',
        project_description: '',
        salutation: '',
        validity_days: 30,
        manager_name: defaultManager?.profile?.full_name || profile?.full_name || '',
        manager_email: defaultManager?.manager_email || defaultManager?.profile?.email || '',
        approver_profile_id: defaultManager?.approver_profile_id || '',
        signoff_name: defaultManager?.signoff_name || profile?.full_name || '',
        signoff_title: defaultManager?.signoff_title || '',
        custom_footer_text: '',
        version_notes: '',
        start_date: '',
        start_alert_days: '',
        line_items: [{ ...EMPTY_LINE_ITEM }],
      });

      if (initialCustomerId) {
        const customer = customers.find(item => item.id === initialCustomerId);
        next.customer_id = initialCustomerId;
        next.attention_name = customer?.contact_name || '';
        next.attention_email = customer?.contact_email || '';
        next.salutation = customer?.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : '';
        next.validity_days = customer?.default_validity_days || 30;
        next.site_address = buildAddress(customer);
      }

      setForm(next);
    }
    wasOpenRef.current = true;
    lastDialogKeyRef.current = dialogKey;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, open, profile, defaultManager, initialCustomerId, customers, dialogKey]);

  function updateField<K extends keyof QuoteFormData>(key: K, value: QuoteFormData[K]) {
    clearFieldError(String(key));
    setSubmitError(null);
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function handleCustomerChange(customerId: string) {
    clearFieldError('customer_id');
    setSubmitError(null);
    const customer = customers.find(c => c.id === customerId);
    setForm(prev => ({
      ...prev,
      customer_id: customerId,
      attention_name: customer?.contact_name || prev.attention_name,
      attention_email: customer?.contact_email || prev.attention_email,
      site_address: buildAddress(customer) || prev.site_address,
      validity_days: customer?.default_validity_days || prev.validity_days,
      salutation: customer?.contact_name ? `Dear ${customer.contact_name.split(' ')[0]},` : prev.salutation,
    }));
  }

  function handleManagerChange(managerProfileId: string) {
    clearFieldError('manager_profile_id');
    setSubmitError(null);
    setForm(prev => applyManager(managerProfileId, {
      ...prev,
      manager_profile_id: managerProfileId,
      manager_name: '',
      manager_email: '',
      signoff_name: '',
      signoff_title: '',
      approver_profile_id: '',
    }));
  }

  function updateLineItem(idx: number, field: keyof QuoteLineItem, value: string | number) {
    clearFieldError(`line_items.${idx}.description`);
    setSubmitError(null);
    setForm(prev => {
      const items = [...prev.line_items];
      const item = { ...items[idx], [field]: value };
      item.line_total = Math.round(Number(item.quantity) * Number(item.unit_rate) * 100) / 100;
      items[idx] = item;
      return { ...prev, line_items: items };
    });
  }

  function addLineItem() {
    setSubmitError(null);
    setForm(prev => ({
      ...prev,
      line_items: [...prev.line_items, { ...EMPTY_LINE_ITEM, sort_order: prev.line_items.length }],
    }));
  }

  function removeLineItem(idx: number) {
    clearFieldError(`line_items.${idx}.description`);
    setSubmitError(null);
    setForm(prev => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== idx).map((li, i) => ({ ...li, sort_order: i })),
    }));
  }

  const subtotal = form.line_items.reduce((sum, li) => sum + Number(li.quantity) * Number(li.unit_rate), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErrors = validateForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setSubmitError('Please correct the highlighted fields and try again.');
      toast.error('Please correct the highlighted fields and try again.');
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      await onSubmit(form, isEditing);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save quote';
      const nextFieldErrors = error instanceof Error && 'fieldErrors' in error
        ? ((error as Error & { fieldErrors?: QuoteFieldErrors }).fieldErrors || {})
        : {};

      setFieldErrors(nextFieldErrors);
      setSubmitError(message);
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

          {submitError ? (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {submitError}
            </div>
          ) : null}

          <p className="mt-4 text-xs text-muted-foreground">
            Only fields marked with `*` are required to create the initial draft.
          </p>

          <div className="grid gap-4 py-4">
            {/* Customer & Requester */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Customer *</Label>
                <Select value={form.customer_id} onValueChange={handleCustomerChange}>
                  <SelectTrigger className={getSelectClassName('customer_id')} aria-invalid={!!fieldErrors.customer_id}>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {renderFieldError('customer_id')}
              </div>
              <div className="space-y-2">
                <Label>Manager *</Label>
                <Select value={form.manager_profile_id} onValueChange={handleManagerChange}>
                  <SelectTrigger className={getSelectClassName('manager_profile_id')} aria-invalid={!!fieldErrors.manager_profile_id}>
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {managerOptions.map(option => (
                      <SelectItem key={option.profile_id} value={option.profile_id}>
                        {(option.profile?.full_name || option.signoff_name || option.initials)} ({option.initials})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {renderFieldError('manager_profile_id')}
              </div>
              <div className="space-y-2">
                <Label>Requester Initials</Label>
                <Input
                  value={form.requester_initials}
                  readOnly
                  maxLength={10}
                  className="bg-slate-800 border-slate-600 font-mono"
                />
                <p className="text-xs text-muted-foreground">Linked to the selected manager’s quote number series.</p>
              </div>
            </div>

            {/* Quote header */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.quote_date}
                  onChange={e => updateField('quote_date', e.target.value)}
                  className={getFieldClassName('quote_date')}
                />
                {renderFieldError('quote_date')}
              </div>
              <div className="space-y-2">
                <Label>Validity (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.validity_days}
                  onChange={e => updateField('validity_days', parseInt(e.target.value) || 30)}
                  className={getFieldClassName('validity_days')}
                />
                {renderFieldError('validity_days')}
              </div>
              <div className="space-y-2">
                <Label>Approver</Label>
                <Select value={form.approver_profile_id || undefined} onValueChange={value => updateField('approver_profile_id', value)}>
                  <SelectTrigger className={getSelectClassName('approver_profile_id')} aria-invalid={!!fieldErrors.approver_profile_id}>
                    <SelectValue placeholder="Select approver" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvers.map(approver => (
                      <SelectItem key={approver.id} value={approver.id}>
                        {approver.full_name || approver.email || approver.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {renderFieldError('approver_profile_id')}
              </div>
            </div>

            {/* Attention */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>For the attention of</Label>
                <Input
                  value={form.attention_name}
                  onChange={e => updateField('attention_name', e.target.value)}
                  className={getFieldClassName('attention_name')}
                />
                {renderFieldError('attention_name')}
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={form.attention_email}
                  onChange={e => updateField('attention_email', e.target.value)}
                  className={getFieldClassName('attention_email')}
                />
                {renderFieldError('attention_email')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Manager Email</Label>
                <Input
                  type="email"
                  value={form.manager_email}
                  onChange={e => updateField('manager_email', e.target.value)}
                  className={getFieldClassName('manager_email')}
                />
                {renderFieldError('manager_email')}
              </div>
              <div className="space-y-2">
                <Label>Manager Name</Label>
                <Input
                  value={form.manager_name}
                  onChange={e => updateField('manager_name', e.target.value)}
                  className={getFieldClassName('manager_name')}
                />
                {renderFieldError('manager_name')}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Site Address</Label>
              <Textarea
                value={form.site_address}
                onChange={e => updateField('site_address', e.target.value)}
                rows={3}
                className={getFieldClassName('site_address')}
              />
              {renderFieldError('site_address')}
            </div>

            <div className="space-y-2">
              <Label>Salutation</Label>
              <Input
                value={form.salutation}
                onChange={e => updateField('salutation', e.target.value)}
                placeholder="Dear Phil,"
                className={getFieldClassName('salutation')}
              />
              {renderFieldError('salutation')}
            </div>

            {/* Subject / Description */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Subject Line</Label>
                <Input
                  value={form.subject_line}
                  onChange={e => updateField('subject_line', e.target.value)}
                  placeholder="e.g. Supply of Fence Panels & Accessories"
                  className={getFieldClassName('subject_line')}
                />
                {renderFieldError('subject_line')}
              </div>
              <div className="space-y-2">
                <Label>Project Description</Label>
                <Textarea
                  value={form.project_description}
                  onChange={e => updateField('project_description', e.target.value)}
                  placeholder="e.g. Saint-Gobain Newark"
                  rows={2}
                  className={getFieldClassName('project_description')}
                />
                {renderFieldError('project_description')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={e => updateField('start_date', e.target.value)}
                  className={getFieldClassName('start_date')}
                />
                {renderFieldError('start_date')}
              </div>
              <div className="space-y-2">
                <Label>Alert Days Before Start</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.start_alert_days}
                  onChange={e => updateField('start_alert_days', e.target.value ? Number(e.target.value) : '')}
                  placeholder="7"
                  className={getFieldClassName('start_alert_days')}
                />
                {renderFieldError('start_alert_days')}
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
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <GripVertical className="h-4 w-4 text-slate-600 hidden sm:block flex-shrink-0" />
                        <Input
                          value={item.description}
                          onChange={e => updateLineItem(idx, 'description', e.target.value)}
                          placeholder="Item description"
                          className={cn('h-8 text-sm', getFieldClassName(`line_items.${idx}.description`))}
                        />
                      </div>
                      {renderFieldError(`line_items.${idx}.description`)}
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
                    <span className="text-muted-foreground mr-4">Total</span>
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
                    className={getFieldClassName('signoff_name')}
                  />
                  {renderFieldError('signoff_name')}
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={form.signoff_title}
                    onChange={e => updateField('signoff_title', e.target.value)}
                    placeholder="Contracts Manager"
                    className={getFieldClassName('signoff_title')}
                  />
                  {renderFieldError('signoff_title')}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Internal Notes / Version Notes</Label>
              <Textarea
                value={form.version_notes}
                onChange={e => updateField('version_notes', e.target.value)}
                rows={3}
                placeholder="Use this for revision context, handover notes, or customer-specific context."
                className={getFieldClassName('version_notes')}
              />
              {renderFieldError('version_notes')}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="border-slate-600 text-muted-foreground">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
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
