/**
 * The identity picker.
 *
 * Full-screen when nobody is signed in, and the same component in a sheet when
 * you tap "Switch" in the header — which is how a reviewer demonstrates the
 * race: two profiles, same event, two taps.
 *
 * Organizers are seed-only (the API always creates players), so the new-player
 * form is honest about what it makes.
 */

import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "../../shared/api-types";
import { createPlayerSchema, NAME_MAX } from "../../shared/schemas";
import { useCreatePlayer, useUsers } from "../api/hooks";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { Skeleton } from "../components/Skeleton";
import { useIdentity } from "./IdentityContext";

function UserGroup({
  title,
  users,
  currentUserId,
  onPick,
}: {
  title: string;
  users: User[];
  currentUserId: string | null;
  onPick: (user: User) => void;
}) {
  if (users.length === 0) return null;
  return (
    <section>
      <h3 className="who__group-title">{title}</h3>
      <ul className="stack">
        {users.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              className="who__option"
              aria-current={user.id === currentUserId}
              onClick={() => onPick(user)}
            >
              <span>{user.name}</span>
              {user.id === currentUserId ? <span className="text-sm muted">Current</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WhoAreYou({ onClose }: { onClose?: () => void }) {
  const { userId, signIn } = useIdentity();
  const users = useUsers();
  const createPlayer = useCreatePlayer();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputId = useId();
  const nameErrorId = useId();
  const headingId = useId();

  const isModal = onClose !== undefined;

  useEffect(() => {
    if (!isModal || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isModal, onClose]);

  function pick(user: User) {
    signIn(user);
    onClose?.();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Client-side pre-validation only; the server is still the authority.
    const parsed = createPlayerSchema.safeParse({ name });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "Enter a name");
      return;
    }
    setNameError(null);
    createPlayer.mutate(parsed.data.name, {
      onSuccess: () => {
        setName("");
        onClose?.();
      },
    });
  }

  const players = (users.data ?? []).filter((user) => user.role === "player");
  const organizers = (users.data ?? []).filter((user) => user.role === "organizer");
  const serverError = createPlayer.error;

  const body = (
    <div className="stack stack--loose">
      {users.isPending ? (
        <div className="stack" role="status" aria-busy="true" aria-label="Loading people">
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : users.isError ? (
        <ErrorBanner error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data && users.data.length === 0 ? (
        <EmptyState title="Nobody here yet" hint="Add yourself below to get started." />
      ) : (
        <>
          <UserGroup title="Players" users={players} currentUserId={userId} onPick={pick} />
          <UserGroup title="Organizers" users={organizers} currentUserId={userId} onPick={pick} />
        </>
      )}

      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={nameInputId}>
            Join as a new player
          </label>
          <input
            id={nameInputId}
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            maxLength={NAME_MAX}
            autoComplete="name"
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? nameErrorId : undefined}
          />
          {nameError ? (
            <p className="field__error" id={nameErrorId}>
              {nameError}
            </p>
          ) : null}
        </div>
        {serverError ? <ErrorBanner error={serverError} /> : null}
        <button type="submit" className="btn btn--block" disabled={createPlayer.isPending}>
          {createPlayer.isPending ? "Joining…" : "Join"}
        </button>
      </form>
    </div>
  );

  if (!isModal) {
    return (
      <main className="who who--full">
        <div>
          <h1 className="page-title" id={headingId}>
            Who's playing?
          </h1>
          <p className="page-subtitle">
            Pick yourself to browse and RSVP. No passwords — this is a demo board.
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
            Switch player
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
