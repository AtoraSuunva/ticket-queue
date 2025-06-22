import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { Ticket } from '../src/Ticket.js'
import { TicketQueue } from '../src/TicketQueue.js'
import { nextEventCycle } from './utils.js'

describe('TicketQueue', () => {
  let queue: TicketQueue

  beforeEach(() => {
    queue = new TicketQueue()
  })

  it('acquires tickets in order', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    assert.strictEqual(queue.queue[0], t1)
    assert.strictEqual(queue.queue[1], t2)
  })

  it('removes ticket from queue', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    queue.removeTicket(t1)
    assert.deepStrictEqual(queue.queue, [t2])
  })

  it('waits for ticket to be first', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()

    // t1 should be first
    assert.strictEqual(queue.getFirstTicket(), t1)

    await queue.waitForFirst(t1)

    // t1 is still first
    assert.strictEqual(queue.getFirstTicket(), t1)
    queue.removeTicket(t1)

    // t2 should now be first
    assert.strictEqual(queue.getFirstTicket(), t2)
  })

  it('waits for ticket to be first and removes it', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    let resolved = false
    const p = queue.waitForFirstAndRemove(t2).then(() => {
      resolved = true
    })
    // t2 is not first yet
    await nextEventCycle()
    assert.strictEqual(resolved, false)
    // Remove t1, t2 should become first
    queue.removeTicket(t1)
    await p
    assert.strictEqual(resolved, true)
  })

  it('waitForTicket rejects if ticket is removed before first', async () => {
    const _t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    const p = queue.waitForFirstAndRemove(t2)
    queue.removeTicket(t2)
    await assert.rejects(() => p)
  })

  it('getFirstTicket returns correct ticket', () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    assert.strictEqual(queue.getFirstTicket(), t1)
    queue.removeTicket(t1)
    assert.strictEqual(queue.getFirstTicket(), t2)
    queue.removeTicket(t2)
    assert.strictEqual(queue.getFirstTicket(), null)
  })

  it('emits newFirstTicket when a ticket is removed', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    let newFirst: Ticket | null = null
    queue.on('newFirstTicket', (t) => {
      newFirst = t
    })
    queue.removeTicket(t1)
    assert.strictEqual(newFirst, t2)
  })

  it('emits acquireTicket when a ticket is acquired', async () => {
    let acquiredTicket: Ticket | null = null
    queue.on('acquireTicket', (t) => {
      acquiredTicket = t
    })
    const t1 = queue.acquireTicket()
    assert.strictEqual(acquiredTicket, t1)
    const t2 = queue.acquireTicket()
    assert.strictEqual(acquiredTicket, t2)
  })

  it('emits newFirstTicket when a ticket is acquired in an empty queue', async () => {
    let newFirstTicket: Ticket | null = null
    queue.on('newFirstTicket', (t) => {
      newFirstTicket = t
    })
    const t1 = queue.acquireTicket()
    assert.strictEqual(newFirstTicket, t1)
    const _t2 = queue.acquireTicket()
    assert.strictEqual(
      newFirstTicket,
      t1,
      'New first ticket should still be t1',
    )
  })

  it('emits removeTicket when ticket is removed', async () => {
    const t1 = queue.acquireTicket()
    let removedTicket: Ticket | null = null
    queue.on('removeTicket', (t) => {
      removedTicket = t
    })
    queue.removeTicket(t1)
    assert.strictEqual(removedTicket, t1)
  })

  it('disposed tickets are removed from queue', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    assert.strictEqual(queue.queue.includes(t1), true)
    assert.strictEqual(queue.queue.includes(t2), true)

    // Dispose t1
    t1[Symbol.dispose]()
    assert.strictEqual(queue.queue.includes(t1), false)
    assert.strictEqual(queue.queue.includes(t2), true)
  })

  it('removes timed out tickets', async (t) => {
    t.mock.timers.enable({
      apis: ['setTimeout'],
    })

    queue = new TicketQueue({ ticketTimeout: 500, ticketRetries: 1 })
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    assert.strictEqual(queue.getFirstTicket(), t1, 'First ticket should be t1')

    // Simulate stalling
    t.mock.timers.runAll()
    assert.strictEqual(
      queue.getFirstTicket(),
      t2,
      'First ticket should be t2 after timeout',
    )
    t2.removeFromQueue()
    assert.strictEqual(
      queue.getFirstTicket(),
      t1,
      'First ticket should be t1 after t2 is removed',
    )
    assert.strictEqual(t1.retries, 1)

    let removedTicket: Ticket | null = null
    queue.on('removeTicket', (ticket) => {
      removedTicket = ticket
    })

    // Simulate stalling again, t1 should be removed since it hit the retry limit
    t.mock.timers.runAll()
    assert.strictEqual(
      queue.getFirstTicket(),
      null,
      'First ticket should be null after t1 is removed due to retry limit',
    )
    assert.strictEqual(removedTicket, t1, 'Removed ticket should be t1')
  })
})
