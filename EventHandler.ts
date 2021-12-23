const GLOBAL_LOGGING = false

interface ExtEventReference {
  el: Node | Window,
  event: string,
  handler: (...args: unknown[]) => void,
  referenceHandler: (...args: unknown[]) => void
}

interface ResolvesCollection {
  [key: string]: (() => void)[]
}

type ElementsArray = (Node | Window)[] | NodeList | HTMLCollection

export type OnEvents = Record<string, (...args) => void>

/*
  Helps creating register and unregister events on DOM
  Also helps creating internal events tied to the object itself and not to DOM elements

  https://github.com/Shyked/EventHandler/blob/master/EventHandler.es6.js
*/
export class EventHandler<CustomOnEvents extends OnEvents = OnEvents> {
  /* eslint-disable camelcase */
  private _eh_extEvents: ExtEventReference[] = []
  private _eh_mutationObservers: MutationObserver[] = []
  private _eh_eventCheckpoints: boolean | ResolvesCollection = {}
  private _eh_timeouts: ReturnType<typeof setTimeout>[] = []
  private _eh_logsEnabled = false

  constructor () {
    this._eh_initEvents()
  }

  private _eh_initEvents (): void {
    this._listen(this, 'destroy', () => {
      this._unregisterEvents()
      this._offAll()
      this._clearTimeouts()
    })
  }

  private _eh_isElementsArray (obj: unknown): obj is ElementsArray {
    return Array.isArray(obj) || obj instanceof NodeList || obj instanceof HTMLCollection
  }

