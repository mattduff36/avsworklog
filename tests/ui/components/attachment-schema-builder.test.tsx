import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AttachmentSchemaBuilderPanel } from '@/components/workshop-tasks/AttachmentSchemaBuilderPanel';

afterEach(() => vi.unstubAllGlobals());

it('preserves existing required failure comments when publishing a checklist', async () => {
  const field = {
    field_key: 'check_1',
    label: 'Oil, fuel & coolant levels/leaks',
    field_type: 'marking_code',
    is_required: true,
    validation_json: { require_note_for: ['attention'] },
  };
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({});
    return Response.json({
      version: { version_number: 1, status: 'published' },
      sections: [{ section_key: 'plant_daily_check', title: 'Plant Daily Check', fields: [field] }],
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<AttachmentSchemaBuilderPanel templateId="plant-check" templateName="General Plant Inspection" templates={[]} />);
  await screen.findByDisplayValue(field.label);
  fireEvent.click(screen.getByRole('button', { name: 'Publish Schema Version' }));

  await waitFor(() => {
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.[1]?.body)).sections[0].fields[0]).toMatchObject(field);
  });
});
