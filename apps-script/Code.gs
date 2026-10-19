/**
 * LA RETA · Pádel Tepic
 * Servidor de la app (Google Apps Script + Google Sheets).
 *
 * Instalación:
 *   1. Pega este archivo como Code.gs y la app como Index.html.
 *   2. Ejecuta una vez la función instalar() y autoriza los permisos.
 *   3. Implementar > Nueva implementación > Aplicación web
 *      Ejecutar como: Yo · Quién tiene acceso: Cualquier persona.
 *   4. Abre el link y regístrate primero: la primera cuenta es la del administrador.
 */

var VERSION_APP = 'La Reta 1.0';
var HOJAS = {
  JUGADORES: ['id', 'celular', 'nombre', 'apellido', 'alias', 'salt', 'hash', 'rol', 'estado', 'creado', 'actualizado', 'nivel'],
  SESIONES: ['token', 'jugadorId', 'creado', 'ultimo'],
  CLUBS: ['id', 'ownerId', 'nombre', 'ciudad', 'direccion', 'canchas', 'telefono', 'horario', 'creado', 'actualizado', 'apertura', 'cierre', 'turno', 'fotos', 'descripcion', 'precios', 'promos', 'canchasInfo', 'extras'],
  BLOQUEOS: ['id', 'clubId', 'fecha', 'cancha', 'hora', 'nota', 'porId', 'creado'],
  RETAS: ['id', 'creadorId', 'fecha', 'hora', 'club', 'canchas', 'maxJugadores', 'tipo', 'puntos', 'modo', 'reglas', 'castigo', 'jugadores', 'partidos', 'creado', 'nivel', 'buscando'],
  MARCADORES: ['id', 'retaId', 'matchId', 'a', 'b', 'porId', 'actualizado'],
  MULTAS: ['id', 'retaId', 'jugadorId', 'n'],
  SUSCRIPCIONES: ['id', 'jugadorId', 'endpoint', 'creado', 'ultimo'],
  AVISOS: ['id', 'paraId', 'tipo', 'texto', 'retaId', 'deId', 'creado', 'leido'],
  PATROCINADORES: ['id', 'nombre', 'giro', 'paquete', 'cancha', 'cuota', 'forma', 'color', 'tinta', 'siglas', 'contacto', 'premio', 'lema', 'imagenId', 'activo', 'actualizado']
};
var JSON_COLS = { reglas: 1, jugadores: 1, partidos: 1, fotos: 1, precios: 1, promos: 1, canchasInfo: 1 };
var NUM_COLS = { canchas: 1, maxJugadores: 1, puntos: 1, a: 1, b: 1, n: 1, cancha: 1, cuota: 1, turno: 1 };
var SESION_DIAS = 120;
var MAX_FALLOS = 5;
var BLOQUEO_SEG = 900;

/* ===================== Web app ===================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('La Reta · Pádel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Entrada para la app instalable (GitHub Pages): recibe {token, accion, datos} en JSON. */
function doPost(e) {
  var r;
  try {
    var b = JSON.parse(e.postData.contents || '{}');
    r = api(b.token || '', String(b.accion || ''), b.datos || {});
  } catch (err) {
    r = { ok: false, error: 'Solicitud no válida.' };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

var CON_TODO_ = { perfil: 1, club: 1, bloqueo: 1, crearReta: 1, inscritos: 1, partidos: 1, borrarReta: 1, patrocinador: 1, borrarPatrocinador: 1, estadoJugador: 1, nivelJugador: 1, faltaUno: 1 };

/** Punto único de entrada desde la app. */
function api(token, accion, datos) {
  try {
    CACHE_TABLAS_ = {}; ENCABEZADO_OK_ = {};
    datos = datos || {};
    if (accion === 'registro') return ok_(registro_(datos));
    if (accion === 'entrar') return ok_(entrar_(datos));
    if (accion === 'publico') return ok_(todo_(null, datos.version));
    if (accion === 'vapid') return ok_({ llave: vapid_().pub });
    if (accion === 'pushPendiente') return ok_(pushPendiente_(datos));
    if (accion === 'imagenPatro') return ok_(imagenPatro_(datos));

    var yo = sesion_(token);
    if (!yo) return { ok: false, error: 'Tu sesión terminó. Vuelve a entrar.', sesion: false };
    if (yo.estado === 'bloqueado') return { ok: false, error: 'Tu cuenta está bloqueada. Habla con el administrador.', sesion: false };

    var acciones = {
      todo: function () { return todo_(yo, datos.version); },
      salir: function () { return salir_(token); },
      perfil: function () { return guardarPerfil_(yo, datos); },
      cambiarPin: function () { return cambiarPin_(yo, datos); },
      club: function () { return guardarClub_(yo, datos); },
      bloqueo: function () { return bloqueo_(yo, datos); },
      crearReta: function () { return crearReta_(yo, datos); },
      inscritos: function () { return inscritos_(yo, datos); },
      partidos: function () { return guardarPartidos_(yo, datos); },
      marcador: function () { return marcador_(yo, datos); },
      multa: function () { return multa_(yo, datos); },
      borrarReta: function () { return borrarReta_(yo, datos); },
      patrocinador: function () { return guardarPatro_(yo, datos); },
      borrarPatrocinador: function () { return borrarPatro_(yo, datos); },
      subirImagen: function () { return subirImagen_(yo, datos); },
      leerAvisos: function () { return leerAvisos_(yo); },
      probarPush: function () { return probarPush_(yo); },
      suscribir: function () { return suscribir_(yo, datos); },
      jugadoresAdmin: function () { return jugadoresAdmin_(yo); },
      resetPin: function () { return resetPin_(yo, datos); },
      estadoJugador: function () { return estadoJugador_(yo, datos); },
      nivelJugador: function () { return nivelJugador_(yo, datos); },
      faltaUno: function () { return faltaUno_(yo, datos); }
    };
    if (!acciones[accion]) throw new Error('Acción no válida.');
    var res = ok_(acciones[accion]());
    // Para acciones que cambian datos, manda de una vez los datos nuevos: la app se ahorra una segunda llamada.
    if (CON_TODO_[accion]) { CACHE_TABLAS_ = {}; res.todo = todo_(sesion_(token) || yo, ''); }
    return res;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function ok_(r) { return { ok: true, data: r }; }
function falla_(msg) { throw new Error(msg); }

/* ===================== Hojas ===================== */

function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function hoja_(nombre) {
  var h = libro_().getSheetByName(nombre);
  if (!h && HOJAS[nombre]) {
    h = libro_().insertSheet(nombre);
    var cols = HOJAS[nombre];
    h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0a0d00').setFontColor('#d4ff1f');
    h.getRange(1, 1, h.getMaxRows(), cols.length).setNumberFormat('@');
    h.setFrozenRows(1);
  }
  if (!h) falla_('Falta la hoja ' + nombre + '. Ejecuta instalar().');
  if (HOJAS[nombre] && !ENCABEZADO_OK_[nombre]) {
    var cols2 = HOJAS[nombre], cab = h.getRange(1, 1, 1, cols2.length).getDisplayValues()[0];
    if (cab.join('|') !== cols2.join('|')) {
      h.getRange(1, 1, 1, cols2.length).setValues([cols2]).setFontWeight('bold').setBackground('#0a0d00').setFontColor('#d4ff1f');
      if (h.getMaxRows() > 1) h.getRange(2, 1, h.getMaxRows() - 1, cols2.length).setNumberFormat('@');
    }
    ENCABEZADO_OK_[nombre] = 1;
  }
  return h;
}

var CACHE_TABLAS_ = {};
var ENCABEZADO_OK_ = {};
function tabla_(nombre) {
  if (CACHE_TABLAS_[nombre]) return CACHE_TABLAS_[nombre];
  var h = hoja_(nombre), cols = HOJAS[nombre];
  var n = h.getLastRow() - 1, filas = [];
  if (n > 0) {
    var v = h.getRange(2, 1, n, cols.length).getDisplayValues();
    for (var i = 0; i < v.length; i++) {
      if (!v[i][0]) continue;
      var o = { _fila: i + 2 };
      for (var c = 0; c < cols.length; c++) o[cols[c]] = desdeCelda_(cols[c], v[i][c]);
      filas.push(o);
    }
  }
  CACHE_TABLAS_[nombre] = filas;
  return filas;
}

function desdeCelda_(col, v) {
  if (JSON_COLS[col]) { try { return v ? JSON.parse(v) : []; } catch (e) { return []; } }
  if (NUM_COLS[col]) return v === '' ? null : Number(v);
  if (col === 'activo') return v !== 'false' && v !== 'FALSE' && v !== '0';
  return v;
}
function aCelda_(col, v) {
  if (JSON_COLS[col]) return JSON.stringify(v || []);
  if (v === null || v === undefined) return '';
  return String(v);
}

function buscar_(nombre, id) {
  var t = tabla_(nombre);
  for (var i = 0; i < t.length; i++) if (t[i].id === id || (nombre === 'SESIONES' && t[i].token === id)) return t[i];
  return null;
}

function guardar_(nombre, obj) {
  var h = hoja_(nombre), cols = HOJAS[nombre];
  var llave = nombre === 'SESIONES' ? obj.token : obj.id;
  var previo = buscar_(nombre, llave);
  var fila = cols.map(function (c) { return aCelda_(c, obj[c]); });
  if (previo) {
    h.getRange(previo._fila, 1, 1, cols.length).setValues([fila]);
    for (var c in obj) previo[c] = obj[c];
  } else {
    var nueva = h.getLastRow() + 1;
    h.getRange(nueva, 1, 1, cols.length).setNumberFormat('@').setValues([fila]);
    obj._fila = nueva;
    tabla_(nombre).push(obj);
  }
  tocar_();
  return obj;
}

function borrar_(nombre, id) {
  var o = buscar_(nombre, id);
  if (!o) return;
  hoja_(nombre).deleteRow(o._fila);
  delete CACHE_TABLAS_[nombre];
  tocar_();
}

function tocar_() {
  PropertiesService.getScriptProperties().setProperty('VERSION_DATOS', String(Date.now()));
}
function versionDatos_() {
  return PropertiesService.getScriptProperties().getProperty('VERSION_DATOS') || '0';
}

function conCandado_(fn) {
  var l = LockService.getScriptLock();
  if (!l.tryLock(15000)) falla_('La app está ocupada, intenta de nuevo en un momento.');
  try { CACHE_TABLAS_ = {}; return fn(); } finally { l.releaseLock(); }
}

function nuevoId_(prefijo) {
  return prefijo + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}
function ahora_() { return new Date().toISOString(); }

/* ===================== Seguridad ===================== */

function pimienta_() {
  var p = PropertiesService.getScriptProperties(), v = p.getProperty('PIMIENTA');
  if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('PIMIENTA', v); }
  return v;
}
function hashPin_(salt, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pin + '|' + pimienta_(), Utilities.Charset.UTF_8);
  var s = bytes.map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length === 1 ? '0' + x : x; }).join('');
  for (var i = 0; i < 300; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s + salt, Utilities.Charset.UTF_8);
    s = bytes.map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length === 1 ? '0' + x : x; }).join('');
  }
  return s;
}
function limpiarCel_(c) {
  var d = String(c || '').replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('52') === 0) d = d.slice(2);
  if (d.length === 13 && d.indexOf('521') === 0) d = d.slice(3);
  return d;
}
function validarPin_(p) {
  p = String(p || '');
  if (!/^\d{6}$/.test(p)) falla_('El PIN debe ser de 6 números.');
  if (/^(\d)\1{5}$/.test(p) || p === '123456' || p === '654321') falla_('Ese PIN es muy fácil de adivinar. Elige otro.');
  return p;
}
function texto_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 80); }

