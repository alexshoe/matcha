import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

// Default client (localStorage persistence) — used to check for existing sessions on app startup.
//
// Supabase table schema:
//   create table notes (
//     id          text    primary key,
//     user_id     uuid    not null references auth.users(id) on delete cascade,
//     title       text    not null default '',
//     content     text    not null default '',
//     created_at  bigint  not null,
//     updated_at  bigint  not null
//   );
export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/**
 * Create a Supabase client configured for the given remember-me preference.
 *   rememberMe = true  → session stored in localStorage (survives app restarts)
 *   rememberMe = false → in-memory only (session cleared when app closes)
 */
export function makeSupabaseClient(rememberMe: boolean): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (rememberMe) return createClient(supabaseUrl, supabaseAnonKey);
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      storage: {
        getItem: (_key: string) => null,
        setItem: (_key: string, _value: string) => {},
        removeItem: (_key: string) => {},
      },
    },
  });
}
