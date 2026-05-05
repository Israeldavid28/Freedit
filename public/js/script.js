// ============================================================
// script.js - Lógica del Frontend & Árbol Binario
// Materia: Programación No Numérica
// ============================================================

const API = '/api';
let currentUser = null;
let authToken   = localStorage.getItem('token') || null;

// ============================================================
// CLASE: CommentNode - Nodo del Árbol Binario
// Cada comentario es un nodo con:
//   - leftChild:  primera RESPUESTA a este comentario
//   - rightSibling: siguiente comentario al MISMO NIVEL
// ============================================================
class CommentNode {
  constructor(data) {
    this.id           = data.id;
    this.postId       = data.post_id;
    this.parentId     = data.parent_id;
    this.content      = data.content;
    this.depth        = data.depth;
    this.upvotes      = data.upvotes;
    this.path         = data.path;
    this.createdAt    = data.created_at;
    this.authorId     = data.author_id;
    this.authorName   = data.author_name;
    this.authorColor  = data.author_color;

    // Punteros del Árbol Binario
    this.leftChild     = null;  // Primera respuesta (hijo)
    this.rightSibling  = null;  // Siguiente comentario del mismo nivel (hermano)
  }
}

// ============================================================
// CLASE: CommentTree - Árbol Binario de Comentarios
// Construye el árbol a partir de una lista plana de comentarios
// y permite recorrerlo recursivamente para renderizarlo.
// ============================================================
class CommentTree {
  constructor() {
    this.roots = [];      // Nodos raíz (depth=0, sin parent)
    this.nodeMap = new Map(); // Map<id, CommentNode> para O(1) lookup
  }

  // ----------------------------------------------------------
  // Construir el árbol desde una lista plana de comentarios
  // Algoritmo:
  //   1. Crear todos los nodos y guardarlos en nodeMap
  //   2. Conectar cada nodo con su padre (leftChild / rightSibling)
  // ----------------------------------------------------------
  buildFromList(commentsList) {
    this.roots = [];
    this.nodeMap.clear();

    // Paso 1: crear todos los nodos
    commentsList.forEach(data => {
      this.nodeMap.set(data.id, new CommentNode(data));
    });

    // Paso 2: conectar punteros del árbol binario
    // Los comentarios ya vienen ordenados por path (orden del árbol)
    commentsList.forEach(data => {
      const node = this.nodeMap.get(data.id);

      if (!data.parent_id) {
        // Nodo raíz: insertar en la lista de raíces como hermanos
        this._insertAsRootSibling(node);
      } else {
        const parent = this.nodeMap.get(data.parent_id);
        if (parent) {
          // Insertar como hijo izquierdo o hermano derecho
          this._insertAsChild(parent, node);
        }
      }
    });

    return this;
  }

  // Insertar nodo en la cadena de raíces (hermanos derechos)
  _insertAsRootSibling(node) {
    if (this.roots.length === 0) {
      this.roots.push(node);
    } else {
      let last = this.roots[this.roots.length - 1];
      // Recorrer la cadena de hermanos hasta el último
      while (last.rightSibling) last = last.rightSibling;
      last.rightSibling = node;
      this.roots.push(node);
    }
  }

  // Insertar nodo como hijo o hermano del padre
  _insertAsChild(parent, node) {
    if (!parent.leftChild) {
      // El padre no tiene hijos: este es el primer hijo (izquierdo)
      parent.leftChild = node;
    } else {
      // El padre ya tiene hijo: recorrer hermanos hasta el último
      let sibling = parent.leftChild;
      while (sibling.rightSibling) sibling = sibling.rightSibling;
      sibling.rightSibling = node;
    }
  }

  // ----------------------------------------------------------
  // Insertar un nuevo nodo en el árbol ya construido
  // Se usa cuando el usuario agrega un comentario en tiempo real
  // ----------------------------------------------------------
  insertNode(newData) {
    const node = new CommentNode(newData);
    this.nodeMap.set(node.id, node);

    if (!node.parentId) {
      this._insertAsRootSibling(node);
    } else {
      const parent = this.nodeMap.get(node.parentId);
      if (parent) this._insertAsChild(parent, node);
    }
    return node;
  }

  // ----------------------------------------------------------
  // Recorrido recursivo: renderizar el árbol completo
  // Recorre raíces → para cada raíz: hijo izquierdo → hermano derecho
  // Devuelve un DocumentFragment con todos los nodos renderizados
  // ----------------------------------------------------------
  renderAll(postId, onReply, onVote) {
    const container = document.createDocumentFragment();
    this.roots.forEach(root => {
      container.appendChild(this._renderNode(root, postId, onReply, onVote));
    });
    return container;
  }

