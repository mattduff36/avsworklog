'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Construction, UserPlus, Search, Edit, Trash2, Shield, User, Mail, Calendar } from 'lucide-react';

export default function UsersAdminPage() {
  // Mock user data for UI preview
  const mockUsers = [
    { id: 1, name: 'John Smith', email: 'john@example.com', role: 'Admin', employeeId: 'E001', status: 'Active', lastLogin: '2025-10-22' },
    { id: 2, name: 'Sarah Johnson', email: 'sarah@example.com', role: 'Manager', employeeId: 'E002', status: 'Active', lastLogin: '2025-10-21' },
    { id: 3, name: 'Mike Davis', email: 'mike@example.com', role: 'Employee', employeeId: 'E003', status: 'Active', lastLogin: '2025-10-20' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Manage users, roles, and permissions
          </p>
        </div>
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">
          <Construction className="h-3 w-3 mr-1" />
          In Development
        </Badge>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <User className="h-8 w-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Admins</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <Shield className="h-8 w-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Managers</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <Shield className="h-8 w-8 text-amber-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Employees</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <User className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Management Interface */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>
                View and manage user accounts, roles, and permissions
              </CardDescription>
            </div>
            <div className="flex gap-2 opacity-50 pointer-events-none">
              <Button variant="outline" disabled>
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
              <Button disabled>
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search Bar (Disabled Preview) */}
            <div className="flex gap-2 opacity-50 pointer-events-none">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by name, email, or employee ID..." disabled className="pl-9" />
              </div>
            </div>

            {/* User Table (Preview) */}
            <div className="border rounded-lg opacity-50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center">
                            <User className="h-4 w-4 text-slate-600" />
                          </div>
                          {user.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {user.email}
                        </div>
                      </TableCell>
                      <TableCell>{user.employeeId}</TableCell>
                      <TableCell>
                        <Badge variant={
                          user.role === 'Admin' ? 'destructive' :
                          user.role === 'Manager' ? 'default' : 'secondary'
                        }>
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {user.lastLogin}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" disabled>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" disabled>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Coming Soon Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center mt-4">
              <Construction className="h-8 w-8 text-amber-600 mx-auto mb-2" />
              <p className="text-sm text-amber-800 font-medium mb-2">
                User management features are under development
              </p>
              <p className="text-xs text-amber-700">
                Create, edit, and manage user accounts • Assign roles and permissions • View activity history
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
