'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Gauge,
  MapPin,
  Clock
} from 'lucide-react';

interface MotHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleReg: string;
}

// Sample data for test vehicles
const SAMPLE_MOT_DATA: Record<string, any> = {
  'TE57 VAN': {
    currentStatus: {
      expiryDate: '2026-07-15',
      status: 'Valid',
      daysRemaining: 204,
      lastTestDate: '2025-06-20',
      lastTestResult: 'PASSED'
    },
    tests: [
      {
        id: '1',
        motTestNumber: '123456789012',
        completedDate: '2025-06-20T10:30:00Z',
        testResult: 'PASSED',
        expiryDate: '2026-07-15',
        odometerValue: 45230,
        odometerUnit: 'mi',
        testStationName: 'ABC Motors',
        testStationPcode: 'SW1A 1AA',
        defects: [
          { type: 'ADVISORY', text: 'Nearside Front Tyre worn close to legal limit', locationLateral: 'nearside', dangerous: false },
          { type: 'ADVISORY', text: 'Offside Rear brake disc worn, pitted or scored', locationLateral: 'offside', dangerous: false },
          { type: 'MINOR', text: 'Windscreen washer provides insufficient washer liquid', locationLateral: null, dangerous: false }
        ]
      },
      {
        id: '2',
        motTestNumber: '987654321098',
        completedDate: '2024-06-15T14:15:00Z',
        testResult: 'FAILED',
        expiryDate: null,
        odometerValue: 32150,
        odometerUnit: 'mi',
        testStationName: 'XYZ Garage',
        testStationPcode: 'W1D 3QU',
        defects: [
          { type: 'MAJOR', text: 'Brake pad(s) less than 1.5 mm thick (1.2.1 (e))', locationLateral: 'offside', dangerous: false },
          { type: 'MAJOR', text: 'Headlamp aim too low (4.1.2 (b))', locationLateral: 'nearside', dangerous: false },
          { type: 'ADVISORY', text: 'Offside Front Tyre worn close to legal limit', locationLateral: 'offside', dangerous: false },
          { type: 'ADVISORY', text: 'Oil leak, but not excessive', locationLateral: null, dangerous: false },
          { type: 'ADVISORY', text: 'Rear exhaust has a minor leak of exhaust gases', locationLateral: null, dangerous: false }
        ]
      },
      {
        id: '3',
        motTestNumber: '567890123456',
        completedDate: '2024-06-18T09:45:00Z',
        testResult: 'PASSED',
        expiryDate: '2025-07-15',
        odometerValue: 32180,
        odometerUnit: 'mi',
        testStationName: 'XYZ Garage',
        testStationPcode: 'W1D 3QU',
        defects: [
          { type: 'ADVISORY', text: 'Oil leak, but not excessive', locationLateral: null, dangerous: false },
          { type: 'ADVISORY', text: 'Rear exhaust has a minor leak of exhaust gases', locationLateral: null, dangerous: false }
        ]
      },
      {
        id: '4',
        motTestNumber: '234567890123',
        completedDate: '2023-06-10T11:20:00Z',
        testResult: 'PASSED',
        expiryDate: '2024-07-15',
        odometerValue: 18900,
        odometerUnit: 'mi',
        testStationName: 'City MOT Centre',
        testStationPcode: 'EC1A 1BB',
        defects: [
          { type: 'ADVISORY', text: 'Nearside Rear Tyre worn close to legal limit', locationLateral: 'nearside', dangerous: false }
        ]
      },
      {
        id: '5',
        motTestNumber: '345678901234',
        completedDate: '2022-06-05T15:30:00Z',
        testResult: 'PASSED',
        expiryDate: '2023-07-15',
        odometerValue: 12450,
        odometerUnit: 'mi',
        testStationName: 'Quick Test Motors',
        testStationPcode: 'SE1 9SG',
        defects: []
      },
      {
        id: '6',
        motTestNumber: '456789012345',
        completedDate: '2021-07-20T10:00:00Z',
        testResult: 'PASSED',
        expiryDate: '2022-07-20',
        odometerValue: 5230,
        odometerUnit: 'mi',
        testStationName: 'First Test Centre',
        testStationPcode: 'N1 9AG',
        defects: []
      }
    ]
  },
  'TE57 HGV': {
    currentStatus: {
      expiryDate: '2026-08-10',
      status: 'Valid',
      daysRemaining: 230,
      lastTestDate: '2025-07-15',
      lastTestResult: 'PASSED'
    },
    tests: [
      {
        id: '1',
        motTestNumber: '789012345678',
        completedDate: '2025-07-15T13:45:00Z',
        testResult: 'PASSED',
        expiryDate: '2026-08-10',
        odometerValue: 67890,
        odometerUnit: 'mi',
        testStationName: 'Heavy Vehicle Testing',
        testStationPcode: 'M1 1AE',
        defects: [
          { type: 'ADVISORY', text: 'Offside Front Tyre tread depth marginal', locationLateral: 'offside', dangerous: false },
          { type: 'ADVISORY', text: 'Rear suspension component mounting prescribed area is corroded', locationLateral: null, dangerous: false }
        ]
      },
      {
        id: '2',
        motTestNumber: '890123456789',
        completedDate: '2024-07-10T09:15:00Z',
        testResult: 'PASSED',
        expiryDate: '2025-08-10',
        odometerValue: 54320,
        odometerUnit: 'mi',
        testStationName: 'HGV Test Station',
        testStationPcode: 'B1 1AA',
        defects: [
          { type: 'MINOR', text: 'Registration plate lamp inoperative', locationLateral: null, dangerous: false },
          { type: 'ADVISORY', text: 'Nearside Rear Brake disc worn, pitted or scored', locationLateral: 'nearside', dangerous: false }
        ]
      },
      {
        id: '3',
        motTestNumber: '901234567890',
        completedDate: '2023-07-05T14:30:00Z',
        testResult: 'FAILED',
        expiryDate: null,
        odometerValue: 41230,
        odometerUnit: 'mi',
        testStationName: 'Commercial Vehicle Tests',
        testStationPcode: 'LS1 1UR',
        defects: [
          { type: 'DANGEROUS', text: 'Brake pipe excessively corroded (1.1.11 (c))', locationLateral: 'nearside', dangerous: true },
          { type: 'MAJOR', text: 'Service brake: efficiency below requirements (1.2.1 (a) (i))', locationLateral: null, dangerous: false },
          { type: 'ADVISORY', text: 'Offside Front suspension arm pin or bush worn but not resulting in excessive movement', locationLateral: 'offside', dangerous: false }
        ]
      },
      {
        id: '4',
        motTestNumber: '012345678901',
        completedDate: '2023-07-08T10:00:00Z',
        testResult: 'PASSED',
        expiryDate: '2024-08-10',
        odometerValue: 41260,
        odometerUnit: 'mi',
        testStationName: 'Commercial Vehicle Tests',
        testStationPcode: 'LS1 1UR',
        defects: [
          { type: 'ADVISORY', text: 'Offside Front suspension arm pin or bush worn but not resulting in excessive movement', locationLateral: 'offside', dangerous: false }
        ]
      },
      {
        id: '5',
        motTestNumber: '123450987654',
        completedDate: '2022-07-02T11:30:00Z',
        testResult: 'PASSED',
        expiryDate: '2023-08-10',
        odometerValue: 28450,
        odometerUnit: 'mi',
        testStationName: 'Fleet MOT Services',
        testStationPcode: 'G1 1AA',
        defects: []
      },
      {
        id: '6',
        motTestNumber: '234561098765',
        completedDate: '2021-08-15T09:00:00Z',
        testResult: 'PASSED',
        expiryDate: '2022-08-15',
        odometerValue: 15230,
        odometerUnit: 'mi',
        testStationName: 'HGV Test Centre',
        testStationPcode: 'CF10 1AA',
        defects: [
          { type: 'ADVISORY', text: 'Slight oil mist from engine breather', locationLateral: null, dangerous: false }
        ]
      }
    ]
  }
};

