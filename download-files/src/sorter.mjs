/**
 * Natural alphanumeric sort comparison function
 * Ensures page numbers 1, 2, ... 9, 10, ... 100 are ordered naturally.
 */
export function naturalCompare(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Natural sort helper supporting both naturalSort(array) and array.sort(naturalSort)
 */
export function naturalSort(a, b) {
  if (Array.isArray(a)) {
    return [...a].sort(naturalCompare);
  }
  return naturalCompare(a, b);
}
