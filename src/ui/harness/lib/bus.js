// @ts-check
// The harness's one connection to the events fan-out (GET /api/events): records, ops, turn holders, sub-agent state
// changes and configuration saves. Opened on the first subscriber and shared by every one, so the page holds a single stream however many
// surfaces listen. The server queues what a slow page cannot take yet and cuts off only a page that stopped reading;
// the browser reconnects an EventSource by itself after a dropped connection, and the bus opens it again after an
// answer that was no stream; a subscriber that must not miss a change resyncs on the stream's `hello`, or on its own
// timer, since what was published while the stream was down is not sent again.
//
// The stream names this page's tab, and the tab counts as open while the stream is (decision 22); a stream that names
// a tab is sent no request record's `progress` (http/events.js): a running turn's figures come from its run's events. A page the browser
// puts away lets the stream go at once (ui/lib/put-away.js), so the session it wrote is let go; one brought back loads
// afresh.

import { TAB_ID } from "./tab.js";
import { listenerSet } from "../../lib/listeners.js";
import { holdWhileShown } from "../../lib/put-away.js";
import { leaveIfRefused } from "../../lib/standing.js";

/** @typedef {(msg: any) => void} BusListener */

const listeners = listenerSet();
/**
 * How long the page waits to open the stream again once the server answered it with no stream: twice as long after
 * each such answer in a row, up to `AGAIN_MAX_MS` — a refusal that does not change (403, 404) is asked again once a
 * minute — and from the start again once a stream opens.
 */
const AGAIN_MS = 2000;
const AGAIN_MAX_MS = 60_000;
let again = AGAIN_MS;
/** @type {EventSource | null} */
let source = null;

function open() {
  source = new EventSource(`/api/events?tab=${encodeURIComponent(TAB_ID)}`);
  const letGo = holdWhileShown(() => {
    source?.close();
    source = null;
  });
  // A dropped stream the browser opens again by itself; one answered with no stream — a refusal, an error — it closes
  // for good: its hold is let go, and it is opened again after a wait, while anything listens. The wait is held as the
  // stream was: a page put away meanwhile opens none, and loads afresh when shown. One is held at a time, so the page
  // put away closes the stream open then, or ends the wait. A refusal may be this browser's own — a device revoked or
  // signed out — and then the page goes to the pairing page (ui/lib/standing.js).
  const s = source;
  source.onopen = () => {
    again = AGAIN_MS;
  };
  source.onerror = () => {
    if (s.readyState !== EventSource.CLOSED || source !== s) return;
    letGo();
    source = null;
    void leaveIfRefused();
    const timer = setTimeout(() => {
      endWait();
      if (!source && listeners.size) open();
    }, again);
    const endWait = holdWhileShown(() => clearTimeout(timer));
    again = Math.min(again * 2, AGAIN_MAX_MS);
  };
  source.onmessage = (e) => {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    // A listener's failure is reported, never allowed to starve the others of the message.
    listeners.hand(msg);
  };
}

/** Hear every message on the fan-out; returns the unsubscribe. @param {BusListener} fn */
export function onBus(fn) {
  const off = listeners.on(fn);
  if (!source) open();
  return off;
}
