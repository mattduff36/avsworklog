// API Route: Get MOT History for a Vehicle
// GET /api/maintenance/mot-history/[vehicleId]

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createMotHistoryService } from '@/lib/services/mot-history-api';

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

    // Check if MOT API is configured
    const motService = createMotHistoryService();
    if (!motService) {
      return NextResponse.json(
        { 
          error: 'MOT History API not configured',
          message: 'Please configure MOT API credentials'
        },
        { status: 503 }
      );
    }

    // Fetch MOT history from API (single call that includes expiry data)
    try {
      const motExpiryData = await motService.getMotExpiryData(vehicle.reg_number);
      const motHistory = motExpiryData.rawData; // Reuse the history data from getMotExpiryData

      // Validate that we have the minimum required data
      if (!motHistory || !motHistory.registration) {
        return NextResponse.json({
          success: false,
          error: 'Incomplete MOT data',
          message: `MOT API returned incomplete data for ${vehicle.reg_number}`,
        }, { status: 500 }); // Internal server error - API returned incomplete data
      }

      // Transform the data to match UI expectations
      const sortedTests = (motHistory.motTests || []).sort((a, b) => 
        new Date(b.completedDate).getTime() - new Date(a.completedDate).getTime()
      );

      // Calculate days remaining for valid MOT
      let daysRemaining = null;
      if (motExpiryData.motExpiryDate && motExpiryData.motStatus === 'Valid') {
        const expiryDate = new Date(motExpiryData.motExpiryDate);
        const now = new Date();
        daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      return NextResponse.json({
        success: true,
        data: {
          registrationNumber: motHistory.registration || vehicle.reg_number,
          make: motHistory.make || null,
          model: motHistory.model || null,
          fuelType: motHistory.fuelType || null,
          primaryColour: motHistory.primaryColour || null,
          firstUsedDate: motHistory.firstUsedDate || null,
          currentStatus: {
            expiryDate: motExpiryData.motExpiryDate,
            status: motExpiryData.motStatus,
            daysRemaining,
            lastTestDate: motExpiryData.lastTestDate,
            lastTestResult: motExpiryData.lastTestResult,
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

    } catch (motError: any) {
      console.error(`MOT API error for ${vehicle.reg_number}:`, motError);
      
      // Return friendly error message
      if (motError.message?.includes('404')) {
        return NextResponse.json({
          success: false,
          error: 'No MOT history found',
          message: `No MOT history found for ${vehicle.reg_number}. Vehicle may be too new or exempt from MOT testing.`,
        }, { status: 404 }); // Not found - vehicle has no MOT history
      }

      return NextResponse.json(
        { 
          error: 'Failed to fetch MOT history',
          message: motError.message 
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('MOT history route error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

