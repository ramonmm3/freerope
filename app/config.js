// Supabase project for accounts and leaderboards. The anon key is public by design: the database's
// row-level security (supabase/migrations) decides what it can do. Empty URL = accounts are off and
// the app stays fully local, like before.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
