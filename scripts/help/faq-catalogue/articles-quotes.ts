import { article, type FAQArticleDef } from './types';

export const QUOTES_ARTICLES: FAQArticleDef[] = [
  article(
    'quotes',
    'quotes-overview',
    'How do I create and track quotes?',
    'Overview of the Quotes module tabs, workflow, billing, and settings.',
    `# How do I create and track quotes?

Open **Quotes** after unlocking with your sensitive PIN if prompted.

## Main tabs

- **Overview** - quote thread and financial summary views
- **Current** - active quotes
- **Projects** - project numbers and cost tracking
- **Archived** - archived quotes
- **Legacy** - imported legacy quotes
- **Settings** - notifications, managers, emails, schedule, templates, and admin tools

## Common actions

- Click **New Quote** to create a quote
- Open a quote to use **Overview**, **Workflow**, **Invoices**, **Attachments**, **Timeline**, and **Versions**
- Use **Work Calendar** for scheduled quoted work

Quotes move through draft, approval, customer outcome, PO/acceptance, progress, completion, invoicing, and archive stages.`,
    0
  ),
  article(
    'quotes',
    'quote-sensitive-access',
    'Why do Quotes ask for a sensitive PIN?',
    'Understanding the Quotes sensitive-module PIN unlock.',
    `# Why do Quotes ask for a sensitive PIN?

Quotes is a sensitive module. When the session is locked you will see a prompt such as **Quotes locked. Enter your sensitive PIN to continue.**

Enter your sensitive PIN to unlock Quotes for the current session. Customers uses the same sensitive-access pattern.

If you do not know your PIN, ask an admin to reset or issue it through the normal user administration process.`,
    1
  ),
  article(
    'quotes',
    'create-quote',
    'How do I create a quote?',
    'Creating a new customer quotation.',
    `# How do I create a quote?

1. Open **Quotes**.
2. Unlock with your sensitive PIN if required.
3. Click **New Quote**.
4. Select or create the customer.
5. Enter quote details, manager/reference information, and line items or pricing attachments.
6. Save the quote as **Draft** until it is ready for internal confirmation.

Keep customer details and titles clear so Overview, Projects, and reports stay accurate.`,
    2
  ),
  article(
    'quotes',
    'quote-line-items',
    'How do line items and totals work?',
    'Adding priced lines and understanding quote totals.',
    `# How do line items and totals work?

When creating or editing a quote, add line items for the priced work.

Line items feed the quote total and later financial summary. Some quotes may also use attachment-based pricing; in that case keep the attachments clear under the **Attachments** tab and ensure the commercial total still reflects the agreed value.`,
    3
  ),
  article(
    'quotes',
    'quote-attachments',
    'How do quote attachments work?',
    'Internal and client-facing quote attachments.',
    `# How do quote attachments work?

Open a quote → **Attachments**.

Use attachments for:

- Customer-facing pricing or supporting documents
- Internal-only files that should not be treated as client pricing

Keep filenames clear and upload the latest revision when a quote version changes.`,
    4
  ),
  article(
    'quotes',
    'quote-statuses',
    'What do quote statuses mean?',
    'Draft through invoiced and archived status labels.',
    `# What do quote statuses mean?

Common status labels include:

- **Draft** - still being prepared
- **Pending Confirmation** - waiting for internal confirmation
- **Approved** / **Changes Requested** / **Confirmed** - internal review outcome
- **Won** / **Lost** - customer outcome
- **Accepted** - PO or acceptance recorded
- **In Progress** - work has started
- **Completed In Part** / **Completed In Full** - completion state
- **Ready To Invoice**, **Partially Invoiced**, **Invoiced** - billing state
- **Archived** - closed archive state

Unknown imported values may show as **Legacy Status**.`,
    5
  ),
  article(
    'quotes',
    'quote-internal-approval',
    'How does internal quote approval work?',
    'Moving a quote through pending confirmation and approval.',
    `# How does internal quote approval work?

Use the quote **Workflow** tab to move a draft through internal review.

Typical path:

1. Submit or mark the quote for confirmation so it becomes **Pending Confirmation**.
2. An authorised manager reviews it.
3. The quote becomes **Approved**, **Changes Requested**, or continues to **Confirmed** according to your process.

Use Timeline and Versions if the commercial detail changes during review.`,
    6
  ),
  article(
    'quotes',
    'send-quote',
    'How do I send a quote to a customer?',
    'Sending customer quote emails from the workflow.',
    `# How do I send a quote to a customer?

1. Open the quote.
2. Go to **Workflow**.
3. Use the send-to-customer action when the quote is ready.
4. Confirm the customer contact and any CC rules from **Settings** → **Emails**.

Email templates and notification toggles are managed under Quotes **Settings**.`,
    7
  ),
  article(
    'quotes',
    'quote-outcome',
    'How do I record won, lost, or changes requested?',
    'Recording customer outcomes on a quote.',
    `# How do I record won, lost, or changes requested?

From the quote **Workflow** tab, record the customer outcome:

- **Won** - customer accepted commercially
- **Lost** - customer declined
- **Changes Requested** - customer asked for revisions

If changes are needed, update the quote or create a new version, then continue the workflow.`,
    8
  ),
  article(
    'quotes',
    'quote-po-received',
    'How do PO numbers and Accepted status work?',
    'Recording purchase orders and acceptance.',
    `# How do PO numbers and Accepted status work?

When a customer issues a purchase order or formal acceptance:

1. Open the quote **Workflow** tab.
2. Use **Request PO** if you are chasing a PO.
3. Record the PO / acceptance details when received.
4. The quote can move to **Accepted**.

Filters such as **With PO** and **No PO** help managers review outstanding acceptances.`,
    9
  ),
  article(
    'quotes',
    'quote-schedule-progress',
    'How do schedule and in-progress work?',
    'Start dates, start alerts, and In Progress status.',
    `# How do schedule and in-progress work?

After acceptance, set or confirm the planned start details from **Workflow**.

- Schedule defaults and start-alert behaviour are configured under **Settings** → **Schedule**
- When work starts, the quote can move to **In Progress**
- Use **Work Calendar** to see planned quoted work across dates

Start alerts notify the configured recipients when a start is approaching or due.`,
    10
  ),
  article(
    'quotes',
    'quote-completion',
    'How do I complete a quote in part or in full?',
    'Approve in part or in full completion outcomes.',
    `# How do I complete a quote in part or in full?

From **Workflow**, choose the completion outcome:

- **Approve in part** → **Completed In Part**
- **Approve in full** → **Completed In Full**

Partial completion is useful when some works are finished and ready to bill while other works continue.`,
    11
  ),
  article(
    'quotes',
    'archive-quote',
    'How do I archive or restore a quote?',
    'Archiving completed quotes and restoring when needed.',
    `# How do I archive or restore a quote?

Use **Archive Quote** from the quote actions when the record should leave the current lists.

Archived quotes appear under the **Archived** tab. Use **Restore Quote** when the quote needs to return to the active workflow.`,
    12
  ),
  article(
    'quotes',
    'quote-versions',
    'How do quote versions and threads work?',
    'Revisions, extras, variations, and version history.',
    `# How do quote versions and threads work?

Open a quote → **Versions**.

Versions are used for revisions, extras, variations, future work, or duplicates linked to the same commercial thread. Each version keeps its own notes and history while Overview can summarise the thread.

Use a new version when the commercial scope changes instead of overwriting the agreed record without a trail.`,
    13
  ),
  article(
    'quotes',
    'quote-invoice-request',
    'How do I request an invoice?',
    'Marking a quote ready to invoice or requesting another invoice.',
    `# How do I request an invoice?

1. Open the quote → **Invoices**.
2. Click **Mark Ready To Invoice** or **Request Another Invoice**.
3. Choose **Invoice in full** or **Partial invoice**.
4. Confirm the request.

The Invoices tab shows **Pending Requested** and **Available To Request**. Use **Retract request** if a pending request was raised in error.`,
    14
  ),
  article(
    'quotes',
    'quote-add-invoice',
    'How do Accounts add invoice details?',
    'Recording invoice details against a pending request.',
    `# How do Accounts add invoice details?

1. Open the quote → **Invoices**.
2. Review the **Pending Request**.
3. Click **Add Invoice Details**.
4. Enter the invoice information and confirm it matches the manager request when prompted.

Recorded invoices update billing status such as **Partially Invoiced** or **Invoiced**.`,
    15
  ),
  article(
    'quotes',
    'quote-billing-statuses',
    'What do quote billing statuses mean?',
    'Not billed, ready, part billed, and fully billed filters.',
    `# What do quote billing statuses mean?

Billing filters and labels include:

- **Not billed** - no invoice progress yet
- **Ready to invoice** / **Ready To Invoice** - waiting for invoice action
- **Part billed** / **Partially Invoiced** - some value invoiced
- **Fully billed** / **Invoiced** - fully invoiced

Use these filters on quote lists to find work that still needs Accounts attention.`,
    16
  ),
  article(
    'quotes',
    'quote-sage-status',
    'How does Sage status work on quotes?',
    'Tracking whether a quote is on Sage.',
    `# How does Sage status work on quotes?

Quotes can be tracked as **On Sage** or **Not on Sage**.

Use the Sage marker when the quote or related billing has been entered in Sage. List filters help managers separate records that still need Sage updates.`,
    17
  ),
  article(
    'quotes',
    'quote-financial-adjustments',
    'How do financial adjustments work?',
    'Credit notes, refunds, voids, write-offs, and related adjustments.',
    `# How do financial adjustments work?

Managers with access can open **Quotes** → **Settings** → **Admin Tools** and use the **Financial Adjustment Ledger**.

## Adjustment types

- **Credit note**
- **Refund**
- **Debit adjustment**
- **Void invoice**
- **Correct invoice details**
- **Correct quote value**
- **Write off remaining value**

History can also show **Reversed** entries.

## Metrics

The ledger summarises values such as **Adjusted quote**, **Net invoiced**, **Credits & voids**, **Refunded cash**, and **Written off**.

Attach supporting documents where the process requires them.`,
    18
  ),
  article(
    'quotes',
    'quote-financial-summary',
    'How do I read the financial summary on a quote?',
    'Understanding quote value, invoices, and adjustments together.',
    `# How do I read the financial summary on a quote?

Open the quote Overview or thread overview to review the financial summary.

Use it to compare:

- Original / adjusted quote value
- Invoices already recorded
- Pending invoice requests
- Credits, voids, refunds, and write-offs from financial adjustments

This is the quickest way to see what remains available to request or bill.`,
    19
  ),
  article(
    'quotes',
    'quotes-overview-tab',
    'How do I use the Quotes Overview tab?',
    'Using Overview for quote threads and summaries.',
    `# How do I use the Quotes Overview tab?

The **Overview** tab helps managers review quote threads and financial summaries rather than only working from a flat current list.

Open a reference overview when you need labour, costs, and billing context together. You can also open overview routes by quote reference when following up from reports or messages.`,
    20
  ),
  article(
    'quotes',
    'quote-overview-by-reference',
    'How do I open a quote overview by reference?',
    'Using the quote overview reference page.',
    `# How do I open a quote overview by reference?

Use the quote overview page for a reference when you need the full thread summary.

From Quotes Overview, open the relevant reference, or navigate to the overview route for that quote reference. This view is useful for labour, costs, and financial context across related versions.`,
    21
  ),
  article(
    'quotes',
    'quote-project-numbers',
    'How do project numbers work?',
    'Creating and tracking project numbers linked to quotes.',
    `# How do project numbers work?

Open **Quotes** → **Projects**.

## Typical actions

- Click **New Project Number**
- Complete **Create Project Number**
- Track project status badges such as open, linked, converted, or cancelled
- Record costs in categories such as materials, subcontractor, plant, labour, and other

Project numbers help connect quoted work, site delivery, and cost tracking.`,
    22
  ),
  article(
    'quotes',
    'legacy-quotes',
    'What is the Legacy Quotes tab?',
    'Reviewing imported legacy quote records.',
    `# What is the Legacy Quotes tab?

Open **Quotes** → **Legacy** to review imported legacy quotes.

These records may show **Legacy Status** when the old status does not map cleanly to the current workflow. Use Legacy for history and reference; create or continue current quotes in the **Current** tab for new work.`,
    23
  ),
  article(
    'quotes',
    'quotes-work-calendar',
    'What is the quotes work calendar?',
    'Using Quote Work Calendar for planned quoted work.',
    `# What is the quotes work calendar?

Click **Work Calendar** from Quotes, or open the Quote Work Calendar page.

The calendar shows planned or scheduled work linked to accepted and in-progress quotes. Use it to:

- See upcoming starts
- Avoid clashes
- Review quote-related work by date

Access still requires Quotes permission and sensitive PIN unlock when the module is locked.`,
    24
  ),
  article(
    'quotes',
    'quote-settings-notifications',
    'How do quote notification settings work?',
    'Turning quote notifications on or off.',
    `# How do quote notification settings work?

Open **Quotes** → **Settings** → **Notifications**.

Use these controls to decide which quote events create notifications for the people who need them, such as approvals, customer sends, PO requests, start alerts, and invoice activity.`,
    25
  ),
  article(
    'quotes',
    'quote-settings-managers',
    'How do I manage quote managers?',
    'Manager initials, number series, and sign-off settings.',
    `# How do I manage quote managers?

Open **Quotes** → **Settings** → **Managers**.

Configure the managers who own quote numbering, initials, and sign-off behaviour. Current and Archived lists can also filter by manager chips once managers are set up.`,
    26
  ),
  article(
    'quotes',
    'quote-settings-sending',
    'How do quote email and CC settings work?',
    'Configuring email CC behaviour for quote events.',
    `# How do quote email and CC settings work?

Open **Quotes** → **Settings** → **Emails**.

Set the CC matrix for events such as customer quote send, PO request, RAMS request, start alert, **Invoice Request**, and **Invoice Added**.

This keeps Accounts and managers copied on the right messages without changing each send manually.`,
    27
  ),
  article(
    'quotes',
    'quote-settings-schedule',
    'How do quote schedule settings work?',
    'Start alert and duration defaults for quoted work.',
    `# How do quote schedule settings work?

Open **Quotes** → **Settings** → **Schedule**.

Configure start-alert timing and duration defaults used when quotes are accepted and scheduled. These defaults support the Work Calendar and start notifications.`,
    28
  ),
  article(
    'quotes',
    'quote-settings-templates',
    'How do quote email templates work?',
    'Managing quote notification and email templates.',
    `# How do quote email templates work?

Open **Quotes** → **Settings** → **Templates**.

Templates control the wording used for customer and internal quote emails. Update templates when your commercial process or contact wording changes, then test with a known quote before sending widely.`,
    29
  ),
  article(
    'quotes',
    'quote-settings-admin-tools',
    'What are Quotes admin tools?',
    'Admin Tools including the financial adjustment ledger.',
    `# What are Quotes admin tools?

Open **Quotes** → **Settings** → **Admin Tools**.

This area contains higher-risk commercial tools, including the **Financial Adjustment Ledger** for credit notes, refunds, voids, write-offs, and value corrections.

Only use admin tools when the commercial or Accounts process requires a formal adjustment.`,
    30
  ),
  article(
    'quotes',
    'quote-rams-request',
    'How do I trigger a RAMS or project document request from a quote?',
    'Sending a RAMS request linked to quoted work.',
    `# How do I trigger a RAMS or project document request from a quote?

From the quote workflow actions, use **Trigger RAMS** or **Send RAMS Request** when project documents need to be raised for the accepted work.

This links the commercial quote process to the Projects document workflow so site paperwork can be prepared in time.`,
    31
  ),
];
