import { article, type FAQArticleDef } from './types';

export const ADMIN_ARTICLES: FAQArticleDef[] = [
  article(
    'customers',
    'customers-overview',
    'How do I manage customers?',
    'Overview of customer records, history, and settings.',
    `# How do I manage customers?

Open **Customers** after unlocking with your sensitive PIN if prompted.

## What you can do

- Use **Overview** to browse customers
- Click **Add Customer** to create a record
- Open a customer history page for detailed activity
- Use **Settings** for customer-related configuration such as default validity

Customer records feed Quotes, so keep company and contact details accurate.`,
    0
  ),
  article(
    'customers',
    'create-edit-customer',
    'How do I create or edit a customer?',
    'Adding and updating customer records.',
    `# How do I create or edit a customer?

1. Open **Customers**.
2. Click **Add Customer**, or open an existing customer to edit.
3. Enter company and contact details.
4. Save the record.

Accurate customer data keeps new quotes linked to the right organisation.`,
    1
  ),
  article(
    'customers',
    'customer-secondary-contacts',
    'How do secondary customer contacts work?',
    'Managing additional contacts on a customer.',
    `# How do secondary customer contacts work?

Customer records can store secondary contacts in addition to the primary contact.

Use secondary contacts when quotes or emails need alternative site or accounts recipients. Keep names and emails up to date before sending quotes.`,
    2
  ),
  article(
    'customers',
    'customer-history',
    'How do I view customer history?',
    'Opening a customer history page.',
    `# How do I view customer history?

From the Customers list, open the customer history page for that record. Use **Back to Customers** when you are finished.

History helps you review previous quote and customer activity before creating new work.`,
    3
  ),
  article(
    'customers',
    'customer-settings',
    'What are Customer Settings?',
    'Customer module settings and defaults.',
    `# What are Customer Settings?

Open **Customers** → **Settings** for customer-module configuration such as default quote validity and related defaults.

Use Settings when the commercial defaults should change for future customers or quotes.`,
    4
  ),
  article(
    'customers',
    'customer-default-validity',
    'How does default quote validity work?',
    'Setting default validity for customer quotes.',
    `# How does default quote validity work?

Customer settings can define a default validity period used when creating quotes.

Set a sensible default so new quotes expire consistently unless a manager overrides the value on the individual quote.`,
    5
  ),
  article(
    'admin-users',
    'user-management-overview',
    'How do I manage users? (Admin)',
    'Overview of user administration.',
    `# How do I manage users? (Admin)

Admins with User Management access can open **Users** to:

- Create users
- Edit profile details
- Reset passwords
- Assign roles
- Review user status
- Deactivate or delete accounts according to company process

Role and permission settings control which modules each user can access.`,
    0
  ),
  article(
    'admin-users',
    'create-user',
    'How do I create a user?',
    'Creating a new app user account.',
    `# How do I create a user?

1. Open **Users**.
2. Create a new user.
3. Enter name, email, and role/team details.
4. Save and issue the temporary password according to your process.`,
    1
  ),
  article(
    'admin-users',
    'edit-user',
    'How do I edit a user?',
    'Updating user profile and access details.',
    `# How do I edit a user?

Open the user from **Users**, update the profile or role details, and save. Changes to roles affect module visibility immediately after the user refreshes or signs in again.`,
    2
  ),
  article(
    'admin-users',
    'reset-user-password',
    'How do I reset a user password?',
    'Issuing a temporary password for a user.',
    `# How do I reset a user password?

From **Users**, open the account and use the reset-password action. Share the temporary password securely and ask the user to change it on next login.`,
    3
  ),
  article(
    'admin-users',
    'delete-user',
    'How do I delete or remove a user?',
    'Removing a user account when appropriate.',
    `# How do I delete or remove a user?

Use the delete or deactivate action available in User Management according to company process.

Prefer deactivation when you need to preserve history but stop sign-in. Use deletion only when your process allows permanent removal.`,
    4
  ),
  article(
    'admin-users',
    'deactivate-vs-delete-user',
    'Should I deactivate or delete a user?',
    'Choosing between deactivation and deletion.',
    `# Should I deactivate or delete a user?

- **Deactivate** - stops access while keeping history linked to the person
- **Delete** - removes the account when your process requires it

If you are unsure, deactivate first and confirm with your admin process before deleting.`,
    5
  ),
  article(
    'admin-roles',
    'roles-overview',
    'How do roles and permissions work?',
    'Understanding role-based module access.',
    `# How do roles and permissions work?

SQUIRES uses roles and team permissions to decide which modules a user can access.

Modules include Timesheets, Van/Plant/HGV Daily Checks, Projects, Absence, Maintenance, Fleet, Workshop Tasks, Inventory, Training, Reminders, Approvals, Actions, Toolbox Talks, Reports, Suggestions, Customers, Quotes, and admin tools.

FAQ categories use the same module names, so restricted FAQ content is only shown to users with matching access.`,
    0
  ),
  article(
    'admin-roles',
    'manage-roles',
    'How do I manage roles?',
    'Creating and editing roles and module permissions.',
    `# How do I manage roles?

Open Roles & Permissions from admin navigation, edit the role, and set module access levels. Keep employee roles narrow and grant manager/admin modules only where needed.`,
    1
  ),
  article(
    'admin-roles',
    'protected-roles',
    'What are protected roles?',
    'Understanding protected high-access roles.',
    `# What are protected roles?

Some roles or accounts are protected so they cannot be locked out or casually modified. Super Admin style accounts exist for recovery and system administration.

Take care when changing permissions on high-access roles.`,
    2
  ),
  article(
    'admin-roles',
    'team-permissions',
    'How do team permissions work?',
    'Using team-based module permissions.',
    `# How do team permissions work?

Teams can carry module permissions that combine with a user's role. Effective access is what the user can actually open after role and team permissions are applied.

Use View As when you need to confirm the resulting experience.`,
    3
  ),
  article(
    'admin-roles',
    'module-access-levels',
    'What do module access levels mean?',
    'Understanding permission access levels on modules.',
    `# What do module access levels mean?

Modules can be granted at different access levels depending on your permissions setup.

A user only sees navigation, pages, and FAQ content for modules they can access. Sensitive modules such as Quotes and Customers may still require a PIN after access is granted.`,
    4
  ),
  article(
    'admin-settings',
    'admin-settings-overview',
    'What is Admin Settings?',
    'Overview of admin-only configuration tools.',
    `# What is Admin Settings?

**Admin Settings** contains configuration that affects the wider app.

Current examples include display-board settings and timesheet type exceptions. Only admins with the Admin Settings permission can change these values.`,
    0
  ),
  article(
    'admin-settings',
    'display-board-settings',
    'How do display board settings work?',
    'Configuring the admin display board settings.',
    `# How do display board settings work?

Open **Admin Settings** and use the display board configuration card to control what the display board shows.

Save changes carefully because they can affect shared screens used by the team.`,
    1
  ),
  article(
    'admin-settings',
    'timesheet-type-exceptions',
    'How do timesheet type exceptions work?',
    'Giving selected users a non-default timesheet type.',
    `# How do timesheet type exceptions work?

Open **Admin Settings** and use the timesheet type exceptions controls to assign a non-default timesheet form to specific people.

Use this when one employee needs a different timesheet type from the normal role default.`,
    2
  ),
  article(
    'faq-editor',
    'faq-editor-overview',
    'How do I manage FAQ categories and articles?',
    'Using the FAQ Editor admin page.',
    `# How do I manage FAQ categories and articles?

Open **FAQ Editor** to create, edit, publish, and reorder FAQ categories and articles.

Article bodies use markdown. Keep formatting simple so the Help page renderer can display headings, lists, and emphasis correctly.`,
    0
  ),
  article(
    'faq-editor',
    'faq-visibility',
    'How does FAQ visibility work?',
    'Module gates that control which FAQ categories users see.',
    `# How does FAQ visibility work?

Each FAQ category can be public or gated to a module such as Inventory, Quotes, Training, or Reminders.

Users only receive gated FAQ content when they can access that module. Public categories such as Getting Started and Troubleshooting remain available more widely.`,
    1
  ),
  article(
    'faq-editor',
    'faq-sort-order',
    'How does FAQ sort order work?',
    'Ordering categories and articles on the Help page.',
    `# How does FAQ sort order work?

Categories and articles both have sort orders. Lower numbers appear first on **/help**.

Use consistent spacing in sort values when you expect to insert articles later.`,
    2
  ),
  article(
    'error-reports',
    'manage-error-reports',
    'How do I manage error reports? (Admin)',
    'Reviewing user-submitted error reports.',
    `# How do I manage error reports? (Admin)

Open the Error Reports admin page to review issues submitted from Help.

Use the report details, status, and notes to investigate, fix, or dismiss items according to your support process.`,
    0
  ),
  article(
    'error-reports',
    'error-report-statuses',
    'What do error report statuses mean?',
    'Tracking progress on submitted error reports.',
    `# What do error report statuses mean?

Error reports move through review statuses as admins investigate them.

Keep status current so the team can see which items are new, in progress, fixed, or closed.`,
    1
  ),
  article(
    'notifications',
    'notifications-overview',
    'How do notifications work?',
    'Overview of in-app notifications and messages.',
    `# How do notifications work?

SQUIRES sends in-app notifications for events such as approvals, toolbox talks, quote activity, reminders, and other module updates you can access.

Open Notifications from the app header or Dashboard badges, then acknowledge or act on each item.`,
    0
  ),
  article(
    'notifications',
    'notification-preferences',
    'How do notification preferences work?',
    'Understanding which notifications you receive.',
    `# How do notification preferences work?

Which notifications you receive depends on your role, module access, and module-specific settings such as Quotes notification and email CC settings.

If you are missing an expected notification, check that you have the module permission and that the module's notification settings include your role or email.`,
    1
  ),
  article(
    'notifications',
    'acknowledge-reminder',
    'How do I acknowledge a notification or reminder message?',
    'Clearing notifications and message acknowledgements.',
    `# How do I acknowledge a notification or reminder message?

Open the notification or message, read it, and use the acknowledge or open-task action provided.

Toolbox Talk acknowledgements and personal Reminders tasks are related but separate: one confirms a message, the other completes an assigned task.`,
    2
  ),
  article(
    'troubleshooting',
    'app-not-loading',
    'The app is not loading. What should I try?',
    'Basic recovery steps when the app will not load.',
    `# The app is not loading. What should I try?

1. Check your internet connection.
2. Refresh the page.
3. Sign out and sign back in.
4. Try another browser or device.
5. If you use the installed PWA, close it fully and reopen it.

If the problem continues, report it from Help with the page name and what you were doing.`,
    0
  ),
  article(
    'troubleshooting',
    'login-issues',
    'I cannot log in. What should I do?',
    'Fixes for common sign-in problems.',
    `# I cannot log in. What should I do?

- Confirm you are using your work email
- Check caps lock and password spelling
- Ask an admin to reset your password
- Confirm your account is still active

If the sign-in page itself errors, report it from another device if possible.`,
    1
  ),
  article(
    'troubleshooting',
    'data-not-saving',
    'My data is not saving. What should I check?',
    'Recovering from save or submit failures.',
    `# My data is not saving. What should I check?

1. Check your connection.
2. Look for validation messages on required fields.
3. Refresh and reopen the draft if one was saved.
4. Try again once.
5. Report the error from Help with the module name and record you were editing.`,
    2
  ),
  article(
    'troubleshooting',
    'permission-denied',
    'I am getting Access Denied - why?',
    'Why a page or FAQ article is hidden or blocked.',
    `# I am getting Access Denied - why?

Access Denied usually means your role or team does not include that module.

Examples:

- Inventory, Quotes, Training, or Reminders are module-gated
- Quotes and Customers also need the sensitive PIN after access is granted
- FAQ categories for restricted modules are hidden unless you can open the module

Ask a manager or admin to review your role permissions if you should have access.`,
    3
  ),
  article(
    'troubleshooting',
    'help-support-tools',
    'How do I report an error or suggest an improvement?',
    'Using Help error reporting and suggestions.',
    `# How do I report an error or suggest an improvement?

Open **Help** and use the Errors or Suggest tabs.

- Error reports go to admins for investigation
- Suggestions can be triaged in **Manage Suggestions**

Include the page name, what you expected, and what happened.`,
    4
  ),
  article(
    'troubleshooting',
    'offline-or-sync-issues',
    'What should I do if the app seems offline or out of date?',
    'Recovering from offline or stale PWA data.',
    `# What should I do if the app seems offline or out of date?

1. Confirm the device is online.
2. Refresh the page.
3. Close and reopen the installed app.
4. Sign out and back in if data still looks stale.

Installed PWAs can keep an older shell until refreshed, so a full reopen often helps.`,
    5
  ),
  article(
    'troubleshooting',
    'pwa-update-stuck',
    'The installed app will not update. What should I try?',
    'Forcing a PWA refresh when a new version is available.',
    `# The installed app will not update. What should I try?

1. Open the app and refresh.
2. Close the installed app completely from the device app switcher.
3. Reopen it from the home screen.
4. If needed, open the site in the browser, sign in, and reinstall from Help.

Yard Inventory kiosks have their own install page and may need the tablet-specific install/pair flow after updates.`,
    6
  ),
];
