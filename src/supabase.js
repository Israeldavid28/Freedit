// ============================================================
// supabase.js - Cliente de Supabase
// Materia: Programación No Numérica
//
// Inicializa el cliente de Supabase con Service Role Key
// para acceso completo al backend (bypassa Row Level Security).
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bkzdpqrxalrxlclflddo.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_KEY) {
    console.warn('⚠️  SUPABASE_SERVICE_ROLE no configurado — revisa las variables de entorno en Vercel');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

module.exports = supabase;
