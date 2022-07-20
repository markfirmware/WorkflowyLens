// ==UserScript==
// @name         WorkflowyLens
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  See more in Workflowy
// @author       Mark E Kendrat
// @match        https://workflowy.com/
// @match        https://beta.workflowy.com/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=workflowy.com
// @grant        none
// ==/UserScript==

(async () => {
    'use strict'
    var dev_mode = false
    var stopAppFn
    var WF
    const trap = f => {
        try {
            f()
        } catch (e) {
            console.log('trap WorkflowyLens', e)
        }
    }
    const wfevent_prefix = 'wfevent.'
    const setWfEventListener = f => { // this adds a trap and also adds the disambiguation prefix used by WorkflowyLens
        window.WFEventListener = raw_event_name => trap(() => f(wfevent_prefix + raw_event_name))
    }
    setWfEventListener(event => {
        if (event == documentReady) {
            WF = window.WF
            startApp(initialLog())
        }
    })
    const { h, text, app } = await import('https://unpkg.com/hyperapp')
    const initialLog = () => starredQueries()
    const showMessageClassName = ' _171q9nk'
    const listenToKeydown = (dispatch, action) => {
        const handler = e => trap (() => dispatch(action, e))
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }
    const listenToWfEvent = (dispatch, action) => {
        setWfEventListener(event => dispatch(action, event))
        return () => { window.WFEventListener = null }
    }
    const listenToWfShowMessageRemoved = (dispatch, action) => {
        const observer = new MutationObserver(
            (mutations_list) => {
                trap(() => {
                    mutations_list.forEach((mutation) => {
                        mutation.removedNodes.forEach((removed_node) => {
                            if(removed_node.className == showMessageClassName) {
                                dispatch(action)
                            }
                        })
                    })
                })
            })
        observer.observe(document.body, { subtree: true, childList: true })
        return () => observer.disconnect()
    }
    const onKeydown = (action) => [listenToKeydown, action]
    const onWfEvent = (action) => [listenToWfEvent, action]
    const onWfShowMessageRemoved = (action) => [listenToWfShowMessageRemoved, action]
    const app_dom_id = 'WorkflowyLens-showmessage-div'
    const isAppShown = () => document.getElementById(app_dom_id) && true
    const restartApp = (log, condition, f) => {
        if (condition) {
            f?.()
            if (isAppShown()) {
                return [log, () => WF.hideMessage()]
            } else {
                startApp(log)
            }
        } else {
            return [log]
        }
    }
    const documentReady = wfevent_prefix + 'documentReady'
    const locationChanged = wfevent_prefix + 'locationChanged'
    const searchTyped = wfevent_prefix + 'searchTyped'
    const searchHistorySelectElementId = 'WorkflowyLens.searchHistorySelectElement.id'
    const fxFocusSearchHistory = () => requestAnimationFrame(() => document.getElementById(searchHistorySelectElementId)?.focus())
    const actions = {
        WfShowMessageRemoved: log => [record(log, 'WfShowMessageRemoved', !q.isGuidanceIssued(log) && { guidanceissued: true }), q.isGuidanceIssued(log) || (() => WF.showMessage('WorkflowyLens message can be toggled with control-l'))],
        ChangeSearch: (log, query) => [record(log, "ChangeSearch", { query }), () => WF.search(query)],
        WfEvent: (log, event) => [record(log, event)],
        Keydown: (log, e) => restartApp(log, e.ctrlKey && e.key == 'l', () => e.preventDefault()),
        DevShowInfoMessage: log => [record(log, 'DevShowInfoMessage'), () => WF.showMessage('show message')],
        DevResetLog: _ => [record(initialLog(), "DevResetLog")],
        DevToggleShowLog: log => [record(log, "DevToggleShowLog", { show_log: !q.showLog(log) })],
    }
    const q = {
        isGuidanceIssued: log => q.mostRecent(log, 'guidanceissued', false),
        getSearchHistory: log => {
            const h = [""]
            for (const r of q.stableQueries(log)) {
                if (r?.query && !h.includes(r.query)) {
                    h.push(r.query)
                }
            }
            return h
        },
        stableQueries: log => {
            const log2 = []
            var i = 0
            while (i < log.length) {
                if (i + 1 < log.length &&
                    log[i + 0].event == searchTyped &&
                    log[i + 1].event == locationChanged &&
                    log[i + 1].query !== undefined) {
                    log2.push(log[i + 1])
                    var x = log[i + 1].query
                    i += 2
                    while (i + 1 < log.length &&
                           log[i + 0].event == searchTyped &&
                           log[i + 1].event == locationChanged &&
                           log[i + 1].query !== undefined &&
                           x.startsWith(log[i + 1].query)) {
                        x = log[i + 1].query
                        i += 2
                    }
                } else {
                    if (log[i + 0] !== undefined) {
                        log2.push(log[i + 0])
                    }
                    i += 1
                }
            }
            return log2
        },
        mostRecent: (log, propertyName, def = '') => {
            for (const x of log) {
                const y = x[propertyName]
                if (y !== undefined) {
                    return y
                }
            }
            return def
        },
        focusedId: log => q.mostRecent(log, 'focusedId'),
        focusedItem: log => WF.getItemById(q.focusedId(log)),
        focusedName: log => {
            const item = q.focusedItem(log)
            return item == null ? null : item.getNameInPlainText()
        },
        currentId: log => q.mostRecent(log, 'currentId'),
        query: log => q.mostRecent(log, 'query'),
        showLog: log => q.mostRecent(log, 'show_log', false),
    }
    const lostFocus = (log, item) => {}
    const record = (log, event, more) => {
        var r = { event: event }
        var x = WF.currentItem().getId()
        if (x != q.currentId(log)) {
            r.currentId = x
        }
        const query_or_null = WF.currentSearchQuery()
        x = query_or_null ? query_or_null.trim() : ""
        if (x != q.query(log)) {
            r.query = x
        }
        return [{ ...r, ...more }, ...log]
    }
    const logItemToString = r => {
        var s = ""
        for (const [k, v] of Object.entries(r)) {
            s += k + ":" + v + " "
        }
        return s
    }
    const starredQueries = () => {
        return WF.starredLocations()
            .filter(x => x.search != null)
            .map(x => x.search)
            .sort()
            .reverse()
            .reduce((acc, i) => {
            acc[i.startsWith("@") ? 1 : 0].push(i)
            return acc
        }, [[], []]).flat().reduce((list, x) => [{ event: 'StarredQuery', query: x }, ...list], [])
    }
    const startApp = log => {
        stopAppFn?.()
        WF.showMessage(`<div id="${app_dom_id}"></div>`)
        stopAppFn = app({
            node: document.getElementById(app_dom_id),
            init: [record(log, "startApp"), fxFocusSearchHistory],
            view: log =>
            h("div", { title: "WorkflowyLens", style: { "text-align": "left" } }, [
                dev_mode && h('button', { onclick: actions.DevShowInfoMessage }, text('show message')),
                dev_mode && h("button", { onclick: actions.DevToggleShowLog, title: "hide/show event log" },
                              text(log.length.toString().padStart(3, "0") + (log.length == 1 ? "  event" : " events"))),
                q.getSearchHistory(log).length > 1 && h("select", {
                    id: searchHistorySelectElementId,
                    style: { position: "absolute", right: "50px", top: "5px" },
                    onchange: (_, e) => [actions.ChangeSearch, e.target.value],
                    title: "search history including starred"
                }, q.getSearchHistory(log).map(x => h("option", {selected: x == q.query(log), title: x}, text(x)))),
                h("div", { hidden: !q.showLog(log) || log.length == 0 }, [
                    h("button", { onclick: actions.DevResetLog, title: "reset event log" }, text("reset")),
                    h("div", {},
                      h("ul", {}, log.slice(0, 10).map(x => h("li", {}, text(logItemToString(x))))),
                     )]),
            ]),
            subscriptions: log => [onKeydown(actions.Keydown),
                                   onWfEvent(actions.WfEvent),
                                   onWfShowMessageRemoved(actions.WfShowMessageRemoved)],
        })
    }
    })()
