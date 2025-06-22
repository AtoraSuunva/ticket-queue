import type { TicketQueue } from './TicketQueue.js'

/**
 * Ticket class represents a ticket in the TicketQueue.
 *
 * It is used to manage the position of a task in the queue and allows the task to wait until it is first in the queue.
 *
 * Tickets are Disposable and should be used with a `using` statement to ensure they are properly cleaned up after they go out of scope.
 *
 * Without explicit resource management, you are responsible for calling `waitUntilFirst` or `removeFromQueue` before the ticket goes out of scope (including on errors).
 * Tickets that aren't handled with `using`, `waitUntilFirst`, or `removeFromQueue` will stall the TicketQueue until they time out. If ticket time out is disabled they will stall the queue **indefinitely**!
 */
export class Ticket implements Disposable {
  public readonly [Symbol.toStringTag] = 'Ticket'
  public readonly [Symbol.dispose]: () => void = this.removeFromQueue.bind(
    this,
    'Explicit Resource Management',
  )
  public disposed = false
  public retries = 0

  constructor(
    public readonly ticketQueue: TicketQueue,
    public readonly id: bigint,
  ) {}

  /**
   * Waits for this ticket to be first in the queue.
   * This method will block until the ticket is first in the queue.
   *
   * @return A promise that resolves when the ticket is first in the queue.
   * @throws Rejects if the ticket has already been disposed.
   * @throws Rejects if the ticket is removed from the queue before it becomes first.
   */
  async waitUntilFirst(): Promise<void> {
    if (this.disposed) {
      throw new Error('Ticket has already been disposed.')
    }

    await this.ticketQueue.waitForFirstAndRemove(this)
  }

  /**
   * Removes this ticket from the queue.
   *
   * With `using` statements, this method is automatically called when the ticket goes out of scope.
   *
   * This method is a safe no-op if the ticket has already been disposed.
   */
  removeFromQueue(reason?: string): void {
    if (this.disposed) {
      return
    }

    this.ticketQueue.removeTicket(this, reason)
    this.disposed = true
  }
}
