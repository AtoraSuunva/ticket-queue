import { EventEmitter } from 'tseep'
import { Ticket } from './Ticket.ts'

/**
 * Options for configuring a TicketQueue.
 */
export interface TicketQueueOptions {
  /**
   * The timeout in milliseconds for how long a ticket can be first in queue before it is considered expired.
   *
   * If a ticket is the first in queue for longer than this timeout, it will be moved to the end of the queue.
   *
   * Note that timeouts under 1000ms may cause tickets to be requeued more frequently than expected due to event loop delays and other factors.
   *
   * If the ticketTimeout is set to 0, tickets will not expire and will remain in the queue until they are removed. This can lead to code that never redeems or disposes of a ticket stalling the entire queue indefinitely.
   * @default 1000
   */
  ticketTimeout?: number
  /**
   * The number of times to requeue a ticket if it times out.
   *
   * After this many retries, the ticket will be removed from the queue instead of being rescheduled. A ticket that stalls forever would otherwise continuously block the queue when it becomes first and introduce "random" delays.
   * @default 3
   */
  ticketRetries?: number
}

/**
 * A queue using tickets. Tasks can acquire tickets without blocking and then later block while waiting for those tickets to be first in queue.
 *
 * This allows for systems where tasks need to sync something in a specific order but can perform other work while waiting for their turn.
 *
 * Tickets are Disposable and should be used with a `using` statement to ensure they are properly cleaned up after use.
 *
 * @example
 * ```typescript
 * const ticketQueue = new TicketQueue()
 *
 * // We have some event where messages need to be sent in order, but the work to prepare the messages can take varying amounts of time and can be done in parallel with other events.
 * async function onEvent() {
 *   using ticket = ticketQueue.acquireTicket()
 *
 *   // Perform some work that can take a varying amount of time
 *   await doSomeWork()
 *
 *   await ticketQueue.waitForFirst(ticket)
 *   // Now we are first in the queue and can proceed with the next step
 *   await sendMessage()
 * }
 */
