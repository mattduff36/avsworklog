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
import { ArrowLeft, Save, Send, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { formatDateISO } from '@/lib/utils/date';
import { INSPECTION_ITEMS, InspectionStatus } from '@/types/inspection';
import { Database } from '@/types/database';

export default function NewInspectionPage() {
  const router = useRouter();
  const { user } = useAuth();
  const supabase = createClient();
  
  const [vehicles, setVehicles] = useState<Array<{ id: string; reg_number: string; make: string; model: string }>>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [selectedDate, setSelectedDate] = useState(formatDateISO(new Date()));
  const [checkboxStates, setCheckboxStates] = useState<Record<number, InspectionStatus>>({});
  const [comments, setComments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchVehicles();
  }, []);

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
    setCheckboxStates(prev => ({ ...prev, [itemNumber]: status }));
  };

  const handleCommentChange = (itemNumber: number, comment: string) => {
    setComments(prev => ({ ...prev, [itemNumber]: comment }));
  };

  const handleSave = async (submitForApproval: boolean = false) => {
    if (!user || !vehicleId) {
      setError('Please select a vehicle');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Create inspection record
      type InspectionInsert = Database['public']['Tables']['vehicle_inspections']['Insert'];
      const inspectionData: InspectionInsert = {
        vehicle_id: vehicleId,
        user_id: user.id,
        inspection_date: selectedDate,
        status: submitForApproval ? 'submitted' : 'draft',
        submitted_at: submitForApproval ? new Date().toISOString() : null,
      };

      const { data: inspection, error: inspectionError } = await supabase
        .from('vehicle_inspections')
        .insert(inspectionData)
        .select()
        .single();

      if (inspectionError) throw inspectionError;
      if (!inspection) throw new Error('Failed to create inspection');

      // Create inspection items
      type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
      const items: InspectionItemInsert[] = INSPECTION_ITEMS.map((item, index) => ({
        inspection_id: inspection.id,
        item_number: index + 1,
        item_description: item,
        status: checkboxStates[index + 1] || 'ok',
        comments: comments[index + 1] || null,
      }));

      const { error: itemsError } = await supabase
        .from('inspection_items')
        .insert(items);

      if (itemsError) throw itemsError;

      router.push('/inspections');
    } catch (err) {
      console.error('Error saving inspection:', err);
      setError(err instanceof Error ? err.message : 'Failed to save inspection');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: InspectionStatus) => {
    switch (status) {
      case 'ok':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'defect':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'na':
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: InspectionStatus, isSelected: boolean) => {
    if (!isSelected) return 'bg-gray-100 text-gray-400 border-gray-200';
    
    switch (status) {
      case 'ok':
        return 'bg-green-100 text-green-700 border-green-300';
      case 'defect':
        return 'bg-red-100 text-red-700 border-red-300';
      case 'na':
        return 'bg-gray-100 text-gray-700 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-400 border-gray-200';
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center space-x-4">
        <Link href="/inspections">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">New Vehicle Inspection</h1>
          <p className="text-muted-foreground">Daily safety check</p>
        </div>
      </div>

      {error && (
        <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Inspection Details</CardTitle>
          <CardDescription>Select the vehicle and date for this inspection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle">Vehicle</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger id="vehicle">
                  <SelectValue placeholder="Select a vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.reg_number} - {vehicle.make} {vehicle.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Inspection Date</Label>
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={formatDateISO(new Date())}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>26-Point Safety Check</CardTitle>
          <CardDescription>
            Mark each item as OK (✓), Defect (✗), or N/A
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Desktop View */}
          <div className="hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2 w-12 font-medium">#</th>
                  <th className="text-left p-2 font-medium">Item</th>
                  <th className="text-center p-2 w-48 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Comments</th>
                </tr>
              </thead>
              <tbody>
                {INSPECTION_ITEMS.map((item, index) => {
                  const itemNumber = index + 1;
                  const currentStatus = checkboxStates[itemNumber];
                  
                  return (
                    <tr key={itemNumber} className="border-b hover:bg-secondary/20">
                      <td className="p-2 text-sm text-muted-foreground">{itemNumber}</td>
                      <td className="p-2 text-sm">{item}</td>
                      <td className="p-2">
                        <div className="flex items-center justify-center gap-2">
                          {(['ok', 'defect', 'na'] as InspectionStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => handleStatusChange(itemNumber, status)}
                              className={`flex items-center justify-center w-10 h-10 rounded border-2 transition-all ${
                                getStatusColor(status, currentStatus === status)
                              }`}
                              title={status.toUpperCase()}
                            >
                              {getStatusIcon(status)}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="p-2">
                        <Input
                          value={comments[itemNumber] || ''}
                          onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                          placeholder={currentStatus === 'defect' ? 'Required for defects' : 'Optional notes'}
                          className={currentStatus === 'defect' && !comments[itemNumber] ? 'border-red-300' : ''}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile View */}
          <div className="md:hidden space-y-4">
            {INSPECTION_ITEMS.map((item, index) => {
              const itemNumber = index + 1;
              const currentStatus = checkboxStates[itemNumber];
              
              return (
                <Card key={itemNumber}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">
                      {itemNumber}. {item}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-center gap-3">
                      {(['ok', 'defect', 'na'] as InspectionStatus[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => handleStatusChange(itemNumber, status)}
                          className={`flex flex-col items-center justify-center w-20 h-20 rounded border-2 transition-all ${
                            getStatusColor(status, currentStatus === status)
                          }`}
                        >
                          {getStatusIcon(status)}
                          <span className="text-xs mt-1 font-medium">
                            {status.toUpperCase()}
                          </span>
                        </button>
                      ))}
                    </div>
                    <Input
                      value={comments[itemNumber] || ''}
                      onChange={(e) => handleCommentChange(itemNumber, e.target.value)}
                      placeholder={currentStatus === 'defect' ? 'Required for defects' : 'Optional notes'}
                      className={currentStatus === 'defect' && !comments[itemNumber] ? 'border-red-300' : ''}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Information Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md text-sm">
            <p className="font-semibold text-blue-900 mb-1">Inspection Guidelines:</p>
            <ul className="list-disc list-inside text-blue-800 space-y-1">
              <li><strong>OK (✓)</strong>: Item is in good working condition</li>
              <li><strong>Defect (✗)</strong>: Item needs attention - comment required</li>
              <li><strong>N/A</strong>: Item is not applicable to this vehicle</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={loading || !vehicleId}
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? 'Saving...' : 'Save Draft'}
            </Button>
            <Button
              onClick={() => handleSave(true)}
              disabled={loading || !vehicleId}
            >
              <Send className="h-4 w-4 mr-2" />
              {loading ? 'Submitting...' : 'Submit Inspection'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
