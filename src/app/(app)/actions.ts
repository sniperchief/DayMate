"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/domain/types";
import { formValues } from "@/lib/domain/validation";
import { requireCtx } from "@/server/context";
import * as ops from "@/server/operations";
import type { OpResult } from "@/server/operations";

const ALL_PAGES = ["/dashboard", "/profile", "/family", "/routines", "/memories"];

function revalidateAll(): void {
  for (const p of ALL_PAGES) revalidatePath(p);
}

function toState(r: OpResult, values: Record<string, string>): FormState {
  if (r.ok) return { status: "success", message: r.message, nonce: randomUUID() };
  return { status: "error", message: r.message, fieldErrors: r.fieldErrors, values, nonce: randomUUID() };
}

// ── profile ──────────────────────────────────────────────────────────────
export async function saveElderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.saveElder(ctx, values, formData.get("photo"));
  if (r.ok) revalidateAll();
  return { ...toState(r, values), values: r.ok ? undefined : values };
}

// ── family ───────────────────────────────────────────────────────────────
export async function createFamilyMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.createFamilyMember(ctx, values, formData.get("photo"));
  if (r.ok) revalidateAll();
  return toState(r, values);
}

export async function updateFamilyMemberAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.updateFamilyMember(ctx, id, values, formData.get("photo"));
  if (!r.ok) return toState(r, values);
  revalidateAll();
  redirect("/family?notice=updated");
}

export async function deleteFamilyMemberAction(id: string): Promise<void> {
  const ctx = await requireCtx();
  const r = await ops.deleteFamilyMember(ctx, id);
  revalidateAll();
  redirect(`/family?notice=${r.ok ? "removed" : "error"}`);
}

// ── routines ─────────────────────────────────────────────────────────────
export async function createRoutineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.createRoutine(ctx, values);
  if (r.ok) revalidateAll();
  return toState(r, values);
}

export async function updateRoutineAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.updateRoutine(ctx, id, values);
  if (!r.ok) return toState(r, values);
  revalidateAll();
  redirect("/routines?notice=updated");
}

export async function setRoutineActiveAction(id: string, active: boolean): Promise<void> {
  const ctx = await requireCtx();
  const r = await ops.setRoutineActive(ctx, id, active);
  revalidateAll();
  if (!r.ok) redirect("/routines?notice=error");
}

export async function deleteRoutineAction(id: string): Promise<void> {
  const ctx = await requireCtx();
  const r = await ops.deleteRoutine(ctx, id);
  revalidateAll();
  redirect(`/routines?notice=${r.ok ? "removed" : "error"}`);
}

// ── memories ─────────────────────────────────────────────────────────────
export async function createMemoryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.createMemory(ctx, values);
  if (r.ok) revalidateAll();
  return toState(r, values);
}

export async function updateMemoryAction(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireCtx();
  const values = formValues(formData);
  const r = await ops.updateMemory(ctx, id, values);
  if (!r.ok) return toState(r, values);
  revalidateAll();
  redirect("/memories?notice=updated");
}

export async function deleteMemoryAction(id: string): Promise<void> {
  const ctx = await requireCtx();
  const r = await ops.deleteMemory(ctx, id);
  revalidateAll();
  redirect(`/memories?notice=${r.ok ? "removed" : "error"}`);
}

// ── Walrus retry ─────────────────────────────────────────────────────────
export async function retryWalrusAction(kind: string, sourceId: string, _prev: FormState): Promise<FormState> {
  const ctx = await requireCtx();
  const r = await ops.retryWalrus(ctx, kind, sourceId);
  revalidateAll();
  return toState(r, {});
}

// ── Sui anchor retry ─────────────────────────────────────────────────────
export async function retrySuiAnchorAction(memoryId: string, _prev: FormState): Promise<FormState> {
  const ctx = await requireCtx();
  const r = await ops.retrySuiAnchor(ctx, memoryId);
  revalidatePath("/memories");
  return toState(r, {});
}
