const doDebug = true;

/*
 * utility debug logger that can be disabled by setting the doDebug variable to false.
 *
 *      params:
 *          level - The level of the log message (info, warn, error).
 *          ...args - The arguments to be logged.
 */
export function debugLog(level, ...args) {
  if (doDebug) {
    switch (level) {
      case 'info':
        console.info(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'error':
        console.error(...args);
        break;
      default:
        console.log(...args);
    }
  }
}