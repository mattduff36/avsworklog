'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { 
  FileText, 
  ClipboardCheck, 
  Clock, 
  CheckCircle2, 
  XCircle,
  Plus
} from 'lucide-react';

export default function DashboardPage() {
  const { profile, isManager } = useAuth();

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">
          Welcome back, {profile?.full_name}
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your timesheets and vehicle inspections
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/timesheets/new">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium">
                New Timesheet
              </CardTitle>
              <FileText className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <CardDescription>
                  Create a new weekly timesheet
                </CardDescription>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create
                </Button>
              </div>
            </CardContent>
          </Link>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <Link href="/inspections/new">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium">
                New Vehicle Inspection
              </CardTitle>
              <ClipboardCheck className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <CardDescription>
                  Create a new vehicle inspection
                </CardDescription>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create
                </Button>
              </div>
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Recent Activity / Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Approval
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Forms awaiting review
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Approved
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              This month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Requires Attention
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              Items needing action
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent Timesheets */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Timesheets</span>
              <Link href="/timesheets">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No timesheets yet</p>
              <Link href="/timesheets/new">
                <Button size="sm" className="mt-4">
                  Create First Timesheet
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recent Inspections */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Recent Inspections</span>
              <Link href="/inspections">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No inspections yet</p>
              <Link href="/inspections/new">
                <Button size="sm" className="mt-4">
                  Create First Inspection
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manager Section */}
      {isManager && (
        <Card>
          <CardHeader>
            <CardTitle>Manager Actions</CardTitle>
            <CardDescription>
              Forms requiring your review and approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <p>No pending approvals</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

