// API Route: Get MOT History for a Vehicle (from Database)
// GET /api/maintenance/mot-history/[vehicleId]
// Note: This endpoint reads from stored database data only (no API calls)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { vehicleId } = await params;

    // Get vehicle registration number
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('reg_number')
      .eq('id', vehicleId)
      .single();

    if (vehicleError || !vehicle) {
      return NextResponse.json(
        { error: 'Vehicle not found' },
        { status: 404 }
      );
    }

    // Get MOT history from database (mot_raw_data field)
    const { data: maintenanceData, error: maintenanceError } = await supabase
      .from('vehicle_maintenance')
      .select('mot_raw_data, mot_expiry_date, mot_api_sync_status, last_mot_api_sync')
      .eq('vehicle_id', vehicleId)
      .single();

    if (maintenanceError || !maintenanceData) {
      return NextResponse.json({
        success: false,
        error: 'No MOT data found',
        message: `No MOT data found for ${vehicle.reg_number}. Data will be synced automatically.`,
      }, { status: 404 });
    }

    // Check if MOT data exists
    const motHistory = maintenanceData.mot_raw_data;
    if (!motHistory || !motHistory.registration) {
      return NextResponse.json({
        success: false,
        error: 'No MOT history',
        message: `No MOT history available for ${vehicle.reg_number}. Data will be synced when you open the Maintenance History modal.`,
      }, { status: 404 });
    }

    // Transform the stored data to match UI expectations
    const sortedTests = (motHistory.motTests || []).sort((a, b) => 
      new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime()
    );

    // Calculate MOT expiry status and days remaining
    const latestPassedTest = sortedTests.find(test => test.testResult === 'PASSED');
    let motExpiryDate = maintenanceData.mot_expiry_date || latestPassedTest?.expiryDate || motHistory.motTestDueDate || null;
    let motStatus = 'Unknown';
    let daysRemaining = null;

    if (motExpiryDate) {
      const expiryDate = new Date(motExpiryDate);
      const now = new Date();
      daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysRemaining > 0) {
        motStatus = 'Valid';
      } else {
        motStatus = 'Expired';
      }
    } else if (sortedTests.length === 0) {
      motStatus = 'No MOT History';
    }

    const lastTest = sortedTests[0];

    return NextResponse.json({
      success: true,
      data: {
        registrationNumber: motHistory.registration || vehicle.reg_number,
        make: motHistory.make || null,
        model: motHistory.model || null,
        fuelType: motHistory.fuelType || null,
        primaryColour: motHistory.primaryColour || null,
        firstUsedDate: motHistory.firstUsedDate || motHistory.registrationDate || null,
        currentStatus: {
          expiryDate: motExpiryDate,
          status: motStatus,
          daysRemaining,
          lastTestDate: lastTest?.completedDate || null,
          lastTestResult: lastTest?.testResult || null,
          motExpiryDate: motExpiryDate, // For backward compatibility
        },
        tests: sortedTests.map(test => ({
          motTestNumber: test.motTestNumber,
          completedDate: test.completedDate,
          testResult: test.testResult,
          expiryDate: test.expiryDate,
          odometerValue: test.odometerValue ? parseInt(test.odometerValue) : null,
          odometerUnit: test.odometerUnit,
          defects: test.defects || [],
        })),
      },
    });

  } catch (error: any) {
    console.error('MOT history route error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