  // Renderizar un nodo y sus hijos
  _renderNode(node, postId, onReply, onVote) {
    if (!node) return document.createDocumentFragment();

    const wrapper = document.createElement('div');
    wrapper.className = 'comment-node';
    wrapper.setAttribute('data-depth', node.depth);
    wrapper.setAttribute('data-id', node.id);

    // Crear burbuja del comentario actual
    const bubble = this._createBubble(node, postId, onReply, onVote);
    wrapper.appendChild(bubble);

    // Los hijos (respuestas) se agrupan en un contenedor para aplicar la línea de hilo
    if (node.leftChild) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'comment-children';
      
      // Iterar sobre el hijo izquierdo y todos sus hermanos derechos
      let child = node.leftChild;
      while (child) {
        childrenContainer.appendChild(this._renderNode(child, postId, onReply, onVote));
        child = child.rightSibling;
      }
      wrapper.appendChild(childrenContainer);
    }

    return wrapper;
  }

  // Crear el elemento HTML de la burbuja de un comentario
  _createBubble(node, postId, onReply, onVote) {
    const timeAgo = formatTimeAgo(node.createdAt);
    const initials = node.authorName.slice(0, 2).toUpperCase();

    const el = document.createElement('div');
    el.innerHTML = `
      <div class="comment-bubble">
        <div class="comment-header">
          <div class="avatar" style="background:${node.authorColor};width:22px;height:22px;font-size:0.65rem">${initials}</div>
          <span class="comment-author">${escapeHtml(node.authorName)}</span>
          <span class="comment-time">${timeAgo}</span>
          <span class="comment-depth-badge">depth:${node.depth}</span>
        </div>
        <p class="comment-content">${escapeHtml(node.content)}</p>
        <div class="comment-actions">
          <button class="btn-comment-vote" data-id="${node.id}">
            ▲ <span class="vote-count-${node.id}">${node.upvotes}</span>
          </button>
          ${node.depth < 10 ? `<button class="btn-reply" data-id="${node.id}">💬 Responder</button>` : '<span style="font-size:0.72rem;color:var(--text-muted)">Máx. profundidad</span>'}
        </div>
        <div class="reply-form" id="reply-form-${node.id}">
          <div class="comment-input-wrap">
            <textarea class="comment-textarea" placeholder="Responder a ${escapeHtml(node.authorName)}..." rows="2" id="reply-input-${node.id}"></textarea>
          </div>
          <button class="btn-comment-submit" data-post="${postId}" data-parent="${node.id}">Enviar</button>
        </div>
      </div>
    `;

    // Eventos del nodo
    const voteBtn  = el.querySelector('.btn-comment-vote');
    const replyBtn = el.querySelector('.btn-reply');
    const submitBtn= el.querySelector('.btn-comment-submit');

    if (voteBtn)  voteBtn.addEventListener('click', () => onVote('comment', node.id));
    if (replyBtn) replyBtn.addEventListener('click', () => {
      const form = document.getElementById(`reply-form-${node.id}`);
      form.classList.toggle('visible');
      if (form.classList.contains('visible'))
        document.getElementById(`reply-input-${node.id}`).focus();
    });
    if (submitBtn) submitBtn.addEventListener('click', () => {
      const input = document.getElementById(`reply-input-${node.id}`);
      onReply(postId, node.id, input.value, input);
    });

    return el;
  }

  // Información educativa del árbol para el panel
  getStats() {
    const total  = this.nodeMap.size;
    const height = this._getHeight(this.roots[0] || null);
    const leaves = this._countLeaves(this.roots[0] || null);
    return { total, height, leaves };
  }

  _getHeight(node) {
    if (!node) return 0;
    return 1 + Math.max(this._getHeight(node.leftChild), this._getHeight(node.rightSibling));
  }

  _countLeaves(node) {
    if (!node) return 0;
    if (!node.leftChild && !node.rightSibling) return 1;
    return this._countLeaves(node.leftChild) + this._countLeaves(node.rightSibling);
  }
}

