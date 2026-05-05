// ============================================================
// auth.js - Módulo de Autenticación
// Materia: Programación No Numérica
//
// Gestiona registro, login y verificación de JWT.
// Usa bcryptjs para hash de contraseñas (nunca texto plano).
// Usa jsonwebtoken para stateless authentication.
// 
// ACID: El registro de usuario usa transacción para garantizar
// que el usuario se crea completamente o no se crea.
// ============================================================

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { withTransaction, query } = require('./db');

// ============================================================
// CONSTANTES DE CONFIGURACIÓN
// ============================================================
const SALT_ROUNDS  = 10;        // Costo del hash bcrypt (2^10 iteraciones)
const JWT_SECRET   = process.env.JWT_SECRET || 'secreto_desarrollo_no_usar_en_produccion';
const JWT_EXPIRES  = '24h';     // Los tokens expiran en 24 horas

// ============================================================
// FUNCIÓN: Registrar un nuevo usuario
// 
// Proceso ACID:
//   1. BEGIN (inicio de transacción)
//   2. Verificar que el username no existe (Consistencia)
//   3. Hashear la contraseña (seguridad)
//   4. Insertar el nuevo usuario
//   5. COMMIT (confirmar) o ROLLBACK (revertir si hay error)
// ============================================================
const registerUser = async (username, password) => {
    // Validaciones básicas antes de ir a la base de datos
    if (!username || username.trim().length < 3) {
        throw new Error('El nombre de usuario debe tener al menos 3 caracteres');
    }
    if (!password || password.length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres');
    }
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(username.trim())) {
        throw new Error('El username solo puede contener letras, números, _ y -');
    }

    // Generar un color de avatar aleatorio para el nuevo usuario
    const avatarColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    const avatarColor  = avatarColors[Math.floor(Math.random() * avatarColors.length)];

    // Ejecutar registro dentro de una TRANSACCIÓN (garantía ACID)
    return await withTransaction(async (client) => {
        // PASO 1: Verificar si el username ya está tomado (case-insensitive)
        const existingUser = await client.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
            [username.trim()]
        );
        
        if (existingUser.rows.length > 0) {
            throw new Error('Este nombre de usuario ya está en uso');
        }

        // PASO 2: Hashear la contraseña con bcrypt
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // PASO 3: Insertar el nuevo usuario (guardamos el username tal como lo escribió)
        const result = await client.query(
            `INSERT INTO users (username, password_hash, avatar_color) 
             VALUES ($1, $2, $3) 
             RETURNING id, username, avatar_color, created_at`,
            [username.trim(), passwordHash, avatarColor]
        );

        const newUser = result.rows[0];
        const token = generateToken(newUser);

        console.log(`👤 Nuevo usuario registrado: ${newUser.username} (ID: ${newUser.id})`);
        
        return {
            user: {
                id:           newUser.id,
                username:     newUser.username,
                avatar_color: newUser.avatar_color,
                created_at:   newUser.created_at
            },
            token
        };
    });
};

// ============================================================
// FUNCIÓN: Autenticar usuario (Login)
// 
// Usa bcrypt.compare() para verificar la contraseña sin
// necesidad de desencriptar (el hash es unidireccional).
// ============================================================
const loginUser = async (username, password) => {
    if (!username || !password) {
        throw new Error('Usuario y contraseña son requeridos');
    }

    // Buscar el usuario en la base de datos (case-insensitive)
    const result = await query(
        `SELECT id, username, password_hash, avatar_color, created_at 
         FROM users 
         WHERE LOWER(username) = LOWER($1)`,
        [username.trim()]
    );

    if (result.rows.length === 0) {
        // Mensaje genérico para no revelar si el usuario existe o no (seguridad)
        throw new Error('Credenciales inválidas');
    }

    const user = result.rows[0];

    // Verificar contraseña contra el hash almacenado
    // bcrypt.compare() es resistente a timing attacks
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
        throw new Error('Credenciales inválidas');
    }

    // Generar nuevo JWT
    const token = generateToken(user);
    
    console.log(`🔐 Login exitoso: ${user.username} (ID: ${user.id})`);

    return {
        user: {
            id:           user.id,
            username:     user.username,
            avatar_color: user.avatar_color,
            created_at:   user.created_at
        },
        token
    };
};

// ============================================================
// FUNCIÓN: Generar un JSON Web Token (JWT)
// 
// El token contiene el payload (datos del usuario) firmado
// con el JWT_SECRET. No almacena información sensible.
// ============================================================
const generateToken = (user) => {
    const payload = {
        id:       user.id,
        username: user.username,
        avatar_color: user.avatar_color
    };
    
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
};

// ============================================================
// MIDDLEWARE: Verificar JWT en rutas protegidas
// 
// Express middleware que verifica el token en el header
// Authorization: Bearer <token>
// 
// Si el token es válido, agrega req.user con los datos del usuario.
// Si es inválido o no existe, responde con 401 Unauthorized.
// ============================================================
const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    // El header debe tener formato: "Bearer <token>"
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Acceso denegado. Se requiere autenticación.',
            code:  'NO_TOKEN'
        });
    }

    const token = authHeader.substring(7); // Remover "Bearer "

    try {
        // Verificar y decodificar el token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Agregar datos del usuario al request para las siguientes rutas
        req.user = {
            id:           decoded.id,
            username:     decoded.username,
            avatar_color: decoded.avatar_color
        };
        
        // Continuar con el siguiente middleware/ruta
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                error: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
                code:  'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({ 
            error: 'Token inválido.',
            code:  'INVALID_TOKEN'
        });
    }
};

module.exports = { registerUser, loginUser, requireAuth };
