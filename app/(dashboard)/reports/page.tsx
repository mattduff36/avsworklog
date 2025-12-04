'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  FileText, 
  Calendar, 
  FileSpreadsheet, 
  Loader2,
  Clipboard,
  Download,
  Package
} from 'lucide-react';

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('timesheets');

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
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Reports</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Generate and export reports for your business operations
        </p>
      </div>

      {/* Date Range - Clean style */}
      <Card className="bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
        <CardHeader className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50">
          <CardTitle className="text-slate-900 dark:text-white flex items-center gap-2">
            <Calendar className="h-5 w-5" style={{ color: '#F1D64A' }} />
            Report Date Range
          </CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Select the date range for generating reports (default: last 30 days)
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300 font-medium">Date From</Label>
              <Input 
                type="date" 
                className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white" 
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300 font-medium">Date To</Label>
              <Input 
                type="date" 
                className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Navigation */}
      <Tabs defaultValue="timesheets" value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-3 h-auto p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          <TabsTrigger 
            value="timesheets" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'timesheets' ? {
              backgroundColor: 'hsl(210 90% 50%)',
              color: 'white',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <FileText className="h-5 w-5" />
            <span className="text-sm font-medium">Timesheets</span>
          </TabsTrigger>
          <TabsTrigger 
            value="inspections" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'inspections' ? {
              backgroundColor: 'hsl(30 95% 55%)',
              color: 'white',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <Clipboard className="h-5 w-5" />
            <span className="text-sm font-medium">Inspections</span>
          </TabsTrigger>
          <TabsTrigger 
            value="future" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'future' ? {
              backgroundColor: '#F1D64A',
              color: '#252525',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <Package className="h-5 w-5" style={activeTab === 'future' ? { color: '#252525' } : {}} />
            <span className="text-sm font-medium">More Reports</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timesheets" className="space-y-4">
          <div className="grid gap-4">
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-timesheet/50 transition-all duration-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      Weekly Timesheet Summary
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Export timesheet summary with daily breakdown and totals
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="bg-timesheet hover:bg-timesheet-dark text-white ml-4 transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
                    onClick={() => downloadReport('/api/reports/timesheets/summary', `Timesheet_Summary_${dateFrom}_to_${dateTo}.xlsx`)}
                    disabled={downloading === '/api/reports/timesheets/summary'}
                  >
                    {downloading === '/api/reports/timesheets/summary' ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Download className="h-5 w-5 mr-2" />
                        Download
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-timesheet/50 transition-all duration-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      Payroll Export
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Export approved hours for payroll processing
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="bg-timesheet hover:bg-timesheet-dark text-white ml-4 transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
                    onClick={() => downloadReport('/api/reports/timesheets/payroll', `Payroll_Export_${dateFrom}_to_${dateTo}.xlsx`)}
                    disabled={downloading === '/api/reports/timesheets/payroll'}
                  >
                    {downloading === '/api/reports/timesheets/payroll' ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Download className="h-5 w-5 mr-2" />
                        Download
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="inspections" className="space-y-4">
          <div className="grid gap-4">
            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-inspection/50 transition-all duration-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      Compliance Summary
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Vehicle safety compliance with statistics and trends
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="bg-inspection hover:bg-inspection-dark text-white ml-4 transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
                    onClick={() => downloadReport('/api/reports/inspections/compliance', `Inspection_Compliance_${dateFrom}_to_${dateTo}.xlsx`)}
                    disabled={downloading === '/api/reports/inspections/compliance'}
                  >
                    {downloading === '/api/reports/inspections/compliance' ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Download className="h-5 w-5 mr-2" />
                        Download
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-inspection/50 transition-all duration-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                      Defects Log
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      All failed items requiring immediate attention
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="bg-inspection hover:bg-inspection-dark text-white ml-4 transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
                    onClick={() => downloadReport('/api/reports/inspections/defects', `Defects_Log_${dateFrom}_to_${dateTo}.xlsx`)}
                    disabled={downloading === '/api/reports/inspections/defects'}
                  >
                    {downloading === '/api/reports/inspections/defects' ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Download className="h-5 w-5 mr-2" />
                        Download
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="future" className="space-y-4">
          <Card className="bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700">
            <CardContent className="py-12 text-center">
              <Package className="h-16 w-16 mx-auto mb-4 text-slate-400" />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                More Reports Coming Soon
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Additional report types will be added here as new features are developed
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
