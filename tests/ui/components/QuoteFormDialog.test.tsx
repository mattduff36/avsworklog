/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { QuoteFormDialog } from '@/app/(dashboard)/quotes/components/QuoteFormDialog';

const mockUseAuth = vi.fn();

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('QuoteFormDialog', () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => undefined),
    customers: [
      {
        id: 'customer-1',
        company_name: 'Acme Ltd',
        short_name: null,
        contact_name: 'Alice Example',
        contact_email: 'alice@example.com',
        address_line_1: '1 Example Street',
        address_line_2: null,
        city: 'Nottingham',
        county: 'Nottinghamshire',
        postcode: 'NG1 1AA',
        default_validity_days: 30,
      },
    ],
    managerOptions: [
      {
        profile_id: 'manager-1',
        initials: 'ME',
        next_number: 42,
        number_start: 1,
        signoff_name: 'Manager Example',
        signoff_title: 'Contracts Manager',
        manager_email: 'manager@example.com',
        approver_profile_id: null,
        is_active: true,
        profile: {
          id: 'manager-1',
          full_name: 'Manager Example',
          email: 'manager@example.com',
        },
        approver: null,
      },
    ],
    approvers: [],
  };

  it('preserves in-progress form values when auth state refreshes while open', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    const { rerender } = render(<QuoteFormDialog {...baseProps} />);

    const subjectInput = screen.getByPlaceholderText(
      'e.g. Supply of Fence Panels & Accessories'
    ) as HTMLInputElement;

    fireEvent.change(subjectInput, {
      target: { value: 'Fence panels for rear compound' },
    });

    expect(subjectInput.value).toBe('Fence panels for rear compound');

    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    rerender(<QuoteFormDialog {...baseProps} />);

    expect(
      (
        screen.getByPlaceholderText(
          'e.g. Supply of Fence Panels & Accessories'
        ) as HTMLInputElement
      ).value
    ).toBe('Fence panels for rear compound');
  });

  it('shows the new client fields and hides auto-populated manager fields', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    render(<QuoteFormDialog {...baseProps} />);

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.getByText('Estimated Duration (days)')).toBeInTheDocument();
    expect(screen.queryByText('Requester Initials')).not.toBeInTheDocument();
    expect(screen.queryByText('Approver')).not.toBeInTheDocument();
    expect(screen.queryByText('Manager Email')).not.toBeInTheDocument();
  });
});
