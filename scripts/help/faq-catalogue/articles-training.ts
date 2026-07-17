import { article, type FAQArticleDef } from './types';

export const TRAINING_ARTICLES: FAQArticleDef[] = [
  article(
    'training',
    'training-overview',
    'What is Training?',
    'Overview of training records, people, qualifications, and notes.',
    `# What is Training?

Open **Training** to track employee and subcontractor training records, cards, qualifications, and expiry dates.

## Tabs

- **Overview** - Active Records, Expired, Expiring Soon, Needs Review, Priority Training Records, and Import Health
- **Records** - filterable training records
- **People** - training people and profile links
- **Qualifications** - qualification catalogue
- **Notes** - Workbook Notes

Use **Add Record**, **Refresh**, and **Export XLSX** from the page actions.`,
    0
  ),
  article(
    'training',
    'training-records-filters',
    'How do I filter training records?',
    'Using Records filters such as Expired and Expiring 90 Days.',
    `# How do I filter training records?

Open **Training** → **Records** and choose a filter:

- **All Active**
- **Expired**
- **Expiring 90 Days**
- **No Expiry**
- **Needs NVQ**
- **Awaiting Card**
- **Training Booked**
- **Manual Review**
- **Subcontractors**
- **Unlinked People**
- **Archived**

Badges such as **No expiry**, **Needs review**, and **Archived** help you scan the list quickly.`,
    1
  ),
  article(
    'training',
    'add-training-record',
    'How do I add or edit a training record?',
    'Creating and updating training records.',
    `# How do I add or edit a training record?

1. Open **Training**.
2. Click **Add Record**, or open a record and click **Edit**.
3. Enter the person, qualification/card details, dates, and review flags.
4. Save the record.

Use **Archive** when a record should leave the active lists but remain available under the Archived filter.`,
    2
  ),
  article(
    'training',
    'manage-training-people',
    'How do I manage training people and link profiles?',
    'Editing training people and match status.',
    `# How do I manage training people and link profiles?

Open **Training** → **People**.

1. Open a person from **Training People**.
2. Use **Edit Training Person**.
3. Review **Name**, **Profile ID**, **Match Status**, **Match Notes**, **DOB Values**, and **Source Sheets**.
4. Click **Save Changes**.

Match statuses include **Matched**, **Ambiguous**, **Unmatched**, and **Not Attempted**. Records may show **No person link** until a profile is linked.`,
    3
  ),
  article(
    'training',
    'manage-training-qualifications',
    'How do I manage qualifications?',
    'Using the Qualification Catalogue.',
    `# How do I manage qualifications?

Open **Training** → **Qualifications** to use the **Qualification Catalogue**.

Qualification statuses can include:

- **Needs Manual Review**
- **Plant/Card Category**
- **Standardised / Spelling Corrected**
- **Note Mixed With Qualification**

Use the status filter, including **All statuses**, to clean imported qualification names.`,
    4
  ),
  article(
    'training',
    'training-expiry-alerts',
    'How do expiry and expiring in 90 days work?',
    'Understanding expired and expiring-soon training records.',
    `# How do expiry and expiring in 90 days work?

Training Overview highlights:

- **Expired**
- **Expiring Soon**
- **Needs Review**

On Records, use **Expired** and **Expiring 90 Days** to prioritise renewals. Import Health also surfaces issues such as No expiry, Needs NVQ, Awaiting card, Training booked, and Unlinked people.`,
    5
  ),
  article(
    'training',
    'training-workbook-notes',
    'What are workbook notes?',
    'Using the Workbook Notes tab.',
    `# What are workbook notes?

Open **Training** → **Notes** to review **Workbook Notes**.

These are read-only notes imported with training workbooks. Search the table by type, sheet/cell, value, or reason when cleaning data or investigating match issues.`,
    6
  ),
  article(
    'training',
    'export-training-data',
    'How do I export training data?',
    'Using Export XLSX from Training.',
    `# How do I export training data?

1. Open **Training**.
2. Apply any filters you need on Records or related views.
3. Click **Export XLSX**.

Use the export for offline review, audits, or sharing a snapshot with managers who need a spreadsheet.`,
    7
  ),
];
