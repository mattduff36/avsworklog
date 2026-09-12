'use client';

import { useState } from 'react';
import {
  readDailyAllocationPrimaryPreference,
  writeDailyAllocationPrimaryPreference,
  type DailyAllocationBoardPrimary,
} from '@/lib/config/daily-allocation-primary-preference';

export function useDailyAllocationPrimaryPreference(userId: string): {
  primary: DailyAllocationBoardPrimary;
  setPrimary: (primary: DailyAllocationBoardPrimary) => void;
} {
  const [primary, setPrimaryState] = useState<DailyAllocationBoardPrimary>(() =>
    readDailyAllocationPrimaryPreference(userId)
  );
  const [seenUserId, setSeenUserId] = useState(userId);

  if (seenUserId !== userId) {
    setSeenUserId(userId);
    setPrimaryState(readDailyAllocationPrimaryPreference(userId));
  }

  function setPrimary(nextPrimary: DailyAllocationBoardPrimary) {
    setPrimaryState(nextPrimary);
    writeDailyAllocationPrimaryPreference(userId, nextPrimary);
  }

  return { primary, setPrimary };
}
