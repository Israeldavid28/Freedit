# Freedit – Simulador de Hilos con Árboles Binarios
### Materia: Programación No Numérica

## 📋 Paso 0 — Instalar Node.js y PostgreSQL (solo la primera vez)

### Instalar Node.js
1. Ve a https://nodejs.org/ y descarga la versión **LTS** (ej. 20.x)
2. Ejecuta el instalador `.msi` → sigue los pasos → **reinicia el PC**
3. Verifica abriendo PowerShell y escribiendo:
   ```
   node --version
   npm --version
   ```

### Instalar PostgreSQL
1. Ve a https://www.postgresql.org/download/windows/
2. Descarga el instalador de **EDB** (ej. PostgreSQL 16)
3. Durante la instalación:
   - Deja el puerto en **5432**
   - Escribe una contraseña para el usuario `postgres` (¡guárdala!)
   - Instala también **pgAdmin 4** (la casilla estará marcada por defecto)
4. Reinicia el PC si se pide

---

## ⚙️ Instalación del proyecto en Windows 11

> 💡 **Cómo abrir la terminal en la carpeta correcta:**
> En VS Code presiona **Ctrl + `** (acento grave) → ya estará en la carpeta del proyecto.
> O bien: en el Explorador de Windows navega a la carpeta, haz clic en la barra de direcciones, escribe `powershell` y presiona Enter.

### 1. Instalar dependencias
En la terminal dentro de la carpeta `reddit-binary-tree`:
```powershell
npm install
```

### 2. Crear la base de datos
Abre **pgAdmin 4** (se instaló con PostgreSQL) y en el panel izquierdo:
1. Clic derecho en **Databases** → **Create** → **Database**
2. Nombre: `reddit_binary_tree` → **Save**

Alternativa por terminal (si `psql` está en tu PATH):
```powershell
psql -U postgres -c "CREATE DATABASE reddit_binary_tree;"
```

### 3. Ejecutar el script SQL
En **pgAdmin 4**:
1. Selecciona la base de datos `reddit_binary_tree`
2. Menú **Tools** → **Query Tool**
3. Abre el archivo `database.sql` (botón de carpeta) → **F5** para ejecutar

Alternativa por terminal:
```powershell
psql -U postgres -d reddit_binary_tree -f database.sql
```

### 4. Configurar variables de entorno
En la terminal del proyecto:
```powershell
copy .env.example .env
```
Luego edita el archivo `.env` (ya visible en VS Code) y pon tu contraseña de PostgreSQL:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=reddit_binary_tree
DB_USER=postgres
DB_PASSWORD=la_contraseña_que_pusiste_al_instalar
JWT_SECRET=cambia_esto_por_cualquier_texto_largo
```

### 5. Iniciar el servidor
```powershell
npm run dev
```
Verás en la terminal:
```
✅ Conexión a PostgreSQL verificada
✅ Servidor corriendo en http://localhost:3000
```

### 6. Abrir la aplicación
Abre tu navegador y visita:
```
http://localhost:3000
```

---

## 👥 Usuarios de demo (ya en la base de datos)
| Usuario | Contraseña |
|---------|------------|
| `prof_garcia` | `password` |
| `estudiante01` | `password` |
| `estudiante02` | `password` |
| `estudiante03` | `password` |

> ⚠️ Las contraseñas del seed usan un hash de bcrypt específico. Si no funcionan, regístrate con un usuario nuevo.

---

## 🗂️ Estructura de archivos

```
reddit-binary-tree/
├── src/
│   ├── index.js      ← Servidor Express + todas las rutas API
│   ├── db.js         ← Conexión PostgreSQL + transacciones ACID
│   └── auth.js       ← bcrypt + JWT + middleware requireAuth
├── public/
│   ├── index.html    ← SPA: pantalla de login + feed
│   ├── css/
│   │   └── styles.css ← Dark mode, animaciones, árbol visual
│   └── js/
│       └── script.js  ← CommentNode, CommentTree, lógica UI
├── database.sql       ← Esquema completo + datos de ejemplo
├── .env.example       ← Plantilla de configuración
└── package.json
```

---

## 🌳 Cómo funciona el Árbol Binario

```
POST (raíz del árbol)
 └── Comentario A (depth=0)          ← leftChild del post
      ├── Respuesta B (depth=1)      ← leftChild de A
      │    └── Respuesta D (depth=2) ← leftChild de B
      └── Comentario C (depth=0)     ← rightSibling de A
           └── Respuesta E (depth=1) ← leftChild de C
```

- **`leftChild`** → primera respuesta al comentario
- **`rightSibling`** → siguiente comentario al mismo nivel
- El **color del borde** izquierdo indica la profundidad (depth 0–10)
- La **sangría visual** refleja la profundidad en el árbol

---

## 🔒 Principios ACID implementados

| Principio | Implementación |
|-----------|---------------|
| **Atomicidad** | `BEGIN/COMMIT/ROLLBACK` en registro, creación de posts y comentarios |
| **Consistencia** | Foreign keys + CHECK constraints + trigger de path |
| **Aislamiento** | Pool de conexiones dedicadas por transacción |
| **Durabilidad** | PostgreSQL garantiza escritura en disco con COMMIT |
