# ticket-queue

> [!NOTE]
> Node.js >= v24 is highly recommended since it adds Explicit Resource Management

A ticket-based first-in-first-out queue. Instead of using a single blocking `acquire()` function, a ticket queue uses a non-blocking `acquireTicket()` function that determines the FIFO order for later blocking `waitForFirst(ticket)` or `waitForFirstAndRemove(ticket)` calls.

In other words, a function can get a ticket without waiting or blocking, perform some work (without blocking any parallel work), then later wait for their turn using their ticket. Turn order is decided by ticket acquisition order.

Tickets are Disposable (see [Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)) which allows tickets to automatically get removed from the queue once they go out of scope—including if the code errors. Explicit resource management is not _required_ but is highly _recommended_ since it avoids stalling the ticket queue!

[Documentation](https://jsr.io/@atorasuunva/ticket-queue/doc)

## Install

> [!WARN]
> This is an ESM-only package. If you're using Common.js you will have to figure out your own way to import it.
> Node.js is the only actually-actively maintained runtime (I don't have time for others 😔) but I will accept issues or PRs relating to other runtimes (bug reports, fixes, and CI support are welcome!)

```sh
# Node.js -> Pick your favorite:
npm i ticket-queue
npx jsr add @atorasuunva/ticket-queue
pnpm i ticket-queue
pnpm i jsr:@atorasuunva/ticket-queue

# Deno
deno add jsr:@atorasuunva/ticket-queue

# Bun
bunx jsr add @atorasuunva/ticket-queue
```

## Usage

```typescript
import { TicketQueue } from 'ticket-queue'

const ticketQueue = new TicketQueue()

// We have some event where messages need to be sent in order, but the work to prepare the messages can take varying amounts of time and can be done in parallel with other events.
async function onEvent(name) {
  using ticket = ticketQueue.acquireTicket()

  // Do something that will take a random amount of time
  await new Promise(r => setTimeout(r, Math.random() * 1000))

  // Wait for our ticket to be first in the queue
  await ticketQueue.waitForFirst(ticket)

  // Now we are first in the queue and can proceed with the next step
  console.log(name)
  
  // We allow explicit resource management to dispose of the ticket, removing it from the queue and allowing the next ticket-holder to continue
}

onEvent('A')
onEvent('B')
onEvent('C')
onEvent('D')

// No matter how long each `onEvent()` call takes, we will always log messages in this order:
// A
// B
// C
// D
```

## Important Notes

### Make sure to _always_ remove your tickets

Node.js v24 introduces explicit resource management. Using `using` guarantees that tickets are _always_ disposed (and removed from the queue) when they go out of scope. Without `using` _you_ are responsible in making sure your tickets are removed or you _will_ stall the ticket queue. Node.js < v24 _may_ work but you will have to `try {} finally {}` after every single `acquireTicket()` call.

```typescript
const ticketQueue = new TicketQueue()

// This is the recommended way to use ticket-queue
async function alsoCorrectlyRemovesTicket() {
  // `using` for explicit resource management
  using ticket = ticketQueue.acquireTicket()

  await doSomeWork()
  // Even if `doSomeWork()` rejects, explicit resource management will ensure our ticket is removed from queue when it goes out of scope. We don't have to do any extra work
  await ticketQueue.waitForFirstAndRemove(ticket)
  await sendMessage()
}

// This is OK
async function correctlyRemovesTicket() {
  const ticket = ticketQueue.acquireTicket()

  try {
    await doSomeWork()
    await ticketQueue.waitForFirstAndRemove(ticket)
    await sendMessage()
  } finally {
    // Even if we use `waitForFirstAndRemove()`, we _must_ handle the event where `doSomeWork()` rejects and prevents `waitForFirstAndRemove() from being called
    ticket.removeFromQueue()
  }
}

// DO NOT DO THIS!!!
async function stallsQueue() {
  const ticket = ticketQueue.acquireTicket()

  await doSomeWork()
  // If `doSomeWork()` rejects, we never wait and remove the ticket and _everyone_ else will have to wait for our ticket to time out.
  // `ticketTimeout` will prevent the queue from being blocked forever, but it will delay everyone else until the ticket is removed
  await ticketQueue.waitForFirstAndRemove(ticket)
  await sendMessage()
}
```

### Tickets time out by default to prevent queue stalling

TicketQueues come with a 1000ms timeout and 3 retries limit by default. If a ticket is at the front of the queue for 1000ms without being removed, the TicketQueue automatically moves it to the back of the queue and moves onto the next ticket. The 4th time a ticket times out it is outright removed from the queue without being requeued. This prevents a single ticket never being removed from stalling the queue forever and multiple tickets never being removed making the queue slow.

These limits are configurable if you need a different timeout window or no timeout at all. Beware that disabling the timeout feature will risk a single ticket stalling your queue for everyone, so make sure you always remove tickets (even on exceptions) and never take too long to remove them. Note that timeouts under 1000ms may cause tickets to be requeued too quickly.

```typescript
const ticketQueue = new TicketQueue({
  ticketTimeout: 0, // Disables the timeout
  ticketRetries: 0, // Tickets are immediately removed from the queue when they time out instead of being requeued
})
```
