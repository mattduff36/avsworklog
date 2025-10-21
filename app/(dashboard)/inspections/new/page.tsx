'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft, Construction } from 'lucide-react';

export default function NewInspectionPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/inspections">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">New Vehicle Inspection</h1>
          <p className="text-muted-foreground">
            26-point safety checklist
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Construction className="h-6 w-6 text-amber-600" />
            <span>Coming Soon</span>
          </CardTitle>
          <CardDescription>
            The vehicle inspection form is being implemented
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This feature will allow you to complete the 26-point vehicle safety inspection 
            checklist with daily columns for the week, photo uploads for defects, and 
            manager review workflow.
          </p>
          <div className="mt-6">
            <Link href="/inspections">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Inspections
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

