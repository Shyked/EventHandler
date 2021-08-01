interface ExtEventReference {
  el: Node | Window,
  event: string,
  handler: (...args: unknown[]) => void,
  referenceHandler: (...args: unknown[]) => void
}

interface EventReference<CustomOnEvents> {
  handler: CustomOnEvents,
  times: number
}

// interface EventReferencesCollection {
//   [key: string]: EventReference[];
// }

interface ResolvesCollection {
  [key: string]: (() => void)[]
}

type ElementsArray = (Node | Window)[] | NodeList | HTMLCollection

interface OnEvents {
  [name: string]: (...args) => void
}

/*
  Helps creating register and unregister events on DOM
  Also helps creating internal events tied to the object itself and not to DOM elements

  https://github.com/Shyked/EventHandler/blob/master/EventHandler.ts
*/
export class EventHandler<CustomOnEvents extends OnEvents> {
  /* eslint-disable camelcase */
  _eh_extEvents: ExtEventReference[] = []
  _eh_mutationObservers: MutationObserver[] = []
  _eh_eventCheckpoints: boolean | ResolvesCollection = {}
  _eh_timeouts: ReturnType<typeof setTimeout>[] = []

  _eh_events: {
    [K in keyof CustomOnEvents]?: EventReference<CustomOnEvents[K] | (() => void)>[]
  } = {}

  constructor () {
    this._eh_initEvents()
  }

  _eh_initEvents (): void {
    this.on('destroy', () => {
      this._unregisterEvents()
      this._clearTimeouts()
    })
  }

  _eh_isElementsArray (obj: unknown): boolean {
    return Array.isArray(obj) || obj instanceof NodeList || obj instanceof HTMLCollection
  }
  /* eslint-enable camelcase */

  /* EXTERNAL */
  /* For DOM modifications */