function registro_(d) {
  return conCandado_(function () {
    var cel = limpiarCel_(d.celular);
    if (cel.length !== 10) falla_('Escribe tu celular a 10 dígitos.');
    var pin = validarPin_(d.pin);
    var nombre = texto_(d.nombre, 40);
    if (!nombre) falla_('Escribe tu nombre.');
    var t = tabla_('JUGADORES');
    for (var i = 0; i < t.length; i++) if (t[i].celular === cel) falla_('Ese celular ya está registrado. Entra con tu PIN.');
    var hayCuentas = t.some(function (x) { return x.celular; });
    var salt = Utilities.getUuid();
    var j = guardar_('JUGADORES', {
      id: nuevoId_('u'), celular: cel, nombre: nombre, apellido: texto_(d.apellido, 40), alias: texto_(d.alias, 24),
      salt: salt, hash: hashPin_(salt, pin), rol: hayCuentas ? 'JUGADOR' : 'ADMIN', estado: 'activo', creado: ahora_(), actualizado: ahora_()
    });
    return { token: crearSesion_(j.id), yo: publicoJugador_(j, j) };
  });
}

function entrar_(d) {
  var cel = limpiarCel_(d.celular), pin = String(d.pin || '');
  var cache = CacheService.getScriptCache(), llave = 'fallos_' + cel;
  var fallos = Number(cache.get(llave) || 0);
  if (fallos >= MAX_FALLOS) falla_('Demasiados intentos. Espera 15 minutos o pide al administrador que te cambie el PIN.');
  var j = null, t = tabla_('JUGADORES');
  for (var i = 0; i < t.length; i++) if (t[i].celular && t[i].celular === cel) j = t[i];
  if (!j || !/^\d{6}$/.test(pin) || hashPin_(j.salt, pin) !== j.hash) {
    cache.put(llave, String(fallos + 1), BLOQUEO_SEG);
    falla_('Celular o PIN incorrectos.' + (fallos + 1 >= 3 ? ' Te quedan ' + Math.max(0, MAX_FALLOS - fallos - 1) + ' intentos.' : ''));
  }
  if (j.estado === 'bloqueado') falla_('Tu cuenta está bloqueada. Habla con el administrador.');
  cache.remove(llave);
  return conCandado_(function () { return { token: crearSesion_(j.id), yo: publicoJugador_(j, j) }; });
}

function crearSesion_(jugadorId) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  guardar_('SESIONES', { token: token, jugadorId: jugadorId, creado: ahora_(), ultimo: ahora_() });
  return token;
}

function sesion_(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  var cache = CacheService.getScriptCache(), k = 'ses_' + token;
  var jid = cache.get(k);
  if (!jid) {
    var s = buscar_('SESIONES', token);
    if (!s) return null;
    var dias = (Date.now() - new Date(s.creado).getTime()) / 864e5;
    if (dias > SESION_DIAS) return null;
    jid = s.jugadorId;
    cache.put(k, jid, 3600);
  }
  return buscar_('JUGADORES', jid);
}

function salir_(token) {
  return conCandado_(function () {
    CacheService.getScriptCache().remove('ses_' + token);
    borrar_('SESIONES', token);
    return true;
  });
}

function cambiarPin_(yo, d) {
  if (hashPin_(yo.salt, String(d.actual || '')) !== yo.hash) falla_('Tu PIN actual no coincide.');
  var pin = validarPin_(d.nuevo);
  return conCandado_(function () {
    var j = buscar_('JUGADORES', yo.id), salt = Utilities.getUuid();
    j.salt = salt; j.hash = hashPin_(salt, pin); j.actualizado = ahora_();
    guardar_('JUGADORES', j);
    return true;
  });
}

function esAdmin_(yo) { return yo && yo.rol === 'ADMIN'; }
function soloAdmin_(yo) { if (!esAdmin_(yo)) falla_('Solo el administrador puede hacer esto.'); }

/* ===================== Lectura ===================== */

function publicoJugador_(j, yo) {
  var o = { id: j.id, nombre: j.nombre, apellido: j.apellido, alias: j.alias, nivel: Number(j.nivel) || 0, demo: !j.celular };
  if (yo && (yo.id === j.id || esAdmin_(yo))) { o.celular = j.celular; o.rol = j.rol; o.estado = j.estado; }
  return o;
}

function todo_(yo, versionCliente) {
  var v = versionDatos_();
  if (versionCliente && versionCliente === v) return { igual: true, version: v };
  var admin = esAdmin_(yo);
  var jug = tabla_('JUGADORES').filter(function (j) { return j.estado !== 'bloqueado' || admin; });
  var r = {
    version: v,
    yo: yo ? publicoJugador_(yo, yo) : null,
    admin: admin,
    jugadores: jug.map(function (j) { return publicoJugador_(j, yo); }),
    clubs: tabla_('CLUBS').map(limpio_),
    bloqueos: bloqueosVigentes_(),
    retas: tabla_('RETAS').map(limpio_),
    marcadores: tabla_('MARCADORES').map(function (m) { return { id: m.id, retaId: m.retaId, matchId: m.matchId, a: m.a, b: m.b }; }),
    multas: tabla_('MULTAS').map(limpio_),
    patrocinadores: tabla_('PATROCINADORES').map(function (p) {
      var o = limpio_(p);
      if (!admin) { delete o.cuota; if (!p.activo) return null; }
      return o;
    }).filter(Boolean),
    avisos: yo ? misAvisos_(yo) : []
  };
  return r;
}
function limpio_(o) { var c = {}; for (var k in o) if (k !== '_fila') c[k] = o[k]; return c; }

/* ===================== Perfil y clubs ===================== */

function guardarPerfil_(yo, d) {
  return conCandado_(function () {
    var j = buscar_('JUGADORES', yo.id);
    var nombre = texto_(d.nombre, 40);
    if (!nombre) falla_('Escribe tu nombre.');
    j.nombre = nombre; j.apellido = texto_(d.apellido, 40); j.alias = texto_(d.alias, 24); if (d.nivel !== undefined) j.nivel = nivelValido_(d.nivel); j.actualizado = ahora_();
    guardar_('JUGADORES', j);
    return publicoJugador_(j, j);
  });
}

