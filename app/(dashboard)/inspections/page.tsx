'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, ClipboardCheck } from 'lucide-react';

export default function InspectionsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vehicle Inspections</h1>
          <p className="text-muted-foreground">
            Manage vehicle safety inspections
          </p>
        </div>
        <Link href="/inspections/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Inspection
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <ClipboardCheck className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No inspections yet</h3>
          <p className="text-muted-foreground mb-4 text-center">
            Create your first vehicle inspection to get started
          </p>
          <Link href="/inspections/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Inspection
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

