import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { TicketQueue } from '../src/TicketQueue.ts'
import { nextEventCycle } from './utils.ts'

describe('Ticket', () => {
  let queue: TicketQueue

  beforeEach(() => {
    queue = new TicketQueue()
  })

  it('.waitUntilFirst resolves when ticket is first', async () => {
    const t1 = queue.acquireTicket()
    const t2 = queue.acquireTicket()
    let done = false
    t2.waitUntilFirst().then(() => {
      done = true
    })
    await nextEventCycle()
    assert.strictEqual(done, false)
    queue.removeTicket(t1)
    await nextEventCycle()
    assert.strictEqual(done, true)
  })

  it('.removeFromQueue disposes ticket', async () => {
    const t1 = queue.acquireTicket()
    t1.removeFromQueue()
    assert.strictEqual(t1.disposed, true)
    assert.strictEqual(queue.queue.includes(t1), false)
  })

  it('[Symbol.dispose] disposes ticket', async () => {
    {
      using t1 = queue.acquireTicket()
      assert.strictEqual(t1.disposed, false)
    }
    // t1 goes out of scope and is disposed
    assert.strictEqual(queue.queue.length, 0)
    assert.strictEqual(queue.getFirstTicket(), null)
  })
})
