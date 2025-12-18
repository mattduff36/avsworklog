'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Truck,
  Loader2,
  AlertTriangle,
  Calendar,
  User,
  Tag,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import type { Database } from '@/types/database';
import Link from 'next/link';

type Vehicle = Database['public']['Tables']['vehicles']['Row'] & {
  vehicle_categories?: { id: string; name: string } | null;
  last_inspector?: string | null;
  last_inspection_date?: string | null;
};

type Category = Database['public']['Tables']['vehicle_categories']['Row'];

export default function VehiclesAdminPage() {
  const { isAdmin } = useAuth();
  const supabase = createClient();

  // State
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states
  const [addVehicleDialogOpen, setAddVehicleDialogOpen] = useState(false);
  const [editVehicleDialogOpen, setEditVehicleDialogOpen] = useState(false);
  const [deleteVehicleDialogOpen, setDeleteVehicleDialogOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  // Category dialog states
  const [addCategoryDialogOpen, setAddCategoryDialogOpen] = useState(false);
  const [editCategoryDialogOpen, setEditCategoryDialogOpen] = useState(false);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  // Form states
  const [vehicleFormData, setVehicleFormData] = useState({
    reg_number: '',
    category_id: '',
    status: 'active',
  });
  const [categoryFormData, setCategoryFormData] = useState({
    name: '',
    description: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Stats
  const stats = {
    total: vehicles.length,
    active: vehicles.filter((v) => v.status === 'active').length,
    inactive: vehicles.filter((v) => v.status === 'inactive').length,
    categories: categories.length,
  };

  // Fetch data
  useEffect(function () {
    if (isAdmin) {
      fetchVehicles();
      fetchCategories();
    }
  }, [isAdmin]);

  // Search filter
  useEffect(function () {
    if (!searchQuery.trim()) {
      setFilteredVehicles(vehicles);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = vehicles.filter(
      (vehicle) =>
        vehicle.reg_number?.toLowerCase().includes(query) ||
        vehicle.vehicle_categories?.name?.toLowerCase().includes(query) ||
        vehicle.last_inspector?.toLowerCase().includes(query)
    );
    setFilteredVehicles(filtered);
  }, [searchQuery, vehicles]);

  async function fetchVehicles() {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/vehicles');
      const data = await response.json();

      if (response.ok) {
        setVehicles(data.vehicles || []);
        setFilteredVehicles(data.vehicles || []);
      }
    } catch (error) {
      console.error('Error fetching vehicles:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategories() {
    try {
      const response = await fetch('/api/admin/categories');
      const data = await response.json();

      if (response.ok) {
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }

  // Format UK registration plates (LLNNLLL -> LLNN LLL)
  function formatRegistration(reg: string): string {
    const cleaned = reg.replace(/\s/g, '').toUpperCase();
    
    // Check if it matches UK format: 2 letters, 2 numbers, 3 letters (7 chars total)
    if (cleaned.length === 7 && /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(cleaned)) {
      return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    }
    
    return cleaned;
  }

  // Vehicle CRUD operations
  async function handleAddVehicle() {
    if (!vehicleFormData.reg_number) {
      setFormError('Please fill in registration number');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      // Format registration before sending
      const formattedData = {
        ...vehicleFormData,
        reg_number: formatRegistration(vehicleFormData.reg_number),
      };

      const response = await fetch('/api/admin/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create vehicle');
      }

      await fetchVehicles();
      setVehicleFormData({ reg_number: '', category_id: '', status: 'active' });
      setAddVehicleDialogOpen(false);
    } catch (error) {
      console.error('Error creating vehicle:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to create vehicle');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEditVehicle() {
    if (!selectedVehicle || !vehicleFormData.reg_number) {
      setFormError('Please fill in registration number');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      // Format registration before sending
      const formattedData = {
        ...vehicleFormData,
        reg_number: formatRegistration(vehicleFormData.reg_number),
      };

      const response = await fetch(`/api/admin/vehicles/${selectedVehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update vehicle');
      }

      await fetchVehicles();
      setEditVehicleDialogOpen(false);
      setSelectedVehicle(null);
    } catch (error) {
      console.error('Error updating vehicle:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to update vehicle');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteVehicle() {
    if (!selectedVehicle) return;

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/vehicles/${selectedVehicle.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete vehicle');
      }

      await fetchVehicles();
      setDeleteVehicleDialogOpen(false);
      setSelectedVehicle(null);
    } catch (error) {
      console.error('Error deleting vehicle:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to delete vehicle');
    } finally {
      setFormLoading(false);
    }
  }

  // Category CRUD operations
  async function handleAddCategory() {
    if (!categoryFormData.name) {
      setFormError('Please fill in category name');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryFormData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create category');
      }

      await fetchCategories();
      setCategoryFormData({ name: '', description: '' });
      setAddCategoryDialogOpen(false);
    } catch (error) {
      console.error('Error creating category:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to create category');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEditCategory() {
    if (!selectedCategory || !categoryFormData.name) {
      setFormError('Please fill in category name');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/categories/${selectedCategory.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryFormData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update category');
      }

      await fetchCategories();
      await fetchVehicles();
      setEditCategoryDialogOpen(false);
      setSelectedCategory(null);
    } catch (error) {
      console.error('Error updating category:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to update category');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteCategory() {
    if (!selectedCategory) return;

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/categories/${selectedCategory.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete category');
      }

      await fetchCategories();
      await fetchVehicles();
      setDeleteCategoryDialogOpen(false);
      setSelectedCategory(null);
    } catch (error) {
      console.error('Error deleting category:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to delete category');
    } finally {
      setFormLoading(false);
    }
  }

  // Dialog helpers
  function openEditVehicleDialog(vehicle: Vehicle) {
    setSelectedVehicle(vehicle);
    setVehicleFormData({
      reg_number: vehicle.reg_number || '',
      category_id: vehicle.category_id || '',
      status: vehicle.status || 'active',
    });
    setFormError('');
    setEditVehicleDialogOpen(true);
  }

  function openDeleteVehicleDialog(vehicle: Vehicle) {
    setSelectedVehicle(vehicle);
    setFormError('');
    setDeleteVehicleDialogOpen(true);
  }

  function openEditCategoryDialog(category: Category) {
    setSelectedCategory(category);
    setCategoryFormData({
      name: category.name || '',
      description: category.description || '',
    });
    setFormError('');
    setEditCategoryDialogOpen(true);
  }

  function openDeleteCategoryDialog(category: Category) {
    setSelectedCategory(category);
    setFormError('');
    setDeleteCategoryDialogOpen(true);
  }

  // Check authorization
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission to access vehicle management.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
              Vehicle Management
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              Manage vehicles and vehicle categories
            </p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Total Vehicles</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
              </div>
              <Truck className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Active</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.active}</p>
              </div>
              <Truck className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Inactive</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.inactive}</p>
              </div>
              <Truck className="h-8 w-8 text-slate-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Categories</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.categories}</p>
              </div>
              <Tag className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for Vehicles and Categories */}
      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="bg-slate-100 dark:bg-slate-800">
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger asChild value="maintenance">
            <Link href="/maintenance">Maintenance & Service</Link>
          </TabsTrigger>
        </TabsList>

        {/* Vehicles Tab */}
        <TabsContent value="vehicles">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">All Vehicles</CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    View and manage fleet vehicles
                  </CardDescription>
                </div>
                <Button
                  onClick={() => {
                    setVehicleFormData({ reg_number: '', category_id: '', status: 'active' });
                    setFormError('');
                    setAddVehicleDialogOpen(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Vehicle
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by registration, category, or inspector..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-slate-900/50 border-slate-600 text-white"
                  />
                </div>

                {/* Vehicle Table */}
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  </div>
                ) : filteredVehicles.length === 0 ? (
                  <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                    {searchQuery ? 'No vehicles found matching your search.' : 'No vehicles yet.'}
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50">
                          <TableHead className="text-slate-700 dark:text-slate-300">
                            Registration
                          </TableHead>
                          <TableHead className="text-slate-700 dark:text-slate-300">Category</TableHead>
                          <TableHead className="text-slate-700 dark:text-slate-300">Status</TableHead>
                          <TableHead className="text-slate-700 dark:text-slate-300">
                            Last Inspector
                          </TableHead>
                          <TableHead className="text-slate-700 dark:text-slate-300">
                            Last Inspection
                          </TableHead>
                          <TableHead className="text-right text-slate-700 dark:text-slate-300">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredVehicles.map((vehicle) => (
                          <TableRow
                            key={vehicle.id}
                            className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            <TableCell className="font-medium text-slate-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <Truck className="h-4 w-4 text-slate-400" />
                                {vehicle.reg_number}
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-300">
                              {vehicle.vehicle_categories?.name || (
                                <span className="text-slate-400">Not set</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={vehicle.status === 'active' ? 'default' : 'secondary'}
                              >
                                {vehicle.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-300">
                              {vehicle.last_inspector ? (
                                <div className="flex items-center gap-2">
                                  <User className="h-3 w-3 text-slate-400" />
                                  {vehicle.last_inspector}
                                </div>
                              ) : (
                                <span className="text-slate-400">No inspections</span>
                              )}
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-300">
                              {vehicle.last_inspection_date ? (
                                <div className="flex items-center gap-2 text-sm">
                                  <Calendar className="h-3 w-3 text-slate-400" />
                                  {new Date(vehicle.last_inspection_date).toLocaleDateString()}
                                </div>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditVehicleDialog(vehicle)}
                                  className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                  title="Edit Vehicle"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openDeleteVehicleDialog(vehicle)}
                                  className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                  title="Delete Vehicle"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-900 dark:text-white">
                    Vehicle Categories
                  </CardTitle>
                  <CardDescription className="text-slate-600 dark:text-slate-400">
                    Manage vehicle types and categories
                  </CardDescription>
                </div>
                <Button
                  onClick={() => {
                    setCategoryFormData({ name: '', description: '' });
                    setFormError('');
                    setAddCategoryDialogOpen(true);
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {categories.length === 0 ? (
                <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                  No categories yet. Add one to get started.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50">
                        <TableHead className="text-slate-700 dark:text-slate-300">Name</TableHead>
                        <TableHead className="text-slate-700 dark:text-slate-300">
                          Description
                        </TableHead>
                        <TableHead className="text-slate-700 dark:text-slate-300">
                          Vehicles
                        </TableHead>
                        <TableHead className="text-right text-slate-700 dark:text-slate-300">
                          Actions
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((category) => {
                        const vehicleCount = vehicles.filter(
                          (v) => v.category_id === category.id
                        ).length;
                        return (
                          <TableRow
                            key={category.id}
                            className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          >
                            <TableCell className="font-medium text-slate-900 dark:text-white">
                              <div className="flex items-center gap-2">
                                <Tag className="h-4 w-4 text-slate-400" />
                                {category.name}
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-300">
                              {category.description || (
                                <span className="text-slate-400">No description</span>
                              )}
                            </TableCell>
                            <TableCell className="text-slate-700 dark:text-slate-300">
                              <Badge variant="outline">{vehicleCount}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEditCategoryDialog(category)}
                                  className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                  title="Edit Category"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openDeleteCategoryDialog(category)}
                                  disabled={vehicleCount > 0}
                                  className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                                  title={
                                    vehicleCount > 0
                                      ? 'Cannot delete category in use'
                                      : 'Delete Category'
                                  }
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Maintenance Log Tab */}
        <TabsContent value="maintenance-demo">
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-slate-900 dark:text-white">Maintenance Log Demo</CardTitle>
              <CardDescription>This is a preview/demo for the upcoming vehicle maintenance module.</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Navigate to <Link className="underline text-blue-600" href="/admin/maintenance-demo">Maintenance Log Demo Page</Link> to try several layout options!</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Vehicle Dialog */}
      <Dialog open={addVehicleDialogOpen} onOpenChange={setAddVehicleDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Add New Vehicle</DialogTitle>
            <DialogDescription className="text-slate-400">
              Add a new vehicle to the fleet
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="add-reg">Registration Number *</Label>
              <Input
                id="add-reg"
                value={vehicleFormData.reg_number}
                onChange={(e) =>
                  setVehicleFormData({ ...vehicleFormData, reg_number: e.target.value.toUpperCase() })
                }
                onBlur={(e) =>
                  setVehicleFormData({ ...vehicleFormData, reg_number: formatRegistration(e.target.value) })
                }
                placeholder="e.g., BG21 EXH"
                className="bg-slate-800 border-slate-600 text-white uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-category">Category</Label>
              <Select
                value={vehicleFormData.category_id || undefined}
                onValueChange={(value) =>
                  setVehicleFormData({ ...vehicleFormData, category_id: value || '' })
                }
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="Select category (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddVehicleDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddVehicle}
              disabled={formLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Vehicle
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Vehicle Dialog */}
      <Dialog open={editVehicleDialogOpen} onOpenChange={setEditVehicleDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Edit Vehicle</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update vehicle information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-reg">Registration Number *</Label>
              <Input
                id="edit-reg"
                value={vehicleFormData.reg_number}
                onChange={(e) =>
                  setVehicleFormData({ ...vehicleFormData, reg_number: e.target.value.toUpperCase() })
                }
                onBlur={(e) =>
                  setVehicleFormData({ ...vehicleFormData, reg_number: formatRegistration(e.target.value) })
                }
                className="bg-slate-800 border-slate-600 text-white uppercase"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category">Category</Label>
              <Select
                value={vehicleFormData.category_id || undefined}
                onValueChange={(value) =>
                  setVehicleFormData({ ...vehicleFormData, category_id: value || '' })
                }
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="Select category (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-status">Status *</Label>
              <Select
                value={vehicleFormData.status}
                onValueChange={(value) =>
                  setVehicleFormData({ ...vehicleFormData, status: value })
                }
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditVehicleDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditVehicle}
              disabled={formLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Vehicle Dialog */}
      <Dialog open={deleteVehicleDialogOpen} onOpenChange={setDeleteVehicleDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Vehicle
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete this vehicle? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedVehicle && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-slate-400">Registration:</span>{' '}
                <span className="text-white font-medium">{selectedVehicle.reg_number}</span>
              </p>
              <p className="text-sm">
                <span className="text-slate-400">Category:</span>{' '}
                <span className="text-white">
                  {selectedVehicle.vehicle_categories?.name || 'Not set'}
                </span>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteVehicleDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteVehicle}
              disabled={formLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Vehicle
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={addCategoryDialogOpen} onOpenChange={setAddCategoryDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Add New Category</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a new vehicle category
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="add-cat-name">Category Name *</Label>
              <Input
                id="add-cat-name"
                value={categoryFormData.name}
                onChange={(e) =>
                  setCategoryFormData({ ...categoryFormData, name: e.target.value })
                }
                placeholder="e.g., Truck"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-cat-desc">Description</Label>
              <Textarea
                id="add-cat-desc"
                value={categoryFormData.description}
                onChange={(e) =>
                  setCategoryFormData({ ...categoryFormData, description: e.target.value })
                }
                placeholder="Optional description"
                className="bg-slate-800 border-slate-600 text-white"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddCategoryDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddCategory}
              disabled={formLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={editCategoryDialogOpen} onOpenChange={setEditCategoryDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update category information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-cat-name">Category Name *</Label>
              <Input
                id="edit-cat-name"
                value={categoryFormData.name}
                onChange={(e) =>
                  setCategoryFormData({ ...categoryFormData, name: e.target.value })
                }
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-cat-desc">Description</Label>
              <Textarea
                id="edit-cat-desc"
                value={categoryFormData.description}
                onChange={(e) =>
                  setCategoryFormData({ ...categoryFormData, description: e.target.value })
                }
                className="bg-slate-800 border-slate-600 text-white"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditCategoryDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleEditCategory}
              disabled={formLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Dialog */}
      <Dialog open={deleteCategoryDialogOpen} onOpenChange={setDeleteCategoryDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Category
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete this category? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedCategory && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-slate-400">Name:</span>{' '}
                <span className="text-white font-medium">{selectedCategory.name}</span>
              </p>
              {selectedCategory.description && (
                <p className="text-sm">
                  <span className="text-slate-400">Description:</span>{' '}
                  <span className="text-white">{selectedCategory.description}</span>
                </p>
              )}
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteCategoryDialogOpen(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteCategory}
              disabled={formLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Category
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

