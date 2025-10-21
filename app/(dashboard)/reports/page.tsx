'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Calendar, Construction } from 'lucide-react';

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Generate and export reports for timesheets and inspections
        </p>
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

      {/* Report Generator (Placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Report Generator</CardTitle>
          <CardDescription>
            Generate custom reports with date range filters
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Construction className="h-12 w-12 text-amber-600 mb-4" />
            <h3 className="text-lg font-semibold mb-2">Report Generator Coming Soon</h3>
            <p className="text-muted-foreground max-w-md">
              Advanced reporting features with custom date ranges, filters by employee/vehicle, 
              and both PDF and Excel export options will be available soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

