'use client';

import Link from 'next/link';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProfileBiometricsCard } from '@/components/profile/ProfileBiometricsCard';
import { ProfileSensitivePinCard } from '@/components/profile/ProfileSensitivePinCard';
import type { ProfilePermissionSummaryItem } from '@/types/profile';

interface ProfileSecurityTabProps {
  sensitiveModules: ProfilePermissionSummaryItem[];
}

export function ProfileSecurityTab({ sensitiveModules }: ProfileSecurityTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-avs-yellow/15 p-2 text-avs-yellow">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Password Reset</CardTitle>
              <CardDescription>Change your account password when needed.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="border-border bg-slate-900/40 text-foreground hover:bg-slate-800"
            asChild
          >
            <Link href="/change-password">Change password</Link>
          </Button>
        </CardContent>
      </Card>

      {sensitiveModules.length > 0 ? (
        <ProfileSensitivePinCard />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-green-500/15 p-2 text-green-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Sensitive Access PIN</CardTitle>
                <CardDescription>
                  Your current module access does not require an extra sensitive access PIN.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      <ProfileBiometricsCard />
    </div>
  );
}