function horaValida_(h, def) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || '')) ? String(h) : def; }
function clubDe_(yo, clubId) {
  var t = tabla_('CLUBS');
  for (var i = 0; i < t.length; i++) if ((clubId && t[i].id === clubId && (t[i].ownerId === yo.id || esAdmin_(yo))) || (!clubId && t[i].ownerId === yo.id)) return t[i];
  return null;
}
function guardarClub_(yo, d) {
  return conCandado_(function () {
    var nombre = texto_(d.nombre, 60);
    if (!nombre) falla_('Escribe el nombre del club.');
    var prev = clubDe_(yo, d.id || '');
    if (d.id && !prev) falla_('Solo el dueño del club puede editarlo.');
    var c = prev || { id: nuevoId_('c'), ownerId: yo.id, creado: ahora_() };
    c.nombre = nombre; c.ciudad = texto_(d.ciudad, 40); c.direccion = texto_(d.direccion, 120);
    c.canchas = Math.max(1, Math.min(20, Number(d.canchas) || 1));
    c.telefono = texto_(d.telefono, 20); c.horario = texto_(d.horario, 60);
    c.apertura = horaValida_(d.apertura, '07:00'); c.cierre = horaValida_(d.cierre, '23:00');
    if (c.cierre <= c.apertura) falla_('La hora de cierre debe ser después de la de apertura.');
    c.turno = [60, 90, 120].indexOf(Number(d.turno)) >= 0 ? Number(d.turno) : 90;
    c.descripcion = texto_(d.descripcion, 300);
    c.fotos = (d.fotos || []).filter(function (x) { return /^[A-Za-z0-9_-]{10,}$/.test(x); }).slice(0, 8);
    var dias = function (a) { var o = []; (a || []).forEach(function (x) { x = Number(x); if (x >= 0 && x <= 6 && o.indexOf(x) < 0) o.push(x); }); return o.sort(); };
    var fecha = function (f) { return /^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) ? String(f) : ''; };
    var num = function (v, max) { v = Math.round(Number(v) || 0); return Math.max(0, Math.min(max, v)); };
    c.precios = (d.precios || []).slice(0, 12).map(function (p) {
      return { nombre: texto_(p.nombre, 30), dias: dias(p.dias), desde: horaValida_(p.desde, c.apertura), hasta: horaValida_(p.hasta, c.cierre), precio: num(p.precio, 20000) };
    }).filter(function (p) { return p.dias.length && p.precio > 0; });
    c.promos = (d.promos || []).slice(0, 10).map(function (p) {
      return { id: /^[a-z0-9]{4,16}$/.test(p.id || '') ? p.id : nuevoId_('pr').slice(0, 12), titulo: texto_(p.titulo, 40), desc: texto_(p.desc, 140),
        tipo: p.tipo === 'fijo' ? 'fijo' : 'pct', valor: num(p.valor, p.tipo === 'fijo' ? 20000 : 100), dias: dias(p.dias),
        desde: horaValida_(p.desde, c.apertura), hasta: horaValida_(p.hasta, c.cierre), inicio: fecha(p.inicio), fin: fecha(p.fin), activa: p.activa !== false };
    }).filter(function (p) { return p.titulo; });
    var info = d.canchasInfo || [];
    c.canchasInfo = [];
    for (var k = 0; k < c.canchas; k++) {
      var x = info[k] || {};
      c.canchasInfo.push({ nombre: texto_(x.nombre, 24) || ('Cancha ' + (k + 1)), techada: !!x.techada, pared: x.pared === 'muro' ? 'muro' : 'cristal', activa: x.activa !== false, nota: texto_(x.nota, 60) });
    }
    c.extras = texto_(d.extras, 120);
    c.actualizado = ahora_();
    guardar_('CLUBS', c);
    return limpio_(c);
  });
}
function hoyMx_() { return Utilities.formatDate(new Date(), 'America/Mazatlan', 'yyyy-MM-dd'); }
function bloqueosVigentes_() {
  var hoy = hoyMx_();
  return tabla_('BLOQUEOS').filter(function (b) { return b.fecha >= hoy; })
    .map(function (b) { return { id: b.id, clubId: b.clubId, fecha: b.fecha, cancha: b.cancha, hora: b.hora, nota: b.nota }; });
}
function bloqueo_(yo, d) {
  return conCandado_(function () {
    var c = clubDe_(yo, d.clubId);
    if (!c) falla_('Solo el club puede cambiar sus horarios.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha))) falla_('Fecha no válida.');
    var cancha = Number(d.cancha), hora = horaValida_(d.hora, '');
    if (!(cancha >= 1 && cancha <= (c.canchas || 1)) || !hora) falla_('Horario no válido.');
    var id = c.id + '_' + d.fecha + '_' + cancha + '_' + hora.replace(':', '');
    var prev = buscar_('BLOQUEOS', id);
    if (d.ocupado) {
      guardar_('BLOQUEOS', { id: id, clubId: c.id, fecha: d.fecha, cancha: cancha, hora: hora, nota: texto_(d.nota, 40), porId: yo.id, creado: ahora_() });
    } else if (prev) {
      borrar_('BLOQUEOS', id);
    }
    var hoy = hoyMx_();
    var viejos = tabla_('BLOQUEOS').filter(function (b) { return b.fecha < hoy; }).map(function (b) { return b._fila; }).sort(function (a, b) { return b - a; });
    if (viejos.length > 50) { viejos.forEach(function (f) { hoja_('BLOQUEOS').deleteRow(f); }); delete CACHE_TABLAS_.BLOQUEOS; tocar_(); }
    return true;
  });
}

/* ===================== Retas ===================== */

function reta_(id) { var r = buscar_('RETAS', id); if (!r) falla_('Esa reta ya no existe.'); return r; }
function puedeOrganizar_(yo, r) { return esAdmin_(yo) || r.creadorId === yo.id || (r.jugadores || []).indexOf(yo.id) >= 0; }
function tieneMarcadores_(retaId) {
  return tabla_('MARCADORES').some(function (m) { return m.retaId === retaId && (m.a !== null || m.b !== null); });
}

function crearReta_(yo, d) {
  return conCandado_(function () {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha))) falla_('Elige la fecha.');
    if (!/^\d{2}:\d{2}$/.test(String(d.hora))) falla_('Elige la hora.');
    var club = texto_(d.club, 60);
    if (!club) falla_('Escribe el club.');
    var reglas = (d.reglas || []).map(function (x) { return texto_(x, 80); }).filter(Boolean).slice(0, 12);
    var r = {
      id: nuevoId_('r'), creadorId: yo.id, fecha: d.fecha, hora: d.hora, club: club,
      canchas: Math.max(1, Math.min(12, Number(d.canchas) || 1)),
      maxJugadores: Math.max(4, Math.min(64, Number(d.maxJugadores) || 8)),
      tipo: d.tipo === 'fija' ? 'fija' : 'royal', puntos: Math.max(1, Math.min(99, Number(d.puntos) || 24)),
      modo: d.modo === 'meta' ? 'meta' : 'total', reglas: reglas, castigo: texto_(d.castigo, 24) || 'Castigos',
      jugadores: [], partidos: [], creado: ahora_(), nivel: rangoValido_(d.nivel), buscando: ''
    };
    guardar_('RETAS', r);
    avisarNuevaReta_(yo, r);
    return limpio_(r);
  });
}

function inscritos_(yo, d) {
  return conCandado_(function () {
    var r = reta_(d.retaId);
    if ((r.partidos || []).length) falla_('Los partidos ya se sortearon. Para cambiar jugadores primero vuelve a sortear.');
    var validos = {}; tabla_('JUGADORES').forEach(function (j) { if (j.estado !== 'bloqueado') validos[j.id] = 1; });
    var nueva = [], vistos = {};
    (d.jugadores || []).forEach(function (id) { if (validos[id] && !vistos[id]) { vistos[id] = 1; nueva.push(id); } });
    if (nueva.length > r.maxJugadores) falla_('La reta ya está llena.');
    var antes = r.jugadores || [];
    var organiza = esAdmin_(yo) || r.creadorId === yo.id;
    if (!organiza) {
      var quitados = antes.filter(function (x) { return nueva.indexOf(x) < 0; });
      var agregados = nueva.filter(function (x) { return antes.indexOf(x) < 0; });
      var soloYo = quitados.concat(agregados).every(function (x) { return x === yo.id; });
      var reordena = !quitados.length && !agregados.length && antes.indexOf(yo.id) >= 0;
      if (!soloYo && !reordena) falla_('Solo quien creó la reta puede inscribir o quitar a otros.');
    }
    r.jugadores = nueva;
    guardar_('RETAS', r);
    avisarInscritos_(yo, r, antes, nueva);
    return limpio_(r);
  });
}

/* ===================== Niveles y "Me falta uno" ===================== */

var NIVELES_ = ['', '1ra', '2da', '3ra', '4ta', '5ta', '6ta', 'Principiante'];
function nivelValido_(n) { n = Math.round(Number(n) || 0); return n >= 1 && n <= 7 ? String(n) : ''; }
function rangoValido_(t) {
  var m = String(t || '').match(/^(\d)-(\d)$/);
  if (!m) return '';
  var a = Number(nivelValido_(m[1])), b = Number(nivelValido_(m[2]));
  if (!a || !b) return '';
  return Math.min(a, b) + '-' + Math.max(a, b);
}
function rangoTxt_(t) {
  var m = String(t || '').split('-');
  if (m.length !== 2) return '';
  return m[0] === m[1] ? NIVELES_[Number(m[0])] : NIVELES_[Number(m[0])] + ' a ' + NIVELES_[Number(m[1])];
}
function nivelJugador_(yo, d) {
  if (!esAdmin_(yo)) falla_('Solo el administrador puede cambiar el nivel de otros.');
  return conCandado_(function () {
    var j = buscar_('JUGADORES', d.id);
    if (!j) falla_('No encontré a ese jugador.');
    j.nivel = nivelValido_(d.nivel); j.actualizado = ahora_();
    guardar_('JUGADORES', j);
    return publicoJugador_(j, yo);
  });
}
function minutos_(h) { var p = String(h || '').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }

