'use client';

import { useState } from 'react';
import {
  readDailyAllocationViewPreference,
  writeDailyAllocationViewPreference,
  type DailyAllocationBoardView,
} from '@/lib/config/daily-allocation-view-preference';

export function useDailyAllocationViewPreference(userId: string): {
  view: DailyAllocationBoardView;
  setView: (view: DailyAllocationBoardView) => void;
} {
  const [view, setViewState] = useState<DailyAllocationBoardView>(() =>
    readDailyAllocationViewPreference(userId)
  );
  const [seenUserId, setSeenUserId] = useState(userId);

  if (userId !== seenUserId) {
    setSeenUserId(userId);
    setViewState(readDailyAllocationViewPreference(userId));
  }

  function setView(nextView: DailyAllocationBoardView) {
    setViewState(nextView);
    writeDailyAllocationViewPreference(userId, nextView);
  }

  return { view, setView };
}
