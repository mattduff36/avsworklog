import type {
  YardKioskBasketLine,
  YardKioskBlockedItem,
  YardKioskDirection,
  YardKioskLocation,
  YardKioskReceipt,
  YardKioskStockItem,
} from '@/lib/inventory/kiosk-types';

export type YardKioskPhase = 'mode' | 'location' | 'items' | 'submitting' | 'receipt';

export interface YardKioskState {
  phase: YardKioskPhase;
  direction: YardKioskDirection | null;
  counterpart: YardKioskLocation | null;
  stock: YardKioskStockItem[];
  basket: YardKioskBasketLine[];
  searchQuery: string;
  category: string;
  loadingStock: boolean;
  error: string | null;
  blockedItems: YardKioskBlockedItem[];
  receipt: YardKioskReceipt | null;
}

export interface YardKioskGuidance {
  instructionKey: string | null;
  message: string | null;
  stepLabel: string;
}

export const INITIAL_YARD_KIOSK_STATE: YardKioskState = {
  phase: 'mode',
  direction: null,
  counterpart: null,
  stock: [],
  basket: [],
  searchQuery: '',
  category: 'all',
  loadingStock: false,
  error: null,
  blockedItems: [],
  receipt: null,
};

export type YardKioskAction =
  | { type: 'SELECT_DIRECTION'; direction: YardKioskDirection }
  | { type: 'SELECT_LOCATION'; location: YardKioskLocation }
  | { type: 'STOCK_LOADED'; stock: YardKioskStockItem[] }
  | { type: 'STOCK_FAILED'; message: string }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_CATEGORY'; category: string }
  | { type: 'ADD_SERIALIZED'; item: Extract<YardKioskStockItem, { kind: 'serialized' }> }
  | { type: 'SET_HARDWARE_QUANTITY'; item: Extract<YardKioskStockItem, { kind: 'hardware' }>; quantity: number }
  | { type: 'REMOVE_LINE'; kind: YardKioskBasketLine['kind']; itemId: string }
  | { type: 'CLEAR_BASKET' }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_FAILED'; message: string; blockedItems?: YardKioskBlockedItem[] }
  | { type: 'SUBMIT_SUCCEEDED'; receipt: YardKioskReceipt }
  | { type: 'DISMISS_ERROR' }
  | { type: 'BACK' }
  | { type: 'RESET' };

