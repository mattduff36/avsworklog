'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  FileText, 
  Calendar, 
  FileSpreadsheet, 
  Loader2,
  Clipboard,
  Download,
  Package,
  FileArchive
} from 'lucide-react';

interface BulkDownloadProgress {
  isDownloading: boolean;
  current: number;
  total: number;
  currentPart: number;
  totalParts: number;
  status: string;
}

export default function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('timesheets');
  const [bulkProgress, setBulkProgress] = useState<BulkDownloadProgress>({
    isDownloading: false,
    current: 0,
    total: 0,
    currentPart: 1,
    totalParts: 1,
    status: '',
  });
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const downloadBulkInspectionPDFs = async () => {
    // Create abort controller for potential cancellation
    abortControllerRef.current = new AbortController();
    
    setBulkProgress({
      isDownloading: true,
      current: 0,
      total: 0,
      currentPart: 1,
      totalParts: 1,
      status: 'Fetching inspections...',
    });

    try {
      const response = await fetch('/api/reports/inspections/bulk-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dateFrom, dateTo }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.error || 'Failed to generate bulk PDFs');
        setBulkProgress(prev => ({ ...prev, isDownloading: false, status: '' }));
        return;
      }

      if (!response.body) {
        alert('Failed to generate bulk PDFs - no response body');
        setBulkProgress(prev => ({ ...prev, isDownloading: false, status: '' }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let shouldExit = false;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // Flush decoder and process any remaining buffered data
          buffer += decoder.decode(new Uint8Array(), { stream: false });
          
          // Process the final buffered line if it exists (only for non-complete messages)
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              
              if (data.error) {
                alert(data.error);
                setBulkProgress(prev => ({ ...prev, isDownloading: false, status: '' }));
                abortControllerRef.current?.abort();
                break;
              }

              // Only handle complete message here if it wasn't already handled in the loop
              if (data.type === 'complete') {
                // Convert base64 to blob and download
                const binaryString = atob(data.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: data.contentType });
                
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = data.fileName;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);

                setBulkProgress({
                  isDownloading: false,
                  current: 0,
                  total: 0,
                  currentPart: 1,
                  totalParts: 1,
                  status: '',
                });
              }
            } catch (parseError) {
              console.error('Error parsing final buffer:', parseError, 'Buffer:', buffer);
            }
          }
          break;
        }

        // Append new data to buffer
        buffer += decoder.decode(value, { stream: true });
        
        // Split by newlines and process complete lines
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);

            if (data.error) {
              alert(data.error);
              setBulkProgress(prev => ({ ...prev, isDownloading: false, status: '' }));
              abortControllerRef.current?.abort();
              shouldExit = true;
              break;
            }

            if (data.type === 'init') {
              setBulkProgress(prev => ({
                ...prev,
                total: data.total,
                totalParts: data.numParts,
              }));
            }

            if (data.type === 'progress') {
              setBulkProgress(prev => ({
                ...prev,
                current: data.current,
                total: data.total,
                currentPart: data.currentPart,
                totalParts: data.totalParts,
              }));
            }

            if (data.type === 'complete') {
              // Convert base64 to blob and download
              const binaryString = atob(data.data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: data.contentType });
              
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = data.fileName;
              document.body.appendChild(a);
              a.click();
              window.URL.revokeObjectURL(url);
              document.body.removeChild(a);

              setBulkProgress({
                isDownloading: false,
                current: 0,
                total: 0,
                currentPart: 1,
                totalParts: 1,
                status: '',
              });
              
              shouldExit = true;
              break;
            }
          } catch (parseError) {
            console.error('Error parsing stream data:', parseError, 'Line:', line);
          }
        }

        // Check if we should exit the outer loop
        if (shouldExit) {
          break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Download cancelled');
      } else {
        console.error('Error downloading bulk PDFs:', error);
        alert('Failed to download bulk PDFs');
      }
      setBulkProgress({
        isDownloading: false,
        current: 0,
        total: 0,
        currentPart: 1,
        totalParts: 1,
        status: '',
      });
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
              color: 'rgb(15 23 42)',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <Clipboard className="h-5 w-5" style={activeTab === 'inspections' ? { color: 'rgb(15 23 42)' } : {}} />
            <span className="text-sm font-medium" style={activeTab === 'inspections' ? { color: 'rgb(15 23 42)' } : {}}>Inspections</span>
          </TabsTrigger>
          <TabsTrigger 
            value="future" 
            className="flex flex-col items-center gap-1 py-3 rounded-md transition-all duration-200 active:scale-95 border-0"
            style={activeTab === 'future' ? {
              backgroundColor: '#F1D64A',
              color: 'rgb(15 23 42)',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
            } : {}}
          >
            <Package className="h-5 w-5" style={activeTab === 'future' ? { color: 'rgb(15 23 42)' } : {}} />
            <span className="text-sm font-medium" style={activeTab === 'future' ? { color: 'rgb(15 23 42)' } : {}}>More Reports</span>
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

            <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg hover:border-inspection/50 transition-all duration-200">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                      <FileArchive className="h-5 w-5" />
                      Bulk Inspection PDFs
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                      Download all inspection reports as individual PDFs (merged or zipped)
                    </p>
                    {bulkProgress.isDownloading && (
                      <div className="space-y-2">
                        <Progress value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0} />
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {bulkProgress.total > 0 ? (
                            <>
                              Processing {bulkProgress.current} of {bulkProgress.total} inspections
                              {bulkProgress.totalParts > 1 && ` (Part ${bulkProgress.currentPart}/${bulkProgress.totalParts})`}
                            </>
                          ) : (
                            'Initializing...'
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    size="lg"
                    className="bg-inspection hover:bg-inspection-dark text-white ml-4 transition-all duration-200 active:scale-95 shadow-md hover:shadow-lg"
                    onClick={downloadBulkInspectionPDFs}
                    disabled={bulkProgress.isDownloading}
                  >
                    {bulkProgress.isDownloading ? (
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
