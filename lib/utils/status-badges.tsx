import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, XCircle, Package, Edit2 } from 'lucide-react';

/**
 * Centralized status badge utilities
 * Provides consistent badge styling across the application
 */

export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted';
export type InspectionStatus = 'draft' | 'submitted';
export type AbsenceStatus = 'pending' | 'approved' | 'rejected';

interface StatusConfig {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  icon?: React.ReactNode;
}

const timesheetStatusConfig: Record<TimesheetStatus, StatusConfig> = {
  draft: {
    label: 'Draft',
    variant: 'secondary',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
  submitted: {
    label: 'Pending',
    variant: 'default',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
  approved: {
    label: 'Approved',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    icon: <XCircle className="h-3 w-3 mr-1" />,
  },
  processed: {
    label: 'Processed',
    variant: 'outline',
    icon: <Package className="h-3 w-3 mr-1" />,
  },
  adjusted: {
    label: 'Adjusted',
    variant: 'outline',
    icon: <Edit2 className="h-3 w-3 mr-1" />,
  },
};

const inspectionStatusConfig: Record<InspectionStatus, StatusConfig> = {
  draft: {
    label: 'Draft',
    variant: 'secondary',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
  submitted: {
    label: 'Submitted',
    variant: 'default',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
};

const absenceStatusConfig: Record<AbsenceStatus, StatusConfig> = {
  pending: {
    label: 'Pending',
    variant: 'default',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
  approved: {
    label: 'Approved',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    icon: <XCircle className="h-3 w-3 mr-1" />,
  },
};

export function getTimesheetStatusBadge(status: string) {
  const config = timesheetStatusConfig[status as TimesheetStatus] || {
    label: status,
    variant: 'outline' as const,
  };

  return (
    <Badge variant={config.variant} className="flex items-center w-fit">
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function getInspectionStatusBadge(status: string) {
  const config = inspectionStatusConfig[status as InspectionStatus] || {
    label: status,
    variant: 'outline' as const,
  };

  return (
    <Badge variant={config.variant} className="flex items-center w-fit">
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function getAbsenceStatusBadge(status: string) {
  const config = absenceStatusConfig[status as AbsenceStatus] || {
    label: status,
    variant: 'outline' as const,
  };

  return (
    <Badge variant={config.variant} className="flex items-center w-fit">
      {config.icon}
      {config.label}
    </Badge>
  );
}

