---
name: Squires
description: Dark operational workspace with AVS yellow identity and module-aware accents
colors:
  avs-yellow: "hsl(48 87% 69%)"
  avs-yellow-hover: "hsl(48 73% 56%)"
  canvas: "hsl(222 47% 11%)"
  surface: "hsl(217 33% 17%)"
  text: "hsl(210 40% 98%)"
  text-muted: "hsl(215 20% 65%)"
  success: "hsl(142 71% 45%)"
  warning: "hsl(38 92% 50%)"
  error: "hsl(0 84% 60%)"
  timesheets: "hsl(210 90% 50%)"
  inspections: "hsl(33 95% 55%)"
  plant: "hsl(25 90% 45%)"
  hgv: "hsl(18 95% 38%)"
  projects: "hsl(142 76% 36%)"
  absence: "hsl(260 60% 50%)"
  fleet: "hsl(190 70% 42%)"
  workshop: "hsl(13 37% 48%)"
  inventory: "hsl(226 8.47% 39.3%)"
  reminders: "hsl(187 85% 42%)"
  reports: "hsl(150 70% 45%)"
typography:
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.avs-yellow}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.25rem"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "2.25rem"
  card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
---

# Design System: Squires

## Overview

**Creative North Star: "The Operational Control Room"**

The incumbent Squires interface is a dark, role-aware workspace designed to keep workforce and asset operations visible under varied working conditions. AVS yellow identifies the product, while module colours act as functional wayfinding rather than decoration. The system favours familiar controls, compact information density, and durable high-contrast surfaces.

The visual language is practical and restrained: slate layers establish hierarchy, cards organise records, and status colours call attention to action or exception. The redesign may evolve structure and rhythm, but the recognisable yellow-on-slate identity and module mapping are durable brand commitments.

**Key Characteristics:**
- Dark-only slate canvas with a fixed diagonal tonal gradient
- Rare, high-contrast AVS yellow for identity and primary action
- Module accents for navigation, tabs, focus, and record context
- Inter typography and conventional product controls
- Rounded, bordered surfaces with compact operational density

## Colors

The palette combines cool dark slate layers with one warm brand signal and a controlled set of module accents.

### Primary
- **AVS Signal Yellow:** Identifies Squires, carries the primary action, focus ring, and brand navigation state.

### Secondary
- **Module Signals:** Blue, orange, green, violet, cyan, rust, and neutral-indigo accents identify operational modules. They are contextual wayfinding, not a decorative rainbow.

### Tertiary
- **Operational States:** Green indicates success, amber indicates warning or pending attention, and red indicates error, destructive action, or critical maintenance state.

### Neutral
- **Night Canvas:** The page background and deepest card surface.
- **Slate Work Surface:** Toolbars, secondary panels, controls, and borders.
- **Signal White:** Primary text.
- **Muted Steel:** Supporting text and metadata.

**The One Signal Rule.** A screen has one dominant accent: AVS yellow for brand surfaces or the active module colour for module surfaces.

## Typography

**Display Font:** Inter (with system-ui fallback)  
**Body Font:** Inter (with system-ui fallback)

**Character:** Neutral, compact, and highly legible. The type should disappear into the task rather than advertise itself.

### Hierarchy
- **Title** (700, 1.875rem, 1.2): Page identity and the highest level within application chrome.
- **Section title** (600, 1.25rem, 1.3): Major workflow regions and grouped records.
- **Body** (400, 1rem, 1.5): Instructions, values, and readable supporting content.
- **Label** (500, 0.875rem, 1.25): Controls, table headings, metadata, and status.

**The Readable Baseline Rule.** Responsive layouts restructure before typography shrinks; mobile text remains readable without a global scale reduction.

## Layout

The incumbent application uses a fixed top navigation, an optional manager/admin sidebar, and centred content containers up to 80rem. Pages commonly use a 1.5rem vertical rhythm and responsive card or table layouts. Mobile surfaces collapse navigation and stack actions.

Future work should keep an eight-point spacing rhythm, prioritise persistent access to primary actions, and make responsive changes structural: rails collapse, toolbars wrap, and dense tables gain focused mobile representations.

## Elevation & Depth

Depth is primarily tonal and structural. Slate surface changes and borders separate regions; low shadows support overlays and selected interactive surfaces. Frosted transparency appears in the incumbent top navigation.

**The Flat-by-Default Rule.** A resting content region earns hierarchy through tone and spacing. Shadows are reserved for overlays, menus, and active elevation.

## Shapes

Controls and surfaces use gently rounded corners, normally between 0.375rem and 0.625rem. Borders are quiet and low contrast. Pills are reserved for statuses, counts, and compact filters rather than general containers.

## Components

### Buttons
- **Shape:** Compact rounded rectangle with a 2.25rem default height.
- **Primary:** Active module colour or AVS yellow with a contrast-safe foreground.
- **Hover / Focus:** Small tonal shift and a visible one-pixel focus ring.
- **Secondary / Ghost:** Slate surface or transparent background with clear hover state.

### Chips
- **Style:** Tinted semantic or module background with a concise text label.
- **State:** Selected chips gain stronger contrast and a visible edge; status chips are not clickable unless they use button semantics.

### Cards / Containers
- **Corner Style:** Gently rounded.
- **Background:** Night canvas or slate work surface.
- **Shadow Strategy:** Flat by default.
- **Border:** One-pixel slate divider.
- **Internal Padding:** Usually 1rem to 1.5rem.

### Inputs / Fields
- **Style:** Slate surface, visible border, rounded corners, high-contrast value, muted placeholder.
- **Focus:** Module-aware ring and border shift.
- **Error / Disabled:** Explicit message or state icon in addition to colour.

### Navigation
- Use persistent, familiar product navigation with icon plus label where space permits. Active state combines colour, shape, and text; module colour may reinforce context but cannot be the sole indicator.

## Do's and Don'ts

### Do:
- **Do** reserve AVS yellow for brand identity, focus, and high-priority action.
- **Do** use the active module colour consistently across its navigation, primary action, selected tab, and loading state.
- **Do** expose clear loading, empty, error, and disabled states.
- **Do** favour scanable alignment and compact density for operational data.

### Don't:
- **Don't** nest decorative cards merely to create spacing.
- **Don't** use several saturated module colours at equal strength on one screen.
- **Don't** hide primary workflow actions below long content on common laptop or mobile viewports.
- **Don't** globally shrink mobile typography to make a desktop layout fit.
