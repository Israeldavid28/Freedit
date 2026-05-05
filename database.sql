-- ============================================================
-- SCRIPT SQL - Reddit Binary Tree Simulator
-- Materia: Programación No Numérica
-- Descripción: Script completo de creación de base de datos
--              con cumplimiento ACID mediante transacciones,
--              llaves foráneas e índices optimizados.
-- ============================================================

-- Crear la base de datos (ejecutar esto conectado como superusuario)
-- CREATE DATABASE reddit_binary_tree;

-- Conectarse a la base de datos antes de ejecutar el resto
-- \c reddit_binary_tree

-- ============================================================
-- HABILITAR EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ELIMINAR TABLAS EXISTENTES (para reinicio limpio)
-- El orden importa por las llaves foráneas (CASCADE)
-- ============================================================
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS posts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- TABLA: users
-- Almacena los usuarios registrados del sistema.
-- La contraseña se almacena como hash bcrypt (NUNCA en texto plano).
-- ============================================================
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50) UNIQUE NOT NULL,
    -- password_hash: almacena el hash bcrypt de la contraseña
    -- El hash incluye el salt embebido, por eso no necesitamos columna salt separada
    password_hash VARCHAR(255) NOT NULL,
    avatar_color VARCHAR(7) DEFAULT '#3b82f6',   -- Color HEX para el avatar generado
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- CONSTRAINT: username solo puede tener letras, números, guiones y guiones bajos
    CONSTRAINT chk_username_format CHECK (username ~ '^[a-zA-Z0-9_-]{3,50}$')
);

-- Índice para búsquedas de login por username (consulta frecuente)
CREATE INDEX idx_users_username ON users(username);

-- Comentario educativo sobre la tabla
COMMENT ON TABLE users IS 
    'Tabla de usuarios. Cumple ACID: la inserción usa transacciones BEGIN/COMMIT 
     para garantizar atomicidad entre el registro y cualquier acción inicial.';

-- ============================================================
-- TABLA: posts
-- Cada post es la raíz de un árbol de comentarios.
-- Representa el "hilo" principal de Reddit.
-- ============================================================
CREATE TABLE posts (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    title       VARCHAR(300) NOT NULL,
    content     TEXT NOT NULL,
    upvotes     INTEGER DEFAULT 0 CHECK (upvotes >= 0),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- LLAVE FORÁNEA: garantiza que todo post pertenece a un usuario existente
    -- ON DELETE CASCADE: si se elimina el usuario, sus posts también se eliminan
    CONSTRAINT fk_posts_user
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- CONSTRAINT: el contenido no puede ser vacío
    CONSTRAINT chk_post_content CHECK (LENGTH(TRIM(content)) > 0),
    CONSTRAINT chk_post_title CHECK (LENGTH(TRIM(title)) > 0)
);

-- Índices para el feed principal (ordenado por fecha)
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_user_id ON posts(user_id);

COMMENT ON TABLE posts IS
    'Tabla de posts principales. Cada post es la RAÍZ de un Árbol Binario de comentarios.
     La relación user_id -> users.id garantiza CONSISTENCIA referencial.';

