// Public client configuration is supplied by Expo environment variables.
// Never put service_role keys or other server-side secrets in a mobile app.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env and set the EXPO_PUBLIC_* values.',
  );
}

export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_KEY = supabaseKey;
