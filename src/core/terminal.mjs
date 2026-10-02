const ANSI_COLORS = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

const forceColor = Boolean(process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0');
const colorOutputEnabled = forceColor || (process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY));

export function colorize(value, color) {
  const ansiColor = ANSI_COLORS[color];
  if (!colorOutputEnabled || !ansiColor) return String(value);
  return `${ansiColor}${value}\x1b[0m`;
}