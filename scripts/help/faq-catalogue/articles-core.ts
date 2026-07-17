import { article, type FAQArticleDef } from './types';

export const CORE_ARTICLES: FAQArticleDef[] = [
  article(
    'getting-started',
    'what-is-squires-app',
    'What is the SQUIRES App?',
    'Overview of the SQUIRES digital work management system.',
    `# What is the SQUIRES App?

SQUIRES is the A&V Squires digital work management app. It replaces paper forms and shared spreadsheets with a mobile-first web app for daily site and office workflows.

## What it covers

The modules you see depend on your role and permissions. Common areas include:

- Timesheets
- Van, plant, and HGV daily checks
- Projects documents and signatures
- Absence and leave
- Maintenance, fleet, workshop tasks, and inventory
- Training records
- Approvals, reports, customers, quotes, toolbox talks, reminders, suggestions, and admin tools

## Access

Open the app at https://avsworklog.mpdee.uk and sign in with your work account.

The app works on desktop, tablet, and mobile. For regular phone or tablet use, install it from the Help page so it opens like a normal app.`,
    0
  ),
  article(
    'getting-started',
    'how-to-login',
    'How do I log in?',
    'Instructions for logging into the app.',
    `# How do I log in?

1. Go to https://avsworklog.mpdee.uk
2. Enter your email address
3. Enter your password
4. Click **Sign In**

## First time login

If this is your first login, an admin will have created your account and sent a temporary password. You may be asked to change that password on first login.

## Forgot password?

Ask an administrator to reset your password from User Management.`,
    1
  ),
  article(
    'getting-started',
    'change-password',
    'How do I change my password?',
    'Instructions for changing your password.',
    `# How do I change my password?

1. Open the change-password page if the app redirects you there, or use the account password option available to you.
2. Enter your new password.
3. Confirm the new password.
4. Save the change.

If you cannot sign in, ask an administrator to issue a temporary password.`,
    2
  ),
  article(
    'getting-started',
    'dashboard-overview',
    'Understanding the Dashboard',
    'Guide to the main dashboard and permission-based navigation.',
    `# Understanding the Dashboard

The Dashboard is your home screen after signing in. It shows quick links for the modules you can access and hides modules that are not enabled for your role or team.

## Quick actions

Day-to-day cards can include Timesheets, Van Daily Checks, Plant Daily Checks, HGV Daily Checks, Projects, Absence, Maintenance, Fleet, Workshop Tasks, Inventory, Training, Reminders, and Help.

## Management tools

Managers and admins may also see Approvals, Actions, Toolbox Talks, Reports, Suggestions, Customers, Quotes, User Management, Admin Settings, FAQ Editor, and Error Reports.

## Badges and alerts

Some cards show counts for unsigned documents, pending approvals, unread notifications, or maintenance and workshop alerts.`,
    3
  ),
  article(
    'getting-started',
    'mobile-pwa-install',
    'How do I install the app on my phone?',
    'Add SQUIRES to your home screen for the best mobile experience.',
    `# How do I install the app on my phone?

SQUIRES is a Progressive Web App. Install it from the Help page install guidance or your browser menu.

## iPhone (Safari)

1. Open Safari and sign in to the app.
2. Tap **Share**.
3. Tap **Add to Home Screen**.

## Android (Chrome)

1. Open Chrome and sign in to the app.
2. Open the browser menu.
3. Tap **Add to Home screen** or **Install app**.

Yard tablets use a separate **Yard Inventory** install flow when pairing a kiosk device.`,
    4
  ),
  article(
    'getting-started',
    'user-roles-explained',
    'What are the different user roles?',
    'Explanation of Employee, Manager, Admin, and Super Admin access.',
    `# What are the different user roles?

Your role and module permissions decide what you can see and do in SQUIRES.

## Employee

Employees can use day-to-day modules enabled for them, such as Timesheets, daily checks, Projects, Absence, Maintenance, Workshop Tasks, Fleet, Inventory, Reminders, and Help.

## Manager

Managers may also have Approvals, Actions, Toolbox Talks, Reports, Suggestions, Training, and selected management workflows.

## Admin

Admins can manage users, roles, permissions, customers, quotes, admin settings, FAQ content, fleet assets, and error reports when those modules are enabled.

## Super Admin

Super Admin is a protected high-access account type used for system administration and recovery.`,
    5
  ),
  article(
    'getting-started',
    'sensitive-module-pin',
    'What is the sensitive module PIN?',
    'Why Quotes and Customers ask for a sensitive PIN.',
    `# What is the sensitive module PIN?

Some modules, including **Quotes** and **Customers**, are protected by a sensitive-access PIN.

When locked, the app asks you to enter your sensitive PIN before showing the module. Unlock lasts for the current sensitive session.

Ask an admin if you need a PIN issued or reset.`,
    6
  ),
  article(
    'getting-started',
    'view-as-role',
    'How does View As work?',
    'Understanding View As when testing another role.',
    `# How does View As work?

Admins with the right access can use View As to preview the app as another role or user context.

While View As is active, navigation and FAQ visibility follow the effective permissions of the selected role. Exit View As when you have finished testing so you return to your normal admin access.`,
    7
  ),
  article(
    'timesheets',
    'create-timesheet',
    'How do I create a new timesheet?',
    'Creating and submitting a weekly timesheet.',
    `# How do I create a new timesheet?

1. Go to **Timesheets**.
2. Click **New Timesheet**.
3. Choose the correct timesheet type when prompted.
4. Select the week ending date.
5. Complete each day with hours, job details, and remarks as required.
6. Add your signature if required.
7. Save a draft or submit.

If a timesheet already exists for that week and type, open the existing record instead of creating a duplicate.`,
    0
  ),
  article(
    'timesheets',
    'timesheet-types',
    'What timesheet types are available?',
    'Understanding different timesheet forms such as civils and plant.',
    `# What timesheet types are available?

SQUIRES can show more than one timesheet form type, such as civils and plant styles, depending on your role and admin configuration.

Choose the correct type when creating a timesheet so job fields, plant details, and approval routing stay accurate. Admins can configure type exceptions in Admin Settings when a person needs a non-default form.`,
    1
  ),
  article(
    'timesheets',
    'timesheet-job-numbers',
    'How do job numbers work on timesheets?',
    'Entering job numbers and related day details.',
    `# How do job numbers work on timesheets?

When completing a day on your timesheet, enter the job number or job reference used for that work.

Accurate job numbers help managers review labour against quotes, project numbers, and payroll reports. Add remarks when the job reference alone is not enough context.`,
    2
  ),
  article(
    'timesheets',
    'edit-timesheet',
    'How do I edit a timesheet?',
    'Editing draft or returned timesheets.',
    `# How do I edit a timesheet?

1. Open **Timesheets**.
2. Select the timesheet.
3. Edit days, hours, job details, or remarks.
4. Save draft or resubmit.

Submitted timesheets may be locked until a manager returns them. Approved timesheets normally cannot be edited by the employee.`,
    3
  ),
  article(
    'timesheets',
    'timesheet-statuses',
    'What do timesheet statuses mean?',
    'Draft, submitted, approved, and related statuses.',
    `# What do timesheet statuses mean?

Common statuses include:

- **Draft** - saved but not submitted
- **Submitted** - waiting for manager review
- **Approved** - accepted for payroll/processing
- **Rejected** or returned statuses - needs correction and resubmission

Check Approvals if you are a manager reviewing submitted timesheets.`,
    4
  ),
  article(
    'timesheets',
    'timesheet-pdf-download',
    'How do I download a timesheet PDF?',
    'Downloading a timesheet PDF copy.',
    `# How do I download a timesheet PDF?

Open the timesheet and use the PDF download action when available. Managers can also export wider timesheet and payroll reports from **Reports**.`,
    5
  ),
  article(
    'timesheets',
    'delete-timesheet',
    'How do I delete a timesheet?',
    'Deleting a draft timesheet when allowed.',
    `# How do I delete a timesheet?

Draft timesheets can usually be deleted by the owner or a manager with permission. Submitted or approved timesheets follow the approval process instead of simple deletion.

If you cannot delete a record, ask a manager to review it in Approvals.`,
    6
  ),
  article(
    'timesheets',
    'timesheet-filters',
    'How do I filter timesheets?',
    'Using timesheet list filters.',
    `# How do I filter timesheets?

On the Timesheets page, use the available filters to narrow by status, week, employee, or type depending on your permissions.

Managers typically see more employees and filter options than employees reviewing their own records.`,
    7
  ),
  article(
    'timesheets',
    'create-timesheet-for-employee',
    'How do I create a timesheet for an employee? (Managers)',
    'Managers creating timesheets on behalf of employees.',
    `# How do I create a timesheet for an employee? (Managers)

Managers with permission can create or complete timesheets for employees when needed.

1. Open **Timesheets**.
2. Start a new timesheet.
3. Select the employee if the form allows it.
4. Complete the week and submit or leave as draft according to your process.

Use this when supporting payroll cut-off or correcting a missed submission.`,
    8
  ),
  article(
    'inspections',
    'create-inspection',
    'How do I perform a van daily check?',
    'Step-by-step guide to completing a van daily check.',
    `# How do I perform a van daily check?

1. Go to **Van Daily Checks**.
2. Click **New Daily Check**.
3. Select the van and week ending date.
4. Enter the current mileage.
5. Complete each daily checklist tab.
6. Add required comments for any failed item.
7. Save a draft or submit the check.

Failed items can create workshop follow-up for managers.`,
    0
  ),
  article(
    'inspections',
    'inspection-defects',
    'What happens when I report a van defect?',
    'How failed van check items become trackable workshop work.',
    `# What happens when I report a van defect?

When you mark a van daily check item as **Fail**, the app records the defect with your comments.

Defects can be reviewed in daily check reports and workshop workflows. Add practical detail such as what is wrong, which side is affected, and whether the vehicle can still be used safely.`,
    1
  ),
  article(
    'inspections',
    'inspection-checklists',
    'What items are on the van daily check?',
    'Summary of the van daily check checklist.',
    `# What items are on the van daily check?

Typical van checklist areas include fluids and leaks, wheels and tyres, windows and wipers, mirrors, body condition, lights, gauges and horn, seat belt, interior condition, locking devices, steering, and brakes.

Plant and HGV checks have their own modules because their forms and compliance needs are different.`,
    2
  ),
  article(
    'inspections',
    'inspection-statuses',
    'What do van daily check statuses mean?',
    'Draft and submitted van daily check statuses.',
    `# What do van daily check statuses mean?

## Draft

Saved but not submitted. You can return to finish it.

## Submitted

Submitted for review. Defects are available for manager and workshop follow-up.

Daily checks do not use the same approval workflow as timesheets.`,
    3
  ),
  article(
    'inspections',
    'add-vehicle-inspection',
    'How do I add a van during a daily check?',
    'Adding a van that is not yet in the daily check list.',
    `# How do I add a van during a daily check?

If the van is missing from the selector and your permissions allow it, use the add option in the van selector. Enter the registration or identifier carefully.

If you cannot add a van, ask a manager or admin with Fleet access to create the asset first.`,
    4
  ),
  article(
    'inspections',
    'duplicate-inspection',
    'Why can I not create a van daily check?',
    'Understanding duplicate daily check prevention.',
    `# Why can I not create a van daily check?

The app prevents duplicate daily checks for the same van and reporting period.

Check for an existing draft, confirm the van and week ending, and open the existing check instead of creating a second one.`,
    5
  ),
  article(
    'inspections',
    'van-checks-vs-plant-hgv',
    'How are van, plant, and HGV daily checks different?',
    'When to use each daily check module.',
    `# How are van, plant, and HGV daily checks different?

- **Van Daily Checks** - vans and light vehicles
- **Plant Daily Checks** - plant machinery and hours/meter readings
- **HGV Daily Checks** - HGVs and HGV compliance items

Use the module that matches the asset. Fleet history and workshop defects remain linked to the correct asset type.`,
    6
  ),
  article(
    'plant-daily-checks',
    'create-plant-daily-check',
    'How do I complete a plant daily check?',
    'Step-by-step guide to completing a plant machinery daily check.',
    `# How do I complete a plant daily check?

1. Go to **Plant Daily Checks**.
2. Click **New Plant Daily Check**.
3. Select the plant item.
4. Enter the required meter or hours reading.
5. Complete the checklist.
6. Add a comment for any failed item.
7. Save a draft or submit.`,
    0
  ),
  article(
    'plant-daily-checks',
    'plant-check-history',
    'Where do I find plant check history?',
    'Reviewing submitted plant checks and fleet history.',
    `# Where do I find plant check history?

Open **Plant Daily Checks** for draft and submitted checks. Managers can also review longer-term plant history in **Fleet**.`,
    1
  ),
  article(
    'plant-daily-checks',
    'plant-check-defects',
    'What happens when I report a plant defect?',
    'Plant daily check defects and workshop follow-up.',
    `# What happens when I report a plant defect?

Mark failed checklist items clearly and describe the fault. Plant defects can feed workshop or maintenance follow-up after manager review.`,
    2
  ),
  article(
    'plant-daily-checks',
    'plant-check-hours-readings',
    'How do plant hours or meter readings work?',
    'Entering hours/meter values on plant daily checks.',
    `# How do plant hours or meter readings work?

Enter the current hours or meter reading when completing a plant daily check. Accurate readings keep Fleet history and maintenance planning reliable.`,
    3
  ),
  article(
    'plant-daily-checks',
    'plant-check-draft-submit',
    'How do draft and submit work for plant checks?',
    'Saving plant check drafts and submitting completed checks.',
    `# How do draft and submit work for plant checks?

Save a **Draft** if you need to finish later. Submit only when the checklist and readings are complete. Submitted checks become part of the plant compliance history.`,
    4
  ),
  article(
    'hgv-daily-checks',
    'create-hgv-daily-check',
    'How do I complete an HGV daily check?',
    'Step-by-step guide to completing an HGV daily check.',
    `# How do I complete an HGV daily check?

1. Go to **HGV Daily Checks**.
2. Click **New HGV Daily Check**.
3. Select the HGV.
4. Enter the mileage or odometer reading.
5. Complete all required checklist items.
6. Add defect comments where needed.
7. Save a draft or submit.`,
    0
  ),
  article(
    'hgv-daily-checks',
    'hgv-mileage-history',
    'How is HGV mileage used?',
    'How HGV daily check mileage supports asset history.',
    `# How is HGV mileage used?

Mileage entered on HGV daily checks keeps the asset record current. Managers can review mileage movement with checks and maintenance history in **Fleet**.`,
    1
  ),
  article(
    'hgv-daily-checks',
    'hgv-check-defects',
    'What happens when I report an HGV defect?',
    'HGV daily check defects and follow-up.',
    `# What happens when I report an HGV defect?

Failed HGV checklist items are recorded with your comments and can create workshop follow-up. Include enough detail for a safe repair decision.`,
    2
  ),
  article(
    'hgv-daily-checks',
    'hgv-check-draft-submit',
    'How do draft and submit work for HGV checks?',
    'Saving HGV check drafts and submitting completed checks.',
    `# How do draft and submit work for HGV checks?

Save a draft to continue later. Submit when the mileage and checklist are complete so compliance history stays accurate.`,
    3
  ),
  article(
    'projects',
    'what-is-rams',
    'What are Projects documents?',
    'Overview of the Projects document and signature workflow.',
    `# What are Projects documents?

The **Projects** module is where project documents, including RAMS-style safety documents, are uploaded, assigned, read, and signed.

Employees view and sign assigned documents. Managers upload, assign, track signatures, and capture visitor signatures when needed.`,
    0
  ),
  article(
    'projects',
    'view-sign-rams',
    'How do I view and sign project documents?',
    'Reading and signing assigned project documents.',
    `# How do I view and sign project documents?

1. Go to **Projects**.
2. Open the document assigned to you.
3. Read the PDF.
4. Sign when you have read and understood it.

Pending documents may also appear on Dashboard badges.`,
    1
  ),
  article(
    'projects',
    'rams-visitor-signature',
    'How do visitors sign project documents?',
    'Recording visitor signatures for project document compliance.',
    `# How do visitors sign project documents?

1. Open the document in **Projects**.
2. Choose the visitor signature option.
3. Enter the visitor name.
4. Capture the signature.
5. Submit.

The app stores the visitor name, signature, timestamp, document, and the user who captured it.`,
    2
  ),
  article(
    'projects',
    'upload-rams-manager',
    'How do I upload project documents? (Managers)',
    'Uploading and assigning project documents.',
    `# How do I upload project documents? (Managers)

1. Go to **Projects**.
2. Open the management or settings area.
3. Upload the PDF.
4. Add a clear title and description.
5. Assign it to the users who need to sign.

Assigned users then see the document in Projects.`,
    3
  ),
  article(
    'projects',
    'project-document-types',
    'What kinds of project documents are used?',
    'Understanding project document types including RAMS-style files.',
    `# What kinds of project documents are used?

Projects commonly stores RAMS-style safety documents and related PDF project paperwork that must be read and signed before work.

Use clear titles so employees can recognise the correct document for the job or site.`,
    4
  ),
  article(
    'projects',
    'assign-project-documents',
    'How do I assign project documents to employees?',
    'Assigning project documents for signature.',
    `# How do I assign project documents to employees?

From Projects management, upload or open the document and assign the employees who must read and sign it. Track outstanding signatures from the Projects management views and Dashboard badges.`,
    5
  ),
  article(
    'absence',
    'request-absence',
    'How do I request absence or leave?',
    'Booking annual leave or other absence.',
    `# How do I request absence or leave?

1. Open **Absence**.
2. Create a new absence or leave request.
3. Choose the dates and reason.
4. Submit for approval.

Managers review requests in Approvals or Absence manage views.`,
    0
  ),
  article(
    'absence',
    'absence-calendar',
    'How does the absence calendar work?',
    'Viewing leave on the absence calendar.',
    `# How does the absence calendar work?

The absence calendar shows booked and requested leave so teams can see coverage. Managers with manage access can review wider team calendars from Absence management.`,
    1
  ),
  article(
    'absence',
    'cancel-absence',
    'How do I cancel an absence request?',
    'Cancelling leave that is still allowed to change.',
    `# How do I cancel an absence request?

Open the absence record and use the cancel action while your permissions and the request status allow it. If the booking is locked after approval, ask a manager to review it.`,
    2
  ),
  article(
    'absence',
    'absence-management',
    'How do managers manage absence?',
    'Using Absence manage tools for calendars, allowances, and reasons.',
    `# How do managers manage absence?

Managers with access can open Absence management tools to review calendars, work shifts, allowances, reasons, and overview information.

Use these tools to process bookings, check remaining allowance, and keep leave reasons consistent.`,
    3
  ),
  article(
    'absence',
    'absence-reports',
    'What absence reports are available?',
    'Overview of absence and leave reports in the Reports hub.',
    `# What absence reports are available?

Open **Reports** → **Absence & Leave** for:

- **Absence & Leave Bookings**
- **Absence Allowance Snapshot**
- **Absence Weekly Print Sheet**

Set the date controls before downloading.`,
    4
  ),
  article(
    'absence',
    'absence-allowance-year',
    'How do absence allowances and leave years work?',
    'Understanding allowance totals and leave-year snapshots.',
    `# How do absence allowances and leave years work?

Managers can review allowance totals and snapshots from Absence management and the **Absence Allowance Snapshot** report.

Allowance figures help confirm remaining leave before approving new bookings. Use the snapshot date carefully when exporting totals.`,
    5
  ),
  article(
    'absence',
    'manager-absence-settings',
    'How do manager absence settings work?',
    'Reasons, shifts, and manage-side absence configuration.',
    `# How do manager absence settings work?

In Absence management, managers can maintain reasons, work-shift information, and related settings that control how bookings are recorded and reported.

Keep reasons clear so Approvals and Reports stay consistent.`,
    6
  ),
];
