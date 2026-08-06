# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Squires is used by A&V Squires Plant Co. Ltd. employees, managers, and administrators. Employees complete operational records in the yard, workshop, vehicles, and on job sites, often on phones or tablets. Managers review and approve work, while administrators manage people, assets, compliance, inventory, commercial records, and reporting.

## Product Purpose

Squires replaces paper and fragmented operational processes with one role-aware system for timesheets, vehicle and plant inspections, absence, compliance documents, fleet maintenance, workshop tasks, inventory, quotes, customers, and reports. Success means staff can record work accurately with minimal friction and managers can see, act on, and audit current operational state.

## Positioning

The product joins workforce records, safety checks, fleet and workshop operations, inventory, and commercial administration around the same employees, jobs, vehicles, and approval workflows. It is an operational system tailored to how A&V Squires works rather than a generic form builder.

## Operating Context

- Employees use the product during active work, sometimes outdoors, on mobile or tablet hardware, and with intermittent connectivity.
- Weekly timesheets and daily safety inspections are frequent, time-sensitive workflows.
- Managers process approval queues, defects, absence requests, reminders, and compliance acknowledgements.
- Administrators work with dense tables, calendars, histories, reports, settings, and role-based permissions.
- The application is a dark-only Progressive Web App backed by Supabase and deployed through Vercel.

## Capabilities and Constraints

- Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui, Supabase, TanStack Query, and Zustand.
- Authentication, role-based access, team permissions, digital signatures, realtime updates, file and photo storage, PDF/Excel output, and partial offline support are existing product capabilities.
- Existing production routes and behavior must remain stable while the future UI is explored in parallel demo routes.
- The demo UI uses the same live data and may perform the same writes as production; a read-only environment switch must remain available for client demonstrations.
- User-facing terminology and factual records must not be invented or silently changed.

## Brand Commitments

- Product name: SQUIRES.
- Preserve the A&V Squires signature yellow and dark slate identity.
- Preserve module accent colours as functional wayfinding.
- The voice is concise, direct, operational, and suitable for a workforce tool.

## Evidence on Hand

- Current application routes, APIs, database-backed workflows, and component implementations are the source of product truth.
- `README.md` documents the product scope and operating model.
- Feature PRDs under `docs/` document established module behavior.
- No testimonials, performance claims, customer endorsements, or marketing evidence should be fabricated.

## Product Principles

1. Put the next operational action within immediate reach.
2. Make state, ownership, and exceptions easy to scan.
3. Preserve trust through familiar controls and explicit feedback.
4. Work well on the real devices and in the real environments staff use.
5. Keep role and permission boundaries visible without making the interface feel bureaucratic.

## Accessibility & Inclusion

Interactive controls must be keyboard accessible, retain visible focus, meet WCAG AA contrast, respect reduced-motion preferences, and remain usable at mobile and tablet sizes without globally shrinking type below a readable baseline.
