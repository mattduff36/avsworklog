/**
 * Predicate-wide error-log archive is disabled.
 * Network noise is classified by /fixerrors, not deleted or archived in bulk.
 */
console.error('Bulk network error-log archive is disabled. Use /fixerrors disposition finalization.');
process.exit(1);
