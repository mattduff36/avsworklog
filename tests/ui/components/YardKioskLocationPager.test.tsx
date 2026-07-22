/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryLocationType } from '@/app/(dashboard)/inventory/types';
import { YardKioskLocationPager } from '@/app/yard-kiosk/components/YardKioskLocationPager';
import type { YardKioskLocation } from '@/lib/inventory/kiosk-types';
import type { YardKioskLocationUiState } from '@/lib/inventory/kiosk-remote-types';
import {
  getPinnedYardKioskLocationIds,
  getRecentYardKioskLocationIds,
} from '@/app/yard-kiosk/yard-kiosk-storage';

function createUiState(): YardKioskLocationUiState {
  return {
    query: '',
    active_filter: 'all',
    page_index: 0,
    include_legacy_quotes: false,
    recent_ids: getRecentYardKioskLocationIds(),
    pinned_ids: getPinnedYardKioskLocationIds(),
  };
}

function makeLocation(
  name: string,
  locationType: InventoryLocationType,
  options: Partial<YardKioskLocation> = {},
): YardKioskLocation {
  return {
    id: name.toLowerCase().replaceAll(' ', '-'),
    name,
    description: null,
    location_type: locationType,
    source_type: 'manual',
    external_reference: null,
    linked_asset_label: null,
    linked_asset_nickname: null,
    primary_user_names: [],
    secondary_user_names: [],
    ...options,
  };
}

function renderPager(locations: YardKioskLocation[]) {
  const onIncludeLegacyQuotesChange = vi.fn(async () => undefined);
  const result = render(
    <ControlledLocationPager
      locations={locations}
      onIncludeLegacyQuotesChange={onIncludeLegacyQuotesChange}
    />,
  );
  return { ...result, onIncludeLegacyQuotesChange };
}

function ControlledLocationPager({
  locations,
  direction = 'take',
  onIncludeLegacyQuotesChange = vi.fn(async () => undefined),
}: {
  locations: YardKioskLocation[];
  direction?: 'take' | 'return';
  onIncludeLegacyQuotesChange?: (enabled: boolean) => Promise<void>;
}) {
  const [uiState, setUiState] = useState(createUiState);
  return (
    <YardKioskLocationPager
      direction={direction}
      locations={locations}
      uiState={uiState}
      onUiStateChange={setUiState}
      onSelect={vi.fn()}
      onIncludeLegacyQuotesChange={onIncludeLegacyQuotesChange}
    />
  );
}

function LegacyLocationHarness({
  standardLocations,
  legacyLocation,
}: {
  standardLocations: YardKioskLocation[];
  legacyLocation: YardKioskLocation;
}) {
  const [locations, setLocations] = useState(standardLocations);
  const [uiState, setUiState] = useState(createUiState);

  return (
    <YardKioskLocationPager
      direction="take"
      locations={locations}
      uiState={uiState}
      onUiStateChange={setUiState}
      onSelect={vi.fn()}
      onIncludeLegacyQuotesChange={async (includeLegacyQuotes) => {
        setLocations(includeLegacyQuotes
          ? [...standardLocations, legacyLocation]
          : standardLocations);
      }}
    />
  );
}

