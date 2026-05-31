/// <reference types="@testing-library/jest-dom/vitest" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { QuoteFormDialog } from '@/app/(dashboard)/quotes/components/QuoteFormDialog';
import type { Quote } from '@/app/(dashboard)/quotes/types';

const mockUseAuth = vi.fn();

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('QuoteFormDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('generates and applies a beta AI quote draft', async () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        subject_line: 'Installation of signage posts - Middlebeck Way',
        project_description: 'Install six sets of signage posts along Middlebeck Way, with final positions to be confirmed.',
        scope: '- Mobilise two operatives and HIAB vehicle.\n- Excavate post holes and spread spoil locally.\n- Concrete sleeves and install posts.',
        caveats: ['Confirm final positions before issue.'],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QuoteFormDialog {...baseProps} />);

    expect(screen.getByText('Beta feature')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open ai helper/i }));
    fireEvent.change(screen.getByLabelText('Customer email'), {
      target: {
        value: 'Would you be able to quote me for installing six sets of posts along Middlebeck Way?',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));

    expect(await screen.findByText('Installation of signage posts - Middlebeck Way')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /apply to quote/i }));

    expect(
      (screen.getByPlaceholderText('e.g. Supply of Fence Panels & Accessories') as HTMLInputElement).value
    ).toBe('Installation of signage posts - Middlebeck Way');
    expect(
      (screen.getByPlaceholderText('Brief customer-facing summary') as HTMLTextAreaElement).value
    ).toContain('Install six sets of signage posts');
    expect(
      (screen.getByPlaceholderText('Describe the included scope of works') as HTMLTextAreaElement).value
    ).toContain('Mobilise two operatives');
    expect(fetchMock).toHaveBeenCalledWith('/api/quotes/assist', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('adds contact names to duplicate customer names in the customer selector', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    render(
      <QuoteFormDialog
        {...baseProps}
        customers={[
          {
            ...baseProps.customers[0],
            id: 'customer-1',
            company_name: 'Exolum',
            contact_name: 'Matthew Fitzgerald',
          },
          {
            ...baseProps.customers[0],
            id: 'customer-2',
            company_name: 'Exolum',
            contact_name: 'Julian Posner',
            contact_email: 'julian@example.com',
          },
          {
            ...baseProps.customers[0],
            id: 'customer-3',
            company_name: 'Johnsons Aggregates And Recycling Ltd',
            contact_name: 'Kevin Marshall',
            contact_email: 'kevin@example.com',
          },
        ]}
      />
    );

    (Element.prototype as unknown as { hasPointerCapture?: (pointerId: number) => boolean }).hasPointerCapture ??= () => false;

    fireEvent.pointerDown(screen.getAllByRole('combobox')[0]);

    expect(screen.getByText('Exolum [Matthew Fitzgerald]')).toBeInTheDocument();
    expect(screen.getByText('Exolum [Julian Posner]')).toBeInTheDocument();
    expect(screen.getByText('Johnsons Aggregates And Recycling Ltd')).toBeInTheDocument();
  });

  it('shows open, replace, and remove controls for saved client attachments', () => {
    mockUseAuth.mockReturnValue({
      profile: {
        id: 'manager-1',
        full_name: 'Manager Example',
      },
    });

    const quote = {
      id: 'quote-1',
      customer_id: 'customer-1',
      requester_id: 'manager-1',
      requester_initials: 'ME',
      quote_date: '2026-05-02',
      subject_line: 'Fence repairs',
      project_description: 'Repair damaged fence panels',
      scope: 'Replace broken bays',
      validity_days: 30,
      pricing_mode: 'attachments_only',
      is_latest_version: true,
      attachments: [
        {
          id: 'attachment-1',
          quote_id: 'quote-1',
          file_name: 'pricing-sheet.pdf',
          file_path: 'quote-1/pricing-sheet.pdf',
          content_type: 'application/pdf',
          file_size: 1024,
          uploaded_by: 'manager-1',
          created_at: '2026-05-02T08:00:00.000Z',
          is_client_visible: true,
          attachment_purpose: 'client_pricing',
        },
      ],
      line_items: [],
    } as Quote;

    render(<QuoteFormDialog {...baseProps} quote={quote} />);

    expect(screen.getByText('Existing client-visible attachments')).toBeInTheDocument();
    expect(screen.getByText('pricing-sheet.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument();
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });
});
