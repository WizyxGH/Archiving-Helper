/**
 * Natural Sorting Algorithm (handles human page ordering e.g. 1, 2, ... 9, 10, 100)
 */
export function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function naturalSortArray(arr) {
  return [...arr].sort(naturalSort);
}
