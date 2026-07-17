import { article, type FAQArticleDef } from './types';

export const INVENTORY_ARTICLES: FAQArticleDef[] = [
  article(
    'inventory',
    'inventory-overview',
    'What is Inventory?',
    'Overview of small tools, minor plant, hardware stock, locations, checks, and Yard kiosk.',
    `# What is Inventory?

Inventory tracks small tools, minor plant, hardware stock, and where items are located across the yard, vans, HGVs, plant, and sites.

## Manager and admin view

Open **Inventory**. You will see three main tabs:

- **Overview** - Small Tools, Minor Plant, Hardware, and Retired Items
- **Locations** - yard, vehicle, site, and manual locations
- **Settings** - Categories, Groups, Hardware Catalogue, and Yard Kiosks

Use **Add Item**, **Add Location**, and **Set My Location** from the page actions when available.

## Employee view

Employees do not see the full manager tabs. Instead they set a location, view **My Inventory Items**, optionally work with a secondary **Site** location, transfer **Hardware**, and **Claim An Item**.

## Related tools

The dedicated **Yard Inventory** kiosk at \`/yard-kiosk\` is used on trusted tablets to collect from or return stock to the Yard.`,
    0
  ),
  article(
    'inventory',
    'inventory-employee-view',
    'How do I use Inventory as an employee?',
    'Employee inventory workflow: location, items, hardware transfer, and claims.',
    `# How do I use Inventory as an employee?

1. Open **Inventory**.
2. Use **Set Your Inventory Location** or **Change My Location** to choose where you are working.
3. Review **My Inventory Items** for tools assigned to your location.
4. If a secondary site is assigned, review the **Site** section as well.
5. Use **Hardware** and **Transfer** when you need to move hardware stock.
6. Use **Claim An Item** when an item should be on your location but is not listed.

If your location is missing from the list, choose **Location not shown** and follow the prompt so a manager can help.`,
    1
  ),
  article(
    'inventory',
    'inventory-select-location',
    'How do I select my inventory location or site?',
    'Setting your primary inventory location and using secondary site locations.',
    `# How do I select my inventory location or site?

## Primary location

Use **Set Your Inventory Location** or **Change My Location**, choose the correct Yard, van, HGV, plant, site, or manual location, then click **Save Location**.

Your primary location controls which items appear under **My Inventory Items**.

## Secondary site locations

Managers can assign site locations under **Site Location Assignments** with **Assign Site**. When assigned, employees may also see a **Site** section with a **Secondary Location** badge.

Managers can optionally include **legacy quotes** when choosing site locations.`,
    2
  ),
  article(
    'inventory',
    'inventory-item-types',
    'What are Small Tools, Minor Plant, and Hardware?',
    'How the three inventory stock types differ.',
    `# What are Small Tools, Minor Plant, and Hardware?

On the Inventory **Overview** tab:

## Small Tools

Individual tracked tools and equipment. They can be moved between locations, checked on an interval, grouped, and retired.

## Minor Plant

Smaller plant-style assets that can also be linked with fleet plant workflows. Managers can use actions such as **Move to Plant Assets** when an item should become a fleet plant record.

## Hardware

Quantity-based stock from the **Hardware Catalogue**. Hardware is managed in the **Hardware Stock Matrix** with add, remove, recount, and transfer actions rather than one record per unit.

## Retired Items

Items that have been retired leave the active lists and appear under **Retired Items**.`,
    3
  ),
  article(
    'inventory',
    'inventory-add-edit-item',
    'How do I add or edit an inventory item?',
    'Creating and updating small tools or minor plant items.',
    `# How do I add or edit an inventory item?

Managers and admins with Inventory access can:

1. Open **Inventory** → **Overview**.
2. Choose **Small Tools** or **Minor Plant**.
3. Click **Add Item** to create a new record, or open an existing item to edit it.
4. Enter the name, category, group, location, and check settings as required.
5. Save the item.

Open an item detail page from the list to review **Overview**, **Movements**, and **Checks**.`,
    4
  ),
  article(
    'inventory',
    'inventory-item-detail',
    'How do I use an item detail page?',
    'Overview, movements, checks, and PDFs on an inventory item.',
    `# How do I use an item detail page?

Open an item from Inventory to go to its detail page.

## Tabs

- **Overview** - item details, current location, and status
- **Movements** - history of location and stock changes
- **Checks** - checklist history and check PDFs where available

Use this page to confirm where an item is, when it last moved, and whether checks are up to date.`,
    5
  ),
  article(
    'inventory',
    'inventory-locations',
    'How do inventory locations work?',
    'Location types, Yard, Unknown, fleet links, and site buckets.',
    `# How do inventory locations work?

Locations describe where stock currently is.

## Location types

- **Yard** - main yard stock location
- **Unknown** - items whose location is not confirmed
- **Van**, **HGV**, **Plant** - fleet-linked locations
- **Site** - site or quote/project linked locations
- **Manual** - manually created locations

## Managing locations

Managers use the **Locations** tab to review and maintain locations, including **Add Location**.

Fleet-linked locations stay aligned with vans, HGVs, and plant assets. Site locations can come from quotes, project numbers, or legacy quotes when that option is enabled.`,
    6
  ),
  article(
    'inventory',
    'inventory-location-types',
    'What inventory location types exist?',
    'Yard, Unknown, Van, HGV, Plant, Site, and Manual explained.',
    `# What inventory location types exist?

- **Yard** - default yard location for stock held on site
- **Unknown** - temporary holding place when a location is unclear
- **Van** - linked to a fleet van
- **HGV** - linked to a fleet HGV
- **Plant** - linked to a fleet plant asset
- **Site** - site, quote, project, or legacy quote location
- **Manual** - custom location created by a manager

Choosing the correct type keeps employee views, Yard kiosk transfers, and reports accurate.`,
    7
  ),
  article(
    'inventory',
    'inventory-manage-locations',
    'How do I manage inventory locations?',
    'Using the Locations tab and adding locations.',
    `# How do I manage inventory locations?

1. Open **Inventory** → **Locations**.
2. Review existing Yard, vehicle, site, and manual locations.
3. Click **Add Location** when a new bucket is needed.
4. Keep names clear so employees can recognise them in **Change My Location**.

Use **Site Location Assignments** when employees need a secondary site location in addition to their primary location.`,
    8
  ),
  article(
    'inventory',
    'inventory-site-assignments',
    'How do site location assignments work?',
    'Assigning secondary site locations to employees.',
    `# How do site location assignments work?

Managers with site-location permission can open **Site Location Assignments** in Inventory.

## Typical actions

- Choose an employee
- Click **Assign Site**
- Select the site location
- Optionally include **legacy quotes** when the required site comes from a legacy quote location

Assigned employees then see a **Site** section with a **Secondary Location** badge alongside their primary inventory location.`,
    9
  ),
  article(
    'inventory',
    'inventory-move-item',
    'How do I move an item between locations?',
    'Moving single items or bulk-selected items.',
    `# How do I move an item between locations?

## Single item

Open the item and use the move action to choose the destination location, or use the move controls from the Overview list.

## Bulk move

1. Open **Overview** → **Small Tools** or **Minor Plant**.
2. Select the items.
3. Click **Move Selected**.
4. Choose the destination location and confirm.

Keep destination names accurate so Yard kiosk and employee views stay correct.`,
    10
  ),
  article(
    'inventory',
    'inventory-movements',
    'How do inventory movements work?',
    'Understanding movement history on inventory items.',
    `# How do inventory movements work?

Every meaningful location or stock change is recorded as a movement.

Open an item → **Movements** to see:

- When the item moved
- From and to locations
- Who recorded the change
- Related notes or reasons where available

Hardware transfers and Yard kiosk collect/return actions also create movement history.`,
    11
  ),
  article(
    'inventory',
    'inventory-complete-check',
    'How do I complete an inventory check?',
    'Running checklist checks on inventory items.',
    `# How do I complete an inventory check?

1. Open the item from Inventory.
2. Go to the **Checks** tab or start the check action shown for due items.
3. Set the **Check Date**.
4. Mark each checklist line as **Pass**, **Fail**, or **N/A**.
5. Review the overall result: **Pass**, **Fail**, or **Partial**.
6. Click **Submit Check**.

Some items show **Check required before leaving Yard**. Complete those checks before moving the item away from the Yard.`,
    12
  ),
  article(
    'inventory',
    'inventory-check-statuses',
    'What do inventory check statuses mean?',
    'Ok, Due Soon, Overdue, Needs Check, and No Check Required.',
    `# What do inventory check statuses mean?

Use the **Check Status** filter on Overview lists.

- **Ok** - check is current
- **Due Soon** - check interval is approaching
- **Overdue** - check is past due
- **Needs Check** - a check is required now
- **No Check Required** - the item is not on a check interval

Keep overdue and needs-check items up to date before they leave the Yard or go to site.`,
    13
  ),
  article(
    'inventory',
    'inventory-check-intervals',
    'How do inventory check intervals work?',
    'Configuring how often items need checks.',
    `# How do inventory check intervals work?

Managers set check intervals on items that need periodic inspection.

The interval drives the check status badges:

- current checks stay **Ok**
- approaching due dates become **Due Soon**
- missed intervals become **Overdue** or **Needs Check**

Items without an interval show **No Check Required**.`,
    14
  ),
  article(
    'inventory',
    'inventory-retire-item',
    'How do I retire an inventory item?',
    'Retiring items with Sold, Scrapped, Lost, Damaged, Returned, or Other.',
    `# How do I retire an inventory item?

1. Open the item from Inventory.
2. Choose the retire action.
3. Select a reason: **Sold**, **Scrapped**, **Lost**, **Damaged**, **Returned**, or **Other**.
4. Confirm that the item should move to **Retired Items**.

Retired items leave the active Small Tools / Minor Plant lists but remain available under **Retired Items** for history and restore when needed.`,
    15
  ),
  article(
    'inventory',
    'inventory-retired-tab',
    'How do I view retired inventory items?',
    'Using the Retired Items overview tab.',
    `# How do I view retired inventory items?

1. Open **Inventory** → **Overview**.
2. Select **Retired Items**.
3. Filter by **Retire Reason** if needed.
4. Open an item to review its history or restore it when the business process allows.

Use this tab for sold, scrapped, lost, damaged, returned, or other retired stock.`,
    16
  ),
  article(
    'inventory',
    'inventory-hardware-catalogue',
    'How do I manage the Hardware catalogue and stock?',
    'Hardware Catalogue settings and the Hardware Stock Matrix.',
    `# How do I manage the Hardware catalogue and stock?

## Catalogue

Open **Inventory** → **Settings** → **Hardware Catalogue** to maintain the hardware items that can be stocked.

## Stock matrix

Open **Overview** → **Hardware** to use the **Hardware Stock Matrix**.

Managers can:

- **Add stock**
- **Remove** / **Remove stock**
- **Recount**

Common reasons include **Delivery**, **Return**, **Used**, **Lost**, **Scrapped**, **Damaged**, **Stocktake correction**, and **Other**.`,
    17
  ),
  article(
    'inventory',
    'inventory-hardware-stock-adjust',
    'How do I adjust Hardware quantities?',
    'Add, remove, and recount hardware stock with reasons.',
    `# How do I adjust Hardware quantities?

1. Open **Inventory** → **Overview** → **Hardware**.
2. Find the hardware row and location in the **Hardware Stock Matrix**.
3. Choose **Add stock**, **Remove**, or **Recount**.
4. Enter the quantity and a reason.
5. Confirm the adjustment.

Employees normally transfer hardware rather than adjusting catalogue totals. Manager adjustments should match a delivery, usage, loss, or stocktake correction.`,
    18
  ),
  article(
    'inventory',
    'inventory-hardware-transfer',
    'How do I transfer Hardware stock?',
    'Employee and manager hardware transfers between locations.',
    `# How do I transfer Hardware stock?

1. Open **Inventory**.
2. Find the **Hardware** section for your location, or open **Overview** → **Hardware** as a manager.
3. Click **Transfer**.
4. Choose the destination location and quantity.
5. Confirm the transfer.

Yard tablet users can also move hardware through the **Yard Inventory** kiosk using **Collect** or **Return**.`,
    19
  ),
  article(
    'inventory',
    'inventory-manage-categories',
    'How do I manage inventory categories?',
    'Using Inventory Settings → Categories.',
    `# How do I manage inventory categories?

1. Open **Inventory** → **Settings** → **Categories**.
2. Add or edit categories used to organise Small Tools and Minor Plant.
3. Keep category names short and consistent so filters and reports stay useful.

Categories help managers search and group items without changing an item's physical location.`,
    20
  ),
  article(
    'inventory',
    'inventory-manage-groups',
    'How do I manage inventory groups?',
    'Using Inventory Settings → Groups for batch organisation.',
    `# How do I manage inventory groups?

1. Open **Inventory** → **Settings** → **Groups**.
2. Create or edit groups used to organise related items.
3. Assign items to groups when creating or editing them.

Groups make bulk moves and filtering easier when several tools belong together.`,
    21
  ),
  article(
    'inventory',
    'inventory-kiosk-devices',
    'How do Yard kiosk devices work?',
    'Pairing trusted Yard Inventory tablets and managing devices.',
    `# How do Yard kiosk devices work?

Yard kiosk tablets use a trusted-device flow so stock can be collected or returned without the full manager Inventory UI.

## Pair a device

1. Open **Inventory** → **Settings** → **Yard Kiosks**.
2. Click **Start pairing**.
3. On the tablet, open the Yard Inventory pair page and enter the **Pairing code**.
4. Confirm the code in Inventory Settings.

## Install the app

Use **Install Yard Inventory** / **Add to Home screen** on the tablet so it launches like an app.

## After pairing

Trusted devices can open **Yard Inventory** and run **Collect** or **Return** transfers.`,
    22
  ),
  article(
    'inventory',
    'inventory-yard-kiosk-use',
    'How do I use the Yard Inventory kiosk?',
    'Collect and Return flows on a trusted Yard tablet.',
    `# How do I use the Yard Inventory kiosk?

On a paired Yard tablet:

1. Open **Yard Inventory**.
2. Choose **Collect** to start a collection, or **Return** to start a return.
3. Follow the steps: choose direction, choose destination or source, choose stock, review the basket.
4. Confirm with **Confirm transfer**.

## Labels to expect

- **Collecting for** / **Destination** when taking stock from the Yard
- **Returning from** when bringing stock back

When the transfer completes, the basket items move and Inventory movement history is updated.`,
    23
  ),
  article(
    'inventory',
    'inventory-fleet-asset-link',
    'How do fleet asset links affect inventory?',
    'How vans, HGVs, and plant link to inventory locations.',
    `# How do fleet asset links affect inventory?

Van, HGV, and Plant inventory locations are linked to Fleet assets.

That means:

- Employee location lists can include the vehicles and plant they use
- Moves to a van, HGV, or plant location stay aligned with Fleet records
- Minor Plant can be moved into Plant Assets when an item should become a fleet plant record

If a vehicle or plant asset is missing, ask a manager with Fleet access to create or update it first.`,
    24
  ),
  article(
    'inventory',
    'inventory-view-assigned-items',
    'How do I view items on my van or site?',
    'Finding items assigned to your current inventory locations.',
    `# How do I view items on my van or site?

1. Open **Inventory**.
2. Confirm your primary location under **Change My Location**.
3. Review **My Inventory Items** for that location.
4. If you have a secondary site assignment, review the **Site** section as well.

Use search and filters where available. If an item should be present but is missing, use **Claim An Item** or ask a manager to move it.`,
    25
  ),
];
