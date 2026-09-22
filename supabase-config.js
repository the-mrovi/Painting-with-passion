/** Shared Supabase client. The publishable key is safe in the browser with RLS. */
const SUPABASE_URL = 'https://xleffmncnrkpcsbycbsv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XBgskuKpbxwdJzXGZpgKSQ_aG1Tw-Qk';

if (!window.supabase) {
    throw new Error('Supabase client library failed to load.');
}

const _supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    }
);

function getSupabase() {
    return _supabaseClient;
}

async function getCurrentUser() {
    const { data, error } = await _supabaseClient.auth.getUser();
    if (error) return null;
    return data.user || null;
}

function onAuthChange(callback) {
    return _supabaseClient.auth.onAuthStateChange(callback);
}

async function signOut(redirectTo = 'index.html') {
    const { error } = await _supabaseClient.auth.signOut();
    if (error) throw error;
    sessionStorage.removeItem('painting-with-passion-return-to');
    window.location.replace(redirectTo);
}

