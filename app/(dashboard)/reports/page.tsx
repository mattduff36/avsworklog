'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  FileText, 
  Calendar, 
  FileSpreadsheet, 
  Loader2
} from 'lucide-react';

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);

  // Form state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    // Set default date range to last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    setDateFrom(thirtyDaysAgo.toISOString().split('T')[0]);
    setDateTo(today.toISOString().split('T')[0]);
  }, []);

  const downloadReport = async (
    endpoint: string,
    filename: string,
    params?: Record<string, string>
  ) => {
    setDownloading(endpoint);
    try {
      const queryParams = new URLSearchParams({
        dateFrom,
        dateTo,
        ...params,
      });
      
      const response = await fetch(`${endpoint}?${queryParams}`);
      
      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to generate report');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading report:', error);
      alert('Failed to download report');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Generate and export reports for timesheets and inspections
        </p>
      </div>

      {/* Date Range Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Report Date Range</CardTitle>
          <CardDescription>
            Select the date range for generating reports (default: last 30 days)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date From</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="date" 
                  className="pl-9" 
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Date To</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="date" 
                  className="pl-9"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Timesheet Reports */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Timesheet Reports</span>
              <FileText className="h-5 w-5 text-primary" />
            </CardTitle>
            <CardDescription>
              Generate Excel reports for employee timesheets
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-md hover:bg-accent/50 transition-colors">
              <div>
                <div className="font-medium">Weekly Timesheet Summary</div>
                <div className="text-xs text-muted-foreground">
                  Export timesheet summary with daily breakdown
                </div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  downloadReport(
                    '/api/reports/timesheets/summary',
                    `Timesheet_Summary_${dateFrom}_to_${dateTo}.xlsx`
                  )
                }
                disabled={downloading === '/api/reports/timesheets/summary'}
              >
                {downloading === '/api/reports/timesheets/summary' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-md hover:bg-accent/50 transition-colors">
              <div>
                <div className="font-medium">Payroll Export</div>
                <div className="text-xs text-muted-foreground">
                  Export approved hours for payroll processing
                </div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  downloadReport(
                    '/api/reports/timesheets/payroll',
                    `Payroll_Export_${dateFrom}_to_${dateTo}.xlsx`
                  )
                }
                disabled={downloading === '/api/reports/timesheets/payroll'}
              >
                {downloading === '/api/reports/timesheets/payroll' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </>
                )}
              </Button>
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
              Generate Excel reports for vehicle inspections
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-md hover:bg-accent/50 transition-colors">
              <div>
                <div className="font-medium">Compliance Summary</div>
                <div className="text-xs text-muted-foreground">
                  Vehicle safety compliance with statistics
                </div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  downloadReport(
                    '/api/reports/inspections/compliance',
                    `Inspection_Compliance_${dateFrom}_to_${dateTo}.xlsx`
                  )
                }
                disabled={downloading === '/api/reports/inspections/compliance'}
              >
                {downloading === '/api/reports/inspections/compliance' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </>
                )}
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 border rounded-md hover:bg-accent/50 transition-colors">
              <div>
                <div className="font-medium">Defects Log</div>
                <div className="text-xs text-muted-foreground">
                  All failed items requiring attention
                </div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  downloadReport(
                    '/api/reports/inspections/defects',
                    `Defects_Log_${dateFrom}_to_${dateTo}.xlsx`
                  )
                }
                disabled={downloading === '/api/reports/inspections/defects'}
              >
                {downloading === '/api/reports/inspections/defects' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