// ============================================================
// UTILIDADES
// ============================================================
const escapeHtml = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const formatTimeAgo = (dateStr) => {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)   return 'ahora';
  if (diff < 3600) return `${Math.floor(diff/60)}m`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h`;
  return `${Math.floor(diff/86400)}d`;
};

// ============================================================
// API HELPER
// ============================================================
const apiFetch = async (path, options = {}) => {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconocido');
  return data;
};

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
const showToast = (msg, type = 'info') => {
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${icons[type]} ${escapeHtml(msg)}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3200);
};

// ============================================================
// AUTENTICACIÓN
// ============================================================
const checkAuth = async () => {
  if (!authToken) return showAuthScreen();
  try {
    const res = await apiFetch('/auth/me');
    currentUser = res.user;
    showAppScreen();
  } catch {
    localStorage.removeItem('token');
    authToken = null;
    showAuthScreen();
  }
};

const showAuthScreen = () => {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.remove('visible');
};

const showAppScreen = () => {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');

  // Mostrar nombre de usuario en navbar
  document.getElementById('nav-username').textContent = currentUser.username;
  const av = document.getElementById('nav-avatar');
  av.textContent = currentUser.username.slice(0,2).toUpperCase();
  av.style.background = currentUser.avatar_color;

  loadFeed();
};

// ============================================================
// FEED DE POSTS
// ============================================================
const loadFeed = async () => {
  const list = document.getElementById('posts-list');
  list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Cargando posts...</p></div>';
  try {
    const res = await apiFetch('/posts');
    const posts = res.data.posts;
    list.innerHTML = '';
    if (posts.length === 0) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>No hay posts. ¡Sé el primero!</p></div>';
      return;
    }
    posts.forEach(p => list.appendChild(createPostCard(p)));
  } catch(e) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>${e.message}</p></div>`;
  }
};

const createPostCard = (post) => {
  const initials = post.author_name.slice(0,2).toUpperCase();
  const card = document.createElement('div');
  card.className = 'post-card';
  card.setAttribute('data-post-id', post.id);
  card.innerHTML = `
    <div class="post-card-header">
      <div class="avatar" style="background:${post.author_color}">${initials}</div>
      <div class="post-meta">
        <div class="post-author">${escapeHtml(post.author_name)}</div>
        <div class="post-time">${formatTimeAgo(post.created_at)}</div>
      </div>
    </div>
    <div class="post-card-body">
      <h3 class="post-title">${escapeHtml(post.title)}</h3>
      <p class="post-content">${escapeHtml(post.content)}</p>
    </div>
    <div class="post-card-footer">
      <button class="btn-vote" id="vote-post-${post.id}">
        <span class="vote-icon">▲</span>
        <span class="post-votes-${post.id}">${post.upvotes}</span>
      </button>
      <button class="btn-toggle-comments" id="toggle-${post.id}">
        💬 ${post.comment_count} comentarios
      </button>
    </div>
    <div class="comments-section" id="comments-${post.id}"></div>
  `;

  card.querySelector(`#vote-post-${post.id}`).addEventListener('click', () => votePost(post.id));
  card.querySelector(`#toggle-${post.id}`).addEventListener('click', () => toggleComments(post.id));

  return card;
};

// ============================================================
// CREAR POST
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-create-post').addEventListener('click', async () => {
    const title   = document.getElementById('post-title-input').value.trim();
    const content = document.getElementById('post-content-input').value.trim();
    if (!title)   return showToast('El título es requerido', 'error');
    if (!content) return showToast('El contenido es requerido', 'error');
    const btn = document.getElementById('btn-create-post');
    btn.disabled = true; btn.textContent = 'Publicando...';
    try {
      const res = await apiFetch('/posts', { method:'POST', body:{ title, content } });
      document.getElementById('post-title-input').value = '';
      document.getElementById('post-content-input').value = '';
      document.getElementById('posts-list').prepend(createPostCard(res.data));
      showToast('Post publicado ✨', 'success');
    } catch(e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Publicar'; }
  });
});

// ============================================================
// VOTOS
// ============================================================
const votePost = async (postId) => {
  try {
    const res = await apiFetch(`/posts/${postId}/upvote`, { method:'POST' });
    document.querySelector(`.post-votes-${postId}`).textContent = res.upvotes;
  } catch(e) { showToast(e.message, 'error'); }
};

const voteComment = async (commentId) => {
  try {
    const res = await apiFetch(`/comments/${commentId}/upvote`, { method:'POST' });
    document.querySelector(`.vote-count-${commentId}`).textContent = res.upvotes;
  } catch(e) { showToast(e.message, 'error'); }
};

// ============================================================
// COMENTARIOS - ÁRBOL BINARIO
// ============================================================
const commentTrees = {};  // Map postId → CommentTree

const toggleComments = async (postId) => {
  const section = document.getElementById(`comments-${postId}`);
  section.classList.toggle('visible');
  if (section.classList.contains('visible') && !commentTrees[postId]) {
    await loadComments(postId);
  }
};

