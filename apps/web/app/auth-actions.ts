"use server";

/**
 * Auth server actions (live mode): email + password via Supabase Auth.
 * Errors are surfaced through the /login?error= query so the page stays a
 * server component.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabase } from "../lib/supabase/server-clients";

function credentialsFrom(formData: FormData): { email: string; password: string } | null {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return null;
  return { email, password };
}

export async function signInAction(formData: FormData): Promise<void> {
  const credentials = credentialsFrom(formData);
  if (!credentials) redirect("/login?error=Email+and+password+are+required");
  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(credentials);
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUpAction(formData: FormData): Promise<void> {
  const credentials = credentialsFrom(formData);
  if (!credentials) redirect("/login?error=Email+and+password+are+required");
  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.signUp(credentials);
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  // With email confirmation enabled there is no session yet — tell the user to check mail.
  if (!data.session) redirect("/login?notice=Check+your+email+to+confirm+your+account");
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
