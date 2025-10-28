'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Save, Send, CheckCircle2, XCircle, AlertCircle, Info, User, Plus, Check } from 'lucide-react';
import Link from 'next/link';
import { formatDateISO, formatDate, getWeekEnding } from '@/lib/utils/date';
import { INSPECTION_ITEMS, InspectionStatus } from '@/types/inspection';
import { Database } from '@/types/database';
import { SignaturePad } from '@/components/forms/SignaturePad';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Employee = {
  id: string;
  full_name: string;
  employee_id: string | null;
};

export default function NewInspectionPage() {
  const router = useRouter();
  const { user, isManager } = useAuth();
  const supabase = createClient();
  
  const [vehicles, setVehicles] = useState<Array<{ id: string; reg_number: string; vehicle_type: string }>>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [weekEnding, setWeekEnding] = useState(formatDateISO(getWeekEnding()));
  const [activeDay, setActiveDay] = useState('0'); // 0-6 for Monday-Sunday
  const [currentMileage, setCurrentMileage] = useState('');
  // Store checkbox states as "dayOfWeek-itemNumber": status (e.g., "1-5": "ok")
  const [checkboxStates, setCheckboxStates] = useState<Record<string, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [showAddVehicleDialog, setShowAddVehicleDialog] = useState(false);
  const [newVehicleReg, setNewVehicleReg] = useState('');
  const [newVehicleType, setNewVehicleType] = useState('');
  const [addingVehicle, setAddingVehicle] = useState(false);
  
  // Manager-specific states
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  useEffect(() => {
    fetchVehicles();
  }, []);

  // Fetch employees if manager, and set initial selected employee
  useEffect(() => {
    if (user && isManager) {
      fetchEmployees();
    } else if (user) {
      // If not a manager, set selected employee to current user
      setSelectedEmployeeId(user.id);
    }
  }, [user, isManager]);

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, employee_id')
        .order('full_name');
      
      if (error) throw error;
      
      setEmployees(data || []);
      
      // Set default to current user
      if (user) {
        setSelectedEmployeeId(user.id);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const fetchVehicles = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('status', 'active')
        .order('reg_number');

      if (error) throw error;
      setVehicles(data || []);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
      setError('Failed to load vehicles');
    }
  };

  const handleStatusChange = (itemNumber: number, status: InspectionStatus) => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const key = `${dayOfWeek}-${itemNumber}`;
    setCheckboxStates(prev => ({ ...prev, [key]: status }));
  };

  const handleCommentChange = (itemNumber: number, comment: string) => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const key = `${dayOfWeek}-${itemNumber}`;
    setComments(prev => ({ ...prev, [key]: comment }));
  };

  const handleMarkAllPass = () => {
    const dayOfWeek = parseInt(activeDay) + 1; // Convert 0-6 to 1-7
    const allPassStates: Record<string, InspectionStatus> = {};
    INSPECTION_ITEMS.forEach((_, index) => {
      const key = `${dayOfWeek}-${index + 1}`;
      allPassStates[key] = 'ok';
    });
    setCheckboxStates(prev => ({ ...prev, ...allPassStates }));
    // Clear comments for this day
    const updatedComments = { ...comments };
    INSPECTION_ITEMS.forEach((_, index) => {
      const key = `${dayOfWeek}-${index + 1}`;
      delete updatedComments[key];
    });
    setComments(updatedComments);
  };

  const handleSubmit = () => {
    if (!vehicleId) {
      setError('Please select a vehicle');
      return;
    }

    if (!currentMileage || parseInt(currentMileage) < 0) {
      setError('Please enter a valid current mileage');
      return;
    }

    // Validate week ending is a Sunday
    const weekEndDate = new Date(weekEnding + 'T00:00:00');
    if (weekEndDate.getDay() !== 0) {
      setError('Week ending must be a Sunday');
      return;
    }
    
    // Show signature dialog
    setShowSignatureDialog(true);
  };

  const handleSignatureComplete = async (sig: string) => {
    setSignature(sig);
    setShowSignatureDialog(false);
    await saveInspection('submitted', sig);
  };

  const handleAddVehicle = async () => {
    if (!newVehicleReg.trim() || !newVehicleType.trim()) {
      setError('Please enter both registration number and vehicle type');
      return;
    }

    setAddingVehicle(true);
    setError('');

    try {
      type VehicleInsert = Database['public']['Tables']['vehicles']['Insert'];
      const vehicleData: VehicleInsert = {
        reg_number: newVehicleReg.trim().toUpperCase(),
        vehicle_type: newVehicleType.trim(),
        status: 'active',
      };

      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select()
        .single();

      if (vehicleError) {
        if (vehicleError.code === '23505') {
          throw new Error('A vehicle with this registration already exists');
        }
        throw vehicleError;
      }

      // Refresh vehicles list
      await fetchVehicles();
      
      // Select the new vehicle
      if (newVehicle) {
        setVehicleId(newVehicle.id);
      }

      // Close dialog and reset form
      setShowAddVehicleDialog(false);
      setNewVehicleReg('');
      setNewVehicleType('');
    } catch (err) {
      console.error('Error adding vehicle:', err);
      setError(err instanceof Error ? err.message : 'Failed to add vehicle');
    } finally {
      setAddingVehicle(false);
    }
  };

  const saveInspection = async (status: 'draft' | 'submitted', signatureData?: string) => {
    if (!user || !selectedEmployeeId || !vehicleId) return;

    setError('');
    setLoading(true);

    try {
      // Calculate inspection start date (Monday of the week)
      const weekEndDate = new Date(weekEnding + 'T00:00:00');
      const startDate = new Date(weekEndDate);
      startDate.setDate(weekEndDate.getDate() - 6); // Go back 6 days to Monday
      
      // Create inspection record
      type InspectionInsert = Database['public']['Tables']['vehicle_inspections']['Insert'];
      const inspectionData: InspectionInsert = {
        vehicle_id: vehicleId,
        user_id: selectedEmployeeId, // Use selected employee ID (can be manager's own ID or another employee's)
        inspection_date: formatDateISO(startDate),
        inspection_end_date: weekEnding,
        current_mileage: parseInt(currentMileage),
        status,
        submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        signature_data: signatureData || null,
        signed_at: signatureData ? new Date().toISOString() : null,
      };

      const { data: inspection, error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .insert(inspectionData)
        .select()
        .single();

      if (inspectionError) throw inspectionError;
      if (!inspection) throw new Error('Failed to create inspection');

      // Create inspection items for all 7 days
      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const items: InspectionItemInsert[] = [];
      
      for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
        INSPECTION_ITEMS.forEach((item, index) => {
          const itemNumber = index + 1;
          const key = `${dayOfWeek}-${itemNumber}`;
          items.push({
            inspection_id: inspection.id,
            item_number: itemNumber,
            day_of_week: dayOfWeek,
            status: checkboxStates[key] || 'ok',
            // comments: comments[key] || null, // Comments not in current schema
          });
        });
      }

      const { data: insertedItems, error: itemsError } = await supabase
        .from('inspection_items')
        .insert(items)
        .select();

      if (itemsError) throw itemsError;

      // Auto-create actions for failed items (only when submitting, not drafting)
      if (status === 'submitted' && insertedItems) {
        const failedItems = insertedItems.filter((item: any) => item.status === 'attention');
        
        if (failedItems.length > 0) {
          type ActionInsert = Database['public']['Tables']['actions']['Insert'];
          const actions: ActionInsert[] = failedItems.map((item: any) => {
            const itemName = INSPECTION_ITEMS[item.item_number - 1] || `Item ${item.item_number}`;
            const dayName = DAY_NAMES[item.day_of_week - 1] || `Day ${item.day_of_week}`;
            return {
              inspection_id: inspection.id,
              inspection_item_id: item.id,
              title: `Defect: ${itemName} (${dayName})`,
              description: `Vehicle inspection item failed during ${dayName} inspection`,
              priority: 'high',
              status: 'pending',
              created_by: user!.id,
            };
          });

          const { error: actionsError } = await supabase
            .from('actions')
            .insert(actions);

          if (actionsError) {
            console.error('Error creating actions:', actionsError);
            // Don't throw - we don't want to fail the inspection if action creation fails
          }
        }
      }

      router.push('/inspections');
    } catch (err) {
      console.error('Error saving inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to save inspection');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: InspectionStatus, isSelected: boolean) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-green-400' : 'text-slate-500'}`} />;
      case 'attention':
        return <XCircle className={`h-10 w-10 md:h-6 md:w-6 ${isSelected ? 'text-red-400' : 'text-slate-500'}`} />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-slate-800/30 border-slate-700 hover:bg-slate-800/50';
    
    switch (status) {
      case 'ok':
        return 'bg-green-500/20 border-green-500 shadow-lg shadow-green-500/20';
      case 'attention':
        return 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20';
      default:
        return 'bg-slate-800/30 border-slate-700';
    }
  };

  // Calculate progress (7 days × 26 items = 182 total)
  const totalItems = INSPECTION_ITEMS.length * 7;
  const completedItems = Object.keys(checkboxStates).length;
  const progressPercent = Math.round((completedItems / totalItems) * 100);

  return (
    <div className="space-y-4 pb-32 md:pb-6 max-w-5xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 md:p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <Link href="/inspections">
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:w-auto md:px-3 hover:bg-slate-100 dark:hover:bg-slate-800">
                <ArrowLeft className="h-5 w-5 md:mr-2" />
                <span className="hidden md:inline">Back</span>
              </Button>
            </Link>
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-slate-900 dark:text-white">New Inspection</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 hidden md:block">Daily safety check</p>
            </div>
          </div>
          {/* Progress Badge */}
          <div className="bg-inspection/10 dark:bg-inspection/20 border border-inspection/30 rounded-lg px-3 py-2">
            <div className="text-xs text-slate-600 dark:text-slate-400">Progress</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">{completedItems}/{totalItems}</div>
          </div>
        </div>
        {/* Progress Bar */}
        <div className="h-2 bg-slate-200 dark:bg-slate-800/50 rounded-full overflow-hidden">
          <div 
            className="h-full bg-inspection transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg backdrop-blur-xl flex items-start gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* Vehicle Details Card */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader className="pb-4">
          <CardTitle className="text-slate-900 dark:text-white">Inspection Details</CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Week ending: {formatDate(weekEnding)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Manager: Employee Selector */}
          {isManager && (
            <div className="space-y-2 pb-4 border-b border-slate-700">
              <Label htmlFor="employee" className="text-slate-900 dark:text-white text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Creating inspection for
              </Label>
              <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                <SelectTrigger className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={employee.id}>
                      {employee.full_name}
                      {employee.employee_id && ` (${employee.employee_id})`}
                      {employee.id === user?.id && ' (You)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                Select which employee this inspection is for
              </p>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle" className="text-slate-900 dark:text-white text-base">Vehicle</Label>
              <Select value={vehicleId} onValueChange={(value) => {
                if (value === 'add-new') {
                  setShowAddVehicleDialog(true);
                } else {
                  setVehicleId(value);
                }
              }}>
                <SelectTrigger id="vehicle" className="h-12 text-base bg-slate-900/50 border-slate-600 text-white">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="add-new" className="text-avs-yellow font-semibold border-b border-slate-700">
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add New Vehicle
                    </div>
                  </SelectItem>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id} className="text-white">
                      {vehicle.reg_number} - {vehicle.vehicle_type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="weekEnding" className="text-slate-900 dark:text-white text-base flex items-center gap-2">
                Week Ending (Sunday)
                <span className="text-red-400">*</span>
              </Label>
              <Input
                id="weekEnding"
                type="date"
                value={weekEnding}
                onChange={(e) => {
                  const selectedDate = new Date(e.target.value + 'T00:00:00');
                  if (selectedDate.getDay() !== 0) {
                    setError('Week ending must be a Sunday');
                    return;
                  }
                  setError('');
                  setWeekEnding(e.target.value);
                }}
                max={formatDateISO(new Date())}
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white w-full"
                required
              />
              <p className="text-xs text-slate-400">Select the Sunday that ends the inspection week</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mileage" className="text-slate-900 dark:text-white text-base flex items-center gap-2">
                Current Mileage
                <span className="text-red-400">*</span>
              </Label>
                  <Input
                    id="mileage"
                    type="number"
                    value={currentMileage}
                    onChange={(e) => setCurrentMileage(e.target.value)}
                    placeholder="e.g., 45000"
                    min="0"
                    step="1"
                    className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                    required
                  />
                </div>
          </div>
        </CardContent>
      </Card>

      {/* 26-Point Safety Check */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-slate-900 dark:text-white">26-Point Safety Check</CardTitle>
          <CardDescription className="text-slate-600 dark:text-slate-400">
            Mark each item as Pass or Fail for each day
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 md:p-6">
          
          <Tabs value={activeDay} onValueChange={setActiveDay} className="w-full">
            <TabsList className="grid w-full grid-cols-7 bg-slate-900/50 p-1 rounded-lg mb-4">
              {DAY_NAMES.map((day, index) => {
                const dayOfWeek = index + 1;
                // Check if all items for this day have a status
                const isComplete = INSPECTION_ITEMS.every((_, itemIndex) => {
                  const itemNumber = itemIndex + 1;
                  const key = `${dayOfWeek}-${itemNumber}`;
                  return checkboxStates[key] !== undefined;
                });
                
                return (
                  <TabsTrigger 
                    key={index} 
                    value={index.toString()} 
                    className={`text-xs py-3 data-[state=active]:bg-inspection data-[state=active]:text-slate-900 text-slate-400 ${
                      isComplete 
                        ? 'data-[state=active]:border-2 data-[state=active]:border-green-500 border-2 border-green-500/50' 
                        : 'data-[state=active]:border-2 data-[state=active]:border-white'
                    }`}
                  >
                    {day.substring(0, 3)}
                    {isComplete && (
                      <Check className="h-3 w-3 ml-1" />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {DAY_NAMES.map((day, dayIndex) => (
              <TabsContent key={dayIndex} value={dayIndex.toString()} className="mt-0">
                {/* Mark All Pass Button - Mobile */}
                <div className="md:hidden mb-4">
                  <Button
                    type="button"
                    onClick={handleMarkAllPass}
                    variant="outline"
                    className="w-full h-12 border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
                  >
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Mark All as PASS
                  </Button>
                </div>

                {/* Mobile View - Card-based */}
                <div className="md:hidden space-y-3">
                  {INSPECTION_ITEMS.map((item, index) => {
                    const itemNumber = index + 1;
                    const dayOfWeek = dayIndex + 1;
                    const key = `${dayOfWeek}-${itemNumber}`;
                    const currentStatus = checkboxStates[key];
                    const hasDefectComment = currentStatus === 'attention' && comments[key];
              
              return (
                <div key={itemNumber} className="bg-slate-900/30 border border-slate-700/50 rounded-lg p-4 space-y-3">
                  {/* Item Header */}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
                      <span className="text-sm font-bold text-slate-400">{itemNumber}</span>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-base font-medium text-white leading-tight">{item}</h4>
                    </div>
                  </div>

                  {/* Status Buttons - Pass or Fail */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleStatusChange(itemNumber, status)}
                        className={`flex items-center justify-center h-12 rounded-xl border-3 transition-all ${
                          getStatusColor(status, currentStatus === status)
                        }`}
                      >
                        {getStatusIcon(status, currentStatus === status)}
                      </button>
                    ))}
                  </div>

                  {/* Comments/Notes */}
                  {(currentStatus === 'attention' || comments[key]) && (
                    <div className="space-y-2">
                      <Label className="text-slate-900 dark:text-white text-sm">
                        {currentStatus === 'attention' ? 'Comments (Required)' : 'Notes'}
                      </Label>
                      <Textarea
                        value={comments[key] || ''}
                        onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                        placeholder="Add details..."
                        className={`w-full min-h-[80px] text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${
                          currentStatus === 'attention' && !comments[key] ? 'border-red-500' : ''
                        }`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mark All Pass Button - Desktop */}
          <div className="hidden md:block mb-4">
            <Button
              type="button"
              onClick={handleMarkAllPass}
              variant="outline"
              className="border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Mark All as PASS
            </Button>
          </div>

          {/* Desktop View - Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left p-3 w-12 font-medium text-white">#</th>
                  <th className="text-left p-3 font-medium text-white">Item</th>
                  <th className="text-center p-3 w-48 font-medium text-white">Status</th>
                  <th className="text-left p-3 font-medium text-white">Comments</th>
                </tr>
              </thead>
              <tbody>
                {INSPECTION_ITEMS.map((item, index) => {
                  const itemNumber = index + 1;
                  const dayOfWeek = dayIndex + 1;
                  const key = `${dayOfWeek}-${itemNumber}`;
                  const currentStatus = checkboxStates[key];
                  
                  return (
                    <tr key={itemNumber} className="border-b border-slate-700/50 hover:bg-slate-800/30">
                      <td className="p-3 text-sm text-slate-400">{itemNumber}</td>
                      <td className="p-3 text-sm text-white">{item}</td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-3">
                          {(['ok', 'attention'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => handleStatusChange(itemNumber, status)}
                              className={`flex items-center justify-center w-12 h-12 rounded-lg border-2 transition-all ${
                                getStatusColor(status, currentStatus === status)
                              }`}
                              title={status === 'ok' ? 'Pass' : 'Fail'}
                            >
                              {getStatusIcon(status, currentStatus === status)}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="p-3">
                        <Input
                          value={comments[key] || ''}
                          onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                          placeholder={currentStatus === 'attention' ? 'Required for defects' : 'Optional notes'}
                          className={`bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 ${
                            currentStatus === 'attention' && !comments[key] ? 'border-red-500' : ''
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Information Box - Desktop Only */}
          <div className="hidden md:block p-4 bg-slate-800/40 border border-slate-700/50 rounded-lg backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-inspection flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-white mb-2">Inspection Guidelines:</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                    <span><strong>Pass:</strong> Item is in good working condition</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-400" />
                    <span><strong>Fail:</strong> Item needs attention - comment required</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

              </TabsContent>
            ))}
          </Tabs>

          {/* Desktop Action Buttons */}
          <div className="hidden md:flex flex-row gap-3 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => saveInspection('draft')}
              disabled={loading || !vehicleId}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !vehicleId}
              className="bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold"
            >
              <Send className="h-4 w-4 mr-2" />
              {loading ? 'Submitting...' : 'Submit Inspection'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Mobile Sticky Footer */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-xl border-t border-slate-700/50 p-4 z-20">
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => saveInspection('draft')}
            disabled={loading || !vehicleId}
            className="flex-1 h-14 border-slate-600 text-white hover:bg-slate-800"
          >
            <Save className="h-5 w-5 mr-2" />
            Save Draft
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !vehicleId}
            className="flex-1 h-14 bg-inspection hover:bg-inspection/90 text-slate-900 font-semibold text-base"
          >
            <Send className="h-5 w-5 mr-2" />
            Submit
          </Button>
        </div>
      </div>

      {/* Add Vehicle Dialog */}
      <Dialog open={showAddVehicleDialog} onOpenChange={setShowAddVehicleDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Add New Vehicle</DialogTitle>
            <DialogDescription className="text-slate-400">
              Enter the vehicle registration number and type
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newVehicleReg" className="text-slate-900 dark:text-white">
                Registration Number <span className="text-red-400">*</span>
              </Label>
              <Input
                id="newVehicleReg"
                value={newVehicleReg}
                onChange={(e) => setNewVehicleReg(e.target.value.toUpperCase())}
                placeholder="e.g., ABC123"
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 uppercase"
                disabled={addingVehicle}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newVehicleType" className="text-slate-900 dark:text-white">
                Vehicle Type <span className="text-red-400">*</span>
              </Label>
              <Input
                id="newVehicleType"
                value={newVehicleType}
                onChange={(e) => setNewVehicleType(e.target.value)}
                placeholder="e.g., Van, Truck, Car"
                className="h-12 text-base bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500"
                disabled={addingVehicle}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowAddVehicleDialog(false);
                setNewVehicleReg('');
                setNewVehicleType('');
              }}
              disabled={addingVehicle}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddVehicle}
              disabled={addingVehicle || !newVehicleReg.trim() || !newVehicleType.trim()}
              className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900 font-semibold"
            >
              {addingVehicle ? 'Adding...' : 'Add Vehicle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Signature Dialog */}
      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl">Sign Inspection</DialogTitle>
            <DialogDescription className="text-slate-400">
              Please sign below to confirm your inspection is accurate
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <SignaturePad
              onSave={handleSignatureComplete}
              onCancel={() => setShowSignatureDialog(false)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSignatureDialog(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
