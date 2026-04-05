import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { TabletModeProvider } from '@/components/layout/tablet-mode-context';
import { AttachmentHybridFormModal } from '@/components/workshop-tasks/AttachmentHybridFormModal';
import type { AttachmentSchemaSnapshot } from '@/types/workshop-attachments-v2';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'attachment-hybrid-test-user' } },
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  }),
}));

vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'>) => <img {...props} alt={props.alt || 'image'} />,
}));

vi.mock('@/components/forms/SignaturePad', () => ({
  SignaturePad: ({ onSave }: { onSave: (signature: string) => void }) => (
    <button type="button" onClick={() => onSave('data:image/png;base64,abc')}>
      Mock Save Signature
    </button>
  ),
}));

const snapshot: AttachmentSchemaSnapshot = {
  id: 'snapshot-1',
  attachment_id: 'attachment-1',
  template_version_id: 'version-1',
  snapshot_json: {
    template_id: 'template-1',
    version_id: 'version-1',
    generated_at: '2026-04-01T12:00:00.000Z',
    sections: [
      {
        id: 'section-a',
        section_key: 'inside_cab',
        title: 'Inside Cab',
        description: null,
        sort_order: 1,
        fields: [
          {
            id: 'field-a1',
            field_key: 'engine_mil',
            label: 'Engine MIL',
            help_text: null,
            field_type: 'marking_code',
            is_required: true,
            sort_order: 1,
            options_json: null,
            validation_json: null,
          },
        ],
      },
      {
        id: 'section-b',
        section_key: 'declaration',
        title: 'Declaration',
        description: null,
        sort_order: 2,
        fields: [
          {
            id: 'field-b1',
            field_key: 'inspector_name',
            label: 'Inspector Name',
            help_text: null,
            field_type: 'text',
            is_required: true,
            sort_order: 1,
            options_json: null,
            validation_json: null,
          },
        ],
      },
    ],
  },
};

const signatureSnapshot: AttachmentSchemaSnapshot = {
  id: 'snapshot-2',
  attachment_id: 'attachment-2',
  template_version_id: 'version-2',
  snapshot_json: {
    template_id: 'template-2',
    version_id: 'version-2',
    generated_at: '2026-04-01T12:00:00.000Z',
    sections: [
      {
        id: 'section-signature',
        section_key: 'declaration',
        title: 'Declaration',
        description: null,
        sort_order: 1,
        fields: [
          {
            id: 'field-signature',
            field_key: 'inspector_signature',
            label: 'Inspector Signature',
            help_text: null,
            field_type: 'signature',
            is_required: false,
            sort_order: 1,
            options_json: null,
            validation_json: null,
          },
        ],
      },
    ],
  },
};

describe('AttachmentHybridFormModal', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tablet_mode:attachment-hybrid-test-user', 'on');
  });

  it('renders sections and saves completed payload', async () => {
    const onSave = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(
      <TabletModeProvider>
        <AttachmentHybridFormModal
          open
          onOpenChange={onOpenChange}
          templateName="6 Week Inspection - HGV"
          snapshot={snapshot}
          existingResponses={[
            {
              section_key: 'inside_cab',
              field_key: 'engine_mil',
              field_id: 'field-a1',
              response_value: 'serviceable',
              response_json: null,
            },
            {
              section_key: 'declaration',
              field_key: 'inspector_name',
              field_id: 'field-b1',
              response_value: 'A. Inspector',
              response_json: null,
            },
          ]}
          onSave={onSave}
        />
      </TabletModeProvider>,
    );

    expect(screen.getAllByText('Inside Cab').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Declaration').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Attachment' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0][1]).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('persists signer name in response_json without existing signature payload', async () => {
    const onSave = vi.fn(async () => undefined);

    render(
      <TabletModeProvider>
        <AttachmentHybridFormModal
          open
          onOpenChange={vi.fn()}
          templateName="Signature Test"
          snapshot={signatureSnapshot}
          existingResponses={[]}
          onSave={onSave}
        />
      </TabletModeProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Signer name'), { target: { value: 'J. Inspector' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    const payload = onSave.mock.calls[0][0] as Array<{
      field_key: string;
      response_json: Record<string, unknown> | null;
    }>;
    const signatureResponse = payload.find((entry) => entry.field_key === 'inspector_signature');

    expect(signatureResponse).toBeDefined();
    expect(signatureResponse?.response_json).toMatchObject({ signed_by_name: 'J. Inspector' });
  });
});