  _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: unknown) => unknown): void
  _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: unknown) => unknown, selector: string): void
  _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: unknown) => unknown, options: Parameters<typeof Node.prototype.addEventListener>[2]): void
  _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: unknown) => unknown, selector: string, options: Parameters<typeof Node.prototype.addEventListener>[2]): void
  _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: unknown) => unknown, arg1: unknown = null, arg2: unknown = null): void {
    let selector: string
    let options: Parameters<typeof Node.prototype.addEventListener>[2]
    let elements: ElementsArray
    if (typeof arg1 === 'string') {
      selector = arg1
      options = arg2
    } else {
      selector = null
      options = arg1
    }
    if (!this._eh_isElementsArray(els)) {
      elements = [els as Node]
    } else {
      elements = els as ElementsArray
    }
    const that = this // eslint-disable-line @typescript-eslint/no-this-alias

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      const handlerOverload = function (event: Event, ...args: unknown[]) {
        if (!selector) handler.call(that, event, ...args)
        else if ((event.target as Element).matches(selector)) handler.call(that, event, ...args)
      }
      this._eh_extEvents.push({
        el: el,
        event: event,
        handler: handlerOverload,
        referenceHandler: handler
      })
      ;(el as Node).addEventListener(event, handlerOverload, options)
    }
  }

  _unregisterEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: unknown) => unknown = null): void {
    let elements: ElementsArray
    if (!this._eh_isElementsArray(els)) {
      elements = [els as Node]
    } else {
      elements = els as ElementsArray
    }

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      for (let idE = 0; idE < this._eh_extEvents.length; idE++) {
        if (this._eh_extEvents[idE].el == el &&
          this._eh_extEvents[idE].event == event &&
          (this._eh_extEvents[idE].referenceHandler == handler || !handler)) {
          el.removeEventListener(this._eh_extEvents[idE].event, this._eh_extEvents[idE].handler)
          this._eh_extEvents.splice(idE, 1)
          idE--
        }
      }
    }
  }

  _unregisterEvents (): void {
    for (let i = 0; i < this._eh_extEvents.length; i++) {
      const ev = this._eh_extEvents[i]
      ev.el.removeEventListener(ev.event, ev.handler)
    }
    this._eh_extEvents = []
    for (let i = 0; i < this._eh_mutationObservers.length; i++) {
      this._eh_mutationObservers[i].disconnect()
    }
    this._eh_mutationObservers = []
  }

  _onRemove (el: Node, handler: () => void): void {
    if (MutationObserver) {
      const parent = el.parentElement
      if (!parent) {
        console.log(el)
        console.log("Can't bind onRemove handler because element does not have a parent.")
      } else {
        const observer = new MutationObserver(function (mutationsList) {
          for (const idM in mutationsList) {
            if ({}.hasOwnProperty.call(mutationsList, idM)) {
              if (mutationsList[idM].type == 'childList') {
                mutationsList[idM].removedNodes.forEach(function (removedNode) {
                  if (removedNode == el) handler()
                })
              }
            }
          }
        })
        observer.observe(el.parentElement, { childList: true })
        this._eh_mutationObservers.push(observer)
      }
    } else console.error('MutationObserver not supported.')
  }

  _onNewChild (el: Node, handler: (el: Node) => void): void {
    if (MutationObserver) {
      const observer = new MutationObserver(function (mutationsList) {
        for (const idM in mutationsList) {
          if ({}.hasOwnProperty.call(mutationsList, idM)) {
            if (mutationsList[idM].type == 'childList') {
              mutationsList[idM].addedNodes.forEach(function (el) {
                handler(el)
              })
            }
          }
        }
      })
      observer.observe(el, { childList: true })
      this._eh_mutationObservers.push(observer)
    } else console.error('MutationObserver not supported.')
  }

  /* INTERNAL */
  /* Triggered with JS */

  /**
   * ```
   * // Triggering the event within the object
   * this._trigger('event_name', param1, param2, param3)
   *
   * // Receiving the event from the external context
   * obj.on('event_name', (param1, param2, param3) => {
   *   console.log('event_name triggered!')
   * })
   * ```
   */
  _trigger<CustomOnEventName extends keyof CustomOnEvents> (
    ev: CustomOnEventName,
    ...args: Parameters<CustomOnEvents[CustomOnEventName]>
  ): void {
    if (this._eh_events[ev]) {
      const deleteListeners = []
      const handlersCopy = []
      for (let i = 0; i < this._eh_events[ev].length; i++) {
        handlersCopy.push(this._eh_events[ev][i])
      }
      for (let i = 0; i < handlersCopy.length; i++) {
        handlersCopy[i].handler.call(this, ...args)
        if (!handlersCopy[i]) i--
        else {
          if (handlersCopy[i].times != -1) {
            handlersCopy[i].times--
            if (handlersCopy[i].times == 0) {
              deleteListeners.push(handlersCopy[i])
            }
          }
        }
      }
      if (deleteListeners.length > 0) {
        for (let i = 0; i < deleteListeners.length; i++) {
          this.off(ev, deleteListeners[i].handler)
        }
      }
    }
  }

  /**
   * ```
   * // Triggering the event within the object
   * this._trigger('event_name', param1, param2, param3)
   *
   * // Receiving the event from the external context
   * obj.on('event_name', (param1, param2, param3) => {
   *   console.log('event_name triggered!')
   * })
   * ```
   */
  on<CustomOnEventName extends keyof CustomOnEvents> (
    ev: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void),
    times: number = null
  ): {
    event: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void),
    until: <Custom2OnEvents extends OnEvents>(
      obj: EventHandler<Custom2OnEvents> | keyof CustomOnEvents,
      untilEv?: keyof Custom2OnEvents
    ) => void
  } {
    if (!this._eh_events[ev]) this._eh_events[ev] = []
    this._eh_events[ev].push({
      handler: handler,
      times: times || -1
    })
    return {
      event: ev,
      handler: handler,
      until: (obj, untilEv): void => {
        if (obj instanceof EventHandler) {
          obj.once(untilEv, () => {
            this.off(ev, handler)
          })
        } else if (typeof obj == 'string') {
          this.once(obj, () => {
            this.off(ev, handler)
          })
        }
      }
    }
  }

  /**
   * Listens for an event only once,
   * will stop listening after the first occurrence.
   *
   * Alias for:
   * ```
   * this.on('event_name', () => {}, 1)
   * ```
   */
  once<CustomOnEventName extends keyof CustomOnEvents> (
    ev: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void)
  ): {
    event: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void),
    until: <Custom2OnEvents extends OnEvents>(
      obj: EventHandler<Custom2OnEvents> | keyof CustomOnEvents,
      untilEv?: keyof Custom2OnEvents
    ) => void
  } {
    return this.on(ev, handler, 1)
  }

  off<U extends keyof CustomOnEvents> (
    ev: U,
    handler: CustomOnEvents[U] | (() => void)
  ): void {
    if (this._eh_events[ev]) {
      for (let i = 0; i < this._eh_events[ev].length; i++) {
        if (this._eh_events[ev][i].handler == handler) {
          this._eh_events[ev].splice(i, 1)
          return
        }
      }
    }
  }

  /* CHECKPOINT */
  /* Ensures a certain event happened before continuing */

  /**
   * await when('you-are-ready')
   * when('you-are-ready', () => {})
   */
  when (eventName: string, callback: () => void = null): Promise<void> {
    const promiseFunction = (resolve = null) => {
      if (!this._eh_eventCheckpoints[eventName]) this._eh_eventCheckpoints[eventName] = []
      if (this._eh_eventCheckpoints[eventName] === true) {
        try {
          if (resolve) resolve()
          if (callback) callback()
        } catch (e) {
          console.error(e)
        }
      } else {
        if (resolve) this._eh_eventCheckpoints[eventName].push(resolve)
        if (callback) this._eh_eventCheckpoints[eventName].push(callback)
      }
    }
    if (Promise) return new Promise(promiseFunction)
    else promiseFunction()
  }

  didEventHappen (eventName: string): boolean {
    return this._eh_eventCheckpoints[eventName] === true
  }

  _eventHappened (eventName: string): void {
    if (this._eh_eventCheckpoints[eventName] !== true) {
      if (Array.isArray(this._eh_eventCheckpoints[eventName])) {
        this._eh_eventCheckpoints[eventName].forEach((resolve: () => void) => {
          resolve()
        })
      }
      this._eh_eventCheckpoints[eventName] = true
    }
  }

  /* TIMEOUTS */

  _setTimeout (handler: () => void, time: number): ReturnType<typeof setTimeout> {
    const timeoutId = setTimeout(() => {
      this._clearTimeout(timeoutId)
      handler()
    }, time)
    this._eh_timeouts.push(timeoutId)
    return timeoutId
  }

  _clearTimeout (timeoutId: ReturnType<typeof setTimeout>): void {
    clearTimeout(timeoutId)
    this._eh_timeouts.splice(this._eh_timeouts.indexOf(timeoutId), 1)
  }

  _clearTimeouts (): void {
    for (let i = 0; i < this._eh_timeouts.length; i++) {
      clearTimeout(this._eh_timeouts[i])
    }
    this._eh_timeouts = []
  }
}
