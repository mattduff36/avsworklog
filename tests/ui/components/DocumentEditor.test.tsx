/// <reference types="@testing-library/jest-dom/vitest" />
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentEditor, emptyExternalDocumentDraft, type ExternalDocumentDraft } from '@/components/external-documents/DocumentEditor';
import type { ExternalDocumentOptionsResponse } from '@/types/external-documents';

const options: ExternalDocumentOptionsResponse = {
  assets: {
    vans: [{ id: 'van-1', label: 'AB12 CDE' }],
    plant: [],
    hgvs: [],
  },
  readers: [
    { id: 'alice-id', label: 'Alice Smith' },
    { id: 'bob-id', label: 'Bob Jones' },
  ],
};

function EditorHarness({
  mode = 'create',
  disabled = false,
  initial,
}: {
  mode?: 'create' | 'edit';
  disabled?: boolean;
  initial?: ExternalDocumentDraft;
}) {
  const [draft, setDraft] = useState<ExternalDocumentDraft>(initial ?? emptyExternalDocumentDraft());
  return (
    <DocumentEditor
      mode={mode}
      draft={draft}
      onDraftChange={setDraft}
      options={options}
      optionsLoading={false}
      optionsError={null}
      canManageSharing
      disabled={disabled}
      formError={null}
    />
  );
}

describe('DocumentEditor', () => {
  it('uploads files, reorders them, and removes one', () => {
    render(<EditorHarness />);

    const alpha = new File(['alpha'], 'alpha.pdf', { type: 'application/pdf' });
    const beta = new File(['beta-bytes'], 'beta.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [alpha, beta] } });

    expect(screen.getByText('1. alpha.pdf')).toBeInTheDocument();
    expect(screen.getByText('2. beta.png')).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move beta.png up' }));
    expect(screen.getByText('1. beta.png')).toBeInTheDocument();
    expect(screen.getByText('2. alpha.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove alpha.pdf' }));
    expect(screen.queryByText(/alpha.pdf/)).not.toBeInTheDocument();
    expect(screen.getByText('1. beta.png')).toBeInTheDocument();
    expect(screen.getByText(/1 file/)).toBeInTheDocument();
  });

  it('keeps selected readers that are hidden by search', () => {
    render(<EditorHarness initial={{ ...emptyExternalDocumentDraft(), shared_with: ['ALICE-ID'] }} />);

    expect(screen.getByRole('checkbox', { name: 'Alice Smith' })).toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'Bob' } });

    expect(screen.queryByRole('checkbox', { name: 'Alice Smith' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Bob Jones' })).not.toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Bob Jones' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'Alice Smith' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bob Jones' })).toBeChecked();
  });

  it('disables controls and does not offer new files when editing', () => {
    const alpha = new File(['alpha'], 'alpha.pdf', { type: 'application/pdf' });
    const initial: ExternalDocumentDraft = {
      ...emptyExternalDocumentDraft(),
      title: 'Service sheet',
      files: [{ key: 'alpha', file: alpha }],
      shared_with: ['alice-id'],
    };

    const { rerender } = render(<EditorHarness disabled initial={initial} />);

    expect(screen.getByLabelText('Title *')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Choose files/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move alpha.pdf up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove alpha.pdf' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Alice Smith' })).toBeDisabled();
    expect(screen.getByLabelText('Search people')).toBeDisabled();

    rerender(<EditorHarness mode="edit" initial={initial} />);
    expect(screen.queryByRole('button', { name: /Choose files/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Take a photo')).not.toBeInTheDocument();
    expect(screen.queryByText('alpha.pdf')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title *')).toHaveValue('Service sheet');
    expect(within(screen.getByRole('group', { name: 'Access' })).getByText(/manager access/)).toBeInTheDocument();
  });
});
