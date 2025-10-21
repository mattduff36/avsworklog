# AVS Worklog

Digital forms management system for A&V Squires Plant Co. Ltd.

A Progressive Web App (PWA) for managing employee timesheets and vehicle inspections with offline support, real-time synchronization, and comprehensive reporting.

## Features

- **Employee Timesheets**: Digital weekly timesheets with auto-calculated hours
- **Vehicle Inspections**: 26-point safety inspection checklists
- **Offline Support**: Work without internet, sync when connected
- **Real-time Updates**: Changes sync across devices instantly
- **Role-Based Access**: Admin, Manager, and Employee permissions
- **Digital Signatures**: Secure employee sign-offs
- **PDF & Excel Reports**: Generate professional reports
- **Mobile-First Design**: Optimized for tablets and smartphones

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS 4, shadcn/ui components
- **Backend**: Supabase (PostgreSQL, Auth, Realtime, Storage)
- **State Management**: TanStack Query, Zustand
- **Forms**: React Hook Form + Zod validation
- **PWA**: next-pwa with service workers
- **Deployment**: Vercel

## Prerequisites

- Node.js 18+ and npm
- Supabase account (free tier works)
- Vercel account for deployment (optional)

## Setup Instructions

### 1. Clone and Install

\`\`\`bash
git clone <repository-url>
cd avsworklog
npm install
\`\`\`

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the database to be ready (2-3 minutes)
3. Go to **SQL Editor** in your Supabase dashboard
4. Copy and paste the entire contents of `supabase/schema.sql`
5. Click "Run" to execute the schema

### 3. Configure Environment Variables

Create a `.env.local` file in the root directory:

\`\`\`env
# Get these from Supabase Dashboard > Settings > API
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
\`\`\`

**Finding your Supabase credentials:**
- Go to your Supabase project
- Click "Settings" (gear icon)
- Go to "API"
- Copy "Project URL" and "anon public" key

### 4. Create First Admin User

1. Go to **Authentication** in Supabase dashboard
2. Click "Add User" > "Create new user"
3. Enter email and password
4. After user is created, go to **SQL Editor**
5. Run this query (replace with your user's ID):

\`\`\`sql
UPDATE profiles 
SET role = 'admin' 
WHERE id = 'paste-user-id-here';
\`\`\`

You can find the user ID in Authentication > Users table.

### 5. Run Development Server

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) and sign in with your admin account.

## Project Structure

\`\`\`
avsworklog/
├── app/                          # Next.js App Router
│   ├── (auth)/                  # Authentication pages
│   │   └── login/              
│   ├── (dashboard)/             # Protected dashboard pages
│   │   ├── dashboard/           # Main dashboard
│   │   ├── timesheets/          # Timesheet management
│   │   ├── inspections/         # Vehicle inspections
│   │   ├── reports/             # Reports & exports
│   │   └── admin/               # Admin pages
│   ├── api/                     # API routes
│   ├── layout.tsx               # Root layout
│   └── globals.css              # Global styles
├── components/
│   ├── ui/                      # shadcn/ui components
│   ├── forms/                   # Form components
│   ├── layout/                  # Layout components (Navbar, etc.)
│   └── dashboard/               # Dashboard widgets
├── lib/
│   ├── supabase/                # Supabase clients & middleware
│   ├── utils/                   # Utility functions
│   ├── hooks/                   # React hooks
│   └── stores/                  # Zustand stores
├── types/                       # TypeScript type definitions
├── supabase/                    # Database schema
└── public/                      # Static assets & PWA files
\`\`\`

## Usage

### For Employees

1. **Log in** with your credentials
2. **Create Timesheet**: 
   - Click "New Timesheet" on dashboard
   - Fill in daily hours and remarks
   - Sign digitally
   - Submit for approval
3. **Vehicle Inspection**:
   - Click "New Vehicle Inspection"
   - Select vehicle and week
   - Mark daily checks (✓/X/0)
   - Add photos for defects
   - Submit

### For Managers

1. View all submitted timesheets and inspections
2. Review and approve/reject forms
3. Add comments for rejected forms
4. Generate reports for date ranges

### For Admins

- All manager functions
- User management
- Add/edit vehicles
- System configuration

## Offline Mode

The app works offline! Changes are:
- Saved locally in browser storage
- Queued for synchronization
- Automatically synced when connection restored
- Indicated by offline icon in navbar

## Development

### Adding New Form Fields

1. Update database schema in `supabase/schema.sql`
2. Update TypeScript types in `types/`
3. Modify form components in `components/forms/`
4. Update validation schemas in `lib/utils/validators.ts`

### Running Tests

\`\`\`bash
npm run lint        # Check code quality
npm run build       # Test production build
\`\`\`

## Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Add environment variables from `.env.local`
5. Deploy!

Vercel will automatically:
- Deploy on every git push
- Generate preview URLs for branches
- Handle serverless functions
- Configure custom domains

### Update Environment Variables

In Vercel dashboard:
- Go to Settings > Environment Variables
- Add all variables from `.env.local`
- Update `NEXT_PUBLIC_APP_URL` to your production URL

## Troubleshooting

### "User not found" error
- Ensure profile was created in database
- Check Supabase triggers are working
- Manually create profile if needed

### Offline sync not working
- Check browser console for errors
- Clear browser cache and reload
- Ensure service worker is registered

### RLS policy errors
- Verify user role in database
- Check RLS policies in Supabase
- Test policies in SQL Editor

### Build errors
- Run `npm install` again
- Delete `.next` folder
- Check for TypeScript errors

## Support

For issues or questions:
1. Check existing documentation
2. Review Supabase logs
3. Check browser console
4. Contact system administrator

## License

Proprietary - A&V Squires Plant Co. Ltd.

## Version

**v1.0.0** - MVP Release
- Employee timesheets
- Vehicle inspections
- Basic reporting
- Offline support
- Real-time sync

---

**Built with** ❤️ **for A&V Squires Plant Co. Ltd.**
