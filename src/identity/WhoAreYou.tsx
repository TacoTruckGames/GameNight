/**
 * The identity picker.
 *
 * Full-screen when nobody is signed in, and the same component hanging off the
 * header's name button when you tap it — which is how a reviewer demonstrates
 * the race: two profiles, same event, two taps. It drops from the button rather
 * than rising from the bottom of the screen because it belongs to that button:
 * a sheet that arrives from somewhere else has to explain where it came from,
 * and a Close control to send it back. This one needs neither. Tap the name
 * again, tap anywhere outside, or press Escape.
 *
 * One tab per role, because the roles see different apps and the choice should
 * be made before you are dropped into one of them. Each tab is the same
 * two-step form: pick someone who already exists or type a new name, then
 * commit. The commit button is deliberate — "Join as Organizer" names the
 * consequence, which a bare list of names never did. Both carry the role's own
 * colour and icon, the same two the header badge uses, so the answer to "who am
 * I about to become" is the same shape before and after the switch.
 *
 * There is deliberately no Admin tab. The main site carries no route into the
 * operator tools at all — you reach them by typing `/admin`, which has its own
 * door (`src/admin/AdminGate.tsx`). Keeping admin out of the picker also keeps
 * it out of `SIGNUP_ROLES`, so self-signup cannot mint one.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { Role } from "../../shared/api-types";
import { createUserSchema, NAME_MAX } from "../../shared/schemas";
import { useCreateUser, useUsers } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Logo } from "../components/Logo";
import { Skeleton } from "../components/Skeleton";
import { ROLE_ICONS } from "../lib/roles";
import { useIdentity } from "./IdentityContext";

// `article` is carried rather than derived: "a"/"an" from a first letter is a
// rule with exceptions, and there are exactly two nouns here.
const TABS = [
  {
    role: "player",
    label: "Player",
    noun: "player",
    article: "a",
    join: "Join as Player",
  },
  {
    role: "organizer",
    label: "Organizer",
    noun: "organizer",
    article: "an",
    join: "Join as Organizer",
  },
] as const satisfies readonly {
  role: Role;
  label: string;
  noun: string;
  article: string;
  join: string;
}[];

/** The roles this picker offers. An admin signing in lands on the player tab. */
type PickerRole = (typeof TABS)[number]["role"];

function pickerRoleFor(role: Role | undefined): PickerRole {
  return role === "organizer" ? "organizer" : "player";
}

