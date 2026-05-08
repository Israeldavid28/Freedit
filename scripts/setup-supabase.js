// ============================================================
// setup-supabase.js
// Script para inicializar las tablas en Supabase via REST API
// Uso: node scripts/setup-supabase.js
// ============================================================

const https = require('https');

const SUPABASE_URL = 'https://bkzdpqrxalrxlclflddo.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJremRwcXJ4YWxyeGxjbGZsZGRvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIxMzc5MywiZXhwIjoyMDkzNzg5NzkzfQ.CYwCju-KcALwF_ztzp2qv8KoneMtaC2DFSb4mFG_x40';

const SQL_SETUP = `
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables (clean slate)
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- TABLE: users
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_color  VARCHAR(7) DEFAULT '#3b82f6',
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT chk_username_format CHECK (username ~ '^[a-zA-Z0-9_-]{3,50}$')
);
CREATE INDEX idx_users_username ON users(username);

-- TABLE: posts
CREATE TABLE posts (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    title      VARCHAR(300) NOT NULL,
    content    TEXT NOT NULL,
    upvotes    INTEGER DEFAULT 0 CHECK (upvotes >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_post_content CHECK (LENGTH(TRIM(content)) > 0),
    CONSTRAINT chk_post_title  CHECK (LENGTH(TRIM(title)) > 0)
);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_user_id ON posts(user_id);

-- TABLE: comments (Binary Tree structure)
CREATE TABLE comments (
    id         SERIAL PRIMARY KEY,
    post_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    parent_id  INTEGER,
    content    TEXT NOT NULL,
    depth      INTEGER DEFAULT 0 CHECK (depth >= 0 AND depth <= 10),
    upvotes    INTEGER DEFAULT 0 CHECK (upvotes >= 0),
    path       TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_comments_post   FOREIGN KEY (post_id)   REFERENCES posts(id)    ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_comments_user   FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_comment_content CHECK (LENGTH(TRIM(content)) > 0),
    CONSTRAINT chk_comment_depth CHECK (depth <= 10)
);
CREATE INDEX idx_comments_post_id   ON comments(post_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
CREATE INDEX idx_comments_path      ON comments(path);
CREATE INDEX idx_comments_user_id   ON comments(user_id);

-- FUNCTION: auto-update path and depth on comment insert
CREATE OR REPLACE FUNCTION update_comment_path()
RETURNS TRIGGER AS $$
DECLARE
    parent_path TEXT;
    parent_depth INTEGER;
BEGIN
    IF NEW.parent_id IS NULL THEN
        NEW.path = NEW.id::TEXT || '.';
        NEW.depth = 0;
    ELSE
        SELECT path, depth INTO parent_path, parent_depth
        FROM comments WHERE id = NEW.parent_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Parent comment with ID % not found', NEW.parent_id;
        END IF;
        NEW.path = parent_path || NEW.id::TEXT || '.';
        NEW.depth = parent_depth + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_comment_path ON comments;
CREATE TRIGGER trg_update_comment_path
    BEFORE INSERT ON comments
    FOR EACH ROW EXECUTE FUNCTION update_comment_path();

-- SEED DATA: sample users (password: "password")
INSERT INTO users (username, password_hash, avatar_color) VALUES
    ('prof_garcia',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#8b5cf6'),
    ('estudiante01', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#3b82f6'),
    ('estudiante02', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#10b981'),
    ('estudiante03', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#f59e0b')
ON CONFLICT (username) DO NOTHING;

INSERT INTO posts (user_id, title, content) VALUES
    (1, 'Bienvenidos a Freedit - Demo de Arbol Binario', 
     'Este es el primer post de demostracion. Los comentarios forman un arbol binario donde cada nodo tiene maximo dos hijos.');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 2, NULL, 'El recorrido inorden visita: izquierdo -> raiz -> derecho. En un ABB esto produce los elementos en orden ascendente.');
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 3, NULL, 'Tambien esta el recorrido preorden util para copiar el arbol, y el postorden para eliminarlo.');
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 1, 1, 'Exacto! Y en el contexto de BST con strings, se usa comparacion lexicografica.');
`;

function executeSQL(sql) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query: sql });
        const url = new URL(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`);

        // Use the pg REST endpoint
        const options = {
            hostname: url.hostname,
            path: '/rest/v1/rpc/exec_sql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'apikey': SERVICE_ROLE_KEY,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Better approach: use Supabase's postgres endpoint directly
function executeSQLDirect(sql) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query: sql });

        const options = {
            hostname: 'bkzdpqrxalrxlclflddo.supabase.co',
            path: '/pg',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
                'apikey': SERVICE_ROLE_KEY,
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    console.log('🚀 Iniciando setup de Supabase...');
    console.log(`   URL: ${SUPABASE_URL}\n`);

    console.log('📋 INSTRUCCIONES ALTERNATIVAS:');
    console.log('   Si este script falla, puedes ejecutar el SQL directamente en:');
    console.log('   https://supabase.com/dashboard/project/bkzdpqrxalrxlclflddo/editor');
    console.log('   Copia y pega el contenido de database.sql\n');

    try {
        const result = await executeSQL(SQL_SETUP);
        if (result.status === 200) {
            console.log('✅ Tablas creadas exitosamente en Supabase!');
            console.log('   Usuarios demo: prof_garcia, estudiante01-03 (contraseña: password)');
        } else {
            console.log(`⚠️  Respuesta del servidor: ${result.status}`);
            console.log('   Cuerpo:', JSON.stringify(result.body, null, 2));
        }
    } catch (error) {
        console.error('❌ Error ejecutando setup:', error.message);
        console.log('\n📋 Ejecuta el SQL manualmente en el editor de Supabase:');
        console.log('   https://supabase.com/dashboard/project/bkzdpqrxalrxlclflddo/editor');
    }
}

main();