describe('Yard kiosk location selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to All and filters structured Manual, Vans, and Sites categories', () => {
    renderPager([
      makeLocation('Manual Store', 'manual'),
      makeLocation('Van Alpha', 'van'),
      makeLocation('Site Bravo', 'site'),
      makeLocation('Plant Charlie', 'plant'),
    ]);

    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('button', { name: /^Manual Store/ })).toHaveClass(
      'bg-[hsl(var(--inventory-primary)/0.12)]',
    );
    expect(screen.getByRole('button', { name: /^Van Alpha/ })).toHaveClass(
      'bg-[hsl(var(--inspection-primary)/0.10)]',
      'focus-visible:ring-amber-300',
    );
    expect(screen.getByRole('button', { name: /^Site Bravo/ })).toHaveClass(
      'bg-[hsl(var(--avs-yellow)/0.10)]',
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    expect(screen.getByRole('button', { name: /^Manual Store/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Van Alpha/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Vans' }));
    expect(screen.getByRole('button', { name: /^Van Alpha/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Manual Store/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Sites' }));
    expect(screen.getByRole('button', { name: /^Site Bravo/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Plant Charlie/ })).not.toBeInTheDocument();
  });

  it('combines category filtering with location search and does not search assignee names', () => {
    renderPager([
      makeLocation('North Depot', 'site', {
        primary_user_names: ['Alice Young'],
      }),
      makeLocation('South Depot', 'site'),
      makeLocation('North Van', 'van'),
    ]);

    fireEvent.click(screen.getByRole('radio', { name: 'Sites' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), {
      target: { value: 'North' },
    });

    expect(screen.getByRole('button', { name: /^North Depot/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^South Depot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^North Van/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), {
      target: { value: 'Alice' },
    });
    expect(screen.getByText('No matching locations')).toBeInTheDocument();
  });

  it('shows labelled primary and secondary names while omitting empty groups', () => {
    renderPager([
      makeLocation('Assigned Site', 'site', {
        primary_user_names: ['Alice Young', 'Bob Zee'],
        secondary_user_names: ['Charlie Able', 'Diane West'],
      }),
      makeLocation('Unassigned Site', 'site'),
    ]);

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Alice Young, Bob Zee')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.getByText('Charlie Able, Diane West')).toBeInTheDocument();
    const unassignedTile = screen.getByRole('button', { name: /^Unassigned Site/ });
    expect(within(unassignedTile).queryByText('Primary')).not.toBeInTheDocument();
    expect(within(unassignedTile).queryByText('Secondary')).not.toBeInTheDocument();
  });

  it('resets the pager after filter, search, and legacy-inclusion changes', async () => {
    const locations = [
      ...Array.from({ length: 9 }, (_, index) => (
        makeLocation(`Manual ${index + 1}`, 'manual')
      )),
      makeLocation('Only Site', 'site'),
    ];
    const { onIncludeLegacyQuotesChange } = renderPager(locations);
    const navigation = screen.getByLabelText('Location page navigation');
    const previous = within(navigation).getByRole('button', { name: 'Previous location page' });
    const next = within(navigation).getByRole('button', { name: 'Next location page' });

    fireEvent.click(next);
    expect(previous).toBeEnabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Sites' }));
    expect(previous).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    fireEvent.click(next);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), {
      target: { value: 'Manual' },
    });
    expect(previous).toBeDisabled();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), {
      target: { value: '' },
    });
    fireEvent.click(next);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Include legacy locations' }));
    });
    expect(onIncludeLegacyQuotesChange).toHaveBeenCalledWith(true);
    expect(previous).toBeDisabled();
  });

  it('toggles canonical legacy sites with distinct state styling and pager reset', async () => {
    const pinnedSite = makeLocation('Pinned Site', 'site', { source_type: 'quote' });
    const standardLocations = [
      pinnedSite,
      ...Array.from({ length: 8 }, (_, index) => (
        makeLocation(`Current Site ${index + 1}`, 'site', { source_type: 'quote' })
      )),
    ];
    const legacyLocation = makeLocation('Historic Site', 'site', {
      source_type: 'legacy_quote',
      external_reference: 'LEGACY-100',
    });
    window.localStorage.setItem(
      'yard-kiosk:pinned-locations:v1',
      JSON.stringify([pinnedSite.id]),
    );
    render(
      <LegacyLocationHarness
        standardLocations={standardLocations}
        legacyLocation={legacyLocation}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Include legacy locations' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass(
      'border-white/10',
      'bg-transparent',
      'text-slate-500',
    );
    expect(screen.queryByRole('button', { name: /^Historic Site/ }))
      .not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Go to Pinned & recent' }))
        .toHaveAttribute('aria-current', 'page');
    });
    const navigation = screen.getByLabelText('Location page navigation');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Next location page' }));
    expect(within(navigation).getByRole('button', { name: 'Previous location page' }))
      .toBeEnabled();

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass(
      'border-amber-300/50',
      'bg-amber-300/10',
      'text-amber-100',
    );
    expect(screen.getByRole('button', { name: /^Historic Site/ })).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: 'Previous location page' }))
      .toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Sites' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), {
      target: { value: 'Historic' },
    });
    expect(screen.getByRole('button', { name: /^Historic Site/ })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('bg-transparent', 'text-slate-500');
    expect(screen.queryByRole('button', { name: /^Historic Site/ }))
      .not.toBeInTheDocument();
  });

  it('continues normal location pagination above 24 matches', () => {
    const locations = Array.from({ length: 25 }, (_, index) => (
      makeLocation(`Manual Location ${String(index + 1).padStart(2, '0')}`, 'manual')
    ));
    renderPager(locations);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Manual Location 01/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Other locations 1 / 4' }))
      .toBeInTheDocument();
    expect(within(screen.getByLabelText('Location page navigation'))
      .getByRole('button', { name: 'Next location page' })).toBeEnabled();
  });

  it.each(['take', 'return'] as const)(
    'starts and re-enters the %s location step on Pinned & recent',
    async (direction) => {
      const pinnedLocation = makeLocation('Pinned Van', 'van');
      const locations = [
        pinnedLocation,
        ...Array.from({ length: 8 }, (_, index) => (
          makeLocation(`Van ${index + 1}`, 'van')
        )),
      ];
      window.localStorage.setItem(
        'yard-kiosk:pinned-locations:v1',
        JSON.stringify([pinnedLocation.id]),
      );

      const firstEntry = render(
        <ControlledLocationPager
          locations={locations}
          direction={direction}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Go to Pinned & recent' }))
          .toHaveAttribute('aria-current', 'page');
      });
      const navigation = screen.getByLabelText('Location page navigation');
      const previous = within(navigation)
        .getByRole('button', { name: 'Previous location page' });
      const next = within(navigation).getByRole('button', { name: 'Next location page' });
      expect(previous).toBeDisabled();

      fireEvent.click(next);
      expect(previous).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Go to Vans' }))
        .toHaveAttribute('aria-current', 'page');

      firstEntry.unmount();
      render(
        <ControlledLocationPager
          locations={locations}
          direction={direction}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Go to Pinned & recent' }))
          .toHaveAttribute('aria-current', 'page');
        expect(within(screen.getByLabelText('Location page navigation'))
          .getByRole('button', { name: 'Previous location page' })).toBeDisabled();
      });
    },
  );
});
