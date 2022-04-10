# Event Handler

Helps managing various kind of events. It tracks life span of objects involved in events to drop event handlers once they are not needed anymore, to prevent memory leak when destroying objects.

Having events attached to objects helps to keep a better organization in our code by leaving the logic on the object that should react to an event, not on the object triggering the event. Let's take for example these event and consequence: "When a friend smile, it makes you happy". The code `changeState(STATE.happy)` should be in located in `You` in a handler triggered when your friend smiles, not in `Friend` in its `smile` function. Maybe someone else than `You` will react differently, it's not your `Friend` who decides this, all they can do is smile and showing their smile to the world.

## Objects emitting events

### Init an object with EventHandler

```ts
class MyObject extends EventHandler<{

  /* Declare the events the object can emit */
  'destroy': () => void, // Always declare the 'destroy' event. It marks the end of life of the object
  'something_happened': (param1: unknown) => void // You can add parameters to the events

}> {
  // ...
}
```

### Trigger an event

Trigger an event to let other objects know about what is happening.

```ts
this._trigger('destroy')
this._trigger('something_happened', something)
```

### Listen to events

Run a fonction when a certain event is triggered by an object.

```ts
object.on('something_happened', (something) => {
  /* ... */
})
```

### Listen to events from another EventHandler object

When an EventHandler is listening to events from another EventHandler, you should avoid using the `on` function, which may lead to memory leaks.
Instead, the `_listen` function will create a contract between the two objects, and free the memory once any of the two objects are destroyed.

```ts
this._listen(object, 'something_happened', (something) => {
  /* ... */
})
```

### Stop listening

Using off

```ts
const handler = (something) => { /* ... */ }

object.on('something_happened', handler)
object.off('something_happened', handler)

this._listen(object, 'something_else_happened', handler)
object.off('something_else_happened', handler)
```

Using until

```ts
this._listen(object, 'something_happened', (something) => {
  /* ... */
}).until('something_else_happened')

this._listen(object, 'something_happened', (something) => {
  /* ... */
}).until(anotherObject, 'something_happened_elsewhere')
```

Using destroy.
Once the object is destroyed, any event contract involving it as a subscriber or emitter will be deleted, to avoid triggering event handlers once either one or the other object life span has ended.

```ts
this._trigger('destroy')
```

### React to an event only once

The event handler will be automatically unregistered after being triggered once, without having to call `object.off` manually.

```ts
object.once('something_happened', (something) => { /* ... */ })
this._listenOnce(object, 'something_happened', (something) => { /* ... */ })
```

### Example

```ts
class Friend extends EventHandler<{
  'destroy': () => void,
  'smile': (bigSmile: boolean) => void
}> {
  receiveNews (news: string): void {
    if (news === NEWS.goodNews) {
      this._trigger('smile', true)
    }
  }

  destroy (): void {
    this._trigger('destroy')
  }
}

class You extends EventHandler {
  constructor (friend) {
    this._listen(friend, 'smile', (bigSmile) => {
      this.changeState(STATE.happy)
    })
  }

  changeState (state): void {
    if (state == STATE.happy) {
      console.log('You are happy!')
    }
  }
}

const friend = new Friend()
const you = new You(friend)
friend.receiveNews(NEWS.goodNews) // => Will output "You are happy!" in the console
```

## Handling one-time events or checkpoints

Sometimes, you want to perform a function as soon as the object is in a "ready" state. This case always requires at least two lines:
- If the object is already ready, then run the function immediately
- Otherwise, when the object is ready, then run the function

EventHandler allows you to do that in a single line.

### Trigger the checkpoint

```ts
this._eventHappened('ready')
```

### Wait for the checkpoint

```ts
await object.when('ready')
object.when('ready').then(() => { /* ... */ })
object.when('ready', () => { /* ... */ })
```

### Check if the checkpoint has been passed

```ts
object.didEventHappen('ready')
```


## Link setTimeout to an object life span

The vanilla `setTimeout` function may generate errors when dealing with objects having a limited life span. If often leads to functions being triggered on destroyed objects.

EventHandler comes with a `this._setTimeout` and `this._clearTimeout` functions, sharing the same parameters and returned value as their vanilla equivalent.
The difference is that, once `this._trigger('destroy')` is called, any pending timeout will be canceled.

```ts
const timeoutId = this._setTimeout(handler, ms)
this._clearTimeout(timeoutId)
```

## Listen to events from the DOM

Let's say you create an object that will listen for mousemove events on the body. When using `addEventListener`, your event will be stored on the `document.body` object, which means it will persist even after your object has been destroyed.

EventHandler will keep track of these events to properly unregister them after destruction of your object.

```ts
this._registerEvent(document.body, 'mousemove', (event) => { /* ... */ })
this._registerEvent(document.body, 'mousemove', (event) => { /* ... */ }, selector)
this._registerEvent(document.body, 'mousemove', (event) => { /* ... */ }, { passive: true })
this._registerEvent(document.body, 'mousemove', (event) => { /* ... */ }, selector, { passive: true })
this._unregisterEvent(document.body, 'mousemove', handlerReference)
```