/** Avisa a los jugadores más adecuados (nivel parecido y que suelen jugar a esa hora) que a la reta le faltan jugadores. */
function faltaUno_(yo, d) {
  return conCandado_(function () {
    var r = reta_(d.retaId);
    var ins = r.jugadores || [];
    if (!(esAdmin_(yo) || r.creadorId === yo.id || ins.indexOf(yo.id) >= 0)) falla_('Solo quien está en la reta puede pedir jugadores.');
    if ((r.partidos || []).length) falla_('Los partidos ya se sortearon.');
    var faltan = Number(r.maxJugadores) - ins.length;
    if (faltan <= 0) falla_('La reta ya está llena.');
    var ahoraMx = Utilities.formatDate(new Date(), 'America/Mazatlan', "yyyy-MM-dd'T'HH:mm");
    var inicio = r.fecha + 'T' + r.hora;
    if (inicio < ahoraMx.slice(0, 10) + 'T00:00' || (r.fecha === ahoraMx.slice(0, 10) && minutos_(r.hora) + 30 < minutos_(ahoraMx.slice(11)))) falla_('Esta reta ya pasó.');
    if (r.buscando) {
      var mins = (new Date().getTime() - new Date(r.buscando).getTime()) / 60000;
      if (mins < 30) falla_('Ya se avisó hace ' + Math.max(1, Math.round(mins)) + ' min. Puedes volver a avisar en ' + Math.ceil(30 - mins) + ' min.');
    }

    var jug = tabla_('JUGADORES'), nivelDe = {};
    jug.forEach(function (j) { nivelDe[j.id] = Number(j.nivel) || 0; });
    // Nivel buscado: el de la reta o el promedio de los inscritos.
    var lo = 0, hi = 0, rg = String(r.nivel || '').split('-');
    if (rg.length === 2) { lo = Number(rg[0]); hi = Number(rg[1]); }
    else {
      var ns = ins.map(function (x) { return nivelDe[x]; }).filter(Boolean);
      if (ns.length) { var p = ns.reduce(function (a, b) { return a + b; }, 0) / ns.length; lo = Math.floor(p); hi = Math.ceil(p); }
    }
    // Afinidad: retas jugadas a una hora parecida y en el mismo club.
    var hora = minutos_(r.hora), club = normTxt_(r.club), af = {};
    tabla_('RETAS').forEach(function (x) {
      if (x.id === r.id) return;
      var ids = (x.jugadores || []).slice();
      (x.partidos || []).forEach(function (f) { if (f && f.jugadorId) ids.push(f.jugadorId); });
      var cerca = Math.abs(minutos_(x.hora) - hora) <= 90, mismo = normTxt_(x.club) === club;
      var vistos = {};
      ids.forEach(function (id) {
        if (vistos[id]) return; vistos[id] = 1;
        af[id] = (af[id] || 0) + (cerca ? 2 : 0) + (mismo ? 1 : 0) + 0.5;
      });
    });
    var cand = jug.filter(function (j) { return j.celular && j.estado !== 'bloqueado' && j.id !== yo.id && ins.indexOf(j.id) < 0; })
      .map(function (j) {
        var n = nivelDe[j.id], dist = 0;
        if (lo && n) dist = n < lo ? lo - n : (n > hi ? n - hi : 0);
        else if (lo) dist = 0.75; // sin nivel: posible
        return { id: j.id, dist: dist, af: af[j.id] || 0 };
      });
    cand.sort(function (a, b) { return (a.dist - b.dist) || (b.af - a.af); });
    var buenos = cand.filter(function (c) { return c.dist <= 1; });
    var para = buenos.slice(0, 25);
    if (para.length < 8) para = para.concat(cand.filter(function (c) { return c.dist > 1; }).slice(0, 8 - para.length));
    para = para.map(function (c) { return c.id; });

    var texto = '🎾 ' + (faltan === 1 ? 'Falta 1' : 'Faltan ' + faltan) + ' en la reta de ' + retaCorta_(r) +
      (r.nivel ? ' · Nivel ' + rangoTxt_(r.nivel) : '') + ' (' + ins.length + '/' + r.maxJugadores + '). ¿Te apuntas?';
    if (para.length) {
      var h = hoja_('AVISOS'), cols = HOJAS.AVISOS, ahora = ahora_();
      var filas = para.map(function (id) { return { id: nuevoId_('a'), paraId: id, tipo: 'falta', texto: texto, retaId: r.id, deId: yo.id, creado: ahora, leido: '' }; });
      var ini = h.getLastRow() + 1;
      h.getRange(ini, 1, filas.length, cols.length).setNumberFormat('@').setValues(filas.map(function (o) { return cols.map(function (c) { return aCelda_(c, o[c]); }); }));
      delete CACHE_TABLAS_.AVISOS;
    }
    r.buscando = ahora_();
    guardar_('RETAS', r);
    try { if (para.length) enviarPush_(para); } catch (e) { console.warn('push', e); }
    return { avisados: para.length, reta: limpio_(r) };
  });
}

/* ===================== Avisos ===================== */

var MESES_ = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function nombreCorto_(id) {
  var j = buscar_('JUGADORES', id);
  return j ? (j.alias || j.nombre || 'Alguien') : 'Alguien';
}
function retaCorta_(r) {
  var f = String(r.fecha || '').split('-'), txt = r.club || 'la reta';
  if (f.length === 3) txt += ' · ' + Number(f[2]) + ' ' + MESES_[Number(f[1]) - 1];
  if (r.hora) {
    var hm = String(r.hora).split(':'), h = Number(hm[0]);
    txt += ' ' + ((h % 12) || 12) + ':' + hm[1] + (h >= 12 ? ' pm' : ' am');
  }
  return txt;
}
function tieneCuenta_(id) { var j = buscar_('JUGADORES', id); return !!(j && j.celular); }
function avisar_(paraId, tipo, texto, retaId, deId) {
  if (!paraId || paraId === deId || !tieneCuenta_(paraId)) return;
  guardar_('AVISOS', { id: nuevoId_('a'), paraId: paraId, tipo: tipo, texto: texto, retaId: retaId || '', deId: deId || '', creado: ahora_(), leido: '' });
  try { enviarPush_([paraId]); } catch (e) { console.warn('push', e); }
}
function normTxt_(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
function clubDeReta_(r) {
  var k = normTxt_(r.club), t = tabla_('CLUBS');
  if (!k) return null;
  for (var i = 0; i < t.length; i++) if (normTxt_(t[i].nombre) === k) return t[i];
  return null;
}
function canchasTxt_(r) { return r.canchas + ' cancha' + (r.canchas > 1 ? 's' : ''); }
function avisarNuevaReta_(yo, r) {
  var club = clubDeReta_(r), dueno = club && club.ownerId !== yo.id ? club.ownerId : '';
  if (dueno) avisar_(dueno, 'club', 'Nueva reta en tu club: ' + retaCorta_(r) + ' · ' + canchasTxt_(r) + ' · ' + nombreCorto_(yo.id) + ' organiza', r.id, yo.id);
  var para = tabla_('JUGADORES').filter(function (j) { return j.celular && j.estado !== 'bloqueado' && j.id !== yo.id && j.id !== dueno; }).map(function (j) { return j.id; });
  if (!para.length) return;
  var texto = 'Nueva reta: ' + retaCorta_(r) + ' · ' + (r.tipo === 'fija' ? 'Pareja fija' : 'Royal') + (r.nivel ? ' · Nivel ' + rangoTxt_(r.nivel) : '') + ' · ' + r.maxJugadores + ' lugares. ¡Apúntate!';
  var h = hoja_('AVISOS'), cols = HOJAS.AVISOS, ahora = ahora_();
  var filas = para.map(function (id) { return { id: nuevoId_('a'), paraId: id, tipo: 'nueva', texto: texto, retaId: r.id, deId: yo.id, creado: ahora, leido: '' }; });
  var ini = h.getLastRow() + 1;
  h.getRange(ini, 1, filas.length, cols.length).setNumberFormat('@').setValues(filas.map(function (o) { return cols.map(function (c) { return aCelda_(c, o[c]); }); }));
  delete CACHE_TABLAS_.AVISOS;
  tocar_();
  try { enviarPush_(para); } catch (e) { console.warn('push', e); }
}
function avisarInscritos_(yo, r, antes, nueva) {
  var agregados = nueva.filter(function (x) { return antes.indexOf(x) < 0; });
  var quitados = antes.filter(function (x) { return nueva.indexOf(x) < 0; });
  var cupo = ' (' + nueva.length + '/' + r.maxJugadores + ')';
  var donde = retaCorta_(r);
  agregados.forEach(function (x) {
    if (x === yo.id) avisar_(r.creadorId, 'apunto', nombreCorto_(x) + ' se apuntó a tu reta de ' + donde + cupo, r.id, yo.id);
    else avisar_(x, 'teapunto', nombreCorto_(yo.id) + ' te apuntó a la reta de ' + donde, r.id, yo.id);
  });
  quitados.forEach(function (x) {
    if (x === yo.id) avisar_(r.creadorId, 'salio', nombreCorto_(x) + ' se salió de tu reta de ' + donde + cupo, r.id, yo.id);
  });
  if (agregados.length && nueva.length >= r.maxJugadores && antes.length < r.maxJugadores) {
    var cl = clubDeReta_(r);
    if (cl && cl.ownerId !== r.creadorId) avisar_(cl.ownerId, 'club', 'Se llenó la reta de ' + donde + ' en tu club (' + nueva.length + '/' + r.maxJugadores + '). Confirmen ' + canchasTxt_(r) + '.', r.id, yo.id);
    avisar_(r.creadorId, 'llena', 'Tu reta de ' + donde + ' ya está llena (' + nueva.length + '/' + r.maxJugadores + '). Ya puedes sortear los partidos.', r.id, yo.id);
  }
}
function misAvisos_(yo) {
  return tabla_('AVISOS').filter(function (a) { return a.paraId === yo.id; })
    .sort(function (a, b) { return a.creado < b.creado ? 1 : -1; }).slice(0, 40)
    .map(function (a) { return { id: a.id, tipo: a.tipo, texto: a.texto, retaId: a.retaId, creado: a.creado, leido: !!a.leido }; });
}
function leerAvisos_(yo) {
  return conCandado_(function () {
    var h = hoja_('AVISOS'), cols = HOJAS.AVISOS, col = cols.indexOf('leido') + 1, n = 0;
    tabla_('AVISOS').forEach(function (a) {
      if (a.paraId === yo.id && !a.leido) { h.getRange(a._fila, col).setValue(ahora_()); a.leido = 'si'; n++; }
    });
    if (n) tocar_();
    return n;
  });
}

function guardarPartidos_(yo, d) {
  return conCandado_(function () {
    var r = reta_(d.retaId);
    if (!puedeOrganizar_(yo, r)) falla_('Solo los jugadores de la reta pueden sortear.');
    var ps = d.partidos || [];
    if (tieneMarcadores_(r.id)) falla_('Ya hay marcadores capturados; no se puede volver a sortear.');
    var ins = {}; (r.jugadores || []).forEach(function (x) { ins[x] = 1; });
    var limpios = ps.slice(0, 400).map(function (m) {
      var a = (m.a || []).slice(0, 2), b = (m.b || []).slice(0, 2);
      if (a.length !== 2 || b.length !== 2) falla_('Partido mal armado.');
      a.concat(b).forEach(function (x) { if (!ins[x]) falla_('Un jugador del sorteo no está inscrito.'); });
      return { id: texto_(m.id, 12), ronda: Number(m.ronda) || 1, cancha: Number(m.cancha) || 1, a: a, b: b };
    });
    r.partidos = limpios;
    guardar_('RETAS', r);
    return limpio_(r);
  });
}

function marcador_(yo, d) {
  return conCandado_(function () {
    var r = reta_(d.retaId);
    if (!puedeOrganizar_(yo, r)) falla_('Solo los jugadores de la reta pueden capturar marcadores.');
    var existe = (r.partidos || []).some(function (m) { return m.id === d.matchId; });
    if (!existe) falla_('Ese partido no existe.');
    var num = function (v) { return v === null || v === '' || v === undefined ? null : Math.max(0, Math.min(99, Math.round(Number(v)) || 0)); };
    var m = { id: r.id + '__' + d.matchId, retaId: r.id, matchId: d.matchId, a: num(d.a), b: num(d.b), porId: yo.id, actualizado: ahora_() };
    guardar_('MARCADORES', m);
    return { id: m.id, a: m.a, b: m.b };
  });
}

function multa_(yo, d) {
  return conCandado_(function () {
    var r = reta_(d.retaId);
    if (!puedeOrganizar_(yo, r)) falla_('Solo los jugadores de la reta pueden anotar castigos.');
    if ((r.jugadores || []).indexOf(d.jugadorId) < 0) falla_('Ese jugador no está en la reta.');
    var id = r.id + '__' + d.jugadorId;
    var m = buscar_('MULTAS', id) || { id: id, retaId: r.id, jugadorId: d.jugadorId, n: 0 };
    m.n = Math.max(0, Math.min(99, (Number(m.n) || 0) + (Number(d.cambio) > 0 ? 1 : -1)));
    guardar_('MULTAS', m);
    return limpio_(m);
  });
}

function borrarReta_(yo, d) {
  return conCandado_(function () {
    var r = reta_(d.retaId);
    if (!esAdmin_(yo) && r.creadorId !== yo.id) falla_('Solo quien creó la reta puede borrarla.');
    ['MARCADORES', 'MULTAS'].forEach(function (h) {
      var filas = tabla_(h).filter(function (x) { return x.retaId === r.id; }).map(function (x) { return x._fila; }).sort(function (a, b) { return b - a; });
      filas.forEach(function (f) { hoja_(h).deleteRow(f); });
      delete CACHE_TABLAS_[h];
    });
    borrar_('RETAS', r.id);
    var txt = 'Se canceló la reta de ' + retaCorta_(r);
    var cl = clubDeReta_(r);
    if (cl) avisar_(cl.ownerId, 'club', txt + '. Se liberan ' + canchasTxt_(r) + ' en tu club.', '', yo.id);
    (r.jugadores || []).forEach(function (x) { if (!cl || x !== cl.ownerId) avisar_(x, 'cancelada', txt + '.', '', yo.id); });
    return true;
  });
}
function probarPush_(yo) {
  return conCandado_(function () {
    guardar_('AVISOS', { id: nuevoId_('a'), paraId: yo.id, tipo: 'prueba', texto: 'Prueba: así te llegarán los avisos de La Reta 🎾', retaId: '', deId: '', creado: ahora_(), leido: '' });
    var n = 0; try { n = enviarPush_([yo.id]); } catch (e) {}
    return { dispositivos: n };
  });
}

/* ===================== Patrocinadores (admin) ===================== */

function guardarPatro_(yo, d) {
  soloAdmin_(yo);
  return conCandado_(function () {
    var p = d.id ? buscar_('PATROCINADORES', d.id) : null;
    p = p || { id: nuevoId_('p') };
    var nombre = texto_(d.nombre, 40);
    if (!nombre) falla_('Escribe el nombre de la marca.');
    var color = /^#[0-9a-fA-F]{6}$/.test(d.color || '') ? d.color : '#d4ff1f';
    p.nombre = nombre; p.giro = texto_(d.giro, 40);
    p.paquete = ['oficial', 'cancha', 'banner', 'colaborador'].indexOf(d.paquete) >= 0 ? d.paquete : 'colaborador';
    p.cancha = Number(d.cancha) || null; p.cuota = Math.max(0, Number(d.cuota) || 0);
    p.forma = ['circulo', 'hexagono', 'escudo', 'rombo', 'cuadro', 'gota'].indexOf(d.forma) >= 0 ? d.forma : 'circulo';
    p.color = color; p.tinta = d.tinta === '#ffffff' ? '#ffffff' : '#0a0d00';
    p.siglas = texto_(d.siglas, 3).toUpperCase(); p.contacto = texto_(d.contacto, 30);
    p.premio = texto_(d.premio, 60); p.lema = texto_(d.lema, 70);
    p.imagenId = /^[A-Za-z0-9_-]{10,}$/.test(d.imagenId || '') ? d.imagenId : '';
    p.activo = d.activo !== false; p.actualizado = ahora_();
    guardar_('PATROCINADORES', p);
    return limpio_(p);
  });
}

function borrarPatro_(yo, d) {
  soloAdmin_(yo);
  return conCandado_(function () { borrar_('PATROCINADORES', d.id); return true; });
}

function carpetaImagenes_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('CARPETA_IMG');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('La Reta · Patrocinadores');
  p.setProperty('CARPETA_IMG', f.getId());
  return f;
}

