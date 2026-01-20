/**
 * Inspection Workshop Routing Utility
 * 
 * Maps keywords in inspector comments to appropriate workshop subcategories
 * for automatic task categorization when "Inform workshop" is selected.
 */

// Keyword to subcategory mapping
// Maps to existing subcategories under "Repair" category from the taxonomy migration
const KEYWORD_TO_SUBCATEGORY: Record<string, string[]> = {
  // Tyres
  'Tyres': ['tyre', 'tyres', 'tire', 'tires', 'wheel', 'wheels', 'puncture', 'flat'],
  
  // Brakes
  'Brakes': ['brake', 'brakes', 'pad', 'pads', 'disc', 'discs', 'rotor', 'rotors', 'caliper'],
  
  // Lighting
  'Lighting': ['light', 'lights', 'bulb', 'bulbs', 'indicator', 'indicators', 'headlight', 'headlights', 
               'taillight', 'taillights', 'beacon', 'lamp', 'lamps'],
  
  // Electrical
  'Electrical': ['battery', 'batteries', 'wiring', 'wire', 'wires', 'fuse', 'fuses', 'starter', 
                 'alternator', 'electrical', 'electrics', 'charging'],
  
  // Engine
  'Engine': ['engine', 'motor', 'oil', 'leak', 'leaking', 'smoke', 'smoking', 'noise', 'noisy', 
             'knocking', 'overheating'],
  
  // Suspension & Steering
  'Suspension & Steering': ['suspension', 'steering', 'tracking', 'shock', 'shocks', 'absorber', 
                            'absorbers', 'spring', 'springs', 'alignment'],
  
  // Transmission
  'Transmission': ['gearbox', 'transmission', 'clutch', 'gear', 'gears', 'shifting'],
  
  // Exhaust
  'Exhaust': ['exhaust', 'dpf', 'particulate', 'emissions', 'muffler', 'silencer'],
  
  // Cooling
  'Cooling': ['coolant', 'radiator', 'overheating', 'cooling', 'fan', 'thermostat', 'heater'],
  
  // Fuel System
  'Fuel System': ['fuel', 'diesel', 'petrol', 'injector', 'injectors', 'tank', 'pump'],
  
  // Bodywork
  'Bodywork': ['windscreen', 'windshield', 'window', 'windows', 'wiper', 'wipers', 'mirror', 'mirrors',
               'door', 'doors', 'body', 'bodywork', 'dent', 'dents', 'scratch', 'scratches', 'crack',
               'cracked', 'panel', 'panels', 'bumper'],
};

export interface SubcategoryMatch {
  subcategoryName: string;
  matchedKeywords: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Infer the best workshop subcategory from a comment's text
 * 
 * @param comment - The inspector's comment
 * @returns The matched subcategory info, or null if no match (fallback needed)
 */
export function inferWorkshopSubcategoryFromComment(comment: string): SubcategoryMatch | null {
  if (!comment || typeof comment !== 'string') {
    return null;
  }

  const lowerComment = comment.toLowerCase();
  const words = lowerComment.split(/\s+/);
  
  const matches: Array<{ subcategory: string; keywords: string[]; count: number }> = [];
  
  // Check each subcategory's keywords
  for (const [subcategoryName, keywords] of Object.entries(KEYWORD_TO_SUBCATEGORY)) {
    const matchedKeywords: string[] = [];
    
    for (const keyword of keywords) {
      // Check if keyword appears in the comment (word boundary match for accuracy)
      const keywordLower = keyword.toLowerCase();
      
      // For single words, check if it's a standalone word or part of comment
      if (words.includes(keywordLower) || lowerComment.includes(keywordLower)) {
        matchedKeywords.push(keyword);
      }
    }
    
    if (matchedKeywords.length > 0) {
      matches.push({
        subcategory: subcategoryName,
        keywords: matchedKeywords,
        count: matchedKeywords.length,
      });
    }
  }
  
  if (matches.length === 0) {
    return null;
  }
  
  // Sort by match count (more keywords = higher confidence)
  matches.sort((a, b) => b.count - a.count);
  
  const best = matches[0];
  
  // Determine confidence based on match quality
  let confidence: 'high' | 'medium' | 'low';
  if (best.count >= 3) {
    confidence = 'high';
  } else if (best.count >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  return {
    subcategoryName: best.subcategory,
    matchedKeywords: best.keywords,
    confidence,
  };
}

/**
 * Get all available subcategory names for display
 */
export function getAvailableSubcategories(): string[] {
  return Object.keys(KEYWORD_TO_SUBCATEGORY);
}

/**
 * Fallback subcategory configuration
 */
export const FALLBACK_SUBCATEGORY = {
  primary: {
    categoryName: 'Repair',
    subcategoryName: 'Inspection defects',
  },
  secondary: {
    categoryName: 'Other',
    subcategoryName: 'Other',
  },
};
