/**
 * File validation utilities for RAMS document uploads
 */

export const ALLOWED_FILE_TYPES = {
  'application/pdf': 'pdf',
} as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  fileType?: 'pdf';
}

/**
 * Validate uploaded file for RAMS documents
 */
export function validateRAMSFile(file: File): FileValidationResult {
  // Check file exists
  if (!file) {
    return {
      valid: false,
      error: 'No file provided',
    };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `File size exceeds ${sizeMB}MB limit`,
    };
  }

  // Check file size is not zero
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty',
    };
  }

  // Check file type
  const fileType = ALLOWED_FILE_TYPES[file.type as keyof typeof ALLOWED_FILE_TYPES];
  
  if (!fileType) {
    return {
      valid: false,
      error: 'Invalid file type. Only PDF files are allowed',
    };
  }

  // Check file extension matches type
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== fileType) {
    return {
      valid: false,
      error: `File extension .${extension} does not match file type ${fileType}`,
    };
  }

  return {
    valid: true,
    fileType,
  };
}

/**
 * Generate safe filename for storage
 */
export function generateSafeFilename(originalFilename: string, userId: string): string {
  // Remove any path components
  const filename = originalFilename.replace(/^.*[\\/]/, '');
  
  // Get extension
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  
  // Get filename without extension
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  
  // Sanitize filename - remove special characters
  const sanitizedName = nameWithoutExt
    .replace(/[^a-z0-9_-]/gi, '_')
    .substring(0, 50); // Limit length
  
  // Add timestamp and user ID for uniqueness
  const timestamp = Date.now();
  
  return `${sanitizedName}_${timestamp}_${userId.substring(0, 8)}.${extension}`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

