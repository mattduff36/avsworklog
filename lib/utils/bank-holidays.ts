// UK Bank Holidays API integration
// Data source: https://www.gov.uk/bank-holidays.json

interface BankHolidayEvent {
  title: string;
  date: string; // YYYY-MM-DD format
  notes: string;
  bunting: boolean;
}

interface BankHolidayDivision {
  division: string;
  events: BankHolidayEvent[];
}

interface BankHolidayData {
  'england-and-wales': BankHolidayDivision;
  'scotland': BankHolidayDivision;
  'northern-ireland': BankHolidayDivision;
}

// Cache for bank holidays (valid for the session)
let cachedBankHolidays: Set<string> | null = null;
let cacheTimestamp: number | null = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch UK bank holidays from GOV.UK API
 * @param division - Which UK division: 'england-and-wales', 'scotland', or 'northern-ireland'
 * @returns Set of bank holiday dates in YYYY-MM-DD format
 */
export async function fetchUKBankHolidays(
  division: 'england-and-wales' | 'scotland' | 'northern-ireland' = 'england-and-wales'
): Promise<Set<string>> {
  // Return cached data if still valid
  if (cachedBankHolidays && cacheTimestamp && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedBankHolidays;
  }

  try {
    const response = await fetch('https://www.gov.uk/bank-holidays.json');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch bank holidays: ${response.statusText}`);
    }

    const data: BankHolidayData = await response.json();
    const divisionData = data[division];
    
    if (!divisionData || !divisionData.events) {
      throw new Error(`Invalid division data for ${division}`);
    }

    // Extract dates into a Set for O(1) lookup
    const dates = new Set(divisionData.events.map(event => event.date));
    
    // Update cache
    cachedBankHolidays = dates;
    cacheTimestamp = Date.now();
    
    return dates;
  } catch (error) {
    console.error('Error fetching bank holidays:', error);
    
    // Return empty set on error - fallback gracefully
    // Consider logging to monitoring service in production
    return new Set<string>();
  }
}

/**
 * Check if a specific date is a UK bank holiday
 * @param date - Date to check
 * @param division - Which UK division (default: england-and-wales)
 * @returns Promise<boolean> - true if the date is a bank holiday
 */
export async function isUKBankHoliday(
  date: Date,
  division: 'england-and-wales' | 'scotland' | 'northern-ireland' = 'england-and-wales'
): Promise<boolean> {
  const bankHolidays = await fetchUKBankHolidays(division);
  
  // Format date as YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;
  
  return bankHolidays.has(dateString);
}

/**
 * Clear the bank holidays cache
 * Useful if you want to force a refresh
 */
export function clearBankHolidayCache(): void {
  cachedBankHolidays = null;
  cacheTimestamp = null;
}

/**
 * Get all bank holidays for a specific year
 * @param year - Year to get bank holidays for
 * @param division - Which UK division (default: england-and-wales)
 * @returns Array of bank holiday events for that year
 */
export async function getBankHolidaysForYear(
  year: number,
  division: 'england-and-wales' | 'scotland' | 'northern-ireland' = 'england-and-wales'
): Promise<BankHolidayEvent[]> {
  try {
    const response = await fetch('https://www.gov.uk/bank-holidays.json');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch bank holidays: ${response.statusText}`);
    }

    const data: BankHolidayData = await response.json();
    const divisionData = data[division];
    
    if (!divisionData || !divisionData.events) {
      return [];
    }

    // Filter events for the specified year
    return divisionData.events.filter(event => {
      const eventYear = parseInt(event.date.split('-')[0]);
      return eventYear === year;
    });
  } catch (error) {
    console.error('Error fetching bank holidays for year:', error);
    return [];
  }
}

