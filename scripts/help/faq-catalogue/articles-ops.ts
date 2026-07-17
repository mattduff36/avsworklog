import { article, type FAQArticleDef } from './types';

export const OPS_ARTICLES: FAQArticleDef[] = [
  article(
    'maintenance',
    'maintenance-overview',
    'What is Maintenance?',
    'Overview of the Maintenance page and service schedule checks.',
    `# What is Maintenance?

Maintenance shows service, MOT, tax, and other due-date or mileage-based checks for assets you can access.

The page highlights overdue items, items due soon, and current maintenance status. Fleet asset management and history are covered under **Fleet**. Workshop repairs are covered under **Workshop Tasks**.`,
    0
  ),
  article(
    'maintenance',
    'view-maintenance',
    'How do I view maintenance status?',
    'Understanding overdue and due-soon maintenance status.',
    `# How do I view maintenance status?

Open **Maintenance** to review asset maintenance status.

Common status colours:

- **Green** - OK
- **Amber** - due soon
- **Red** - overdue
- **Grey** - not applicable or not tracked`,
    1
  ),
  article(
    'maintenance',
    'maintenance-settings',
    'How do I configure maintenance settings? (Managers)',
    'Configure maintenance thresholds and tracked categories.',
    `# How do I configure maintenance settings? (Managers)

Managers with Maintenance access can configure warning periods, tracked categories, and related thresholds so due-soon and overdue states match company process.`,
    2
  ),
  article(
    'maintenance',
    'update-maintenance-record',
    'How do I update a maintenance record?',
    'Recording completed maintenance or service updates.',
    `# How do I update a maintenance record?

Open the relevant maintenance item or linked Fleet asset and record the completed service, MOT, tax, or inspection update. Accurate dates and mileage keep future due status correct.`,
    3
  ),
  article(
    'maintenance',
    'maintenance-vs-workshop',
    'What is the difference between Maintenance and Workshop Tasks?',
    'When to use Maintenance versus Workshop Tasks.',
    `# What is the difference between Maintenance and Workshop Tasks?

- **Maintenance** - planned due dates and compliance schedules such as service, MOT, and tax
- **Workshop Tasks** - repair jobs and defect follow-up work

A failed daily check often creates workshop work, while Maintenance tracks recurring schedule obligations.`,
    4
  ),
  article(
    'fleet',
    'fleet-overview',
    'What is Fleet?',
    'Overview of fleet assets including vans, plant, and HGVs.',
    `# What is Fleet?

**Fleet** is the asset register for vans, plant, and HGVs.

Use it to review asset details, categories, inactive assets, and history. Inventory locations for vans, HGVs, and plant can link back to these Fleet records.`,
    0
  ),
  article(
    'fleet',
    'fleet-asset-history',
    'How do I view asset history?',
    'Reviewing checks, maintenance, and repair history for an asset.',
    `# How do I view asset history?

Open **Fleet**, select the asset, and open its history views. History can include daily checks, mileage or hours, maintenance, and workshop activity.`,
    1
  ),
  article(
    'fleet',
    'manage-vehicles',
    'How do I manage fleet assets? (Admin)',
    'Creating and editing vans, plant, and HGVs.',
    `# How do I manage fleet assets? (Admin)

Admins with Fleet access can create and edit assets, update identifiers such as registration, and keep categories and active/inactive status current.

Accurate Fleet records keep daily checks and inventory vehicle locations working correctly.`,
    2
  ),
  article(
    'fleet',
    'vehicle-categories',
    'How do I manage fleet categories?',
    'Organising fleet assets with categories.',
    `# How do I manage fleet categories?

Use Fleet category management to group assets consistently. Clear categories make filters, reports, and daily-check selectors easier to use.`,
    3
  ),
  article(
    'fleet',
    'fleet-vans-plant-hgv-tabs',
    'How are vans, plant, and HGVs organised in Fleet?',
    'Using Fleet tabs for different asset types.',
    `# How are vans, plant, and HGVs organised in Fleet?

Fleet separates vans, plant, and HGVs so each asset type keeps the right fields and history. Open the relevant tab or filter before adding or editing an asset.`,
    4
  ),
  article(
    'fleet',
    'fleet-inactive-assets',
    'How do inactive fleet assets work?',
    'Hiding or retiring assets that are no longer in use.',
    `# How do inactive fleet assets work?

Mark assets inactive when they leave the working fleet so they stop appearing in day-to-day selectors. History remains available for audit and review.`,
    5
  ),
  article(
    'workshop-tasks',
    'workshop-overview',
    'What is Workshop Tasks?',
    'Overview of workshop repair and defect task tracking.',
    `# What is Workshop Tasks?

**Workshop Tasks** tracks repair jobs and defect follow-up for fleet assets.

Tasks can come from daily-check defects or be created directly by managers. Use statuses, categories, and comments to follow a job through to completion.`,
    0
  ),
  article(
    'workshop-tasks',
    'view-workshop-tasks',
    'How do I view workshop tasks?',
    'Finding and filtering workshop tasks.',
    `# How do I view workshop tasks?

Open **Workshop Tasks** and use the list filters to find open, in-progress, or completed work. Open a task for details, comments, and linked asset information.`,
    1
  ),
  article(
    'workshop-tasks',
    'create-workshop-task',
    'How do I create a workshop task?',
    'Creating a repair or defect follow-up task.',
    `# How do I create a workshop task?

1. Open **Workshop Tasks**.
2. Create a new task.
3. Select the asset and category.
4. Describe the fault or work required.
5. Save the task.

Tasks may also be created from failed daily-check defects.`,
    2
  ),
  article(
    'workshop-tasks',
    'update-workshop-task',
    'How do I update a workshop task?',
    'Changing status and details on a workshop task.',
    `# How do I update a workshop task?

Open the task, update the status and details, and save. Keep the status current so managers can see what is logged, waiting, in progress, or complete.`,
    3
  ),
  article(
    'workshop-tasks',
    'workshop-comments',
    'How do workshop comments work?',
    'Adding progress notes to workshop tasks.',
    `# How do workshop comments work?

Open a workshop task and add comments to record diagnosis, parts waiting, or completion notes. Comments keep the repair history clear for the next person who opens the task.`,
    4
  ),
  article(
    'workshop-tasks',
    'workshop-categories',
    'How do workshop categories work?',
    'Organising workshop tasks by category.',
    `# How do workshop categories work?

Workshop categories group repair types so lists and filters stay useful. Choose the closest category when creating a task, and ask a manager to adjust categories if the list needs updating.`,
    5
  ),
  article(
    'workshop-tasks',
    'workshop-from-plant-hgv-defects',
    'How do daily-check defects become workshop tasks?',
    'Following van, plant, or HGV defects into workshop work.',
    `# How do daily-check defects become workshop tasks?

When a van, plant, or HGV daily check records a failed item, managers can create or update a linked Workshop Task.

Use the defect comments from the check as the starting point, then track repair progress in Workshop Tasks.`,
    6
  ),
  article(
    'approvals',
    'approvals-overview',
    'What is Approvals?',
    'Overview of manager approval queues.',
    `# What is Approvals?

**Approvals** is where managers review submitted timesheets and absence requests.

Open Approvals from the Dashboard or navigation, then work through the pending items for each type.`,
    0
  ),
  article(
    'approvals',
    'approve-timesheet',
    'How do I approve a timesheet?',
    'Reviewing and approving submitted timesheets.',
    `# How do I approve a timesheet?

1. Open **Approvals**.
2. Select the timesheet queue.
3. Open a submitted timesheet.
4. Approve it, or return/reject it with a clear reason.

Approved timesheets feed payroll and timesheet reports.`,
    1
  ),
  article(
    'approvals',
    'approve-absence',
    'How do I approve an absence request?',
    'Reviewing and approving leave requests.',
    `# How do I approve an absence request?

1. Open **Approvals**.
2. Select the absence queue.
3. Check dates, reason, and remaining allowance where shown.
4. Approve or decline with a clear reason.`,
    2
  ),
  article(
    'approvals',
    'process-timesheet-payroll',
    'How do approvals relate to payroll reports?',
    'Using approved timesheets with payroll exports.',
    `# How do approvals relate to payroll reports?

Timesheets generally need to be approved before they are ready for payroll processing. After approval, managers with Reports access can use **Payroll Export** and related timesheet reports.`,
    3
  ),
  article(
    'actions',
    'actions-overview',
    'What is the Manager Actions Hub?',
    'Overview of the manager actions summary pages.',
    `# What is the Manager Actions Hub?

**Actions** provides manager summary pages for outstanding items across key workflows.

Use it as a quick launch point into the modules that still need attention. Some older action views are retained for compatibility while day-to-day work happens in the dedicated modules.`,
    0
  ),
  article(
    'toolbox-talks',
    'toolbox-talks-overview',
    'What are Toolbox Talks?',
    'Overview of toolbox talk messages and acknowledgements.',
    `# What are Toolbox Talks?

Toolbox Talks are safety or briefing messages sent to employees who must acknowledge them.

Managers create talks, target recipients, and track acknowledgements. Employees receive them through notifications and message views.`,
    0
  ),
  article(
    'toolbox-talks',
    'create-toolbox-talk',
    'How do I create a toolbox talk?',
    'Sending a toolbox talk to employees.',
    `# How do I create a toolbox talk?

1. Open **Toolbox Talks**.
2. Create a new toolbox talk.
3. Enter the title and message.
4. Choose the recipients.
5. Send the talk.

Track acknowledgements after sending.`,
    1
  ),
  article(
    'toolbox-talks',
    'create-reminder',
    'How do I create a toolbox reminder message?',
    'Sending reminder-style toolbox messages.',
    `# How do I create a toolbox reminder message?

From Toolbox Talks, create a reminder-style message when you need recipients to acknowledge a short instruction or notice.

This is different from the personal **Reminders** module, which tracks assigned task reminders for a user.`,
    2
  ),
  article(
    'toolbox-talks',
    'toolbox-reports',
    'How do I track Toolbox Talk signatures?',
    'Reviewing toolbox talk acknowledgement reports.',
    `# How do I track Toolbox Talk signatures?

Use Toolbox Talks reporting or acknowledgement views to see who has signed or still needs to respond. Follow up on outstanding recipients before the related work starts.`,
    3
  ),
  article(
    'toolbox-talks',
    'acknowledge-toolbox-talk',
    'How do I acknowledge a toolbox talk?',
    'Employee acknowledgement of a toolbox talk message.',
    `# How do I acknowledge a toolbox talk?

Open the toolbox talk from your notifications or messages, read it, and submit your acknowledgement or signature when prompted.

Outstanding talks may also appear as badges until completed.`,
    4
  ),
  article(
    'reminders',
    'reminders-overview',
    'What is the Reminders module?',
    'Personal task reminders assigned in the app.',
    `# What is the Reminders module?

**Reminders** shows personal task reminders assigned to you, such as checks or follow-up actions.

This is separate from Toolbox Talk reminder messages. If you have no items, you will see **No pending reminders**.`,
    0
  ),
  article(
    'reminders',
    'action-assigned-reminder',
    'How do assigned reminders work?',
    'Understanding reminders assigned to you.',
    `# How do assigned reminders work?

Reminders can show badges such as **Assigned to you** and due text like **Check required** or a days-remaining count.

Open the reminder and use its task link when provided to go straight to the work that needs completing.`,
    1
  ),
  article(
    'reminders',
    'complete-reminder',
    'How do I complete a reminder?',
    'Clearing a personal reminder by finishing the linked task.',
    `# How do I complete a reminder?

Open the reminder and complete the linked task in the relevant module, such as an inventory check or other assigned action.

When the underlying work is done, the reminder leaves your pending list.`,
    2
  ),
  article(
    'reports',
    'reports-overview',
    'What reports can I download?',
    'Overview of the Reports hub and current report groups.',
    `# What reports can I download?

Open **Reports** → **Overview** and choose a group:

- **Timesheets** - Weekly Timesheet Summary, Payroll Export
- **Daily Checks** - Daily Checks Compliance Summary, Daily Checks Defects Log, bulk PDFs
- **Absence & Leave** - bookings, allowance snapshot, weekly print sheet
- **Quotes** - Quotes Conversion Funnel
- **More Reports** - future report placeholders

Use **Settings** on the Reports page for report preferences where available.`,
    0
  ),
  article(
    'reports',
    'bulk-pdf-download',
    'How do I bulk download daily check PDFs?',
    'Downloading multiple daily check PDFs from Reports.',
    `# How do I bulk download daily check PDFs?

1. Open **Reports**.
2. Choose **Daily Checks**.
3. Use the bulk PDF download report/action.
4. Set the date range and filters.
5. Download the PDF pack.`,
    1
  ),
  article(
    'reports',
    'suggest-report',
    'How do I suggest a new report?',
    'Requesting an additional report from the Reports hub.',
    `# How do I suggest a new report?

In **Reports**, use the suggest/more-reports path to submit a report idea. Managers who review suggestions can also triage these from **Suggestions**.`,
    2
  ),
  article(
    'reports',
    'timesheet-payroll-report',
    'How do I download the payroll export?',
    'Using the Payroll Export timesheet report.',
    `# How do I download the payroll export?

1. Open **Reports**.
2. Choose **Timesheets**.
3. Open **Payroll Export**.
4. Set the date range.
5. Download the export.

Approve timesheets first when your payroll process depends on approved records.`,
    3
  ),
  article(
    'reports',
    'daily-checks-compliance-report',
    'How do daily checks compliance and defects reports work?',
    'Compliance summary and defects log reports.',
    `# How do daily checks compliance and defects reports work?

Under **Reports** → **Daily Checks** you can run:

- **Daily Checks Compliance Summary** - who has completed required checks
- **Daily Checks Defects Log** - recorded defects for follow-up

Use these with Workshop Tasks when repairs are needed.`,
    4
  ),
  article(
    'reports',
    'absence-weekly-print',
    'How do I print the weekly absence sheet?',
    'Using the Absence Weekly Print Sheet report.',
    `# How do I print the weekly absence sheet?

1. Open **Reports** → **Absence & Leave**.
2. Choose **Absence Weekly Print Sheet**.
3. Set the week/date controls.
4. Download the printable PDF.`,
    5
  ),
  article(
    'reports',
    'quotes-conversion-funnel-report',
    'How does the Quotes Conversion Funnel report work?',
    'Reviewing quote conversion performance.',
    `# How does the Quotes Conversion Funnel report work?

Open **Reports** → **Quotes** → **Quotes Conversion Funnel**.

Use it to review how quotes move through commercial stages over the selected period. This complements the Quotes module lists and financial summaries.`,
    6
  ),
  article(
    'suggestions',
    'suggestions-manage-overview',
    'How do I manage suggestions?',
    'Using Manage Suggestions to review user ideas.',
    `# How do I manage suggestions?

Open **Suggestions** / **Manage Suggestions** to review ideas submitted from Help or Reports.

Open a row to see **Suggestion Details**, then update its status as you triage it.`,
    0
  ),
  article(
    'suggestions',
    'triage-suggestion',
    'How do I triage a suggestion?',
    'Reviewing and updating a suggestion.',
    `# How do I triage a suggestion?

1. Open **Manage Suggestions**.
2. Open the suggestion.
3. Review the details.
4. Move it to the correct status and add any internal notes your process uses.

Keep users informed through the status change rather than leaving items in **New** indefinitely.`,
    1
  ),
  article(
    'suggestions',
    'suggestion-statuses',
    'What do suggestion statuses mean?',
    'New, Under Review, Planned, Completed, and Declined.',
    `# What do suggestion statuses mean?

- **New** - just submitted
- **Under Review** - being assessed
- **Planned** - accepted for future work
- **Completed** - delivered
- **Declined** - not going ahead`,
    2
  ),
];
