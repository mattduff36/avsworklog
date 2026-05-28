'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ProfileDetailsDraft {
  full_name: string;
  phone_number: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  secondary_emergency_contact_name: string;
  secondary_emergency_contact_phone: string;
  secondary_emergency_contact_relationship: string;
  employer_profile_notes: string;
}

interface ProfileMyDetailsTabProps {
  canEditBasicFields: boolean;
  draft: ProfileDetailsDraft;
  onDraftChange: (field: keyof ProfileDetailsDraft, value: string) => void;
  onSave: () => void;
  isSaving: boolean;
  hasChanges: boolean;
}

export function ProfileMyDetailsTab({
  canEditBasicFields,
  draft,
  onDraftChange,
  onSave,
  isSaving,
  hasChanges,
}: ProfileMyDetailsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Details</CardTitle>
        <CardDescription>
          Keep your account and emergency contact information up to date for your employer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Account details</h3>
            {!canEditBasicFields ? (
              <p className="text-xs text-muted-foreground">Name and phone are read-only for your role</p>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-full-name">Full name</Label>
              <Input
                id="profile-full-name"
                value={draft.full_name}
                readOnly={!canEditBasicFields}
                onChange={(event) => onDraftChange('full_name', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone-number">Phone number</Label>
              <Input
                id="profile-phone-number"
                value={draft.phone_number}
                readOnly={!canEditBasicFields}
                onChange={(event) => onDraftChange('phone_number', event.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border border-[hsl(var(--avs-yellow)/0.3)] bg-[hsl(var(--avs-yellow)/0.06)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Emergency contacts</h3>
            <p className="text-xs text-muted-foreground">
              These details are for workplace support if your manager needs to contact someone on your behalf.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="profile-emergency-contact-name">Primary contact name</Label>
              <Input
                id="profile-emergency-contact-name"
                value={draft.emergency_contact_name}
                onChange={(event) => onDraftChange('emergency_contact_name', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-emergency-contact-phone">Primary contact phone</Label>
              <Input
                id="profile-emergency-contact-phone"
                value={draft.emergency_contact_phone}
                onChange={(event) => onDraftChange('emergency_contact_phone', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-emergency-contact-relationship">Relationship</Label>
              <Input
                id="profile-emergency-contact-relationship"
                value={draft.emergency_contact_relationship}
                onChange={(event) => onDraftChange('emergency_contact_relationship', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-secondary-emergency-contact-name">Secondary contact name</Label>
              <Input
                id="profile-secondary-emergency-contact-name"
                value={draft.secondary_emergency_contact_name}
                onChange={(event) => onDraftChange('secondary_emergency_contact_name', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-secondary-emergency-contact-phone">Secondary contact phone</Label>
              <Input
                id="profile-secondary-emergency-contact-phone"
                value={draft.secondary_emergency_contact_phone}
                onChange={(event) => onDraftChange('secondary_emergency_contact_phone', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-secondary-emergency-contact-relationship">Relationship</Label>
              <Input
                id="profile-secondary-emergency-contact-relationship"
                value={draft.secondary_emergency_contact_relationship}
                onChange={(event) => onDraftChange('secondary_emergency_contact_relationship', event.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Additional information</h3>
            <p className="text-xs text-muted-foreground">
              Optional notes that may help your employer support you at work.
            </p>
          </div>
          <Textarea
            id="profile-employer-notes"
            value={draft.employer_profile_notes}
            maxLength={500}
            onChange={(event) => onDraftChange('employer_profile_notes', event.target.value)}
            placeholder="For example, preferred contact times or practical support notes."
          />
          <p className="text-right text-xs text-muted-foreground">
            {draft.employer_profile_notes.length}/500
          </p>
        </section>

        <Button
          type="button"
          onClick={onSave}
          disabled={!hasChanges || isSaving}
          className="bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save details'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

