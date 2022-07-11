// ==UserScript==
// @name         WorkflowyLens
// @namespace    http://tampermonkey.net/
// @version      0.1
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
    window.WFEventListener = (event) => {
        if (event == 'documentReady') {
            const style = document.createElement('style')
            style.appendChild(document.createTextNode('')) // for webkit
            document.head.appendChild(style)
            // better alignment for monospace fonts
            style.sheet.addRule('.contentTag', 'padding: 0px 1px !important')
            style.sheet.addRule('.children', 'padding-left: 23px !important')
            addStarredQueries(starting_state)
            recordAction(starting_state, "StartApp")
            startApp(starting_state)
        }
    }
    const { h, text, app } = await import("https://unpkg.com/hyperapp")
    const WF = window.WF
    const locationChanged = "locationChanged"
    const searchTyped = "searchTyped"
    const listenToWorkflowyMessageRemoved = (dispatch, action) => {
        const observer = new MutationObserver((mutations_list) => {
            mutations_list.forEach((mutation) => {
                mutation.removedNodes.forEach((removed_node) => {
                    if(removed_node.className == ' _171q9nk') {
                        dispatch(action)
                    }
                })
            })
        })
        observer.observe(document.body, { subtree: true, childList: true })
        return () => observer.disconnect()
    }
    const onWorkflowyMessageRemoved = (action) => [listenToWorkflowyMessageRemoved, action]
    const starting_state = { log: [] }
    var stopAppFn
    var nesting = 0
    const WorkflowyMessageRemoved = (s) => {
        console.log("workflowy message removed - restarting ShowyWorkflowy")
        stopAppFn()
        startApp(s)
    }
    const listenToWorkflowyEvents = (dispatch, action) => {
        window.WFEventListener = (event) => {
            try {
                nesting += 1
                dispatch(action, event)
            } catch (e) {
                console.log(e)
            }
            nesting -= 1
        }
        return () => { window.WFEventListener = null }
    }
    const onWorkflowyEvent = (action) => [listenToWorkflowyEvents, action]
    const WfEventReceived = (s, event) => {
        try {
            const was_editing_id = isEditEvent(s.log?.[0].event) && focusedId(s.log)
            record(s, event, () => {
                if (isEditEvent(event)) {
                    const focused = WF.focusedItem()
                    return { commentFocusedName: focused != null ?
                            focused.getNameInPlainText() : "<not focused!>" }
                }
            })
            if (focusedId(s.log) != was_editing_id) {
                const was_editing_item = WF.getItemById(was_editing_id)
                if (was_editing_item) {
                    lostFocus(s, was_editing_item)
                } else {
                    console.log("editing " + was_editing_id + " not found")
                }
            }
        } catch (e) {
            console.log(e)
        }
        return { ...s }
    }
    const lostFocus = (state, item) => {}
    const isEditEvent = (event) => event == "edit" || event == "operation--edit"
    const record = (s, event, moreFn) => {
        var r = {
            event: event,
        }
        if (nesting > 1) {
            r.nesting = nesting
        }
        const c = WF.currentItem().getId()
        if (c != currentId(s.log)) {
            r.currentId = c
        }
        const f = isEditEvent(event) && WF.focusedItem()?.getId() || ""
        if (f != focusedId(s.log)) {
            r.focusedId = f
        }
        const query_or_null = WF.currentSearchQuery()
        const q = query_or_null ? query_or_null.trim() : ""
        if (q != query(s.log)) {
            r.query = q
        }
        r = { ...r, ...moreFn?.() }
        s.log.unshift(r)
        return r
    }
    const recordAction = (s, actionName, moreFn) => {
        record(s, actionName, moreFn)
        return { ...s }
    }
    const recordReaction = (s, actionName, moreFn) => {
        record(s, actionName, moreFn)
        return { ...s }
    }
    const recordAsString = (r) => {
        var s = r?.nesting ? r.nesting.toString() + "/" : ""
        s += r.event
        s += (r.show_log !== undefined) ? " " + r.show_log : ""
        s += (r.detail_level !== undefined) ? " " + r.detail_level : ""
        s += (r.query !== undefined) ? " " + r.query : ""
        s += (r.currentId !== undefined) ?
            (" current:" +
             (WF.getItemById(r.currentId) ?
              WF.getItemById(r.currentId).getUrl() : "(deleted? " + r.currentId + ")")) : ""
        s += (r.focusedId !== undefined) ?
            r.focusedId ?
            (" focused:" +
             (WF.getItemById(r.focusedId) ?
              WF.getItemById(r.focusedId).getUrl() : "(deleted? " + r.focusedId + ")")) : " lost-focus"
        : ""
        s += (r.commentFocusedName !== undefined) ? " <" + r.commentFocusedName + ">" : ""
        return s
    }
    const stableQueries = (log) => {
        const log2 = []
        var i = 0
        while (i < log.length) {
            if (i + 1 < log.length &&
                log[i + 0].event == searchTyped &&
                log[i + 1].event == locationChanged &&
                log[i + 1].query !== undefined) {
                log2.push(log[i + 1])
                var q = log[i + 1].query
                i += 2
                while (i + 1 < log.length &&
                       log[i + 0].event == searchTyped &&
                       log[i + 1].event == locationChanged &&
                       log[i + 1].query !== undefined &&
                       q.startsWith(log[i + 1].query)) {
                    q = log[i + 1].query
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
    const getSearchHistory = (log) => {
        const h = [""]
        for (const r of stableQueries(log)) {
            if (r?.query && !h.includes(r.query)) {
                h.push(r.query)
            }
        }
        return h
    }
    const addStarredQueries = (s) => {
        WF.starredLocations()
            .filter((x) => x.search != null)
            .map((x) => x.search)
            .sort()
            .reverse()
            .reduce((acc, i) => {
            acc[i.startsWith("@") ? 1 : 0].push(i)
            return acc
        }, [[], []]).flat().map((x) => record(s, "AddStarredQuery", () => ({ query: x })))
    }
    const mostRecent = (log, propertyName, def = '') => {
        for (const x of log) {
            const y = x[propertyName]
            if (y !== undefined) {
                return y
            }
        }
        return def
    }
    const focusedId = (log) => mostRecent(log, 'focusedId')
    const focusedItem = (log) => WF.getItemById(focusedId(log))
    const focusedName = (log) => {
        const item = focusedItem(log)
        return item == null ? null : item.getNameInPlainText()
    }
    const currentId = (log) => mostRecent(log, 'currentId')
    const query = (log) => mostRecent(log, 'query')
    const showLog = (log) => mostRecent(log, 'show_log', false)
    const detailLevel = (log) => mostRecent(log, 'detail_level', 1)
    const nextDetailLevel = (log) => detailLevel(log) % 3 + 1
    const ChangeSearch = (s, q) => {
        return recordAction(s, "ChangeSearch", () => {
            WF.search(q)
        })
    }
    const ResetLog = (s) => {
        s.log = []
        addStarredQueries(s)
        return recordAction(s, "ResetLog")
    }
    const ChangeDetailLevel = (s) => recordAction(s, "ChangeDetailLevel",
                                                  () => ({ detail_level: nextDetailLevel(s.log) }))
    const ToggleShowLog = (s) => recordAction(s, "ToggleShowLog", () => ({ show_log: !showLog(s.log) }))
    const startApp = (initialState) => {
        const app_dom_id = "workflowy-showmessage-div"
        WF.hideMessage()
        WF.showMessage(`<div id="${app_dom_id}"></div>`)
        const font = { style: {"font-family": "monospace"} }
        stopAppFn = app({
            node: document.getElementById(app_dom_id),
            init: initialState,
            view: ({ log }) =>
            h("div", {
                title: "WorkflowyLens",
                style: {
                    "font-family": "monospace",
                    "background-color": "lightgreen",
                    "color": "black",
                    "text-align": "left",
                }, }, [
                h("button", { ...font, onclick: ToggleShowLog, title: "hide/show event log",
                             hidden: !dev_mode},
                  text(log.length.toString().padStart(3, "0") + (log.length == 1 ? "  event" : " events"))),
                getSearchHistory(log).length > 1 && h("select", {
                    onchange: (_, e) => [ChangeSearch, e.target.value],
                    title: "search history including starred"
                }, getSearchHistory(log).map((q) => h("option", {selected: q == query(log), title: q}, text(q)))),
                h("div", { hidden: detailLevel(log) < 2 }, [
                    h("span", {}, text("detail level " + detailLevel(log))
                     )]),
                h("div", { hidden: !showLog(log) || log.length == 0 }, [
                    h("button", { ...font, onclick: ResetLog, title: "reset event log" }, text("reset")),
                    h("div", {},
                      h("ul", {}, log.slice(0, 10).map((m) => h("li", {}, text(recordAsString(m))))),
                     )]),
            ]),
            subscriptions: (s) => [onWorkflowyEvent(WfEventReceived),
                                   onWorkflowyMessageRemoved(WorkflowyMessageRemoved)],
        })
    }
    })()
