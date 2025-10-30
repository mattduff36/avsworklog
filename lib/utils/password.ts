/**
 * Password generation and management utilities
 */

/**
 * Generate a secure random password
 * Format: AVS + 5 random characters (e.g., "AVSfeh5J")
 * - Always starts with "AVS"
 * - Followed by 5 random letters (upper/lower) and numbers
 * - Total length: 8 characters
 */
export function generateSecurePassword(): string {
  // Characters to use (letters and numbers, mixed case)
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  // Generate 5 random characters
  let randomPart = '';
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    randomPart += characters[randomIndex];
  }
  
  // Format: AVS + 5 random characters
  return `AVS${randomPart}`;
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - Contains uppercase
 * - Contains lowercase
 * - Contains number
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Format password requirements for display
 */
export function getPasswordRequirements(): string[] {
  return [
    'At least 8 characters long',
    'Contains at least one uppercase letter',
    'Contains at least one lowercase letter',
    'Contains at least one number'
  ];
}

