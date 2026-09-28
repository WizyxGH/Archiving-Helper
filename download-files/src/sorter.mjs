/**
 * Natural alphanumeric sort comparison function
 * Ensures page numbers 1, 2, ... 9, 10, ... 100 are ordered naturally.
 */
export function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
