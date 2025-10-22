'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Download, Calendar, Construction, BarChart3, TrendingUp, Users, FileSpreadsheet, Clock } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Reports & Analytics</h1>
        <p className="text-muted-foreground">
          Generate and export reports for timesheets, inspections, and workforce analytics
        </p>
      </div>

      {/* Stats Overview (Preview) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Hours (This Week)</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <BarChart3 className="h-8 w-8 text-timesheet/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Approvals</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <Clock className="h-8 w-8 text-amber-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Employees</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <Users className="h-8 w-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Inspections Completed</p>
                <p className="text-2xl font-bold">--</p>
              </div>
              <TrendingUp className="h-8 w-8 text-inspection/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Timesheet Reports */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Timesheet Reports</span>
              <FileText className="h-5 w-5 text-primary" />
            </CardTitle>
            <CardDescription>
              Generate reports for employee timesheets
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">Individual Timesheet PDF</div>
                <div className="text-xs text-muted-foreground">
                  Export single timesheet as PDF
                </div>
              </div>
              <Badge variant="warning">
                <Construction className="h-3 w-3 mr-1" />
                Soon
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">Weekly Summary Excel</div>
                <div className="text-xs text-muted-foreground">
                  Export week summary with all employees
                </div>
              </div>
              <Badge variant="warning">
                <Construction className="h-3 w-3 mr-1" />
                Soon
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">Payroll Export</div>
                <div className="text-xs text-muted-foreground">
                  Export hours for payroll processing
                </div>
              </div>
              <Badge variant="warning">
                <Construction className="h-3 w-3 mr-1" />
                Soon
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Inspection Reports */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Inspection Reports</span>
              <FileText className="h-5 w-5 text-primary" />
            </CardTitle>
            <CardDescription>
              Generate reports for vehicle inspections
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">Inspection PDF</div>
                <div className="text-xs text-muted-foreground">
                  Export single inspection as PDF
                </div>
              </div>
              <Badge variant="warning">
                <Construction className="h-3 w-3 mr-1" />
                Soon
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">Compliance Summary</div>
                <div className="text-xs text-muted-foreground">
                  Vehicle safety compliance report
                </div>
              </div>
              <Badge variant="warning">
                <Construction className="h-3 w-3 mr-1" />
                Soon
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <div className="font-medium">Defects Log</div>
                <div className="text-xs text-muted-foreground">
                  All items requiring attention
                </div>
              </div>
              <Badge variant="warning">
                <Construction className="h-3 w-3 mr-1" />
                Soon
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Custom Report Generator (Interactive Preview) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Custom Report Generator</CardTitle>
              <CardDescription>
                Generate custom reports with date range filters and export options
              </CardDescription>
            </div>
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">
              <Construction className="h-3 w-3 mr-1" />
              In Development
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Filters Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 opacity-50 pointer-events-none">
              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Select report type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="timesheets">Timesheets Summary</SelectItem>
                    <SelectItem value="inspections">Inspections Log</SelectItem>
                    <SelectItem value="payroll">Payroll Report</SelectItem>
                    <SelectItem value="compliance">Compliance Report</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Date From</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input type="date" disabled className="pl-9" />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Date To</Label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input type="date" disabled className="pl-9" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-50 pointer-events-none">
              <div className="space-y-2">
                <Label>Filter by Employee</Label>
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="All employees" />
                  </SelectTrigger>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Filter by Vehicle</Label>
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="All vehicles" />
                  </SelectTrigger>
                </Select>
              </div>
            </div>

            {/* Export Options */}
            <div className="border-t pt-6 opacity-50 pointer-events-none">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold mb-1">Export Format</h4>
                  <p className="text-sm text-muted-foreground">Choose your preferred export format</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" disabled>
                    <FileText className="h-4 w-4 mr-2" />
                    PDF
                  </Button>
                  <Button variant="outline" disabled>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </Button>
                  <Button disabled>
                    <Download className="h-4 w-4 mr-2" />
                    Generate Report
                  </Button>
                </div>
              </div>
            </div>

            {/* Coming Soon Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
              <Construction className="h-8 w-8 text-amber-600 mx-auto mb-2" />
              <p className="text-sm text-amber-800 font-medium">
                This feature is under development and will be available in a future update
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