function subirImagen_(yo, d) {
  var deClub = d.para === 'club';
  if (deClub) { if (!clubDe_(yo, d.clubId || '')) falla_('Primero registra tu club.'); } else soloAdmin_(yo);
  var tipos = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (!tipos[d.tipo]) falla_('Sube la imagen en JPG, PNG o WEBP.');
  var bytes = Utilities.base64Decode(String(d.base64 || ''));
  if (bytes.length > 1572864) falla_('La imagen pesa más de 1.5 MB.');
  var blob = Utilities.newBlob(bytes, d.tipo, (deClub ? 'club_' : 'banner_') + Date.now() + '.' + tipos[d.tipo]);
  var f = carpetaImagenes_().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { imagenId: f.getId() };
}

/** Devuelve la imagen de un patrocinador en base64 (para dibujarla en la imagen del podio). Solo imágenes de patrocinadores. */
function imagenPatro_(d) {
  var id = String(d.imagenId || '');
  var ok = tabla_('PATROCINADORES').some(function (p) { return p.imagenId === id && p.activo !== false && String(p.activo) !== 'false'; });
  if (!ok) falla_('Imagen no disponible.');
  var c = CacheService.getScriptCache(), k = 'img_' + id, v = c.get(k);
  if (v) return JSON.parse(v);
  var b = DriveApp.getFileById(id).getBlob();
  var r = { tipo: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) };
  var txt = JSON.stringify(r);
  if (txt.length < 95000) c.put(k, txt, 21600);
  return r;
}

/* ===================== Jugadores (admin) ===================== */

function jugadoresAdmin_(yo) {
  soloAdmin_(yo);
  return tabla_('JUGADORES').filter(function (j) { return j.celular; }).map(function (j) {
    return { id: j.id, nombre: j.nombre, apellido: j.apellido, alias: j.alias, celular: j.celular, rol: j.rol, estado: j.estado, creado: j.creado };
  });
}

function resetPin_(yo, d) {
  soloAdmin_(yo);
  return conCandado_(function () {
    var j = buscar_('JUGADORES', d.jugadorId);
    if (!j || !j.celular) falla_('Ese jugador no tiene cuenta.');
    var pin;
    do { pin = String(Math.floor(100000 + Math.random() * 900000)); } while (/^(\d)\1{5}$/.test(pin));
    j.salt = Utilities.getUuid(); j.hash = hashPin_(j.salt, pin); j.actualizado = ahora_();
    guardar_('JUGADORES', j);
    CacheService.getScriptCache().remove('fallos_' + j.celular);
    return { pin: pin };
  });
}

function estadoJugador_(yo, d) {
  soloAdmin_(yo);
  return conCandado_(function () {
    var j = buscar_('JUGADORES', d.jugadorId);
    if (!j) falla_('No encontré a ese jugador.');
    if (j.id === yo.id) falla_('No puedes bloquear tu propia cuenta.');
    j.estado = d.estado === 'bloqueado' ? 'bloqueado' : 'activo';
    guardar_('JUGADORES', j);
    if (j.estado === 'bloqueado') {
      tabla_('SESIONES').filter(function (s) { return s.jugadorId === j.id; }).map(function (s) { return s.token; })
        .forEach(function (t) { CacheService.getScriptCache().remove('ses_' + t); borrar_('SESIONES', t); });
    }
    return true;
  });
}

/* ===================== Instalación ===================== */

/** Ejecútala una vez desde el editor. Crea las hojas y carga la semana de ejemplo. */
function instalar() {
  var libro = libro_();
  Object.keys(HOJAS).forEach(function (n) {
    var h = libro.getSheetByName(n) || libro.insertSheet(n);
    var cols = HOJAS[n];
    h.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0a0d00').setFontColor('#d4ff1f');
    h.getRange(1, 1, h.getMaxRows(), cols.length).setNumberFormat('@');
    h.setFrozenRows(1);
  });
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) {
    var h = libro.getSheetByName(n);
    if (h && libro.getSheets().length > 1 && h.getLastRow() === 0) libro.deleteSheet(h);
  });
  pimienta_();
  if (tabla_('RETAS').length === 0) cargarDemo();
  tocar_();
  Logger.log('Listo. Ahora implementa la app web y regístrate primero para quedar como administrador.');
}

/** Borra todos los datos de ejemplo (jugadores sin cuenta, retas, marcadores y castigos de ejemplo). */
function borrarDemo() {
  conCandado_(function () {
    ['MARCADORES', 'MULTAS', 'RETAS'].forEach(function (n) {
      var filas = tabla_(n).filter(function (x) { return String(x.id).indexOf('demo-') === 0; }).map(function (x) { return x._fila; }).sort(function (a, b) { return b - a; });
      filas.forEach(function (f) { hoja_(n).deleteRow(f); });
      delete CACHE_TABLAS_[n];
    });
    var jf = tabla_('JUGADORES').filter(function (j) { return !j.celular; }).map(function (x) { return x._fila; }).sort(function (a, b) { return b - a; });
    jf.forEach(function (f) { hoja_('JUGADORES').deleteRow(f); });
    var cf = tabla_('CLUBS').filter(function (c) { return c.ownerId === 'demo'; }).map(function (x) { return x._fila; }).sort(function (a, b) { return b - a; });
    cf.forEach(function (f) { hoja_('CLUBS').deleteRow(f); });
    var pf = tabla_('PATROCINADORES').filter(function (p) { return String(p.id).indexOf('demo-') === 0; }).map(function (x) { return x._fila; }).sort(function (a, b) { return b - a; });
    pf.forEach(function (f) { hoja_('PATROCINADORES').deleteRow(f); });
    CACHE_TABLAS_ = {};
    tocar_();
  });
}

