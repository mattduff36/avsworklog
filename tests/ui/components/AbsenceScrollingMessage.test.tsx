import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AbsenceScrollingMessage } from '@/app/(dashboard)/absence/components/AbsenceScrollingMessage';

describe('AbsenceScrollingMessage', () => {
  it('does not render anything when the message is empty', () => {
    const { container } = render(<AbsenceScrollingMessage message="   " />);

    expect(screen.queryByRole('status', { name: 'Absence announcement' })).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('renders a looping announcement when a message is provided', () => {
    render(<AbsenceScrollingMessage message="Factory closes early on Friday." />);

    expect(screen.getByRole('status', { name: 'Absence announcement' })).toBeInTheDocument();
    expect(screen.getAllByText('Factory closes early on Friday.')).toHaveLength(2);
  });
});
