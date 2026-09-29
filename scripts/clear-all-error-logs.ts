/**
 * Bulk error-log archive is disabled.
 * Untriaged and outstanding rows stay active until /fixerrors finalizes an exact disposition.
 */
console.error('Bulk error-log archive is disabled. Use /fixerrors disposition finalization.');
process.exit(1);
