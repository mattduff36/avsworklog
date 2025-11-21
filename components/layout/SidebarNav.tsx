'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  Users,
  CheckSquare,
  ListTodo,
  Truck,
  MessageSquare,
  X
} from 'lucide-react';
import { useEffect } from 'react';

interface SidebarNavProps {
  open: boolean;
  onClose: () => void;
}

export function SidebarNav({ open, onClose }: SidebarNavProps) {
  const pathname = usePathname();
  const { isAdmin, isManager } = useAuth();

  // Debug logging
  useEffect(() => {
    console.log('SidebarNav open state:', open);
    console.log('SidebarNav isManager:', isManager);
  }, [open, isManager]);

  // Close sidebar on route change
  useEffect(() => {
    if (open) {
      onClose();
    }
  }, [pathname, open, onClose]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    
    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open, onClose]);

  if (!isManager) return null;

  const managerLinks = [
    { href: '/approvals', label: 'Approvals', icon: CheckSquare },
    { href: '/actions', label: 'Actions', icon: ListTodo },
    { href: '/toolbox-talks', label: 'Toolbox Talks', icon: MessageSquare },
    { href: '/reports', label: 'Reports', icon: BarChart3 },
  ];

  const adminLinks = isAdmin ? [
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/vehicles', label: 'Vehicles', icon: Truck },
  ] : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sidebar - Full height */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-64 bg-slate-900 border-r border-slate-700 z-[70] transform transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Manager Menu</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation */}
        <div className="overflow-y-auto h-[calc(100vh-4rem)] py-4">
          {/* Manager Links */}
          <div className="px-3 mb-6">
            <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Management
            </div>
            <div className="space-y-1">
              {managerLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname?.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-avs-yellow text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Admin Links */}
          {isAdmin && (
            <div className="px-3">
              <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Administration
              </div>
              <div className="space-y-1">
                {adminLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname?.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-avs-yellow text-slate-900'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

