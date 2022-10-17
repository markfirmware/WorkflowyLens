// ==UserScript==
// @name         WorkflowyLens
// @namespace    http://tampermonkey.net/
// @version      0.5.1
// @description  See more in Workflowy
// @author       Mark E Kendrat
// @match        https://workflowy.com
// @match        https://beta.workflowy.com
// @match        https://dev.workflowy.com
// @icon         https://www.google.com/s2/favicons?sz=64&domain=workflowy.com
// @grant        none
// ==/UserScript==

await (async () => {
    'use strict'
    const { h, text, app } = await import('https://unpkg.com/hyperapp')
    const script_name = 'WorkflowyLens'
    var stopHyperAppFn
    var WF
    const trap = f => {
        try {
            f()
        } catch (e) {
            console.log('trap', script_name, e)
        }
    }
    const DevMode = (() => {
        const isOn = log => false
        const ShowInfoMessage = log => [record(log, 'ShowInfoMessage'), () => WF.showMessage('show message')]
        const ResetLog = _ => [record(initialLog(), "ResetLog")]
        const ToggleShowLog = log => [record(log, "ToggleShowLog", { showLog: !q.showLog(log) })]
        return { isOn, ShowInfoMessage, ResetLog, ToggleShowLog }
    })()
    const WfEvents = (() => {
        const withWfPrefix = e => 'wfevent.' + e
        const listenToWfEvent = (dispatch, action) => {
            current_wfeventlistener = event => dispatch(action, event)
            return () => { current_wfeventlistener = null }
        }
        const onEvent = (action) => [listenToWfEvent, action]
        return {
            onEvent,
            withWfPrefix,
            documentReady: withWfPrefix('documentReady'),
            locationChanged: withWfPrefix('locationChanged'),
            searchTyped: withWfPrefix('searchTyped'),
        }})()
    const saved_wfeventlistener = window.WFEventListener
    var current_wfeventlistener
    window.WFEventListener = raw_event_name => trap(() => {
        current_wfeventlistener?.(WfEvents.withWfPrefix(raw_event_name))
        saved_wfeventlistener?.(raw_event_name)
    })
    const Keyboard = (() => {
        const listenToKeydown = (dispatch, action) => {
            const handler = e => trap (() => dispatch(action, e))
            window.addEventListener('keydown', handler)
            return () => window.removeEventListener('keydown', handler)
        }
        return {
            onKeydown: action => [listenToKeydown, action]
        }
    })()
    const initialLog = () => Starred.allQueries()
    const SearchHistory = (() => {
        const selectElementId = 'WorkflowyLens.searchHistorySelectElement.id'
        const getHistory = log => {
            const h = [""]
            for (const r of stableQueries(log)) {
                if (r?.query && !h.includes(r.query)) {
                    h.push(r.query)
                }
            }
            return h
        }
        const stableQueries = log => {
            const log2 = []
            var i = 0
            while (i < log.length) {
                if (i + 1 < log.length &&
                    log[i + 0].event == WfEvents.searchTyped &&
                    log[i + 1].event == WfEvents.locationChanged &&
                    log[i + 1].query !== undefined) {
                    log2.push(log[i + 1])
                    var x = log[i + 1].query
                    i += 2
                    while (i + 1 < log.length &&
                           log[i + 0].event == WfEvents.searchTyped &&
                           log[i + 1].event == WfEvents.locationChanged &&
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
        }
        const ChangeSearch = (log, query) => [record(log, "ChangeSearch", { query }), () => WF.search(query)]
        const fxFocusSearchHistory = () => requestAnimationFrame(() => document.getElementById(selectElementId)?.focus())
        return { ChangeSearch, fxFocusSearchHistory,
                view: log => [
                    getHistory(log).length > 1 &&
                    h("span", { style: { position: "absolute",
                                        right: "50px",
                                        top: "50%",
                                        "-ms-transform": "translateY(-50%)",
                                        transform: "translateY(-50%)"
                                       } }, [
                        text("search "),
                        text("history "),
                        h("select", {
                            id: selectElementId,
                            onchange: (_, e) => [ChangeSearch, e.target.value],
                            title: "search history including starred"
                        }, getHistory(log).map(x => h("option", {selected: x == q.query(log), title: x}, text(x))))]),
                ],
               }})()
    const actions = {
        Keydown: (log, e) => WfShowMessage.restartHyperApp(log, e.ctrlKey && e.key == 'l', () => e.preventDefault()),
        WfShowMessageRemoved: log => [record(log, 'WfShowMessageRemoved', !q.isGuidanceIssued(log) && { guidanceissued: true }), q.isGuidanceIssued(log) || (() => WF.showMessage('WorkflowyLens message can be toggled with Ctrl+l (lower case "L"'))],
        WfEvent: (log, event) => [record(log, event)],
    }
    const q = {
        isGuidanceIssued: log => q.mostRecent(log, 'guidanceissued', false),
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
        showLog: log => q.mostRecent(log, 'showLog', false),
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
    const Starred = (() => {
        const allQueries = () => {
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
        return { allQueries }
    })()
    const startHyperApp = log => {
        stopHyperAppFn?.()
        WfShowMessage.show(`<div id="${WfShowMessage.app_dom_id}"></div>`)
        stopHyperAppFn = app({
            node: WfShowMessage.appElement(),
            init: [record(log, "startHyperApp"), SearchHistory.fxFocusSearchHistory],
            view: log =>
            h("div", { title: "WorkflowyLens", style: { "text-align": "left" } }, [
                DevMode.isOn(log) && h('button', { onclick: DevMode.ShowInfoMessage }, text('show message')),
                DevMode.isOn(log) && h("button", { onclick: DevMode.ToggleShowLog, title: "hide/show event log" },
                                       text(log.length.toString().padStart(3, "0") + (log.length == 1 ? "  event" : " events"))),
                text("WorkflowyLens!"),
                ...SearchHistory.view(log),
                h("div", { hidden: !q.showLog(log) || log.length == 0 }, [
                    h("button", { onclick: actions.DevResetLog, title: "reset event log" }, text("reset")),
                    h("div", {},
                      h("ul", {}, log.slice(0, 10).map(x => h("li", {}, text(logItemToString(x))))),
                     )]),
            ]),
            subscriptions: log => [Keyboard.onKeydown(actions.Keydown),
                                   WfEvents.onEvent(actions.WfEvent),
                                   WfShowMessage.onRemoved(actions.WfShowMessageRemoved)],
        })
    }
    const WfShowMessage = (() => {
        const showMessageClassName = ' _171q9nk'
        const app_dom_id = 'WorkflowyLens-showmessage-div'
        const show = html => WF.showMessage(html)
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
        const onRemoved = (action) => [listenToWfShowMessageRemoved, action]
        const isAppShown = () => document.getElementById(WfShowMessage.app_dom_id) && true
        const appElement = () => document.getElementById(app_dom_id)
        const restartHyperApp = (log, condition, f) => {
            if (condition) {
                f?.()
                if (isAppShown()) {
                    return [log, () => WF.hideMessage()]
                } else {
                    startHyperApp(log)
                }
            } else {
                return [log]
            }
        }
        return { show, app_dom_id, isAppShown, appElement, onRemoved, restartHyperApp }
    })()
    current_wfeventlistener = event => {
        if (event == WfEvents.documentReady) {
            WF = window.WF
            startHyperApp(initialLog())
        }
    }
})()
