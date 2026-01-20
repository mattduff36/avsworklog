'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronUp, Save, Truck, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

// Validation schema
const vehicleEditSchema = z.object({
  reg_number: z.string().min(1, 'Registration number is required'),
  nickname: z.string().max(100).optional().nullable(),
  category_id: z.string().min(1, 'Category is required'),
  status: z.enum(['active', 'inactive', 'sold', 'written_off']),
});

type VehicleEditData = z.infer<typeof vehicleEditSchema>;

type Vehicle = {
  id: string;
  reg_number: string;
  nickname: string | null;
  status: string;
  category_id: string;
  vehicle_categories?: { name: string; id: string } | null;
};

type Category = {
  id: string;
  name: string;
};

interface ExpandingVehicleCardProps {
  vehicle: Vehicle;
  categories: Category[];
  onUpdate: () => void;
}

export function ExpandingVehicleCard({ vehicle, categories, onUpdate }: ExpandingVehicleCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<VehicleEditData>({
    resolver: zodResolver(vehicleEditSchema),
    defaultValues: {
      reg_number: vehicle.reg_number,
      nickname: vehicle.nickname || '',
      category_id: vehicle.category_id,
      status: vehicle.status as any,
    },
  });

  const selectedCategoryId = watch('category_id');
  const selectedStatus = watch('status');

  const handleExpand = () => {
    if (!isExpanded) {
      // Reset form when expanding
      reset({
        reg_number: vehicle.reg_number,
        nickname: vehicle.nickname || '',
        category_id: vehicle.category_id,
        status: vehicle.status as any,
      });
    }
    setIsExpanded(!isExpanded);
    setIsEditing(false);
  };

  const handleEditToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditing && isDirty) {
      // Confirm discard changes
      if (confirm('You have unsaved changes. Discard them?')) {
        reset();
        setIsEditing(false);
      }
    } else {
      setIsEditing(!isEditing);
    }
  };

  const onSubmit = async (data: VehicleEditData) => {
    try {
      const response = await fetch(`/api/admin/vehicles/${vehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_number: data.reg_number.trim(),
          nickname: data.nickname?.trim() || null,
          category_id: data.category_id,
          status: data.status,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update vehicle');
      }

      toast.success('Vehicle updated successfully');
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating vehicle:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update vehicle');
    }
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-all">
      <CardContent className="p-4">
        {/* Collapsed View - Always Visible */}
        <div 
          className="flex items-center justify-between cursor-pointer"
          onClick={handleExpand}
        >
          <div className="flex items-center gap-4 flex-1">
            <div className="bg-blue-500/10 p-3 rounded-lg">
              <Truck className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                {vehicle.reg_number}
                {vehicle.nickname && (
                  <span className="text-sm text-slate-400 font-normal">({vehicle.nickname})</span>
                )}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
                <span>{vehicle.vehicle_categories?.name || 'No Category'}</span>
                <span>•</span>
                <Badge 
                  variant={vehicle.status === 'active' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {vehicle.status}
                </Badge>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Link 
              href={`/fleet/vehicles/${vehicle.id}/history`}
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                History
              </Button>
            </Link>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            )}
          </div>
        </div>

        {/* Expanded View - Edit Form */}
        {isExpanded && (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 pt-6 border-t border-slate-700 space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-medium text-slate-300 uppercase tracking-wide">
                Vehicle Details
              </h4>
              {!isEditing ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleEditToggle}
                  className="border-blue-600 text-blue-400 hover:bg-blue-600 hover:text-white"
                >
                  Edit Details
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleEditToggle}
                    disabled={isSubmitting}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!isDirty || isSubmitting}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {isSubmitting ? (
                      <>
                        <Save className="h-4 w-4 mr-1 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-1" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Registration Number */}
              <div className="space-y-2">
                <Label htmlFor={`reg-${vehicle.id}`} className="text-white">
                  Registration Number
                </Label>
                <Input
                  id={`reg-${vehicle.id}`}
                  {...register('reg_number')}
                  disabled={!isEditing}
                  className="bg-slate-800 border-slate-600 text-white disabled:opacity-70"
                />
                {errors.reg_number && (
                  <p className="text-sm text-red-400">{errors.reg_number.message}</p>
                )}
              </div>

              {/* Nickname */}
              <div className="space-y-2">
                <Label htmlFor={`nickname-${vehicle.id}`} className="text-white">
                  Nickname <span className="text-slate-400 text-xs">(Optional)</span>
                </Label>
                <Input
                  id={`nickname-${vehicle.id}`}
                  {...register('nickname')}
                  disabled={!isEditing}
                  placeholder="e.g., Andy's Van, Main Truck"
                  className="bg-slate-800 border-slate-600 text-white disabled:opacity-70"
                />
                {errors.nickname && (
                  <p className="text-sm text-red-400">{errors.nickname.message}</p>
                )}
              </div>

              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor={`category-${vehicle.id}`} className="text-white">
                  Category
                </Label>
                <Select
                  value={selectedCategoryId}
                  onValueChange={(value) => setValue('category_id', value, { shouldDirty: true })}
                  disabled={!isEditing}
                >
                  <SelectTrigger 
                    id={`category-${vehicle.id}`}
                    className="bg-slate-800 border-slate-600 text-white disabled:opacity-70"
                  >
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 dark:text-slate-100 text-slate-900">
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.category_id && (
                  <p className="text-sm text-red-400">{errors.category_id.message}</p>
                )}
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor={`status-${vehicle.id}`} className="text-white">
                  Status
                </Label>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) => setValue('status', value as any, { shouldDirty: true })}
                  disabled={!isEditing}
                >
                  <SelectTrigger 
                    id={`status-${vehicle.id}`}
                    className="bg-slate-800 border-slate-600 text-white disabled:opacity-70"
                  >
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600 dark:text-slate-100 text-slate-900">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="sold">Sold</SelectItem>
                    <SelectItem value="written_off">Written Off</SelectItem>
                  </SelectContent>
                </Select>
                {errors.status && (
                  <p className="text-sm text-red-400">{errors.status.message}</p>
                )}
              </div>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