const loadComments = async (postId) => {
  const section = document.getElementById(`comments-${postId}`);
  section.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res = await apiFetch(`/posts/${postId}/comments`);

    // Construir el Árbol Binario
    const tree = new CommentTree();
    tree.buildFromList(res.data);
    commentTrees[postId] = tree;

    renderCommentSection(postId, section, tree);
  } catch(e) {
    section.innerHTML = `<p style="color:var(--danger);padding:1rem">${e.message}</p>`;
  }
};

const renderCommentSection = (postId, section, tree) => {
  section.innerHTML = '';

  // Formulario para comentario raíz
  const rootForm = document.createElement('div');
  rootForm.className = 'comment-form-root';
  rootForm.innerHTML = `
    <div class="comment-input-wrap">
      <textarea class="comment-textarea" placeholder="Escribe un comentario..." rows="2" id="root-comment-${postId}"></textarea>
    </div>
    <button class="btn-comment-submit" id="root-submit-${postId}">Comentar</button>
  `;
  rootForm.querySelector(`#root-submit-${postId}`).addEventListener('click', () => {
    const input = document.getElementById(`root-comment-${postId}`);
    submitComment(postId, null, input.value, input);
  });
  section.appendChild(rootForm);

  // Árbol de comentarios
  const treeContainer = document.createElement('div');
  treeContainer.className = 'tree-container';
  treeContainer.id = `tree-${postId}`;
  treeContainer.appendChild(
    tree.renderAll(postId,
      (pid, parentId, content, input) => submitComment(pid, parentId, content, input),
      (type, id) => type === 'comment' ? voteComment(id) : votePost(id)
    )
  );
  section.appendChild(treeContainer);

  if (tree.nodeMap.size === 0) {
    treeContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">💬</span><p>Sin comentarios. ¡Inicia la conversación!</p></div>';
  }
};

const submitComment = async (postId, parentId, content, inputEl) => {
  if (!content || !content.trim()) return showToast('Escribe algo antes de enviar', 'error');
  try {
    const res = await apiFetch(`/posts/${postId}/comments`, {
      method: 'POST',
      body:   { content: content.trim(), parent_id: parentId || undefined }
    });
    const newNode = commentTrees[postId].insertNode(res.data);
    inputEl.value = '';

    // Cerrar formulario de respuesta inline
    if (parentId) {
      const form = document.getElementById(`reply-form-${parentId}`);
      if (form) form.classList.remove('visible');
    }

    // Re-renderizar el árbol actualizado
    const section = document.getElementById(`comments-${postId}`);
    renderCommentSection(postId, section, commentTrees[postId]);

    // Actualizar contador en botón
    const toggleBtn = document.getElementById(`toggle-${postId}`);
    const count = commentTrees[postId].nodeMap.size;
    toggleBtn.textContent = `💬 ${count} comentarios`;

    showToast('Comentario publicado', 'success');
  } catch(e) { showToast(e.message, 'error'); }
};

// ============================================================
// AUTH UI
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab, .auth-form').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`form-${btn.dataset.tab}`).classList.add('active');
      document.getElementById('auth-error').classList.remove('visible');
    });
  });

  // Login
  document.getElementById('btn-login').addEventListener('click', async () => {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      const res = await fetch('/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('token', authToken);
      showToast(data.message, 'success');
      showAppScreen();
    } catch(e) {
      const err = document.getElementById('auth-error');
      err.textContent = e.message;
      err.classList.add('visible');
    } finally { btn.disabled = false; btn.textContent = 'Iniciar sesión'; }
  });

  // Register
  document.getElementById('btn-register').addEventListener('click', async () => {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const btn = document.getElementById('btn-register');
    btn.disabled = true; btn.textContent = 'Registrando...';
    try {
      const res = await fetch('/api/auth/register', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('token', authToken);
      showToast(data.message, 'success');
      showAppScreen();
    } catch(e) {
      const err = document.getElementById('auth-error');
      err.textContent = e.message;
      err.classList.add('visible');
    } finally { btn.disabled = false; btn.textContent = 'Crear cuenta'; }
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('token');
    Object.keys(commentTrees).forEach(k => delete commentTrees[k]);
    showToast('Sesión cerrada', 'info');
    showAuthScreen();
  });

  // Enter en inputs de auth
  ['login-password','reg-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById(id === 'login-password' ? 'btn-login' : 'btn-register').click();
    });
  });

  // Panel educativo toggle
  document.getElementById('edu-toggle').addEventListener('click', () => {
    document.getElementById('edu-body').classList.toggle('visible');
  });

  // Iniciar
  checkAuth();
});