-- ============================================================
-- TABLA: comments
-- NÚCLEO DEL ÁRBOL BINARIO
-- 
-- Estructura del Árbol Binario de comentarios:
-- 
--   POST (raíz del árbol)
--    └─ Comment A (primer hijo del post)
--        ├─ Comment B (primer respuesta de A = hijo izquierdo)
--        │   └─ Comment D (primer respuesta de B)
--        └─ Comment C (siguiente comentario al mismo nivel de A = hermano derecho)
--
-- Campos clave para el árbol:
--   parent_id:    ID del comentario padre (NULL si es respuesta directa al post)
--   post_id:      ID del post raíz (para recuperar todo el árbol eficientemente)
--   depth:        Profundidad del nodo en el árbol (0 = respuesta directa al post)
--   path:         Ruta materializada para consultas eficientes de subárboles
-- ============================================================
CREATE TABLE comments (
    id          SERIAL PRIMARY KEY,
    post_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    parent_id   INTEGER,              -- NULL = hijo directo del post (nodo raíz nivel 0)
    content     TEXT NOT NULL,
    depth       INTEGER DEFAULT 0 CHECK (depth >= 0),  -- Profundidad en el árbol
    upvotes     INTEGER DEFAULT 0 CHECK (upvotes >= 0),
    -- path: ruta materializada tipo "1.3.7." para ordenamiento eficiente
    -- Permite reconstruir el árbol con un ORDER BY sin recursión en DB
    path        TEXT DEFAULT '',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- LLAVES FORÁNEAS: garantizan integridad referencial (Consistencia ACID)
    CONSTRAINT fk_comments_post
        FOREIGN KEY (post_id) 
        REFERENCES posts(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    CONSTRAINT fk_comments_user
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    
    -- Auto-referencia: un comentario puede tener un padre que es otro comentario
    -- ON DELETE SET NULL: si se borra el padre, el hijo pasa a ser raíz (no se pierde)
    CONSTRAINT fk_comments_parent
        FOREIGN KEY (parent_id) 
        REFERENCES comments(id) 
        ON DELETE SET NULL ON UPDATE CASCADE,
    
    -- CONSTRAINT: el contenido no puede estar vacío
    CONSTRAINT chk_comment_content CHECK (LENGTH(TRIM(content)) > 0),
    
    -- CONSTRAINT: la profundidad máxima es 10 niveles (límite de indentación visual)
    CONSTRAINT chk_comment_depth CHECK (depth <= 10)
);

-- Índices optimizados para reconstrucción del árbol
CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
CREATE INDEX idx_comments_path ON comments(path);
CREATE INDEX idx_comments_post_created ON comments(post_id, created_at);

COMMENT ON TABLE comments IS
    'Tabla de comentarios que implementa un ÁRBOL BINARIO.
     - parent_id: puntero al nodo padre (hijo izquierdo en terminología de árbol)
     - Los comentarios del mismo padre ordenados por created_at son los hermanos (derecho)
     - depth: profundidad del nodo para la indentación visual
     - path: ruta materializada para consultas O(1) de subárboles
     Cumple ACID: inserciones dentro de transacciones garantizan atomicidad.';

-- ============================================================
-- FUNCIÓN: Actualizar automáticamente el path y depth al insertar
-- Esto garantiza que el árbol siempre tenga rutas consistentes (Consistencia ACID)
-- ============================================================
CREATE OR REPLACE FUNCTION update_comment_path()
RETURNS TRIGGER AS $$
DECLARE
    parent_path TEXT;
    parent_depth INTEGER;
BEGIN
    IF NEW.parent_id IS NULL THEN
        -- Es un nodo raíz (respuesta directa al post)
        NEW.path = NEW.id::TEXT || '.';
        NEW.depth = 0;
    ELSE
        -- Obtener el path del padre para construir el path del hijo
        SELECT path, depth INTO parent_path, parent_depth
        FROM comments 
        WHERE id = NEW.parent_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Comentario padre con ID % no encontrado', NEW.parent_id;
        END IF;
        
        NEW.path = parent_path || NEW.id::TEXT || '.';
        NEW.depth = parent_depth + 1;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: se ejecuta DESPUÉS de insertar para usar el ID generado
CREATE TRIGGER trg_update_comment_path
    BEFORE INSERT ON comments
    FOR EACH ROW
    EXECUTE FUNCTION update_comment_path();

-- ============================================================
-- DATOS DE EJEMPLO (semilla educativa)
-- Inserción dentro de una transacción para garantizar atomicidad
-- ============================================================
BEGIN;

-- Usuarios de ejemplo (contraseñas hasheadas con bcrypt, factor 10)
-- Password real: "password123" para todos los usuarios de ejemplo
INSERT INTO users (username, password_hash, avatar_color) VALUES
    ('prof_garcia',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#8b5cf6'),
    ('estudiante01',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#3b82f6'),
    ('estudiante02',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#10b981'),
    ('estudiante03',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#f59e0b');

-- Posts de ejemplo
INSERT INTO posts (user_id, title, content) VALUES
    (1, '¿Qué es un Árbol Binario?', 
     'Un árbol binario es una estructura de datos donde cada nodo tiene como máximo DOS hijos: el hijo izquierdo y el hijo derecho. En nuestro contexto de comentarios de Reddit, el "hijo izquierdo" representa la PRIMERA respuesta a un comentario, y el "hijo derecho" representa el SIGUIENTE comentario al mismo nivel (hermano). ¿Alguien puede explicar cómo se implementa el recorrido inorden?'),
    
    (2, 'Diferencia entre Árbol Binario y Árbol Binario de Búsqueda', 
     'He estado estudiando y me confundo entre estos dos conceptos. Sé que en un ABB los valores menores van a la izquierda y los mayores a la derecha, pero ¿cómo se aplica esto a datos no numéricos como comentarios de texto?'),
    
    (1, 'Complejidad temporal de operaciones en Árboles', 
     'Para el examen, deben recordar: Búsqueda en ABB = O(log n) promedio, O(n) peor caso. Inserción = O(log n) promedio. Recorrido completo = O(n) siempre. ¿Preguntas?');

-- Comentarios de ejemplo para el post 1 (se insertarán secuencialmente para que el trigger funcione)
-- Nivel 0: Respuestas directas al post
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 2, NULL, 'El recorrido inorden visita: izquierdo -> raíz -> derecho. En un ABB esto produce los elementos en orden ascendente. ¡Es muy elegante!');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 3, NULL, 'También está el recorrido preorden (raíz -> izq -> der) útil para copiar el árbol, y el postorden (izq -> der -> raíz) útil para eliminar el árbol.');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 4, NULL, 'Yo lo entiendo mejor con una analogía: imagina el árbol genealógico de una familia. La raíz es el abuelo, y cada hijo puede tener máximo 2 descendientes directos.');

-- Nivel 1: Respuestas a comentarios de nivel 0
-- Respuesta al comentario 1
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 1, 1, '¡Exacto! Y en el contexto de BST con strings, se puede usar comparación lexicográfica. "apple" < "banana" porque "a" < "b" en ASCII.');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 3, 1, 'Complementando: el inorden en árboles de expresiones matemáticas produce la notación infija que usamos normalmente, como (a + b) * c.');

