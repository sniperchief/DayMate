"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { IDLE, type FormState } from "@/lib/domain/types";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

interface Ctx {
  state: FormState;
  defaults: Record<string, string | null | undefined>;
}
const FormCtx = createContext<Ctx>({ state: IDLE, defaults: {} });

/** Value for a field: submitted value after an error, otherwise the default. */
export function useFieldValue(name: string): string {
  const { state, defaults } = useContext(FormCtx);
  return state.values?.[name] ?? defaults[name] ?? "";
}

function useFieldError(name: string): string | undefined {
  return useContext(FormCtx).state.fieldErrors?.[name];
}

export function FormShell({
  action,
  defaults = {},
  submitLabel,
  pendingLabel = "Saving…",
  children,
  multipart = false,
}: {
  action: Action;
  defaults?: Record<string, string | null | undefined>;
  submitLabel: string;
  pendingLabel?: string;
  children: React.ReactNode;
  /** The form includes a file input (shows a re-select hint after errors). */
  multipart?: boolean;
}) {
  const [state, formAction] = useActionState(action, IDLE);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") alertRef.current?.focus();
  }, [state]);

  return (
    <FormCtx.Provider value={{ state, defaults }}>
      {/* key re-mounts the form so fields take fresh defaults after each response */}
      <form key={state.nonce ?? "initial"} action={formAction} className="form" noValidate>
        {state.status !== "idle" && state.message && (
          <div ref={alertRef} tabIndex={-1} role={state.status === "error" ? "alert" : "status"} className={`alert ${state.status === "error" ? "alert-error" : "alert-success"}`}>
            {state.message}
            {state.status === "error" && multipart && <p className="hint" style={{ margin: "0.5rem 0 0" }}>If you chose a photo, please choose it again.</p>}
          </div>
        )}
        {children}
        <div>
          <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
        </div>
      </form>
    </FormCtx.Provider>
  );
}

export function SubmitButton({ label, pendingLabel = "Saving…", className = "btn" }: { label: string; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Described({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint && (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

interface BaseProps {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
}

function Label({ htmlFor, label, required }: { htmlFor: string; label: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor}>
      {label} {!required && <span className="optional">(optional)</span>}
    </label>
  );
}

export function TextField({ name, label, hint, required, type = "text", maxLength, autoComplete, list }: BaseProps & { type?: string; maxLength?: number; autoComplete?: string; list?: string }) {
  const id = useId();
  const error = useFieldError(name);
  const value = useFieldValue(name);
  return (
    <div className="field">
      <Label htmlFor={id} label={label} required={required} />
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={type === "password" ? undefined : value}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        list={list}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
      />
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({ name, label, hint, required, maxLength, rows = 4 }: BaseProps & { maxLength?: number; rows?: number }) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <div className="field">
      <Label htmlFor={id} label={label} required={required} />
      <textarea id={id} name={name} rows={rows} defaultValue={useFieldValue(name)} required={required} maxLength={maxLength} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} />
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({ name, label, hint, required, options, placeholder }: BaseProps & { options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <div className="field">
      <Label htmlFor={id} label={label} required={required} />
      <select id={id} name={name} defaultValue={useFieldValue(name)} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}

export function FileField({ name, label, hint }: Omit<BaseProps, "required">) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <div className="field">
      <Label htmlFor={id} label={label} />
      <input id={id} name={name} type="file" accept="image/jpeg,image/png,image/webp" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} />
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}

export function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  const id = useId();
  const { state } = useContext(FormCtx);
  const checked = state.values ? state.values[name] === "on" : defaultChecked;
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" name={name} defaultChecked={checked} />
      {label}
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
