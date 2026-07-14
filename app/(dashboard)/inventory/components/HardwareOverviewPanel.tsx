'use client';

import { useMemo } from 'react';
import { Boxes, MapPin } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  InventoryHardwareBalance,
  InventoryHardwareItem,
} from '../types';

interface HardwareOverviewPanelProps {
  items: InventoryHardwareItem[];
  balances: InventoryHardwareBalance[];
}

export function HardwareOverviewPanel({
  items,
  balances,
}: HardwareOverviewPanelProps) {
  const balancesByItem = useMemo(() => {
    const grouped = new Map<string, InventoryHardwareBalance[]>();
    for (const balance of balances) {
      if (balance.quantity <= 0) continue;
      const itemBalances = grouped.get(balance.hardware_item_id) || [];
      itemBalances.push(balance);
      grouped.set(balance.hardware_item_id, itemBalances);
    }
    return grouped;
  }, [balances]);

  const activeItems = useMemo(
    () => items
      .filter((item) => item.is_active)
      .toSorted((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [items],
  );

  return (
    <Card className="overflow-hidden border-slate-700 bg-slate-900/70">
      <CardHeader className="border-b border-slate-700 bg-slate-950/40">
        <CardTitle className="flex items-center gap-2 text-white">
          <Boxes className="h-5 w-5 text-inventory" />
          Hardware Stock
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Company-wide non-serialised stock. Expand an item to see where its quantity is held.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {activeItems.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No active Hardware items have been configured.
          </p>
        ) : (
          <Accordion type="multiple" className="divide-y divide-slate-800">
            {activeItems.map((item) => {
              const itemBalances = balancesByItem.get(item.id) || [];
              const total = itemBalances.reduce((sum, balance) => sum + balance.quantity, 0);

              return (
                <AccordionItem key={item.id} value={item.id} className="border-0 px-5">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-4 pr-3 text-left">
                      <span className="truncate font-semibold text-white">{item.name}</span>
                      <Badge className="shrink-0 bg-inventory/15 text-inventory-light hover:bg-inventory/20">
                        {total.toLocaleString()} total
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {itemBalances.length === 0 ? (
                      <p className="pb-4 text-sm text-muted-foreground">No stock is currently recorded.</p>
                    ) : (
                      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {itemBalances
                          .toSorted((a, b) => (
                            (a.location?.name || '').localeCompare(b.location?.name || '')
                          ))
                          .map((balance) => (
                            <div
                              key={`${item.id}:${balance.location_id}`}
                              className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2"
                            >
                              <span className="flex min-w-0 items-center gap-2 text-sm text-slate-200">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-inventory" />
                                <span className="truncate">{balance.location?.name || 'Unknown location'}</span>
                              </span>
                              <span className="font-mono text-sm font-semibold text-white">
                                {balance.quantity.toLocaleString()}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
