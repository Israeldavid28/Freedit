// ============================================================
// db.js - Módulo de Conexión a PostgreSQL
// Materia: Programación No Numérica
// 
// Utiliza el Pool de conexiones de 'pg' para gestionar
// múltiples conexiones simultáneas de forma eficiente.
// 
// ACID: Todas las operaciones críticas usan transacciones
// BEGIN/COMMIT/ROLLBACK para garantizar atomicidad.
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();

// ============================================================
// CONFIGURACIÓN DEL POOL DE CONEXIONES
// Un Pool reutiliza conexiones en lugar de abrir/cerrar una
// por cada consulta, mejorando drásticamente el rendimiento.
// ============================================================
const poolConfig = {
    // Configuración del pool
    max:              10,    // Máximo de conexiones simultáneas
    idleTimeoutMillis: 30000, // Cerrar conexiones inactivas después de 30s
    connectionTimeoutMillis: 2000, // Timeout al intentar obtener una conexión
};

// Si existe POSTGRES_URL o DATABASE_URL (ej. Vercel Postgres, Neon, Render), úsala.
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (connectionString) {
    poolConfig.connectionString = connectionString;
    // La mayoría de los servicios en la nube requieren SSL
    if (process.env.NODE_ENV === 'production' || connectionString.includes('supabase') || connectionString.includes('neon') || connectionString.includes('vercel')) {
        poolConfig.ssl = { rejectUnauthorized: false };
    }
} else {
    // Modo local tradicional
    poolConfig.host     = process.env.DB_HOST     || 'localhost';
    poolConfig.port     = parseInt(process.env.DB_PORT) || 5432;
    poolConfig.database = process.env.DB_NAME     || 'reddit_binary_tree';
    poolConfig.user     = process.env.DB_USER     || 'postgres';
    poolConfig.password = process.env.DB_PASSWORD || '';
}

const pool = new Pool(poolConfig);

// Evento: conexión exitosa al pool
pool.on('connect', () => {
    console.log('✅ Nueva conexión establecida con PostgreSQL');
});

// Evento: error en el pool (conexiones inesperadamente cerradas, etc.)
pool.on('error', (err) => {
    console.error('❌ Error inesperado en el pool de PostgreSQL:', err.message);
    process.exit(-1);
});

// ============================================================
// FUNCIÓN: Ejecutar una query simple (sin transacción)
// Uso para operaciones SELECT individuales
// ============================================================
const query = async (text, params) => {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        
        // Log en desarrollo para debugging
        if (process.env.NODE_ENV === 'development') {
            console.log(`📊 Query ejecutada en ${duration}ms | Filas: ${result.rowCount}`);
        }
        
        return result;
    } catch (error) {
        console.error('❌ Error en query:', { text, error: error.message });
        throw error;
    }
};

// ============================================================
// FUNCIÓN: Ejecutar múltiples operaciones en una TRANSACCIÓN
// Garantiza ATOMICIDAD: o todas las operaciones se completan
// o ninguna se aplica (ROLLBACK automático en caso de error).
//
// Uso:
//   const result = await withTransaction(async (client) => {
//       await client.query('INSERT INTO ...');
//       await client.query('UPDATE ...');
//       return await client.query('SELECT ...');
//   });
// ============================================================
const withTransaction = async (callback) => {
    // Obtener un cliente dedicado del pool para esta transacción
    const client = await pool.connect();
    
    try {
        // ACID - ATOMICIDAD: Iniciar transacción
        await client.query('BEGIN');
        
        // Ejecutar todas las operaciones del callback
        const result = await callback(client);
        
        // ACID - DURABILIDAD: Confirmar todos los cambios permanentemente
        await client.query('COMMIT');
        
        return result;
    } catch (error) {
        // ACID - ATOMICIDAD: Si algo falla, revertir TODOS los cambios
        await client.query('ROLLBACK');
        console.error('🔄 Transacción revertida (ROLLBACK):', error.message);
        throw error;
    } finally {
        // SIEMPRE devolver el cliente al pool (evitar connection leaks)
        client.release();
    }
};

// ============================================================
// FUNCIÓN: Verificar conexión con la base de datos
// Se usa al iniciar el servidor para validar la configuración
// ============================================================
const testConnection = async () => {
    try {
        const result = await query('SELECT NOW() AS current_time, version() AS pg_version');
        console.log('✅ Conexión a PostgreSQL verificada');
        console.log(`   📅 Hora del servidor: ${result.rows[0].current_time}`);
        console.log(`   🐘 Versión: ${result.rows[0].pg_version.split(',')[0]}`);
        return true;
    } catch (error) {
        console.error('❌ No se pudo conectar a PostgreSQL:', error.message);
        console.error('   Verifica las variables en el archivo .env');
        return false;
    }
};

module.exports = { pool, query, withTransaction, testConnection };
