'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { CustomersTable } from './components/CustomersTable';
import { CustomerFormDialog } from './components/CustomerFormDialog';
import type { Customer, CustomerFormData } from './types';

export default function CustomersPage() {
  const { hasPermission: canViewCustomers, loading: permissionLoading } = usePermissionCheck('customers', false);
  const router = useRouter();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await fetch('/api/customers');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionLoading) return;
    if (!canViewCustomers) {
      toast.error('Access denied');
      router.push('/dashboard');
      return;
    }
    fetchCustomers();
  }, [permissionLoading, canViewCustomers, router, fetchCustomers]);

  async function handleCreate(data: CustomerFormData) {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create customer');
    }
    toast.success('Customer added');
    await fetchCustomers();
  }

  async function handleUpdate(data: CustomerFormData) {
    if (!editingCustomer) return;
    const res = await fetch(`/api/customers/${editingCustomer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update customer');
    }
    toast.success('Customer updated');
    setEditingCustomer(null);
    await fetchCustomers();
  }

  function handleRowClick(customer: Customer) {
    router.push(`/customers/${customer.id}/history`);
  }

  if (permissionLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-avs-yellow" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-avs-yellow/10">
          <Building2 className="h-5 w-5 text-avs-yellow" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="text-sm text-muted-foreground">Manage your customer directory</p>
        </div>
      </div>

      <CustomersTable
        customers={customers}
        onAdd={() => { setEditingCustomer(null); setFormOpen(true); }}
        onRowClick={handleRowClick}
      />

      <CustomerFormDialog
        open={formOpen || !!editingCustomer}
        onClose={() => { setFormOpen(false); setEditingCustomer(null); }}
        onSubmit={editingCustomer ? handleUpdate : handleCreate}
        customer={editingCustomer}
      />
    </div>
  );
}