export function WhoAreYou({ onClose }: { onClose?: () => void }) {
  const { user, signIn } = useIdentity();
  const users = useUsers();
  const createUser = useCreateUser();

  // Open on the tab you are already signed in under, with yourself preselected.
  // An admin has no tab here, so they land on the player one with nothing picked.
  const [role, setRole] = useState<PickerRole>(pickerRoleFor(user?.role));
  const [selectedId, setSelectedId] = useState<string | null>(
    user && user.role !== "admin" ? user.id : null,
  );
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const nameInputId = `${baseId}-name`;
  const pickerId = `${baseId}-picker`;
  const errorId = `${baseId}-error`;
  const headingId = `${baseId}-heading`;
  const tabId = (value: Role) => `${baseId}-tab-${value}`;

  const tabRefs = useRef<Record<PickerRole, HTMLButtonElement | null>>({ player: null, organizer: null });
  const panelRef = useRef<HTMLDivElement>(null);
  const isModal = onClose !== undefined;

  // Opening moves focus into the panel, so the next Tab lands on the role tabs
  // rather than back in the page behind them. `AppShell` sends it home again.
  useEffect(() => {
    if (isModal) panelRef.current?.focus();
  }, [isModal]);

  useEffect(() => {
    if (!isModal || !onClose) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModal, onClose]);

  function selectRole(next: PickerRole) {
    if (next === role) return;
    setRole(next);
    // A selection only means something inside its own tab, and a failed signup
    // from the other tab would be reported against the wrong button.
    setSelectedId(user?.role === next ? user.id : null);
    setName("");
    setFormError(null);
    createUser.reset();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // Wraps at both ends, as a tablist should.
    const current = TABS.findIndex((item) => item.role === role);
    const step = event.key === "ArrowRight" ? 1 : TABS.length - 1;
    const next: PickerRole = (TABS[(current + step) % TABS.length] ?? TABS[0]).role;
    selectRole(next);
    tabRefs.current[next]?.focus();
  }

  function pick(id: string) {
    // "" is the placeholder option: choosing it means "no one yet", not a person.
    setSelectedId(id === "" ? null : id);
    if (id !== "") setName("");
    setFormError(null);
  }

  const tab = TABS.find((item) => item.role === role) ?? TABS[0];
  const people = (users.data ?? []).filter((person) => person.role === role);
  const canJoin = name.trim() !== "" || selectedId !== null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = name.trim();

    if (typed !== "") {
      // Client-side pre-validation only; the server is still the authority.
      const parsed = createUserSchema.safeParse({ name: typed, role });
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? "Enter a name");
        return;
      }
      setFormError(null);
      createUser.mutate(parsed.data, {
        onSuccess: () => {
          setName("");
          onClose?.();
        },
      });
      return;
    }

    // `user` covers the case where the list has not loaded yet but the signed-in
    // identity is the preselected one.
    const picked =
      people.find((person) => person.id === selectedId) ?? (user?.id === selectedId ? user : undefined);
    if (!picked) {
      setFormError(`Pick ${tab.article} ${tab.noun} above, or type a name to join as someone new.`);
      return;
    }
    setFormError(null);
    signIn(picked);
    onClose?.();
  }

  // The tint is set once on the container and read by the selected tab and the
  // commit button, so "which role am I choosing" is one declaration, not two.
  const body = (
    <div className={`stack stack--loose who--${role}`}>
      <div className="who__tabs" role="tablist" aria-label="Join as">
        {TABS.map((item) => (
          <button
            key={item.role}
            type="button"
            role="tab"
            id={tabId(item.role)}
            className="who__tab"
            aria-selected={item.role === role}
            aria-controls={panelId}
            tabIndex={item.role === role ? 0 : -1}
            ref={(node) => {
              tabRefs.current[item.role] = node;
            }}
            onClick={() => selectRole(item.role)}
            onKeyDown={onTabKeyDown}
          >
            <Icon name={ROLE_ICONS[item.role]} size={16} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="stack stack--loose" role="tabpanel" id={panelId} aria-labelledby={tabId(role)}>

        {users.isPending ? (
          <div className="stack" role="status" aria-busy="true" aria-label="Loading people">
            <Skeleton height={44} />
          </div>
        ) : users.isError ? (
          <ErrorBanner error={users.error} onRetry={() => void users.refetch()} />
        ) : people.length === 0 ? (
          <EmptyState
            title={`No ${tab.noun}s yet`}
            hint="Type a name below to be the first."
          />
        ) : (
          // A select, not a row of buttons: the demo board seeds 28 players, and
          // 28 tappable rows pushed the join button several screens down a phone.
          // The native picker is one line however long the list gets.
          <div className="field">
            <label className="field__label" htmlFor={pickerId}>
              Pick {tab.article} {tab.noun}
            </label>
            <select
              id={pickerId}
              className="select"
              value={selectedId ?? ""}
              onChange={(event) => pick(event.target.value)}
            >
              <option value="">Choose {tab.article} {tab.noun}…</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.id === user?.id ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={nameInputId}>
              Or join as a new {tab.noun}
            </label>
            <input
              id={nameInputId}
              className="input"
              value={name}
              onChange={(event) => {
                // Typing and picking answer the same question, so one clears
                // the other and the button never has to guess which you meant.
                setName(event.target.value);
                setSelectedId(null);
                setFormError(null);
              }}
              placeholder="Your name"
              maxLength={NAME_MAX}
              autoComplete="name"
              aria-invalid={formError !== null}
              aria-describedby={formError ? errorId : undefined}
            />
            {formError ? (
              <p className="field__error" id={errorId}>
                {formError}
              </p>
            ) : null}
          </div>
          {createUser.error ? <ErrorBanner error={createUser.error} /> : null}
          <button
            type="submit"
            className="btn btn--block who__join"
            disabled={createUser.isPending || !canJoin}
          >
            {createUser.isPending ? "Joining…" : tab.join}
          </button>
        </form>
      </div>
    </div>
  );

  if (!isModal) {
    return (
      <main className="who who--full">
        <div>
          {/* The mark loses its `title` here: the wordmark beside it now carries
              the name, and two accessible names for one lockup reads it twice. */}
          <span className="who__mark">
            <Logo size={40} />
            Game Night
          </span>
          <h1 className="page-title" id={headingId}>
            Who's playing?
          </h1>
          <p className="page-subtitle">
            Pick who you are, or join as someone new. No passwords — this is a demo board.
          </p>
        </div>
        {body}
      </main>
    );
  }

  // The scrim is what "anywhere outside" means, and it is also what makes the
  // name button close rather than reopen: it covers the header, so that click
  // lands here. Transparent, not dimmed — this hangs off a control, it has not
  // taken over the screen.
  return (
    <>
      <div className="popover__scrim" onClick={() => onClose?.()} />
      <div
        className="popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panelRef}
        tabIndex={-1}
      >
        <h2 className="page-title popover__title" id={headingId}>
          Switch User
        </h2>
        {body}
      </div>
    </>
  );
}
