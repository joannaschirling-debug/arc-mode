// Public Supabase project settings. The anon key is meant to be shipped in apps;
// all data is protected by row level security (see supabase/schema.sql).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
