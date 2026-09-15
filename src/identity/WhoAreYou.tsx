/**
 * The identity picker.
 *
 * Full-screen when nobody is signed in, and the same component in a sheet when
 * you tap "Switch" in the header — which is how a reviewer demonstrates the
 * race: two profiles, same event, two taps.
 *
 * One tab per role, because the two roles see different apps and the choice
 * should be made before you are dropped into one of them. Each tab is the same
 * two-step form: pick someone who already exists or type a new name, then
 * commit. The commit button is deliberate — "Join as Organizer" names the
 * consequence, which a bare list of names never did.
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
import { useIdentity } from "./IdentityContext";

const TABS = [
  { role: "player", label: "Player", noun: "player", join: "Join as Player", hint: "Browse events and RSVP." },
  {
    role: "organizer",
    label: "Organizer",
    noun: "organizer",
    join: "Join as Organizer",
    hint: "Post events and see who is coming.",
  },
] as const satisfies readonly { role: Role; label: string; noun: string; join: string; hint: string }[];

export function WhoAreYou({ onClose }: { onClose?: () => void }) {
  const { user, signIn } = useIdentity();
  const users = useUsers();
  const createUser = useCreateUser();

  // Open on the tab you are already signed in under, with yourself preselected.
  const [role, setRole] = useState<Role>(user?.role ?? "player");
  const [selectedId, setSelectedId] = useState<string | null>(user?.id ?? null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const nameInputId = `${baseId}-name`;
  const errorId = `${baseId}-error`;
  const headingId = `${baseId}-heading`;
  const tabId = (value: Role) => `${baseId}-tab-${value}`;

  const tabRefs = useRef<Record<Role, HTMLButtonElement | null>>({ player: null, organizer: null });
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const isModal = onClose !== undefined;

  useEffect(() => {
    if (!isModal || !onClose) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModal, onClose]);

  function selectRole(next: Role) {
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
    // Two tabs, so either arrow lands on the other one.
    const next: Role = role === "player" ? "organizer" : "player";
    selectRole(next);
    tabRefs.current[next]?.focus();
  }

  function pick(id: string) {
    setSelectedId(id);
    setName("");
    setFormError(null);
    // Eight names push the button off a phone screen, and picking a row is only
    // half the job now — so bring the half that finishes it into view. `nearest`
    // makes this a no-op when the button is already visible.
    submitRef.current?.scrollIntoView({ block: "nearest" });
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
      setFormError(`Pick a ${tab.noun} above, or type a name to join as someone new.`);
      return;
    }
    setFormError(null);
    signIn(picked);
    onClose?.();
  }

  const body = (
    <div className="stack stack--loose">
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
            {item.label}
          </button>
        ))}
      </div>

      <div className="stack stack--loose" role="tabpanel" id={panelId} aria-labelledby={tabId(role)}>
        <p className="who__hint">{tab.hint}</p>

        {users.isPending ? (
          <div className="stack" role="status" aria-busy="true" aria-label="Loading people">
            <Skeleton height={56} />
            <Skeleton height={56} />
            <Skeleton height={56} />
          </div>
        ) : users.isError ? (
          <ErrorBanner error={users.error} onRetry={() => void users.refetch()} />
        ) : people.length === 0 ? (
          <EmptyState title={`No ${tab.noun}s yet`} hint="Type a name below to be the first." />
        ) : (
          <ul className="stack">
            {people.map((person) => {
              const isSelected = person.id === selectedId;
              return (
                <li key={person.id}>
                  <button
                    type="button"
                    className="who__option"
                    aria-pressed={isSelected}
                    onClick={() => pick(person.id)}
                  >
                    <span>{person.name}</span>
                    <span className="who__option-end">
                      {person.id === user?.id ? <span className="text-sm muted">Current</span> : null}
                      {isSelected ? <Icon name="in" size={20} label="Selected" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
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
            ref={submitRef}
            type="submit"
            className="btn btn--block"
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
          <span className="who__mark">
            <Logo size={40} title="Game Night" />
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

  return (
    <div className="modal" onClick={() => onClose?.()}>
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="page-title" id={headingId}>
            Switch user
          </h2>
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => onClose?.()}>
            Close
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
