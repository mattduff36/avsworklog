import type {
  DailyAllocationOptimisticOperation,
  DailyAllocationProjection,
} from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';

export function dailyAllocationProofsSatisfied(
  operation: Pick<DailyAllocationOptimisticOperation, 'queryKeys' | 'proofs'>,
  projection: DailyAllocationProjection
): boolean {
  return operation.queryKeys.every((key) => operation.proofs[key]?.(projection) === true);
}

export class DailyAllocationBoardReconciler {
  private pendingKeys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private followUp = false;
  private interactionActive = false;

  constructor(private readonly options: {
    delayMs?: number;
    run: (keys: string[]) => Promise<void>;
    onInteractionStart?: () => Promise<void> | void;
  }) {}

  schedule(keys: readonly string[]): void {
    for (const key of keys) this.pendingKeys.add(key);
    if (this.interactionActive) return;
    if (this.inFlight) {
      this.followUp = true;
      return;
    }
    this.arm();
  }

  setInteractionActive(active: boolean): void {
    if (this.interactionActive === active) return;
    this.interactionActive = active;
    if (active) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.options.onInteractionStart?.();
      return;
    }
    if (this.pendingKeys.size > 0) this.arm();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingKeys.clear();
    this.followUp = false;
  }

  private arm(): void {
    if (this.interactionActive) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs ?? 400);
  }

  private async flush(): Promise<void> {
    if (this.inFlight || this.interactionActive || this.pendingKeys.size === 0) return;
    const keys = [...this.pendingKeys];
    this.pendingKeys.clear();
    this.inFlight = true;
    try {
      await this.options.run(keys);
    } finally {
      this.inFlight = false;
      if (!this.interactionActive && (this.followUp || this.pendingKeys.size > 0)) {
        this.followUp = false;
        this.arm();
      }
    }
  }
}
