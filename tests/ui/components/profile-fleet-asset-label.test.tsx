/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProfileOverviewTab } from '@/components/profile/ProfileOverviewTab';

vi.mock('@/components/profile/ProfileHelpShortcuts', () => ({
  ProfileHelpShortcuts: () => null,
}));

describe('ProfileOverviewTab fleet asset label', () => {
  it('shows only the VRN while retaining the asset type accessibly', () => {
    render(
      <ProfileOverviewTab
        profile={{
          id: 'user-1',
          full_name: 'Peter Woodward',
          phone_number: null,
          employee_id: '127',
          avatar_url: null,
          must_change_password: false,
          annual_holiday_allowance_days: 28,
          super_admin: false,
          email: 'peter@example.com',
          emergency_contact_name: null,
          emergency_contact_phone: null,
          emergency_contact_relationship: null,
          secondary_emergency_contact_name: null,
          secondary_emergency_contact_phone: null,
          secondary_emergency_contact_relationship: null,
          employer_profile_notes: null,
          team: { id: 'team-1', name: 'Accounts' },
          role: {
            name: 'employee',
            display_name: 'Employee',
            role_class: 'employee',
            is_manager_admin: false,
            is_super_admin: false,
          },
        }}
        managers={[]}
        annualLeaveSummary={{
          allowance: 28,
          approved_taken: 2,
          pending_total: 1,
          remaining: 25,
        }}
        permissionModules={[]}
        helpShortcuts={[]}
        currentFleetAssignment={{
          id: 'assignment-1',
          user_id: 'user-1',
          asset_type: 'van',
          asset_id: 'van-1',
          asset_label: 'BN26 VDG',
          asset_nickname: 'Peter Woodward',
          source_location_id: null,
          assigned_at: '2026-08-03T10:00:00.000Z',
        }}
      />
    );

    const assetBadge = screen.getByLabelText('Van BN26 VDG');
    expect(assetBadge).toHaveTextContent('BN26 VDG');
    expect(assetBadge).not.toHaveTextContent('Peter Woodward');
    expect(assetBadge.className).toContain('--inspection-primary');
  });
});