export function yardKioskReducer(
  state: YardKioskState,
  action: YardKioskAction,
): YardKioskState {
  switch (action.type) {
    case 'SELECT_DIRECTION':
      return {
        ...INITIAL_YARD_KIOSK_STATE,
        phase: 'location',
        direction: action.direction,
      };
    case 'SELECT_LOCATION':
      return {
        ...state,
        phase: 'items',
        counterpart: action.location,
        stock: [],
        basket: [],
        searchQuery: '',
        category: 'all',
        loadingStock: true,
        error: null,
        blockedItems: [],
      };
    case 'STOCK_LOADED':
      return {
        ...state,
        stock: action.stock,
        loadingStock: false,
        error: null,
      };
    case 'STOCK_FAILED':
      return {
        ...state,
        stock: [],
        loadingStock: false,
        error: action.message,
      };
    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query, category: action.query ? 'all' : state.category };
    case 'SET_CATEGORY':
      return { ...state, category: action.category, searchQuery: '', error: null };
    case 'ADD_SERIALIZED': {
      if (action.item.is_check_blocked) {
        return {
          ...state,
          error: `${action.item.item_number} needs an inventory check before it can leave Yard.`,
          blockedItems: [{
            id: action.item.id,
            item_number: action.item.item_number,
            name: action.item.name,
            check_status: action.item.check_status,
          }],
        };
      }
      if (state.basket.some((line) => line.kind === 'serialized' && line.item_id === action.item.id)) {
        return state;
      }
      return {
        ...state,
        error: null,
        blockedItems: [],
        basket: [...state.basket, {
          kind: 'serialized',
          item_id: action.item.id,
          item_number: action.item.item_number,
          name: action.item.name,
          category: action.item.category,
        }],
      };
    }
    case 'SET_HARDWARE_QUANTITY': {
      const quantity = Math.min(action.item.available_quantity, Math.max(0, action.quantity));
      const withoutItem = state.basket.filter(
        (line) => !(line.kind === 'hardware' && line.item_id === action.item.id),
      );
      if (quantity === 0) return { ...state, basket: withoutItem };
      return {
        ...state,
        error: null,
        blockedItems: [],
        basket: [...withoutItem, {
          kind: 'hardware',
          item_id: action.item.id,
          name: action.item.name,
          quantity,
          available_quantity: action.item.available_quantity,
        }],
      };
    }
    case 'REMOVE_LINE':
      return {
        ...state,
        basket: state.basket.filter(
          (line) => !(line.kind === action.kind && line.item_id === action.itemId),
        ),
      };
    case 'CLEAR_BASKET':
      return { ...state, basket: [], error: null, blockedItems: [] };
    case 'SUBMIT_START':
      return { ...state, phase: 'submitting', error: null, blockedItems: [] };
    case 'SUBMIT_FAILED':
      return {
        ...state,
        phase: 'items',
        error: action.message,
        blockedItems: action.blockedItems || [],
      };
    case 'SUBMIT_SUCCEEDED':
      return {
        ...state,
        phase: 'receipt',
        receipt: action.receipt,
        error: null,
        blockedItems: [],
      };
    case 'DISMISS_ERROR':
      return { ...state, error: null, blockedItems: [] };
    case 'BACK':
      if (state.phase === 'items') {
        return {
          ...INITIAL_YARD_KIOSK_STATE,
          phase: 'location',
          direction: state.direction,
        };
      }
      if (state.phase === 'location') return INITIAL_YARD_KIOSK_STATE;
      return state;
    case 'RESET':
      return INITIAL_YARD_KIOSK_STATE;
    default:
      return state;
  }
}

export function getBasketSummary(basket: YardKioskBasketLine[]) {
  return basket.reduce(
    (summary, line) => {
      if (line.kind === 'serialized') summary.serialized += 1;
      else {
        summary.hardwareLines += 1;
        summary.hardwareUnits += line.quantity;
      }
      return summary;
    },
    { serialized: 0, hardwareLines: 0, hardwareUnits: 0 },
  );
}

export function getYardKioskGuidance(state: YardKioskState): YardKioskGuidance {
  const direction = state.direction ?? 'take';

  if (state.phase === 'mode') {
    return {
      instructionKey: null,
      message: null,
      stepLabel: 'Choose direction',
    };
  }

  if (state.phase === 'location') {
    return direction === 'take'
      ? {
          instructionKey: 'location:take',
          message: 'Select the destination location',
          stepLabel: 'Choose destination',
        }
      : {
          instructionKey: 'location:return',
          message: 'Select the source location',
          stepLabel: 'Choose source',
        };
  }

  if (state.phase === 'items') {
    if (state.basket.length > 0) {
      return {
        instructionKey: `items:${direction}:review`,
        message: 'Review your basket, then confirm',
        stepLabel: 'Review basket',
      };
    }

    return direction === 'take'
      ? {
          instructionKey: 'items:take:select',
          message: 'Select stock to collect from Yard',
          stepLabel: 'Choose stock',
        }
      : {
          instructionKey: 'items:return:select',
          message: 'Select stock to return to Yard',
          stepLabel: 'Choose stock',
        };
  }

  if (state.phase === 'submitting') {
    return {
      instructionKey: null,
      message: null,
      stepLabel: 'Confirming transfer',
    };
  }

  return {
    instructionKey: null,
    message: null,
    stepLabel: 'Complete',
  };
}