  private _eh_on<CustomOnEventName extends keyof CustomOnEvents> (
    ev: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void),
    times: number | null = null,
    subscriber: EventHandler<OnEvents> | null = null
  ): {
    event: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void),
    until: <Custom2OnEvents extends OnEvents>(
      obj: EventHandler<Custom2OnEvents> | keyof CustomOnEvents,
      untilEv?: keyof Custom2OnEvents
    ) => void
  } {
    const listener = new Listener({
      subscriber: subscriber,
      emittor: this,
      eventName: ev,
      handler: handler,
      times: times
    })
    ListenerBank.store(listener)
    return {
      event: ev,
      handler: handler,
      until: (obj, untilEv): void => {
        if (obj instanceof EventHandler && untilEv) {
          this._listenOnce(obj, untilEv, () => {
            this.off(ev, handler)
          })
        } else if (typeof obj == 'string') {
          this._listenOnce(this, obj, () => {
            this.off(ev, handler)
          })
        }
      }
    }
  }

  private _eh_log (...args: unknown[]): void {
    if (this._eh_logsEnabled || GLOBAL_LOGGING) {
      console.log('[EVENT_HANDLER]', ...args)
    }
  }

  /**
   * The until function of _listen only suggest strings in auto complete if no
   * function in this class is using the CustomOnEvents type directly.
   */
  private _eh_thisIsADirtyFixForListenFunctions (obj?: CustomOnEvents): void {
    void obj
  }
  /* eslint-enable camelcase */

  protected _enableEventLogs (): void {
    this._eh_logsEnabled = true
  }

  /* EXTERNAL */
  /* For DOM modifications */

  protected _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: Event) => unknown): void
  protected _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: Event) => unknown, selector: string): void
  protected _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: Event) => unknown, options: Parameters<typeof Node.prototype.addEventListener>[2]): void
  protected _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: Event) => unknown, selector: string, options: Parameters<typeof Node.prototype.addEventListener>[2]): void
  protected _registerEvent (els: ElementsArray | Node | Window, event: string, handler: (this: Node | Window, ev: Event) => unknown, arg1: unknown = null, arg2: unknown = null): void {
    let selector: string | null
    let options: Parameters<typeof Node.prototype.addEventListener>[2]
    let elements: ElementsArray
    if (typeof arg1 === 'string') {
      selector = arg1
      options = arg2 as typeof options
    } else {
      selector = null
      options = arg1 as typeof options
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

  protected _unregisterEvent (els: ElementsArray | Node | Window, event: string, handler: ((this: Node | Window, ev: unknown) => unknown) | null = null): void {
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

  protected _unregisterEvents (): void {
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

  protected _onRemove (el: Node, handler: () => void): void {
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

  protected _onNewChild (el: Node, handler: (el: Node) => void): void {
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
  protected _trigger<CustomOnEventName extends keyof CustomOnEvents> (
    ev: CustomOnEventName,
    ...args: Parameters<CustomOnEvents[CustomOnEventName]>
  ): void {
    const listeners = ListenerBank.getEmittorEventListeners(this, ev)
    this._eh_log(ev, this, listeners)
    if (listeners) {
      const deleteListeners: typeof listeners = []
      const handlersCopy: typeof listeners = []
      for (let i = 0; i < listeners.length; i++) {
        handlersCopy.push(listeners[i])
      }
      for (let i = 0; i < handlersCopy.length; i++) {
        try {
          handlersCopy[i].handler.call(this, ...args)
        } catch (e) {
          Rollbar.error(e)
        }
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
   * A more stable approach than `obj.on()`.
   * Will make sure references are cleaned
   * after one of both objects is destroyed.
   */
  protected _listen<TargetOnEvents extends OnEvents, TargetOnEventName extends keyof TargetOnEvents> (
    obj: EventHandler<TargetOnEvents>,
    ev: TargetOnEventName,
    handler: TargetOnEvents[TargetOnEventName] | (() => void),
    times: number | null = null
  ): {
    event: TargetOnEventName,
    handler: TargetOnEvents[TargetOnEventName] | (() => void),
    until: <Custom2OnEvents extends OnEvents>(
      obj: EventHandler<Custom2OnEvents> | keyof TargetOnEvents,
      untilEv?: keyof Custom2OnEvents
    ) => void
  } {
    return obj._eh_on(ev, handler, times, this)
  }

  /**
   * Same as `_listen(obj, ev, handler, 1)`
   */
  protected _listenOnce<TargetOnEvents extends OnEvents, TargetOnEventName extends keyof TargetOnEvents> (
    obj: EventHandler<TargetOnEvents>,
    ev: TargetOnEventName,
    handler: TargetOnEvents[TargetOnEventName] | (() => void)
  ): {
    event: TargetOnEventName,
    handler: TargetOnEvents[TargetOnEventName] | (() => void),
    until: <Custom2OnEvents extends OnEvents>(
      obj: EventHandler<Custom2OnEvents> | keyof TargetOnEvents,
      untilEv?: keyof Custom2OnEvents
    ) => void
  } {
    return obj._eh_on(ev, handler, 1, this)
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
    times: number | null = null
  ): {
    event: CustomOnEventName,
    handler: CustomOnEvents[CustomOnEventName] | (() => void),
    until: <Custom2OnEvents extends OnEvents>(
      obj: EventHandler<Custom2OnEvents> | keyof CustomOnEvents,
      untilEv?: keyof Custom2OnEvents
    ) => void
  } {
    return this._eh_on(ev, handler, times, null)
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
    const listener = ListenerBank.get(this, ev, handler)
    if (listener) ListenerBank.drop(listener as Listener)
  }

  private _offAll () {
    ListenerBank.drop(this)
  }

  /* CHECKPOINT */
  /* Ensures a certain event happened before continuing */

  /**
   * await when('you-are-ready')
   * when('you-are-ready', () => {})
   */
  when (eventName: string, callback: (() => void) | null = null): Promise<void> {
    const promiseFunction = (resolve: (() => void) | null = null) => {
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
    return new Promise(promiseFunction)
  }

  didEventHappen (eventName: string): boolean {
    return this._eh_eventCheckpoints[eventName] === true
  }

  protected _eventHappened (eventName: string): void {
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

  protected _setTimeout (handler: () => void, time: number): ReturnType<typeof setTimeout> {
    const timeoutId = setTimeout(() => {
      this._clearTimeout(timeoutId)
      handler()
    }, time)
    this._eh_timeouts.push(timeoutId)
    return timeoutId
  }

  protected _clearTimeout (timeoutId: ReturnType<typeof setTimeout>): void {
    clearTimeout(timeoutId)
    this._eh_timeouts.splice(this._eh_timeouts.indexOf(timeoutId), 1)
  }

  protected _clearTimeouts (): void {
    for (let i = 0; i < this._eh_timeouts.length; i++) {
      clearTimeout(this._eh_timeouts[i])
    }
    this._eh_timeouts = []
  }
}

export class StandaloneEventHandler<StandaloneEvents extends OnEvents = OnEvents> extends EventHandler<StandaloneEvents> {
  public trigger (
    ...args: Parameters<EventHandler<StandaloneEvents>['_trigger']>
  ): ReturnType<EventHandler<StandaloneEvents>['_trigger']> {
    return this._trigger(...args)
  }
}

class Listener<EmittorOnEvents extends OnEvents = OnEvents, T extends keyof EmittorOnEvents = keyof EmittorOnEvents, SubscriberOnEvents extends OnEvents = OnEvents> {
  public subscriber: EventHandler<SubscriberOnEvents> | null
  public emittor: EventHandler<EmittorOnEvents>
  public eventName: T
  public handler: EmittorOnEvents[T]
  public times: number

  constructor (params: {
    subscriber: typeof this.subscriber,
    emittor: typeof this.emittor,
    eventName: typeof this.eventName,
    handler: typeof this.handler,
    times?: typeof this.times
  }) {
    this.subscriber = params.subscriber
    this.emittor    = params.emittor
    this.eventName  = params.eventName
    this.handler    = params.handler
    this.times      = params.times ?? -1
  }
}

type EventMap<EmittorOnEvents extends OnEvents = OnEvents, T extends keyof EmittorOnEvents = keyof EmittorOnEvents> = Record<T, Listener<EmittorOnEvents, T>[]>
type EmittorMap = Map<EventHandler, EventMap>
type SubscriberMap = Map<EventHandler, EmittorMap>

/**
 * Terminology:
 * ============
 *
 * - **Event :** Something that can happen on an object. It has a name and can happen multiple times (ex: position_updated).
 * - **Emittor :** The object that emits the event.
 * - **Subscriber :** Another object that will subscribe an event from an emittor. It can also be the emittor itself.
 * - **Listener :** A contract made between an emittor, a subscriber, for a given event.
 * - **EventHandler :** And object that can handle events, and thus become emittor or subscriber.
 * - **Handler :** A function bound to a listener, that is called once corresponding the event is triggered.
 */
const ListenerBank = new (class ListenerBank {
  private _subscriptions: SubscriberMap = new Map()
  private _emissions: EmittorMap = new Map()

  /**
   * Everytime EventHandler._listen() is called, the instanciated Listener is
   * stored here.
   * Once an event is triggered, having the listener stored here will allow the
   * corresponding handler to be ran.
   */
  store (listener: Listener): void {
    this._storeListenerForEmittor(listener)
    if (listener.subscriber) this._storeListenerforSubscriber(listener)
  }

  /**
   * Drop either an EventHandler or a Listener
   *
   * - The Listener will be dropped from both the subscriptions and emissions list
   * - Dropping an EventHandler will drop any Listener that has this EventHandler
   * as a Emittor or a Subscriber, in both the emissions and subscriptions list
   */
  drop (eventHandler: EventHandler): void
  drop (listener: Listener): void
  drop (x: EventHandler | Listener): void {
    if (x instanceof EventHandler) {
      const eventHandler = x
      this._dropEventHandlerListeners(eventHandler)
    } else if (x instanceof Listener) {
      const listener = x
      this._dropListenerFromEmittor(listener)
      if (listener.subscriber) this._dropListenerFromSubscriber(listener)
    } else {
      throw new Error('Cannot drop anything in ListenerBank from this type')
    }
  }

  /**
   * Get a specific Listener given the Emittor, the event name and its Handler
   */
  get<EmittorOnEvents extends OnEvents, T extends keyof EmittorOnEvents> (
    emittor: EventHandler<EmittorOnEvents>,
    eventName: T,
    handler: EmittorOnEvents[T] | (() => void)
  ): Listener<EmittorOnEvents, T> | null {
    const listeners = this.getEmittorEventListeners(emittor, eventName)
    for (let i = 0; i < listeners.length; i++) {
      const listener = listeners[i]
      if (listener.handler === handler) return listener
    }
    return null
  }

  /**
   * Get the list of all Listeners for a given Emittor and event name
   */
  getEmittorEventListeners<EmittorOnEvents extends OnEvents, T extends keyof EmittorOnEvents> (
    emittor: EventHandler<EmittorOnEvents>,
    eventName: T
  ): Listener<EmittorOnEvents, T>[] {
    const emittorEvents = this._emissions.get(emittor) as EventMap<EmittorOnEvents, T>
    if (!emittorEvents) return []
    const emittorEventListeners = emittorEvents[eventName]
    if (!emittorEventListeners) return []
    return emittorEventListeners
  }

  /**
   * Stores a Listener in the emissions list
   */
  private _storeListenerForEmittor (listener: Listener): void {
    let emittorEvents = this._emissions.get(listener.emittor)
    if (!emittorEvents) {
      emittorEvents = {}
      this._emissions.set(listener.emittor, emittorEvents)
    }
    let emittorEventListeners = emittorEvents[listener.eventName]
    if (!emittorEventListeners) {
      emittorEventListeners = []
      emittorEvents[listener.eventName] = emittorEventListeners
    }
    emittorEventListeners.push(listener)
  }

  /**
   * Stores a Listener in the subscriptions list
   */
  private _storeListenerforSubscriber (listener: Listener): void {
    if (listener.subscriber) {
      let subscriberEmittors = this._subscriptions.get(listener.subscriber)
      if (!subscriberEmittors) {
        subscriberEmittors = new Map()
        this._subscriptions.set(listener.subscriber, subscriberEmittors)
      }
      let subscriberEmittorEvents = subscriberEmittors.get(listener.emittor)
      if (!subscriberEmittorEvents) {
        subscriberEmittorEvents = {}
        subscriberEmittors.set(listener.emittor, subscriberEmittorEvents)
      }
      let subscriberEmittorEventListeners = subscriberEmittorEvents[listener.eventName]
      if (!subscriberEmittorEventListeners) {
        subscriberEmittorEventListeners = []
        subscriberEmittorEvents[listener.eventName] = subscriberEmittorEventListeners
      }
      subscriberEmittorEventListeners.push(listener)
    }
  }

  /**
   * Drops a specific Listener from the emissions list
   */
  private _dropListenerFromEmittor (listener: Listener): void {
    const emittorEvents = this._emissions.get(listener.emittor)
    if (!emittorEvents) return
    const emittorEventListeners = emittorEvents[listener.eventName]
    if (!emittorEventListeners) return
    const index = emittorEventListeners.indexOf(listener)
    if (~index) {
      emittorEventListeners.splice(index, 1)
    }
  }

  /**
   * Drops a specific Listener from the subscriptions list
   */
  private _dropListenerFromSubscriber (listener: Listener): void {
    if (listener.subscriber) {
      const subscriberEmittors = this._subscriptions.get(listener.subscriber)
      if (!subscriberEmittors) return
      const subscriberEmittorEvents = subscriberEmittors.get(listener.emittor)
      if (!subscriberEmittorEvents) return
      const subscriberEmittorEventListeners = subscriberEmittorEvents[listener.eventName]
      if (!subscriberEmittorEventListeners) return
      const index = subscriberEmittorEventListeners.indexOf(listener)
      if (~index) {
        subscriberEmittorEventListeners.splice(index, 1)
      }
    }
  }

  /**
   * Drops any Listener related to this EventHandler.
   * - If a subscriber is listening to events emitted by this EventHandler,
   * these Listeners will be dropped.
   * - If this EventHandler subscribed to events emitted by other EventHandlers,
   * the Listeners will be dropped too.
   */
  private _dropEventHandlerListeners (eventHandler: EventHandler): void {
    this._dropEventHandlerEmissions(eventHandler)
    this._dropEventHandlerSubscriptions(eventHandler)
  }

  /**
   * Drops any Listener to events emitted by the given EventHandler
   */
  private _dropEventHandlerEmissions (eventHandler: EventHandler): void {
    const emittorEvents = this._emissions.get(eventHandler)
    if (emittorEvents) {
      Object.keys(emittorEvents).forEach(eventName => {
        const listeners = emittorEvents[eventName]
        if (listeners) {
          const listenersCopy = listeners.slice()
          listenersCopy.forEach(listener => {
            this._dropListenerFromEmittor(listener)
            if (listener.subscriber) this._dropListenerFromSubscriber(listener)
          })
        }
      })
    }
    this._emissions.delete(eventHandler)
  }

  /**
   * Drops any Listener that was created by the EventHandler to subscribe
   * to another's events
   */
  private _dropEventHandlerSubscriptions (eventHandler: EventHandler): void {
    const subscriberEmittors = this._subscriptions.get(eventHandler)
    if (subscriberEmittors) {
      subscriberEmittors.forEach(subscriberEmittorEvents => {
        Object.keys(subscriberEmittorEvents).forEach(eventName => {
          const listeners = subscriberEmittorEvents[eventName]
          if (listeners) {
            const listenersCopy = listeners.slice()
            listenersCopy.forEach(listener => {
              this._dropListenerFromEmittor(listener)
              if (listener.subscriber) this._dropListenerFromSubscriber(listener)
            })
          }
        })
      })
    }
    this._subscriptions.delete(eventHandler)
  }
})()
