/**
 * The organizer side: post a table. That is now the whole page.
 *
 * It used to carry the form *and* a copy of the organizer's own events below
 * it, which meant an organizer had two places to look at their week — this one,
 * and a board showing everybody's. The board is theirs now (see `EventsPage`),
 * so the list moved there and this page does one thing.
 *
 * The form itself is `EventForm`, which the event page also wears to edit one —
 * posting and editing ask for the same seven things, so they are one component
 * with two submit paths rather than two forms waiting to drift apart.
 */

import { EventForm } from "../components/EventForm";

export function OrganizerPage() {
  return (
    <div className="stack stack--loose">
      <h1 className="page-title">Organize an Event</h1>
      <EventForm />
    </div>
  );
}
