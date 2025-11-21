#!/bin/bash
# Helper script to update API routes - for reference only
# The actual updates will be done manually via search_replace

# Files to update:
# app/api/admin/users/list-with-emails/route.ts
# app/api/admin/users/[id]/reset-password/route.ts
# app/api/admin/categories/[id]/route.ts
# app/api/admin/vehicles/[id]/route.ts
# app/api/admin/vehicles/route.ts
# app/api/admin/categories/route.ts
# app/api/rams/*.ts
# app/api/timesheets/[id]/delete.ts
# app/api/inspections/[id]/delete.ts

# Pattern to find:
# const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
# if (!profile || profile.role !== 'admin') { ... }

# Replace with:
# const profile = await getProfileWithRole(user.id);
# if (!profile || profile.role?.name !== 'admin') { ... }

