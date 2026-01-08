import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MotHistoryDialog } from '@/app/(dashboard)/maintenance/components/MotHistoryDialog';
import { resetAllMocks, mockFetch } from '../../utils/test-helpers';

describe('MotHistoryDialog', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('renders "Not Set" when odometerValue is null', async () => {
    mockFetch({
      success: true,
      data: {
        currentStatus: {
          expiryDate: '2026-07-15',
          status: 'Valid',
          daysRemaining: 204,
          lastTestDate: '2025-06-20T10:30:00Z',
          lastTestResult: 'PASSED',
          motExpiryDate: '2026-07-15',
        },
        tests: [
          {
            motTestNumber: '123456789012',
            completedDate: '2025-06-20T10:30:00Z',
            testResult: 'PASSED',
            expiryDate: '2026-07-15',
            odometerValue: null,
            odometerUnit: 'mi',
            defects: [],
          },
        ],
      },
    });

    render(
      <MotHistoryDialog
        open={true}
        onOpenChange={() => undefined}
        vehicleReg="AB12 CDE"
        vehicleId="vehicle-1"
        existingMotDueDate={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Test History/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Not Set')).toBeInTheDocument();
  });

  it('formats numeric odometerValue with unit', async () => {
    mockFetch({
      success: true,
      data: {
        currentStatus: {
          expiryDate: '2026-07-15',
          status: 'Valid',
          daysRemaining: 204,
          lastTestDate: '2025-06-20T10:30:00Z',
          lastTestResult: 'PASSED',
          motExpiryDate: '2026-07-15',
        },
        tests: [
          {
            motTestNumber: '123456789012',
            completedDate: '2025-06-20T10:30:00Z',
            testResult: 'PASSED',
            expiryDate: '2026-07-15',
            odometerValue: 12345,
            odometerUnit: 'mi',
            defects: [],
          },
        ],
      },
    });

    render(
      <MotHistoryDialog
        open={true}
        onOpenChange={() => undefined}
        vehicleReg="AB12 CDE"
        vehicleId="vehicle-1"
        existingMotDueDate={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Test History/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/12,345 mi/)).toBeInTheDocument();
  });
});