-- Respuesta al comentario 2
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 4, 2, 'Gracias por explicar los tipos de recorrido. ¿Cuál sería más eficiente para buscar un comentario específico en este sistema?');

-- Nivel 2: Respuestas a respuestas
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 2, 4, 'Para búsqueda en árbol de comentarios (no BST ordenado), cualquier recorrido tiene O(n) en el peor caso. No hay atajos sin índices adicionales.');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (1, 1, 6, 'Depende del caso de uso. Si buscas el comentario más reciente, DFS con postorden puede encontrarlo antes si los más nuevos están en hojas.');

-- Comentarios para el post 2
INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (2, 1, NULL, 'Excelente pregunta. La diferencia clave: un Árbol Binario es la ESTRUCTURA (cada nodo máximo 2 hijos), mientras que el ABB es un árbol binario con una PROPIEDAD ADICIONAL de ordenamiento.');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (2, 3, NULL, 'Para datos no numéricos como comentarios, usamos un árbol binario simple sin la propiedad de búsqueda. El orden es temporal (primero insertado = primero mostrado).');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (2, 4, 9, 'Entonces en este sistema, ¿el árbol NUNCA está balanceado automáticamente? ¿Puede volverse una lista enlazada?');

INSERT INTO comments (post_id, user_id, parent_id, content) VALUES
    (2, 1, 11, 'Sí, exactamente. Si todos los comentarios son respuestas al último comentario, el árbol degenera. Por eso Reddit tiene límites de anidamiento (usualmente 8-10 niveles).');

COMMIT;

-- Verificación de los datos insertados
SELECT 
    'Usuarios insertados: ' || COUNT(*) AS verificacion 
FROM users;

SELECT 
    'Posts insertados: ' || COUNT(*) AS verificacion 
FROM posts;

SELECT 
    'Comentarios insertados: ' || COUNT(*) AS verificacion 
FROM comments;

-- Ver el árbol del post 1 con indentación visual
SELECT 
    REPEAT('  ', depth) || '📝 [' || c.id || '] ' || 
    SUBSTRING(c.content, 1, 50) || '...' AS arbol_visual,
    c.depth,
    c.path,
    u.username AS autor
FROM comments c
JOIN users u ON c.user_id = u.id
WHERE c.post_id = 1
ORDER BY c.path;