export function MotHistoryDialog({ open, onOpenChange, vehicleReg }: MotHistoryDialogProps) {
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  
  // Get sample data for this vehicle or show "No data" message
  const motData = SAMPLE_MOT_DATA[vehicleReg];
  
  const getDefectColor = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'MAJOR': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'MINOR': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'ADVISORY': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'FAIL': return 'text-red-600 bg-red-600/10 border-red-600/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };
  
  const getDefectIcon = (type: string) => {
    switch (type) {
      case 'DANGEROUS': return '🔴';
      case 'MAJOR': return '🟠';
      case 'MINOR': return '🟡';
      case 'ADVISORY': return '🔵';
      case 'FAIL': return '⚫';
      default: return '⚪';
    }
  };
  
  const countDefectsByType = (defects: any[]) => {
    const counts: Record<string, number> = {};
    defects.forEach(defect => {
      counts[defect.type] = (counts[defect.type] || 0) + 1;
    });
    return counts;
  };
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-[80vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex-1">
              <DialogTitle className="text-2xl flex items-center gap-2">
                <FileText className="h-6 w-6" />
                MOT History - {vehicleReg}
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Complete MOT test history from GOV.UK database
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!motData ? (
          <div className="text-center py-12 text-slate-400">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>No MOT history available yet</p>
            <p className="text-sm mt-1">MOT data will appear here once synced with DVLA</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current MOT Status Card */}
            <div className="bg-gradient-to-r from-blue-900/30 to-blue-800/20 border border-blue-700/50 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-blue-300 mb-3 flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Current MOT Status
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-slate-400">Expiry Date:</span>
                  <p className="text-white font-semibold text-lg">{formatDate(motData.currentStatus.expiryDate)}</p>
                </div>
                <div>
                  <span className="text-slate-400">Status:</span>
                  <p className={`font-semibold text-lg ${motData.currentStatus.status === 'Valid' ? 'text-green-400' : 'text-red-400'}`}>
                    {motData.currentStatus.status}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Days Remaining:</span>
                  <p className="text-white font-semibold text-lg">{motData.currentStatus.daysRemaining}</p>
                </div>
                <div>
                  <span className="text-slate-400">Last Test:</span>
                  <p className="text-white font-medium">{formatDate(motData.currentStatus.lastTestDate)}</p>
                  <Badge className={`mt-1 ${motData.currentStatus.lastTestResult === 'PASSED' ? 'bg-green-600' : 'bg-red-600'}`}>
                    {motData.currentStatus.lastTestResult}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Test History */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">Test History</h3>
              
              {motData.tests.map((test: any) => {
                const defectCounts = countDefectsByType(test.defects);
                const isExpanded = expandedTestId === test.id;
                const isPassed = test.testResult === 'PASSED';
                
                return (
                  <div 
                    key={test.id}
                    className={`border rounded-lg p-4 ${
                      isPassed 
                        ? 'bg-gradient-to-r from-green-900/20 to-green-800/10 border-green-700/30' 
                        : 'bg-gradient-to-r from-red-900/20 to-red-800/10 border-red-700/30'
                    }`}
                  >
                    {/* Test Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {isPassed ? (
                          <CheckCircle className="h-6 w-6 text-green-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-6 w-6 text-red-400 flex-shrink-0" />
                        )}
                        <div>
                          <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                            {test.testResult}
                            <span className="text-sm text-slate-400 font-normal">
                              {formatDate(test.completedDate)}
                            </span>
                          </h4>
                          {test.expiryDate && (
                            <p className="text-sm text-slate-400">
                              Expiry: <span className="text-white font-medium">{formatDate(test.expiryDate)}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {test.motTestNumber}
                      </Badge>
                    </div>

                    {/* Test Details Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-3">
                      <div className="flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-400">Mileage:</span>
                        <span className="text-white font-medium">{test.odometerValue.toLocaleString()} {test.odometerUnit}</span>
                      </div>
                      <div className="flex items-center gap-2 col-span-2">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-400">Station:</span>
                        <span className="text-white font-medium">{test.testStationName}, {test.testStationPcode}</span>
                      </div>
                    </div>

                    {/* Defect Summary */}
                    {test.defects.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {Object.entries(defectCounts).map(([type, count]) => (
                            <Badge key={type} className={`${getDefectColor(type)} border`}>
                              {getDefectIcon(type)} {count} {type}
                            </Badge>
                          ))}
                        </div>

                        {/* Expandable Defects */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedTestId(isExpanded ? null : test.id)}
                          className="w-full text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                        >
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-4 w-4 mr-2" />
                              Hide Defects
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-4 w-4 mr-2" />
                              View {test.defects.length} Defect{test.defects.length !== 1 ? 's' : ''}
                            </>
                          )}
                        </Button>

                        {isExpanded && (
                          <div className="mt-3 space-y-2 border-t border-slate-700 pt-3">
                            {test.defects.map((defect: any, idx: number) => (
                              <div 
                                key={idx}
                                className={`p-3 rounded border ${getDefectColor(defect.type)}`}
                              >
                                <div className="flex items-start gap-2">
                                  <span className="text-lg">{getDefectIcon(defect.type)}</span>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <Badge className={`${getDefectColor(defect.type)} border text-xs`}>
                                        {defect.type}
                                      </Badge>
                                      {defect.locationLateral && (
                                        <span className="text-xs text-slate-400">
                                          {defect.locationLateral}
                                        </span>
                                      )}
                                      {defect.dangerous && (
                                        <Badge className="bg-red-600 text-xs">DANGEROUS</Badge>
                                      )}
                                    </div>
                                    <p className="text-sm text-white">{defect.text}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {test.defects.length === 0 && (
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <CheckCircle className="h-4 w-4" />
                        No defects or advisories recorded
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

