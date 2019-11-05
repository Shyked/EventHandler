class EventHandler {


    constructor() {
        this._eh_extEvents         = [];
        this._eh_events            = {};
        this._eh_mutationObservers = [];
        this._eh_eventCheckpoints  = {};
        this._eh_timeouts          = [];

        this._eh_initEvents();
    };

    _eh_initEvents() {
        this.on('destroy', () => {
            this._unregisterEvents();
            this._clearTimeouts();
        });
    };

    _eh_isElementsArray(obj) {
        return Array.isArray(obj) || obj instanceof NodeList || obj instanceof HTMLCollection;
    };

    /* EXTERNAL */
    /* For DOM modifications */

    _registerEvent(els, event, handler, selector, options) {
        if (typeof selector != "string") {
            options = selector;
            selector = null;
        }
        var that = this;
        if (!this._eh_isElementsArray(els))
            els = [els];
        for (var i = 0 ; i < els.length ; i++) {
            var el = els[i];
            var handlerOverload = function(e) {
                if (!selector) handler.apply(that, arguments);
                else if (e.target.matches(selector)) handler.apply(that, arguments);
            };
            this._eh_extEvents.push({
                el: el,
                event: event,
                handler: handlerOverload,
                referenceHandler: handler
            })
            el.addEventListener(event, handlerOverload, options);
        }
    };

    _unregisterEvent(els, event, handler) {
        var that = this;
        if (!this._eh_isElementsArray(els))
            els = [els];
        for (var i = 0 ; i < els.length ; i++) {
            var el = els[i];
            for (var idE = 0 ; idE < this._eh_extEvents.length ; idE++) {
                if (this._eh_extEvents[idE].el == el
                    && this._eh_extEvents[idE].event == event
                    && (this._eh_extEvents[idE].referenceHandler == handler || !handler)) {
                    el.removeEventListener(this._eh_extEvents[idE].event, this._eh_extEvents[idE].handler);
                    this._eh_extEvents.splice(idE, 1);
                    idE--;
                }
            }
        }
    }

    _unregisterEvents() {
        for (var i = 0 ; i < this._eh_extEvents.length ; i++) {
            var ev = this._eh_extEvents[i];
            ev.el.removeEventListener(ev.event, ev.handler);
        }
        this._eh_extEvents = [];
        for (var i = 0 ; i < this._eh_mutationObservers.length ; i++) {
            this._eh_mutationObservers[i].disconnect();
        }
        this._eh_mutationObservers = [];
    };

    _onRemove(el, handler) {
        if (MutationObserver) {
            var parent = el.parentElement;
            if (!parent) {
                console.log(el);
                console.log("Can't bind onRemove handler because element does not have a parent.")
            }
            else {
                var observer = new MutationObserver(function (mutationsList) {
                    for (var idM in mutationsList) {
                        if ({}.hasOwnProperty.call(mutationsList, idM)) {
                            if (mutationsList[idM].type == 'childList') {
                                mutationsList[idM].removedNodes.forEach(function (removedNode) {
                                    if (removedNode == el)
                                        handler();
                                });
                            }
                        }
                    }
                });
                observer.observe(el.parentElement, { childList: true });
                this._eh_mutationObservers.push(observer);
            }

        }
        else console.error('MutationObserver not supported.');
    };

    _onNewChild(el, handler) {
        if (MutationObserver) {
            var observer = new MutationObserver(function (mutationsList) {
                for (var idM in mutationsList) {
                    if ({}.hasOwnProperty.call(mutationsList, idM)) {
                        if (mutationsList[idM].type == 'childList') {
                            mutationsList[idM].addedNodes.forEach(function(el) {
                                handler(el);
                            });
                        }
                    }
                }
            });
            observer.observe(el, { childList: true });
            this._eh_mutationObservers.push(observer);
        }
        else console.error('MutationObserver not supported.');
    };

    /* INTERNAL */
    /* Triggered with JS */

    _trigger(ev) {
        if (this._eh_events[ev]) {
            var deleteListeners = [];
            var handlersCopy = [];
            for (var i = 0 ; i < this._eh_events[ev].length ; i++)
                handlersCopy.push(this._eh_events[ev][i]);
            for (var i = 0 ; i < handlersCopy.length ; i++) {
                handlersCopy[i].handler.apply(this, Array.prototype.slice.call(arguments, 1));
                if (!handlersCopy[i]) i--;
                else {
                    if (handlersCopy[i].times != -1) {
                        handlersCopy[i].times--;
                        if (handlersCopy[i].times == 0) {
                            deleteListeners.push(handlersCopy[i]);
                        }
                    }
                }
            }
            if (deleteListeners.length > 0) {
                for (var i = 0 ; i < deleteListeners.length ; i++) {
                    this.off(ev, deleteListeners[i].handler)
                }
            }
        }
    };

    on(ev, handler, times) {
        if (!this._eh_events[ev]) this._eh_events[ev] = [];
        this._eh_events[ev].push({
            handler: handler,
            times: times || -1
        });
        return { event: ev, handler: handler, until: (obj, untilEv) => {
            if (typeof obj == 'string') {
                untilEv = obj;
                obj = this;
            }
            obj.once(untilEv, () => {
                this.off(ev, handler);
            });
        } };
    };

    once(ev, handler) {
        return this.on(ev, handler, 1);
    };

    off(ev, handler) {
        if (this._eh_events[ev]) {
            for (var i = 0 ; i < this._eh_events[ev].length ; i++) {
                if (this._eh_events[ev][i].handler == handler) {
                    this._eh_events[ev].splice(i, 1);
                    return
                }
            }
        }
    };

    /* CHECKPOINT */
    /* Ensures a certain event happened before continuing */

    /**
     * await when('you-are-ready')
     * when('you-are-ready', () => {})
     * 
     * @param  {string}   eventName
     * @param  {function} callback  (optional)
     * @return {Promise}
     */
    when(eventName, callback) {
        var promiseFunction = (resolve, reject) => {
            if (!this._eh_eventCheckpoints[eventName]) this._eh_eventCheckpoints[eventName] = [];
            if (this._eh_eventCheckpoints[eventName] === true) {
                resolve();
                if (callback) callback();
            }
            else {
                this._eh_eventCheckpoints[eventName].push(resolve);
                if (callback) this._eh_eventCheckpoints[eventName].push(callback);
            }
        };
        if (Promise) return new Promise(promiseFunction);
        else return promiseFunction(function() {}, function() {});
    };

    didEventHappen(eventName) {
        return this._eh_eventCheckpoints[eventName] === true;
    }

    _eventHappened(eventName) {
        if (this._eh_eventCheckpoints[eventName] !== true) {
            if (Array.isArray(this._eh_eventCheckpoints[eventName])) {
                this._eh_eventCheckpoints[eventName].forEach(resolve => {
                    resolve();
                });
            }
            this._eh_eventCheckpoints[eventName] = true;
        }
    };

    /* TIMEOUTS */

    _setTimeout(handler, time) {
        let timeoutId = setTimeout(() => {
            this._clearTimeout(timeoutId);
            handler();
        }, time);
        this._eh_timeouts.push(timeoutId);
        return timeoutId;
    };

    _clearTimeout(timeoutId) {
        clearTimeout(timeoutId);
        this._eh_timeouts.splice(this._eh_timeouts.indexOf(timeoutId), 1);
    }

    _clearTimeouts() {
        for (var i = 0 ; i < this._eh_timeouts ; i++) {
            clearTimeout(this._eh_timeouts[i]);
        }
        this._eh_timeouts = [];
    }

};


// Polyfill

if (!Element.prototype.matches) {
    Element.prototype.matches =
        Element.prototype.matchesSelector ||
        Element.prototype.mozMatchesSelector ||
        Element.prototype.msMatchesSelector ||
        Element.prototype.oMatchesSelector ||
        Element.prototype.webkitMatchesSelector ||
        function(s) {
            var matches = (this.document || this.ownerDocument).querySelectorAll(s),
                i = matches.length;
            while (--i >= 0 && matches.item(i) !== this) {}
            return i > -1;
        };
}
