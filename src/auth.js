// ============================================================
// auth.js - Módulo de Autenticación (migrado a Supabase JS)
// Materia: Programación No Numérica
//
// Gestiona registro, login y verificación de JWT.
// Usa bcryptjs para hash de contraseñas.
// Usa jsonwebtoken para stateless authentication.
// Usa @supabase/supabase-js para consultas a la base de datos.
// ============================================================

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const supabase = require('./supabase');

const SALT_ROUNDS = 10;
const JWT_SECRET  = process.env.JWT_SECRET || 'secreto_desarrollo_no_usar_en_produccion';
const JWT_EXPIRES = '24h';

// ============================================================
// FUNCIÓN: Registrar un nuevo usuario
// ============================================================
const registerUser = async (username, password) => {
    if (!username || username.trim().length < 3) {
        throw new Error('El nombre de usuario debe tener al menos 3 caracteres');
    }
    if (!password || password.length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres');
    }
    if (!/^[a-zA-Z0-9_-]{3,50}$/.test(username.trim())) {
        throw new Error('El username solo puede contener letras, números, _ y -');
    }

    const avatarColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
    const avatarColor  = avatarColors[Math.floor(Math.random() * avatarColors.length)];

    // Verificar si el username ya existe (case-insensitive)
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .ilike('username', username.trim())
        .maybeSingle();

    if (existingUser) {
        throw new Error('Este nombre de usuario ya está en uso');
    }

    // Hashear la contraseña
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insertar el nuevo usuario
    const { data: newUser, error } = await supabase
        .from('users')
        .insert({
            username:      username.trim(),
            password_hash: passwordHash,
            avatar_color:  avatarColor
        })
        .select('id, username, avatar_color, created_at')
        .single();

    if (error) {
        if (error.code === '23505') {
            throw new Error('Este nombre de usuario ya está en uso');
        }
        throw new Error(`Error al crear usuario: ${error.message}`);
    }

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
};

// ============================================================
// FUNCIÓN: Autenticar usuario (Login)
// ============================================================
const loginUser = async (username, password) => {
    if (!username || !password) {
        throw new Error('Usuario y contraseña son requeridos');
    }

    const { data: user, error } = await supabase
        .from('users')
        .select('id, username, password_hash, avatar_color, created_at')
        .ilike('username', username.trim())
        .maybeSingle();

    if (error || !user) {
        throw new Error('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
        throw new Error('Credenciales inválidas');
    }

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
// FUNCIÓN: Generar JWT
// ============================================================
const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, username: user.username, avatar_color: user.avatar_color },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
};

// ============================================================
// MIDDLEWARE: Verificar JWT en rutas protegidas
// ============================================================
const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Acceso denegado. Se requiere autenticación.',
            code:  'NO_TOKEN'
        });
    }

    const token = authHeader.substring(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = {
            id:           decoded.id,
            username:     decoded.username,
            avatar_color: decoded.avatar_color
        };
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
                code:  'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({ error: 'Token inválido.', code: 'INVALID_TOKEN' });
    }
};

module.exports = { registerUser, loginUser, requireAuth };
