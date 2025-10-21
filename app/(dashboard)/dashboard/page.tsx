'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { 
  Clock, 
  CheckCircle2, 
  XCircle,
  Plus,
  FileSpreadsheet
} from 'lucide-react';
import { getEnabledForms } from '@/lib/config/forms';

export default function DashboardPage() {
  const { profile, isManager } = useAuth();
  const formTypes = getEnabledForms();

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-white">
          Welcome back, {profile?.full_name}
        </h1>
        <p className="text-slate-400 mt-1">
          Manage your forms and documents
        </p>
      </div>

      {/* Quick Actions - Scalable Grid */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-4">Create New Form</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {formTypes.map((formType) => {
            const Icon = formType.icon;
            return (
              <Card 
                key={formType.id}
                className={`hover:shadow-2xl transition-all cursor-pointer border-l-4 border-${formType.color} bg-slate-800/40 backdrop-blur-xl border-slate-700/50`}
              >
                <Link href={formType.href}>
                  <CardHeader className={`flex flex-row items-center justify-between space-y-0 pb-2 bg-${formType.color}/10`}>
                    <CardTitle className="text-lg font-medium text-white">
                      {formType.title}
                    </CardTitle>
                    <Icon className={`h-5 w-5 text-${formType.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <CardDescription className="text-slate-400">
                        {formType.description}
                      </CardDescription>
                      <Button size="sm" className={`bg-${formType.color} hover:bg-${formType.color}/90 text-white`}>
                        <Plus className="h-4 w-4 mr-1" />
                        Create
                      </Button>
                    </div>
                  </CardContent>
                </Link>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Recent Activity / Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-t-4 border-t-amber-400 bg-slate-800/40 backdrop-blur-xl border-slate-700/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-white">
              Pending Approval
            </CardTitle>
            <Clock className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">0</div>
            <p className="text-xs text-slate-400">
              Forms awaiting review
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-green-400 bg-slate-800/40 backdrop-blur-xl border-slate-700/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-white">
              Approved
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">0</div>
            <p className="text-xs text-slate-400">
              This month
            </p>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-red-400 bg-slate-800/40 backdrop-blur-xl border-slate-700/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-white">
              Requires Attention
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-400">0</div>
            <p className="text-xs text-slate-400">
              Items needing action
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity - Unified view for all form types */}
      <Card className="bg-slate-800/40 backdrop-blur-xl border-slate-700/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-white">
            <span>Recent Activity</span>
            <Badge variant="outline" className="text-slate-400 border-slate-600">
              All Forms
            </Badge>
          </CardTitle>
          <CardDescription className="text-slate-400">
            Your recent submissions across all form types
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-slate-400">
            <FileSpreadsheet className="h-16 w-16 mx-auto mb-4 opacity-20 text-avs-yellow" />
            <p className="text-lg mb-2">No activity yet</p>
            <p className="text-sm text-slate-500 mb-6">
              Start by creating your first form above
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {formTypes.map((formType) => (
                <Link key={formType.id} href={formType.listHref}>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700/50"
                  >
                    View All {formType.title}s
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manager Section */}
      {isManager && (
        <Card className="bg-slate-800/40 backdrop-blur-xl border-slate-700/50 border-t-2 border-t-admin">
          <CardHeader className="bg-admin/10">
            <CardTitle className="text-white">Manager Actions</CardTitle>
            <CardDescription className="text-slate-400">
              Forms requiring your review and approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-slate-400">
              <p>No pending approvals</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

