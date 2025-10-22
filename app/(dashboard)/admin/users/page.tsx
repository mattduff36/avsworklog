'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Construction } from 'lucide-react';

export default function UsersAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">User Management</h1>
        <p className="text-muted-foreground">
          Manage users, roles, and permissions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Construction className="h-6 w-6 text-amber-600" />
            <span>Coming Soon</span>
          </CardTitle>
          <CardDescription>
            User management features are being implemented
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-muted-foreground">
              The user management system will allow administrators to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li>Create and manage user accounts</li>
              <li>Assign roles (Admin, Manager, Employee)</li>
              <li>Set employee IDs and details</li>
              <li>Reset passwords</li>
              <li>Deactivate accounts</li>
              <li>View user activity</li>
            </ul>
            <div className="pt-4">
              <p className="text-sm text-muted-foreground">
                For now, users can be created manually through the Supabase dashboard.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

