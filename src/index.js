// ============================================================
// index.js - Servidor Principal Express
// Materia: Programación No Numérica
//
// Punto de entrada de la aplicación. Configura:
//   - Servidor HTTP con Express
//   - Middlewares de seguridad y parsing
//   - Rutas de la API REST
//   - Manejo centralizado de errores
//   - Servicio de archivos estáticos del frontend
// ============================================================

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

const { testConnection, query, withTransaction, pool } = require('./db');
const { registerUser, loginUser, requireAuth }         = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================

// Parsear JSON en el body de las peticiones
app.use(express.json({ limit: '10mb' }));

// Parsear URL-encoded (formularios HTML)
app.use(express.urlencoded({ extended: true }));

// CORS: permitir peticiones desde el frontend (mismo origen en producción)
app.use(cors({
    origin:      process.env.NODE_ENV === 'production' ? false : '*',
    credentials: true
}));

// Servir archivos estáticos del frontend (HTML, CSS, JS del cliente)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// API ROUTES - AUTENTICACIÓN
// ============================================================

/**
 * POST /api/auth/register
 * Registrar un nuevo usuario
 * Body: { username, password }
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await registerUser(username, password);
        res.status(201).json({ 
            success: true, 
            message: `¡Bienvenido, ${result.user.username}!`,
            ...result 
        });
    } catch (error) {
        console.error('Error en registro:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/auth/login
 * Iniciar sesión
 * Body: { username, password }
 */
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await loginUser(username, password);
        res.json({ 
            success: true, 
            message: `¡Hola de vuelta, ${result.user.username}!`,
            ...result 
        });
    } catch (error) {
        console.error('Error en login:', error.message);
        res.status(401).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/auth/me
 * Verificar token y obtener datos del usuario actual
 * Header: Authorization: Bearer <token>
 */
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const result = await query(
            'SELECT id, username, avatar_color, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================================
// API ROUTES - POSTS
// ============================================================

/**
 * GET /api/posts
 * Obtener todos los posts con información del autor y conteo de comentarios
 * Paginación: ?page=1&limit=10
 */
app.get('/api/posts', requireAuth, async (req, res) => {
    try {
        const page  = parseInt(req.query.page)  || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const result = await query(`
            SELECT 
                p.id,
                p.title,
                p.content,
                p.upvotes,
                p.created_at,
                u.id          AS author_id,
                u.username    AS author_name,
                u.avatar_color AS author_color,
                COUNT(c.id)   AS comment_count
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN comments c ON c.post_id = p.id
            GROUP BY p.id, u.id, u.username, u.avatar_color
            ORDER BY p.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        // Total de posts para paginación
        const countResult = await query('SELECT COUNT(*) AS total FROM posts');
        const total = parseInt(countResult.rows[0].total);

        res.json({
            success: true,
            data: {
                posts:       result.rows,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error obteniendo posts:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener los posts' });
    }
});

/**
 * POST /api/posts
 * Crear un nuevo post (requiere autenticación)
 * Body: { title, content }
 */
app.post('/api/posts', requireAuth, async (req, res) => {
    try {
        const { title, content } = req.body;
        
        if (!title || title.trim().length === 0) {
            return res.status(400).json({ error: 'El título es requerido' });
        }
        if (!content || content.trim().length === 0) {
            return res.status(400).json({ error: 'El contenido es requerido' });
        }
        if (title.trim().length > 300) {
            return res.status(400).json({ error: 'El título no puede exceder 300 caracteres' });
        }

        // Insertar el post dentro de una transacción (garantía ACID)
        const result = await withTransaction(async (client) => {
            const postResult = await client.query(`
                INSERT INTO posts (user_id, title, content)
                VALUES ($1, $2, $3)
                RETURNING id, title, content, upvotes, created_at
            `, [req.user.id, title.trim(), content.trim()]);

            return postResult.rows[0];
        });

        // Enriquecer con datos del autor para la respuesta
        const newPost = {
            ...result,
            author_id:    req.user.id,
            author_name:  req.user.username,
            author_color: req.user.avatar_color,
            comment_count: '0'
        };

        console.log(`📝 Nuevo post creado: "${newPost.title}" por ${req.user.username}`);
        
        res.status(201).json({ success: true, data: newPost });
    } catch (error) {
        console.error('Error creando post:', error.message);
        res.status(500).json({ success: false, error: 'Error al crear el post' });
    }
});

/**
 * POST /api/posts/:id/upvote
 * Dar upvote a un post
 */
app.post('/api/posts/:id/upvote', requireAuth, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        
        const result = await query(
            'UPDATE posts SET upvotes = upvotes + 1 WHERE id = $1 RETURNING upvotes',
            [postId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Post no encontrado' });
        }
        
        res.json({ success: true, upvotes: result.rows[0].upvotes });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar votos' });
    }
});

// ============================================================
// API ROUTES - COMENTARIOS (ÁRBOL BINARIO)
// ============================================================

/**
 * GET /api/posts/:id/comments
 * Obtener TODOS los comentarios de un post ordenados para
 * reconstruir el árbol binario en el frontend.
 * 
 * Los comentarios se ordenan por 'path' (ruta materializada)
 * para mantener el orden del árbol sin recursión en BD.
 */
app.get('/api/posts/:id/comments', requireAuth, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        
        if (isNaN(postId)) {
            return res.status(400).json({ error: 'ID de post inválido' });
        }

        // Verificar que el post existe
        const postExists = await query('SELECT id FROM posts WHERE id = $1', [postId]);
        if (postExists.rows.length === 0) {
            return res.status(404).json({ error: 'Post no encontrado' });
        }

        // Obtener comentarios ordenados por path para preservar estructura del árbol
        // El ORDER BY path garantiza que los padres siempre vengan antes que sus hijos
        const result = await query(`
            SELECT 
                c.id,
                c.post_id,
                c.parent_id,
                c.content,
                c.depth,
                c.upvotes,
                c.path,
                c.created_at,
                u.id          AS author_id,
                u.username    AS author_name,
                u.avatar_color AS author_color
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = $1
            ORDER BY c.path ASC, c.created_at ASC
        `, [postId]);

        // NOTA EDUCATIVA: El frontend recibe una lista plana de comentarios
        // con parent_id. La clase CommentTree en script.js los convierte
        // a la estructura de árbol binario para renderizado recursivo.

        res.json({ 
            success: true, 
            data:    result.rows,
            count:   result.rows.length,
            educational_note: 
                'Los comentarios se envían como lista plana con parent_id. ' +
                'El frontend los convierte a un Árbol Binario usando la clase CommentTree.'
        });
    } catch (error) {
        console.error('Error obteniendo comentarios:', error.message);
        res.status(500).json({ success: false, error: 'Error al obtener los comentarios' });
    }
});

/**
 * POST /api/posts/:id/comments
 * Crear un nuevo comentario en un post
 * Body: { content, parent_id? }
 * 
 * ACID: Toda la inserción ocurre en una transacción.
 * El trigger de PostgreSQL (trg_update_comment_path) 
 * actualiza automáticamente depth y path.
 */
app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
    try {
        const postId   = parseInt(req.params.id);
        const { content, parent_id } = req.body;
        
        if (!content || content.trim().length === 0) {
            return res.status(400).json({ error: 'El contenido del comentario es requerido' });
        }
        
        if (content.trim().length > 10000) {
            return res.status(400).json({ error: 'El comentario es demasiado largo (max 10,000 caracteres)' });
        }

        const result = await withTransaction(async (client) => {
            // Verificar que el post existe (CONSISTENCIA ACID)
            const postCheck = await client.query(
                'SELECT id FROM posts WHERE id = $1', 
                [postId]
            );
            
            if (postCheck.rows.length === 0) {
                throw new Error('El post no existe');
            }

            // Si hay parent_id, verificar que el comentario padre existe
            // y pertenece al mismo post (CONSISTENCIA ACID)
            if (parent_id) {
                const parentCheck = await client.query(
                    'SELECT id, depth FROM comments WHERE id = $1 AND post_id = $2',
                    [parent_id, postId]
                );
                
                if (parentCheck.rows.length === 0) {
                    throw new Error('El comentario padre no existe en este post');
                }
                
                if (parentCheck.rows[0].depth >= 10) {
                    throw new Error('Se alcanzó la profundidad máxima de anidamiento (10 niveles)');
                }
            }

            // Insertar el comentario
            // El trigger de PostgreSQL calcula automáticamente depth y path
            const commentResult = await client.query(`
                INSERT INTO comments (post_id, user_id, parent_id, content)
                VALUES ($1, $2, $3, $4)
                RETURNING id, post_id, parent_id, content, depth, upvotes, path, created_at
            `, [postId, req.user.id, parent_id || null, content.trim()]);

            return commentResult.rows[0];
        });

        const newComment = {
            ...result,
            author_id:    req.user.id,
            author_name:  req.user.username,
            author_color: req.user.avatar_color
        };

        console.log(`💬 Nuevo comentario (depth: ${newComment.depth}) en post ${postId} por ${req.user.username}`);
        
        res.status(201).json({ success: true, data: newComment });
    } catch (error) {
        console.error('Error creando comentario:', error.message);
        const statusCode = error.message.includes('no existe') || 
                           error.message.includes('profundidad') ? 400 : 500;
        res.status(statusCode).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/comments/:id/upvote
 * Dar upvote a un comentario
 */
app.post('/api/comments/:id/upvote', requireAuth, async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);
        
        const result = await query(
            'UPDATE comments SET upvotes = upvotes + 1 WHERE id = $1 RETURNING upvotes',
            [commentId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Comentario no encontrado' });
        }
        
        res.json({ success: true, upvotes: result.rows[0].upvotes });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar votos' });
    }
});

// ============================================================
// RUTA: Servir el frontend para todas las rutas no-API
// (SPA fallback)
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ============================================================
// MANEJO CENTRALIZADO DE ERRORES
// ============================================================
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({ 
        success: false, 
        error: process.env.NODE_ENV === 'production' 
            ? 'Error interno del servidor' 
            : err.message 
    });
});

// ============================================================
// AUTO-SETUP: Crear tablas automáticamente si no existen
// Esto soluciona el error "relation users does not exist"
// ============================================================
const autoSetupDatabase = async () => {
    try {
        // Verificar si la tabla users ya existe
        const check = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = 'users'
            ) AS exists
        `);

        if (check.rows[0].exists) {
            console.log('✅ Tablas de base de datos verificadas');
            return;
        }

        console.log('⚙️  Primera ejecución: creando tablas automáticamente...');

        // Leer el archivo database.sql y ejecutarlo
        const sqlPath = path.join(__dirname, '..', 'database.sql');
        if (!fs.existsSync(sqlPath)) {
            console.error('❌ No se encontró database.sql');
            return;
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Ejecutar el SQL completo usando el pool directamente
        const client = await pool.connect();
        try {
            await client.query(sql);
            console.log('✅ Tablas creadas exitosamente');
            console.log('✅ Datos de ejemplo insertados');
        } finally {
            client.release();
        }
    } catch (err) {
        // Si el error es por datos duplicados (re-ejecución parcial), continuar
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
            console.log('✅ Tablas ya existentes, continuando...');
        } else {
            console.error('⚠️  Error en auto-setup:', err.message);
        }
    }
};

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const startServer = async () => {
    console.log('\n🤖 Iniciando Freedit...');
    console.log('   Materia: Programación No Numérica\n');
    
    // Verificar conexión a la base de datos
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
        console.error('\n❌ No se pudo conectar a la base de datos.');
        console.error('   Verifica tu archivo .env y que el servicio PostgreSQL esté corriendo.');
        console.error('   Windows: Busca "Servicios" → postgresql-x64-18 → Iniciar\n');
        process.exit(1);
    }

    // Auto-crear tablas si es la primera vez
    await autoSetupDatabase();
    
    app.listen(PORT, () => {
        console.log(`\n✅ Freedit corriendo en http://localhost:${PORT}`);
        console.log(`   📊 Entorno: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   🌐 Abre tu navegador en: http://localhost:${PORT}\n`);
    });
};

// Si estamos en Vercel, no iniciamos el servidor manualmente, solo exportamos app
if (!process.env.VERCEL) {
    startServer();
}

module.exports = app;
