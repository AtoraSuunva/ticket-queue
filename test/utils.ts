/**
 * Waits for the next event cycle.
 * @returns A promise that resolves on the next event cycle.
 */
export const nextEventCycle = () =>
  new Promise((resolve) => setTimeout(resolve, 0))