function cargarDemo() {
  var D = DEMO_();
  var poner = function (nombre, filas) {
    if (!filas.length) return;
    var cols = HOJAS[nombre];
    var h = hoja_(nombre);
    h.getRange(h.getLastRow() + 1, 1, filas.length, cols.length).setNumberFormat('@').setValues(filas.map(function (o) { return cols.map(function (c) { return aCelda_(c, o[c]); }); }));
  };
  poner('JUGADORES', D.jugadores.map(function (j) { return { id: j.id, nombre: j.nombre, apellido: j.apellido, alias: j.alias, rol: 'JUGADOR', estado: 'activo', creado: '2026-10-12T00:00:00.000Z' }; }));
  poner('CLUBS', D.clubs.map(function (c) { c.ownerId = 'demo'; return c; }));
  poner('RETAS', D.retas);
  poner('MARCADORES', D.marcadores);
  poner('MULTAS', D.multas);
  poner('PATROCINADORES', D.patrocinadores);
  CACHE_TABLAS_ = {};
}

function DEMO_() {
  return {"jugadores":[{"id":"j01","nombre":"Luis","apellido":"Ramírez","alias":"El Mago"},{"id":"j02","nombre":"Andrés","apellido":"Navarro","alias":"Tito"},{"id":"j03","nombre":"Jorge","apellido":"Medina","alias":"Chepo"},{"id":"j04","nombre":"Ricardo","apellido":"Ávila","alias":"Richi"},{"id":"j05","nombre":"Fernando","apellido":"Ortega","alias":"Fer"},{"id":"j06","nombre":"Daniel","apellido":"Cruz","alias":"Dani"},{"id":"j07","nombre":"Mauricio","apellido":"Salas","alias":"Mau"},{"id":"j08","nombre":"Gerardo","apellido":"Peña","alias":"Lalo"},{"id":"j09","nombre":"Iván","apellido":"Contreras","alias":"El Güero"},{"id":"j10","nombre":"Rodrigo","apellido":"Lara","alias":"Roy"},{"id":"j11","nombre":"Héctor","apellido":"Flores","alias":"Tito H"},{"id":"j12","nombre":"Pablo","apellido":"Guzmán","alias":"Polo"}],"clubs":[{"id":"demo-club-norte","nombre":"Pádel Norte","ciudad":"Tepic","canchas":4,"telefono":"311 220 4400","direccion":"","horario":"","creado":"2026-10-12T00:00:00.000Z"},{"id":"demo-club-alameda","nombre":"La Alameda Pádel","ciudad":"Tepic","canchas":3,"telefono":"311 214 9010","direccion":"","horario":"","creado":"2026-10-12T00:00:00.000Z"}],"retas":[{"id":"demo-1012","creadorId":"demo","fecha":"2026-10-12","hora":"20:00","club":"Pádel Norte","canchas":2,"maxJugadores":8,"tipo":"royal","puntos":24,"modo":"total","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha"],"castigo":"Ballenas","jugadores":["j01","j02","j03","j04","j05","j06","j07","j08"],"partidos":[{"id":"r1c1","ronda":1,"cancha":1,"a":["j08","j04"],"b":["j06","j05"]},{"id":"r1c2","ronda":1,"cancha":2,"a":["j01","j03"],"b":["j02","j07"]},{"id":"r2c1","ronda":2,"cancha":1,"a":["j06","j08"],"b":["j03","j07"]},{"id":"r2c2","ronda":2,"cancha":2,"a":["j01","j02"],"b":["j05","j04"]},{"id":"r3c1","ronda":3,"cancha":1,"a":["j05","j02"],"b":["j06","j07"]},{"id":"r3c2","ronda":3,"cancha":2,"a":["j01","j04"],"b":["j08","j03"]},{"id":"r4c1","ronda":4,"cancha":1,"a":["j08","j05"],"b":["j03","j02"]},{"id":"r4c2","ronda":4,"cancha":2,"a":["j07","j01"],"b":["j06","j04"]},{"id":"r5c1","ronda":5,"cancha":1,"a":["j01","j08"],"b":["j06","j02"]},{"id":"r5c2","ronda":5,"cancha":2,"a":["j04","j03"],"b":["j05","j07"]}],"creado":"2026-10-12T03:00:00.000Z"},{"id":"demo-1014","creadorId":"demo","fecha":"2026-10-14","hora":"19:00","club":"La Alameda Pádel","canchas":2,"maxJugadores":10,"tipo":"fija","puntos":21,"modo":"meta","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha","Último lugar paga las bebidas"],"castigo":"Ballenas","jugadores":["j01","j06","j02","j05","j03","j08","j04","j07"],"partidos":[{"id":"r1c1","ronda":1,"cancha":1,"a":["j02","j05"],"b":["j03","j08"]},{"id":"r1c2","ronda":1,"cancha":2,"a":["j01","j06"],"b":["j04","j07"]},{"id":"r2c1","ronda":2,"cancha":1,"a":["j01","j06"],"b":["j03","j08"]},{"id":"r2c2","ronda":2,"cancha":2,"a":["j04","j07"],"b":["j02","j05"]},{"id":"r3c1","ronda":3,"cancha":1,"a":["j03","j08"],"b":["j04","j07"]},{"id":"r3c2","ronda":3,"cancha":2,"a":["j01","j06"],"b":["j02","j05"]}],"creado":"2026-10-14T03:00:00.000Z"},{"id":"demo-1015","creadorId":"demo","fecha":"2026-10-15","hora":"20:30","club":"Pádel Norte","canchas":2,"maxJugadores":8,"tipo":"royal","puntos":24,"modo":"total","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha"],"castigo":"Ballenas","jugadores":["j03","j04","j05","j06","j09","j10","j11","j12"],"partidos":[{"id":"r1c1","ronda":1,"cancha":1,"a":["j06","j03"],"b":["j05","j04"]},{"id":"r1c2","ronda":1,"cancha":2,"a":["j11","j09"],"b":["j10","j12"]},{"id":"r2c1","ronda":2,"cancha":1,"a":["j12","j09"],"b":["j06","j05"]},{"id":"r2c2","ronda":2,"cancha":2,"a":["j03","j04"],"b":["j10","j11"]},{"id":"r3c1","ronda":3,"cancha":1,"a":["j03","j10"],"b":["j12","j06"]},{"id":"r3c2","ronda":3,"cancha":2,"a":["j11","j04"],"b":["j09","j05"]},{"id":"r4c1","ronda":4,"cancha":1,"a":["j12","j05"],"b":["j04","j10"]},{"id":"r4c2","ronda":4,"cancha":2,"a":["j03","j11"],"b":["j06","j09"]},{"id":"r5c1","ronda":5,"cancha":1,"a":["j11","j06"],"b":["j05","j10"]},{"id":"r5c2","ronda":5,"cancha":2,"a":["j03","j09"],"b":["j12","j04"]}],"creado":"2026-10-15T03:00:00.000Z"},{"id":"demo-1016","creadorId":"demo","fecha":"2026-10-16","hora":"21:00","club":"Pádel Norte","canchas":2,"maxJugadores":8,"tipo":"royal","puntos":24,"modo":"total","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha","Último lugar paga las bebidas"],"castigo":"Ballenas","jugadores":["j01","j02","j04","j07","j08","j09","j10","j12"],"partidos":[{"id":"r1c1","ronda":1,"cancha":1,"a":["j09","j07"],"b":["j01","j08"]},{"id":"r1c2","ronda":1,"cancha":2,"a":["j12","j02"],"b":["j04","j10"]},{"id":"r2c1","ronda":2,"cancha":1,"a":["j04","j01"],"b":["j10","j08"]},{"id":"r2c2","ronda":2,"cancha":2,"a":["j12","j07"],"b":["j09","j02"]},{"id":"r3c1","ronda":3,"cancha":1,"a":["j04","j02"],"b":["j01","j09"]},{"id":"r3c2","ronda":3,"cancha":2,"a":["j08","j07"],"b":["j10","j12"]},{"id":"r4c1","ronda":4,"cancha":1,"a":["j04","j09"],"b":["j07","j10"]},{"id":"r4c2","ronda":4,"cancha":2,"a":["j02","j01"],"b":["j12","j08"]},{"id":"r5c1","ronda":5,"cancha":1,"a":["j04","j07"],"b":["j12","j01"]},{"id":"r5c2","ronda":5,"cancha":2,"a":["j10","j02"],"b":["j08","j09"]}],"creado":"2026-10-16T03:00:00.000Z"},{"id":"demo-1017","creadorId":"demo","fecha":"2026-10-17","hora":"10:00","club":"La Alameda Pádel","canchas":2,"maxJugadores":10,"tipo":"fija","puntos":21,"modo":"meta","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha"],"castigo":"Ballenas","jugadores":["j02","j09","j01","j11","j03","j12","j04","j10","j05","j07"],"partidos":[{"id":"r1c1","ronda":1,"cancha":1,"a":["j01","j11"],"b":["j05","j07"]},{"id":"r1c2","ronda":1,"cancha":2,"a":["j03","j12"],"b":["j04","j10"]},{"id":"r2c1","ronda":2,"cancha":1,"a":["j01","j11"],"b":["j03","j12"]},{"id":"r2c2","ronda":2,"cancha":2,"a":["j02","j09"],"b":["j05","j07"]},{"id":"r3c1","ronda":3,"cancha":1,"a":["j02","j09"],"b":["j04","j10"]},{"id":"r3c2","ronda":3,"cancha":2,"a":["j05","j07"],"b":["j03","j12"]},{"id":"r4c1","ronda":4,"cancha":1,"a":["j04","j10"],"b":["j01","j11"]},{"id":"r4c2","ronda":4,"cancha":2,"a":["j02","j09"],"b":["j03","j12"]},{"id":"r5c1","ronda":5,"cancha":1,"a":["j04","j10"],"b":["j05","j07"]},{"id":"r5c2","ronda":5,"cancha":2,"a":["j02","j09"],"b":["j01","j11"]}],"creado":"2026-10-17T03:00:00.000Z"},{"id":"demo-1018","creadorId":"demo","fecha":"2026-10-18","hora":"19:00","club":"Pádel Norte","canchas":2,"maxJugadores":8,"tipo":"royal","puntos":24,"modo":"total","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha","Último lugar paga las bebidas"],"castigo":"Ballenas","jugadores":["j01","j03","j05","j06","j07","j08","j10","j11"],"partidos":[{"id":"r1c1","ronda":1,"cancha":1,"a":["j11","j01"],"b":["j07","j03"]},{"id":"r1c2","ronda":1,"cancha":2,"a":["j06","j05"],"b":["j08","j10"]},{"id":"r2c1","ronda":2,"cancha":1,"a":["j07","j01"],"b":["j10","j06"]},{"id":"r2c2","ronda":2,"cancha":2,"a":["j05","j08"],"b":["j11","j03"]},{"id":"r3c1","ronda":3,"cancha":1,"a":["j05","j03"],"b":["j06","j07"]},{"id":"r3c2","ronda":3,"cancha":2,"a":["j11","j08"],"b":["j10","j01"]},{"id":"r4c1","ronda":4,"cancha":1,"a":["j01","j06"],"b":["j11","j05"]},{"id":"r4c2","ronda":4,"cancha":2,"a":["j03","j08"],"b":["j10","j07"]},{"id":"r5c1","ronda":5,"cancha":1,"a":["j10","j11"],"b":["j07","j05"]},{"id":"r5c2","ronda":5,"cancha":2,"a":["j06","j08"],"b":["j03","j01"]},{"id":"r6c1","ronda":6,"cancha":1,"a":["j11","j07"],"b":["j08","j01"]},{"id":"r6c2","ronda":6,"cancha":2,"a":["j06","j03"],"b":["j10","j05"]}],"creado":"2026-10-18T03:00:00.000Z"},{"id":"demo-1019","creadorId":"demo","fecha":"2026-10-19","hora":"20:00","club":"La Alameda Pádel","canchas":2,"maxJugadores":8,"tipo":"royal","puntos":24,"modo":"total","reglas":["Doble falta: pone una ballena","Primer lugar no paga cancha"],"castigo":"Ballenas","jugadores":["j02","j04","j09","j12","j01"],"partidos":[],"creado":"2026-10-19T03:00:00.000Z"}],"marcadores":[{"id":"demo-1012__r1c1","retaId":"demo-1012","matchId":"r1c1","a":11,"b":13,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r1c2","retaId":"demo-1012","matchId":"r1c2","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r2c1","retaId":"demo-1012","matchId":"r2c1","a":5,"b":19,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r2c2","retaId":"demo-1012","matchId":"r2c2","a":18,"b":6,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r3c1","retaId":"demo-1012","matchId":"r3c1","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r3c2","retaId":"demo-1012","matchId":"r3c2","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r4c1","retaId":"demo-1012","matchId":"r4c1","a":5,"b":19,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r4c2","retaId":"demo-1012","matchId":"r4c2","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r5c1","retaId":"demo-1012","matchId":"r5c1","a":11,"b":13,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1012__r5c2","retaId":"demo-1012","matchId":"r5c2","a":17,"b":7,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1014__r1c1","retaId":"demo-1014","matchId":"r1c1","a":21,"b":18,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1014__r1c2","retaId":"demo-1014","matchId":"r1c2","a":10,"b":21,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1014__r2c1","retaId":"demo-1014","matchId":"r2c1","a":21,"b":15,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1014__r2c2","retaId":"demo-1014","matchId":"r2c2","a":21,"b":11,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1014__r3c1","retaId":"demo-1014","matchId":"r3c1","a":21,"b":10,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1014__r3c2","retaId":"demo-1014","matchId":"r3c2","a":15,"b":21,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r1c1","retaId":"demo-1015","matchId":"r1c1","a":14,"b":10,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r1c2","retaId":"demo-1015","matchId":"r1c2","a":17,"b":7,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r2c1","retaId":"demo-1015","matchId":"r2c1","a":5,"b":19,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r2c2","retaId":"demo-1015","matchId":"r2c2","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r3c1","retaId":"demo-1015","matchId":"r3c1","a":16,"b":8,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r3c2","retaId":"demo-1015","matchId":"r3c2","a":11,"b":13,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r4c1","retaId":"demo-1015","matchId":"r4c1","a":9,"b":15,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r4c2","retaId":"demo-1015","matchId":"r4c2","a":16,"b":8,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r5c1","retaId":"demo-1015","matchId":"r5c1","a":11,"b":13,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1015__r5c2","retaId":"demo-1015","matchId":"r5c2","a":15,"b":9,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r1c1","retaId":"demo-1016","matchId":"r1c1","a":5,"b":19,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r1c2","retaId":"demo-1016","matchId":"r1c2","a":13,"b":11,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r2c1","retaId":"demo-1016","matchId":"r2c1","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r2c2","retaId":"demo-1016","matchId":"r2c2","a":5,"b":19,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r3c1","retaId":"demo-1016","matchId":"r3c1","a":16,"b":8,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r3c2","retaId":"demo-1016","matchId":"r3c2","a":16,"b":8,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r4c1","retaId":"demo-1016","matchId":"r4c1","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r4c2","retaId":"demo-1016","matchId":"r4c2","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r5c1","retaId":"demo-1016","matchId":"r5c1","a":9,"b":15,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1016__r5c2","retaId":"demo-1016","matchId":"r5c2","a":18,"b":6,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r1c1","retaId":"demo-1017","matchId":"r1c1","a":19,"b":21,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r1c2","retaId":"demo-1017","matchId":"r1c2","a":14,"b":21,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r2c1","retaId":"demo-1017","matchId":"r2c1","a":21,"b":15,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r2c2","retaId":"demo-1017","matchId":"r2c2","a":15,"b":21,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r3c1","retaId":"demo-1017","matchId":"r3c1","a":21,"b":8,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r3c2","retaId":"demo-1017","matchId":"r3c2","a":21,"b":16,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r4c1","retaId":"demo-1017","matchId":"r4c1","a":21,"b":10,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r4c2","retaId":"demo-1017","matchId":"r4c2","a":21,"b":11,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r5c1","retaId":"demo-1017","matchId":"r5c1","a":18,"b":21,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1017__r5c2","retaId":"demo-1017","matchId":"r5c2","a":21,"b":19,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1018__r1c1","retaId":"demo-1018","matchId":"r1c1","a":16,"b":8,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1018__r1c2","retaId":"demo-1018","matchId":"r1c2","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-1018__r2c1","retaId":"demo-1018","matchId":"r2c1","a":19,"b":5,"porId":"demo","actualizado":"2026-10-18T00:00:00.000Z"}],"multas":[{"id":"demo-1012__j01","retaId":"demo-1012","jugadorId":"j01","n":2},{"id":"demo-1012__j05","retaId":"demo-1012","jugadorId":"j05","n":2},{"id":"demo-1012__j06","retaId":"demo-1012","jugadorId":"j06","n":1},{"id":"demo-1014__j05","retaId":"demo-1014","jugadorId":"j05","n":2},{"id":"demo-1014__j03","retaId":"demo-1014","jugadorId":"j03","n":1},{"id":"demo-1014__j08","retaId":"demo-1014","jugadorId":"j08","n":1},{"id":"demo-1014__j04","retaId":"demo-1014","jugadorId":"j04","n":1},{"id":"demo-1015__j03","retaId":"demo-1015","jugadorId":"j03","n":2},{"id":"demo-1015__j05","retaId":"demo-1015","jugadorId":"j05","n":1},{"id":"demo-1015__j06","retaId":"demo-1015","jugadorId":"j06","n":1},{"id":"demo-1015__j10","retaId":"demo-1015","jugadorId":"j10","n":1},{"id":"demo-1015__j12","retaId":"demo-1015","jugadorId":"j12","n":1},{"id":"demo-1016__j04","retaId":"demo-1016","jugadorId":"j04","n":1},{"id":"demo-1016__j07","retaId":"demo-1016","jugadorId":"j07","n":2},{"id":"demo-1016__j08","retaId":"demo-1016","jugadorId":"j08","n":2},{"id":"demo-1016__j09","retaId":"demo-1016","jugadorId":"j09","n":2},{"id":"demo-1017__j11","retaId":"demo-1017","jugadorId":"j11","n":2},{"id":"demo-1017__j12","retaId":"demo-1017","jugadorId":"j12","n":2},{"id":"demo-1017__j04","retaId":"demo-1017","jugadorId":"j04","n":1},{"id":"demo-1017__j10","retaId":"demo-1017","jugadorId":"j10","n":1},{"id":"demo-1017__j05","retaId":"demo-1017","jugadorId":"j05","n":1},{"id":"demo-1017__j07","retaId":"demo-1017","jugadorId":"j07","n":1},{"id":"demo-1018__j01","retaId":"demo-1018","jugadorId":"j01","n":1},{"id":"demo-1018__j03","retaId":"demo-1018","jugadorId":"j03","n":2},{"id":"demo-1018__j06","retaId":"demo-1018","jugadorId":"j06","n":1},{"id":"demo-1018__j10","retaId":"demo-1018","jugadorId":"j10","n":2}],"patrocinadores":[{"id":"demo-altamira","nombre":"Inmobiliaria Altamira","giro":"Bienes raíces","paquete":"colaborador","cancha":null,"cuota":800,"forma":"escudo","color":"#0f9d58","tinta":"#ffffff","siglas":"IA","contacto":"311 512 7788","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-autos-valle","nombre":"Autos del Valle","giro":"Agencia de autos","paquete":"cancha","cancha":4,"cuota":1500,"forma":"rombo","color":"#2f7bff","tinta":"#ffffff","siglas":"AV","contacto":"311 260 4433","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-barberia-bandeja","nombre":"Barbería La Bandeja","giro":"Barbería","paquete":"banner","cancha":null,"cuota":450,"forma":"escudo","color":"#ff3d6e","tinta":"#ffffff","siglas":"LB","contacto":"311 389 1720","premio":"","lema":"Corte + barba $180 mostrando tu perfil","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-cafe-la-pared","nombre":"Café La Pared","giro":"Cafetería","paquete":"banner","cancha":null,"cuota":500,"forma":"circulo","color":"#c8814a","tinta":"#ffffff","siglas":"LP","contacto":"311 222 0945","premio":"","lema":"Tu café antes de la reta, 2x1 en frappé","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-cerro-alto","nombre":"Cervecería Cerro Alto","giro":"Cerveza artesanal","paquete":"cancha","cancha":1,"cuota":1500,"forma":"escudo","color":"#f2b230","tinta":"#0a0d00","siglas":"CA","contacto":"311 303 1180","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-fisiomove","nombre":"FisioMove","giro":"Fisioterapia deportiva","paquete":"colaborador","cancha":null,"cuota":700,"forma":"circulo","color":"#19c3b1","tinta":"#0a0d00","siglas":"FM","contacto":"311 334 9810","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-fuerza-nayar","nombre":"Fuerza Nayar Gym","giro":"Gimnasio","paquete":"cancha","cancha":3,"cuota":1200,"forma":"cuadro","color":"#e53935","tinta":"#ffffff","siglas":"FN","contacto":"311 118 7702","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-lavado-express","nombre":"Lavado Express","giro":"Autolavado","paquete":"banner","cancha":null,"cuota":400,"forma":"gota","color":"#27c4ff","tinta":"#0a0d00","siglas":"LE","contacto":"311 274 8815","premio":"","lema":"Lavado completo mientras juegas","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-pulso","nombre":"Pulso Isotónico","giro":"Bebida deportiva","paquete":"colaborador","cancha":null,"cuota":700,"forma":"gota","color":"#00b3ff","tinta":"#ffffff","siglas":"P","contacto":"311 201 6620","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-seguros-punto-oro","nombre":"Seguros Punto de Oro","giro":"Seguros de auto y gastos médicos","paquete":"banner","cancha":null,"cuota":600,"forma":"hexagono","color":"#ffc53d","tinta":"#0a0d00","siglas":"PO","contacto":"311 166 4401","premio":"","lema":"Cotiza gratis tu seguro de gastos médicos","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-smash","nombre":"Smash Smoothies","giro":"Jugos y smoothies","paquete":"cancha","cancha":2,"cuota":1200,"forma":"gota","color":"#ff4fa3","tinta":"#ffffff","siglas":"S","contacto":"311 455 2091","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-tacos-reves","nombre":"Tacos El Revés","giro":"Taquería","paquete":"colaborador","cancha":null,"cuota":500,"forma":"circulo","color":"#ffd23f","tinta":"#0a0d00","siglas":"TR","contacto":"311 147 3355","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-vision-clara","nombre":"Ópticas Visión Clara","giro":"Óptica y lentes deportivos","paquete":"colaborador","cancha":null,"cuota":600,"forma":"cuadro","color":"#8e5cff","tinta":"#ffffff","siglas":"VC","contacto":"311 289 0147","premio":"","lema":"","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"},{"id":"demo-volea","nombre":"Volea Sports","giro":"Tienda de pádel","paquete":"oficial","cancha":null,"cuota":3500,"forma":"hexagono","color":"#ff7a1a","tinta":"#0a0d00","siglas":"VS","contacto":"311 210 5577","premio":"un overgrip Pro","lema":"Raquetas, pelotas y grips con 15% para jugadores de La Reta","imagenId":"","activo":true,"actualizado":"2026-10-18T00:00:00.000Z"}]};
}


/* ===================== Notificaciones push (Web Push con VAPID) ===================== */
/* La notificación viaja vacía; el celular pide el texto del aviso a este servidor al recibirla. */

var P256_ = null;
function p256_() {
  if (P256_) return P256_;
  var B = function (h) { return BigInt('0x' + h); };
  P256_ = {
    p: B('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
    n: B('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    G: [B('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'), B('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')]
  };
  P256_.a = P256_.p - BigInt(3);
  return P256_;
}
function mod_(a, m) { var r = a % m; return r < BigInt(0) ? r + m : r; }
function inv_(a, m) {
  var lm = BigInt(1), hm = BigInt(0), low = mod_(a, m), high = m, Z = BigInt(0);
  while (low > BigInt(1)) { var r = high / low, nm = hm - lm * r, nw = high - low * r; hm = lm; high = low; lm = nm; low = nw; }
  return mod_(lm, m);
}
function sumaPt_(P, Q) {
  var c = p256_(), p = c.p;
  if (!P) return Q; if (!Q) return P;
  var l;
  if (P[0] === Q[0]) {
    if (mod_(P[1] + Q[1], p) === BigInt(0)) return null;
    l = mod_((BigInt(3) * P[0] * P[0] + c.a) * inv_(BigInt(2) * P[1], p), p);
  } else {
    l = mod_((Q[1] - P[1]) * inv_(Q[0] - P[0], p), p);
  }
  var x = mod_(l * l - P[0] - Q[0], p);
  return [x, mod_(l * (P[0] - x) - P[1], p)];
}
function porEscalar_(k, P) {
  var R = null, A = P;
  while (k > BigInt(0)) { if (k & BigInt(1)) R = sumaPt_(R, A); A = sumaPt_(A, A); k = k >> BigInt(1); }
  return R;
}
function bytesAHex_(b) { return b.map(function (x) { var v = (x < 0 ? x + 256 : x).toString(16); return v.length === 1 ? '0' + v : v; }).join(''); }
function hexABytes_(h) { var o = []; for (var i = 0; i < h.length; i += 2) { var v = parseInt(h.substr(i, 2), 16); o.push(v > 127 ? v - 256 : v); } return o; }
function big32_(x) { var h = x.toString(16); while (h.length < 64) h = '0' + h; return h; }
function b64url_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function azarN_() {
  var c = p256_(), k = BigInt(0);
  while (k === BigInt(0)) {
    var h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random(), Utilities.Charset.UTF_8);
    k = mod_(BigInt('0x' + bytesAHex_(h)), c.n);
  }
  return k;
}
function vapid_() {
  var pr = PropertiesService.getScriptProperties(), d = pr.getProperty('VAPID_D'), pub = pr.getProperty('VAPID_PUB');
  if (!d || !pub) {
    var c = p256_(), k = azarN_(), Q = porEscalar_(k, c.G);
    d = big32_(k); pub = b64url_(hexABytes_('04' + big32_(Q[0]) + big32_(Q[1])));
    pr.setProperty('VAPID_D', d); pr.setProperty('VAPID_PUB', pub);
  }
  return { d: d, pub: pub };
}
function firmarES256_(texto, dHex) {
  var c = p256_(), d = BigInt('0x' + dHex);
  var e = BigInt('0x' + bytesAHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8)));
  while (true) {
    var k = azarN_(), R = porEscalar_(k, c.G), r = mod_(R[0], c.n);
    if (r === BigInt(0)) continue;
    var s = mod_(inv_(k, c.n) * (e + r * d), c.n);
    if (s === BigInt(0)) continue;
    return b64url_(hexABytes_(big32_(r) + big32_(s)));
  }
}
function jwtVapid_(endpoint) {
  var v = vapid_(), aud = String(endpoint).match(/^https:\/\/[^\/]+/)[0];
  var enc = function (o) { return b64url_(Utilities.newBlob(JSON.stringify(o)).getBytes()); };
  var cuerpo = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:avisos@lareta.app' });
  return { jwt: cuerpo + '.' + firmarES256_(cuerpo, v.d), pub: v.pub };
}
function suscribir_(yo, d) {
  var ep = String(d.endpoint || '');
  if (!/^https:\/\/[a-z0-9.-]+\//i.test(ep) || ep.length > 1000) falla_('Suscripción no válida.');
  return conCandado_(function () {
    var id = bytesAHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, ep, Utilities.Charset.UTF_8)).slice(0, 24);
    var s = buscar_('SUSCRIPCIONES', id) || { id: id, endpoint: ep, creado: ahora_() };
    s.jugadorId = yo.id; s.ultimo = ahora_();
    guardar_('SUSCRIPCIONES', s);
    return true;
  });
}
function enviarPush_(ids) {
  var quien = {}; (ids || []).forEach(function (x) { quien[x] = 1; });
  var subs = tabla_('SUSCRIPCIONES').filter(function (s) { return quien[s.jugadorId]; });
  if (!subs.length) return 0;
  var reqs = subs.map(function (s) {
    var t = jwtVapid_(s.endpoint);
    return { url: s.endpoint, method: 'post', muteHttpExceptions: true, contentType: 'application/octet-stream', payload: '',
      headers: { TTL: '86400', Urgency: 'high', Authorization: 'vapid t=' + t.jwt + ', k=' + t.pub } };
  });
  var res = UrlFetchApp.fetchAll(reqs), muertas = [];
  res.forEach(function (r, i) { var c = r.getResponseCode(); if (c === 404 || c === 410) muertas.push(subs[i]); });
  muertas.map(function (s) { return s._fila; }).sort(function (a, b) { return b - a; }).forEach(function (f) { hoja_('SUSCRIPCIONES').deleteRow(f); });
  if (muertas.length) delete CACHE_TABLAS_.SUSCRIPCIONES;
  return res.length - muertas.length;
}
function pushPendiente_(d) {
  var ep = String(d.endpoint || ''), sub = null;
  tabla_('SUSCRIPCIONES').forEach(function (s) { if (s.endpoint === ep) sub = s; });
  if (!sub) return null;
  var av = tabla_('AVISOS').filter(function (a) { return a.paraId === sub.jugadorId && !a.leido; })
    .sort(function (a, b) { return a.creado < b.creado ? 1 : -1; });
  if (!av.length) return null;
  return { texto: av[0].texto, retaId: av[0].retaId, id: av[0].id, pendientes: av.length };
}

/** Ejecútala una vez desde el editor después de pegar el código, para autorizar el envío de notificaciones. */
function autorizarNotificaciones() {
  vapid_();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('Listo: notificaciones autorizadas.');
}
