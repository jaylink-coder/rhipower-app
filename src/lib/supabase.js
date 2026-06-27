// Supabase client — handles authentication and database
// SETUP: Create a free project at https://supabase.com
//        Then create a .env file in rhipower-app/ with:
//        VITE_SUPABASE_URL=https://yourproject.supabase.co
//        VITE_SUPABASE_ANON_KEY=your_anon_key_here

import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  || ''
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Returns null if not yet configured — app works without it for the calculator
export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null

export const isSupabaseReady = Boolean(supabase)
