
// ============================================================
// index.js - Servidor Principal Express (migrado a Supabase JS)
// Materia: Programación No Numérica
//
// Rutas de la API REST que usan @supabase/supabase-js
// en lugar de pg directo. Elimina problemas de SSL/pooler.
// ============================================================

const express = require('express');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config();

const supabase = require('./supabase');
const { registerUser, loginUser, requireAuth } = require('./auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    credentials: true
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============================================================
// API ROUTES - AUTENTICACIÓN
// ============================================================

/** POST /api/auth/register */
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

/** POST /api/auth/login */
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

/** GET /api/auth/me */
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, avatar_color, created_at')
            .eq('id', req.user.id)
            .single();

        if (error || !user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================================
// API ROUTES - POSTS
// ============================================================

/**
 * GET /api/posts
 * Paginación: ?page=1&limit=20
 */
app.get('/api/posts', requireAuth, async (req, res) => {
    try {
        const page   = parseInt(req.query.page)  || 1;
        const limit  = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Obtener posts con autor y comentarios (para contar)
        const { data: posts, error } = await supabase
            .from('posts')
            .select('id, title, content, upvotes, created_at, users!inner(id, username, avatar_color), comments(id)')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Total de posts para paginación
        const { count: total } = await supabase
            .from('posts')
            .select('id', { count: 'exact', head: true });

        // Transformar a formato que espera el frontend
        const formattedPosts = (posts || []).map(p => ({
            id:            p.id,
            title:         p.title,
            content:       p.content,
            upvotes:       p.upvotes,
            created_at:    p.created_at,
            author_id:     p.users.id,
            author_name:   p.users.username,
            author_color:  p.users.avatar_color,
            comment_count: String(p.comments?.length || 0)
        }));

        res.json({
            success: true,
            data: {
                posts: formattedPosts,
                pagination: {
                    page,
                    limit,
                    total:      total || 0,
                    totalPages: Math.ceil((total || 0) / limit)
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

        const { data: post, error } = await supabase
            .from('posts')
            .insert({
                user_id: req.user.id,
                title:   title.trim(),
                content: content.trim()
            })
            .select('id, title, content, upvotes, created_at')
            .single();

        if (error) throw error;

        const newPost = {
            ...post,
            author_id:     req.user.id,
            author_name:   req.user.username,
            author_color:  req.user.avatar_color,
            comment_count: '0'
        };

        console.log(`📝 Nuevo post: "${newPost.title}" por ${req.user.username}`);
        res.status(201).json({ success: true, data: newPost });
    } catch (error) {
        console.error('Error creando post:', error.message);
        res.status(500).json({ success: false, error: 'Error al crear el post' });
    }
});

/**
 * POST /api/posts/:id/upvote
 */
app.post('/api/posts/:id/upvote', requireAuth, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);

        const { data: current } = await supabase
            .from('posts')
            .select('upvotes')
            .eq('id', postId)
            .single();

        if (!current) return res.status(404).json({ error: 'Post no encontrado' });

        const { data: updated, error } = await supabase
            .from('posts')
            .update({ upvotes: current.upvotes + 1 })
            .eq('id', postId)
            .select('upvotes')
            .single();

        if (error) throw error;
        res.json({ success: true, upvotes: updated.upvotes });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar votos' });
    }
});

// ============================================================
// API ROUTES - COMENTARIOS (ÁRBOL BINARIO)
// ============================================================

/**
 * GET /api/posts/:id/comments
 * Comentarios ordenados por path para reconstruir el árbol binario.
 */
app.get('/api/posts/:id/comments', requireAuth, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);

        if (isNaN(postId)) {
            return res.status(400).json({ error: 'ID de post inválido' });
        }

        // Verificar que el post existe
        const { data: post } = await supabase
            .from('posts')
            .select('id')
            .eq('id', postId)
            .single();

        if (!post) {
            return res.status(404).json({ error: 'Post no encontrado' });
        }

        // Obtener comentarios con datos del autor, ordenados por path
        const { data: comments, error } = await supabase
            .from('comments')
            .select('id, post_id, parent_id, content, depth, upvotes, path, created_at, users!inner(id, username, avatar_color)')
            .eq('post_id', postId)
            .order('path', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Transformar al formato plano que espera el frontend
        const formattedComments = (comments || []).map(c => ({
            id:           c.id,
            post_id:      c.post_id,
            parent_id:    c.parent_id,
            content:      c.content,
            depth:        c.depth,
            upvotes:      c.upvotes,
            path:         c.path,
            created_at:   c.created_at,
            author_id:    c.users.id,
            author_name:  c.users.username,
            author_color: c.users.avatar_color
        }));

        res.json({
            success: true,
            data:    formattedComments,
            count:   formattedComments.length,
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
 * Body: { content, parent_id? }
 * El trigger de PostgreSQL calcula depth y path automáticamente.
 */
app.post('/api/posts/:id/comments', requireAuth, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const { content, parent_id } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({ error: 'El contenido del comentario es requerido' });
        }
        if (content.trim().length > 10000) {
            return res.status(400).json({ error: 'El comentario es demasiado largo (max 10,000 caracteres)' });
        }

        // Verificar que el post existe
        const { data: post } = await supabase
            .from('posts')
            .select('id')
            .eq('id', postId)
            .single();

        if (!post) {
            return res.status(400).json({ error: 'El post no existe' });
        }

        // Si hay parent_id, verificar que existe y no excede profundidad máxima
        if (parent_id) {
            const { data: parent } = await supabase
                .from('comments')
                .select('id, depth')
                .eq('id', parent_id)
                .eq('post_id', postId)
                .single();

            if (!parent) {
                return res.status(400).json({ error: 'El comentario padre no existe en este post' });
            }
            if (parent.depth >= 10) {
                return res.status(400).json({ error: 'Se alcanzó la profundidad máxima de anidamiento (10 niveles)' });
            }
        }

        // Insertar el comentario — el trigger de PostgreSQL calcula depth y path
        const { data: comment, error } = await supabase
            .from('comments')
            .insert({
                post_id:   postId,
                user_id:   req.user.id,
                parent_id: parent_id || null,
                content:   content.trim()
            })
            .select('id, post_id, parent_id, content, depth, upvotes, path, created_at')
            .single();

        if (error) throw error;

        const newComment = {
            ...comment,
            author_id:    req.user.id,
            author_name:  req.user.username,
            author_color: req.user.avatar_color
        };

        console.log(`💬 Comentario (depth: ${newComment.depth}) en post ${postId} por ${req.user.username}`);
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
 */
app.post('/api/comments/:id/upvote', requireAuth, async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);

        const { data: current } = await supabase
            .from('comments')
            .select('upvotes')
            .eq('id', commentId)
            .single();

        if (!current) return res.status(404).json({ error: 'Comentario no encontrado' });

        const { data: updated, error } = await supabase
            .from('comments')
            .update({ upvotes: current.upvotes + 1 })
            .eq('id', commentId)
            .select('upvotes')
            .single();

        if (error) throw error;
        res.json({ success: true, upvotes: updated.upvotes });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar votos' });
    }
});

// ============================================================
// SPA FALLBACK — Servir frontend para rutas no-API
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
// VERIFICAR CONEXIÓN A SUPABASE AL INICIAR
// ============================================================
const autoSetupDatabase = async () => {
    try {
        const { error } = await supabase.from('users').select('id').limit(1);
        if (error) {
            console.error('❌ Error conectando a Supabase:', error.message);
            console.error('   Verifica SUPABASE_URL y SUPABASE_SERVICE_ROLE en Vercel.');
        } else {
            console.log('✅ Conexión a Supabase verificada — tablas OK');
        }
    } catch (err) {
        console.error('⚠️  Error al verificar Supabase:', err.message);
    }
};

// ============================================================
// INICIAR SERVIDOR
// ============================================================
const startServer = async () => {
    console.log('\n🤖 Iniciando Freedit...');
    console.log('   Materia: Programación No Numérica\n');

    await autoSetupDatabase();

    app.listen(PORT, () => {
        console.log(`\n✅ Freedit corriendo en http://localhost:${PORT}`);
        console.log(`   📊 Entorno: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   🌐 Abre tu navegador en: http://localhost:${PORT}\n`);
    });
};

// Si estamos en Vercel, no iniciamos el servidor manualmente
if (!process.env.VERCEL) {
    startServer();
}

module.exports = app;