export class TicketQueue extends EventEmitter<{
  newFirstTicket(ticket: Ticket | null): void
  acquireTicket(ticket: Ticket): void
  removeTicket(ticket: Ticket, reason?: string): void
}> {
  public readonly [Symbol.toStringTag] = 'TicketQueue'
  /** The queue of tickets in the order they were acquired */
  public queue: Ticket[] = []
  /** The next ticket ID to be assigned */
  public ticketCount = 0n

  /** The timeout in milliseconds for how long a ticket can be first in queue before it is considered expired. */
  public ticketTimeout: number
  /** The number of times to requeue a ticket if it times out. */
  public ticketRetries: number

  /**
   * Create a new TicketQueue. See the class documentation for more info.
   * @param options Options to create the TicketQueue with
   */
  constructor(options: TicketQueueOptions = {}) {
    super()
    this.ticketTimeout = options.ticketTimeout ?? 1000
    this.ticketRetries = options.ticketRetries ?? 3

    if (this.ticketTimeout < 0) {
      throw new Error('Ticket timeout must be a non-negative number')
    }

    if (this.ticketRetries < 0) {
      throw new Error('Ticket retries must be a non-negative number')
    }

    let timeoutId: NodeJS.Timeout | null = null

    this.on('newFirstTicket', (ticket) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      if (ticket && this.ticketTimeout > 0) {
        // If the ticket is first in queue, start a timeout to check if it stalls
        timeoutId = setTimeout(() => {
          if (this.getFirstTicket() === ticket) {
            // If the ticket is still first, we requeue it or remove it if it has reached its retry limit
            if (ticket.retries < this.ticketRetries) {
              ticket.retries++
              this.queue.shift()
              this.queue.push(ticket)
              this.emit('newFirstTicket', this.getFirstTicket())
            } else {
              this.removeTicket(
                ticket,
                'Ticket timed out and reached retry limit',
              )
            }
          }
        }, this.ticketTimeout)
      }
    })
  }

  /**
   * Acquires a new ticket for the queue. Tickets are added to the end of the queue in the order this method is called.
   * @returns A new ticket that can be used to wait for its turn in the queue.
   */
  acquireTicket(): Ticket {
    const ticket = new Ticket(this, this.ticketCount++)
    this.queue.push(ticket)
    this.emit('acquireTicket', ticket)

    if (this.queue.length === 1) {
      this.emit('newFirstTicket', ticket)
    }

    return ticket
  }

  /**
   * Removes a ticket from the queue. When using explicit resource management this method is automatically called.
   *
   * If the ticket is the first in the queue, the next ticket will be emitted as the new first ticket.
   * @param ticket The ticket to remove from the queue.
   */
  removeTicket(ticket: Ticket, reason?: string): void {
    const index = this.queue.indexOf(ticket)
    if (index === -1) return

    ticket.disposed = true

    this.queue.splice(index, 1)

    this.emit('removeTicket', ticket, reason)

    if (index === 0) {
      this.emit('newFirstTicket', this.getFirstTicket())
    }
  }

  /**
   * Waits for a specific ticket to be first in the queue and then removes it from the queue.
   *
   * This method will block until the ticket is first in the queue.
   * @param ticket The ticket to wait for.
   * @returns A promise that resolves when the ticket is first in the queue.
   * @throws Rejects if the ticket is removed from the queue before it becomes first.
   * @throws Rejects if the ticket is disposed before it becomes first.
   * @throws Rejects if the ticket is not in the queue.
   * @example
   * ```typescript
   * const ticketQueue = new TicketQueue()
   * using ticket = ticketQueue.acquireTicket()
   * // Perform some work that can take a varying amount of time
   * await doSomeWork()
   * await ticketQueue.waitForFirstAndRemove(ticket)
   * // Now we are first in the queue and can proceed with the next step
   * // Since the ticket was removed from the queue, another function can redeem their ticket and race this `sendMessage()`, potentially going before us
   * // If the order of `sendMessage()` is important, you should use `waitForFirst()` instead of `waitForFirstAndRemove()` to block other callers.
   * await sendMessage()
   * ```
   */
  waitForFirstAndRemove(ticket: Ticket): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waitForFirst(ticket)
        .then(() => {
          this.removeTicket(ticket)
          resolve()
        })
        .catch(reject)
    })
  }

  /**
   * Waits for a ticket to be first in the queue without removing it.
   *
   * This method will block until the ticket is first in the queue.
   *
   * This method doesn't remove the ticket from the queue, meaning you are responsible to either use explicit resource management via `using` or call `removeFromQueue` on the ticket when you are done with it.
   * Failing to do so will stall the queue until the ticket times out.
   *
   * @param ticket The ticket to check if it is first in the queue.
   * @returns A promise that resolves when the ticket is first in the queue.
   * @throws Rejects if the ticket is removed from the queue before it becomes first.
   * @throws Rejects if the ticket is disposed before it becomes first.
   * @throws Rejects if the ticket is not in the queue.
   * @example
   * ```typescript
   * const ticketQueue = new TicketQueue()
   * using ticket = ticketQueue.acquireTicket()
   * // Perform some work that can take a varying amount of time
   * await doSomeWork()
   * await ticketQueue.waitForFirst(ticket)
   * // Now we are first in the queue and can proceed with the next step
   * // `waitForFirst()` does not remove the ticket from the queue, so we are still blocking other ticket-holders and need to remove the ticket before they can proceed.
   * // This however guarantees that our `sendMessage()` will run to completion before any other ticket can proceed.
   * // If the order of `sendMessage()` is not important, you can use `waitForFirstAndRemove()` instead to remove the ticket from the queue as soon as its first and unblock other callers.
   * await sendMessage()
   * // Since we used `using`, the ticket is automatically removed from the queue when it goes out of scope.
   * // If we didn't use `using`, we would need to call `ticket.removeFromQueue()` to remove the ticket from the queue.
   * ```
   */
  waitForFirst(ticket: Ticket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ticket.disposed) {
        return reject(new Error('Ticket is disposed'))
      }

      if (!this.queue.includes(ticket)) {
        return reject(new Error('Ticket is not in the queue'))
      }

      const firstTicket = this.getFirstTicket()

      if (firstTicket === ticket) {
        return resolve()
      }

      const newTicketListener = (newFirstTicket: Ticket | null) => {
        if (newFirstTicket === ticket) {
          this.off('newFirstTicket', newTicketListener)
          resolve()
        }
      }

      this.on('newFirstTicket', newTicketListener)

      const removeTicketListener = (removedTicket: Ticket, reason?: string) => {
        if (removedTicket === ticket) {
          this.off('newFirstTicket', newTicketListener)
          this.off('removeTicket', removeTicketListener)
          reject(
            new Error(
              `Ticket was removed from the queue${reason ? `: ${reason}` : ''}`,
            ),
          )
        }
      }

      this.on('removeTicket', removeTicketListener)
    })
  }

  /**
   * Gets the first ticket in the queue without removing it.
   * @returns The first ticket in the queue or null if the queue is empty.
   */
  getFirstTicket(): Ticket | null {
    return this.queue.length > 0 ? this.queue[0] : null
  }

  /** Returns a string representation of the ticket queue. */
  override toString(): string {
    return `TicketQueue (size=${this.queue.length}, tickets=[${this.queue.join(',')}])`
  }
}
