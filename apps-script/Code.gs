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
  JUGADORES: ['id', 'celular', 'nombre', 'apellido', 'alias', 'salt', 'hash', 'rol', 'estado', 'creado', 'actualizado'],
  SESIONES: ['token', 'jugadorId', 'creado', 'ultimo'],
  CLUBS: ['id', 'ownerId', 'nombre', 'ciudad', 'direccion', 'canchas', 'telefono', 'horario', 'creado', 'actualizado'],
  RETAS: ['id', 'creadorId', 'fecha', 'hora', 'club', 'canchas', 'maxJugadores', 'tipo', 'puntos', 'modo', 'reglas', 'castigo', 'jugadores', 'partidos', 'creado'],
  MARCADORES: ['id', 'retaId', 'matchId', 'a', 'b', 'porId', 'actualizado'],
  MULTAS: ['id', 'retaId', 'jugadorId', 'n'],
  PATROCINADORES: ['id', 'nombre', 'giro', 'paquete', 'cancha', 'cuota', 'forma', 'color', 'tinta', 'siglas', 'contacto', 'premio', 'lema', 'imagenId', 'activo', 'actualizado']
};
var JSON_COLS = { reglas: 1, jugadores: 1, partidos: 1 };
var NUM_COLS = { canchas: 1, maxJugadores: 1, puntos: 1, a: 1, b: 1, n: 1, cancha: 1, cuota: 1 };
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

/** Punto único de entrada desde la app. */
function api(token, accion, datos) {
  try {
    CACHE_TABLAS_ = {};
    datos = datos || {};
    if (accion === 'registro') return ok_(registro_(datos));
    if (accion === 'entrar') return ok_(entrar_(datos));
    if (accion === 'publico') return ok_(todo_(null, datos.version));

    var yo = sesion_(token);
    if (!yo) return { ok: false, error: 'Tu sesión terminó. Vuelve a entrar.', sesion: false };
    if (yo.estado === 'bloqueado') return { ok: false, error: 'Tu cuenta está bloqueada. Habla con el administrador.', sesion: false };

    var acciones = {
      todo: function () { return todo_(yo, datos.version); },
      salir: function () { return salir_(token); },
      perfil: function () { return guardarPerfil_(yo, datos); },
      cambiarPin: function () { return cambiarPin_(yo, datos); },
      club: function () { return guardarClub_(yo, datos); },
      crearReta: function () { return crearReta_(yo, datos); },
      inscritos: function () { return inscritos_(yo, datos); },
      partidos: function () { return guardarPartidos_(yo, datos); },
      marcador: function () { return marcador_(yo, datos); },
      multa: function () { return multa_(yo, datos); },
      borrarReta: function () { return borrarReta_(yo, datos); },
      patrocinador: function () { return guardarPatro_(yo, datos); },
      borrarPatrocinador: function () { return borrarPatro_(yo, datos); },
      subirImagen: function () { return subirImagen_(yo, datos); },
      jugadoresAdmin: function () { return jugadoresAdmin_(yo); },
      resetPin: function () { return resetPin_(yo, datos); },
      estadoJugador: function () { return estadoJugador_(yo, datos); }
    };
    if (!acciones[accion]) throw new Error('Acción no válida.');
    return ok_(acciones[accion]());
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
  if (!h) falla_('Falta la hoja ' + nombre + '. Ejecuta instalar().');
  return h;
}

var CACHE_TABLAS_ = {};
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
  var o = { id: j.id, nombre: j.nombre, apellido: j.apellido, alias: j.alias, demo: !j.celular };
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
    retas: tabla_('RETAS').map(limpio_),
    marcadores: tabla_('MARCADORES').map(function (m) { return { id: m.id, retaId: m.retaId, matchId: m.matchId, a: m.a, b: m.b }; }),
    multas: tabla_('MULTAS').map(limpio_),
    patrocinadores: tabla_('PATROCINADORES').map(function (p) {
      var o = limpio_(p);
      if (!admin) { delete o.cuota; if (!p.activo) return null; }
      return o;
    }).filter(Boolean)
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
    j.nombre = nombre; j.apellido = texto_(d.apellido, 40); j.alias = texto_(d.alias, 24); j.actualizado = ahora_();
    guardar_('JUGADORES', j);
    return publicoJugador_(j, j);
  });
}

function guardarClub_(yo, d) {
  return conCandado_(function () {
    var nombre = texto_(d.nombre, 60);
    if (!nombre) falla_('Escribe el nombre del club.');
    var prev = null, t = tabla_('CLUBS');
    for (var i = 0; i < t.length; i++) if (t[i].ownerId === yo.id) prev = t[i];
    var c = prev || { id: nuevoId_('c'), ownerId: yo.id, creado: ahora_() };
    c.nombre = nombre; c.ciudad = texto_(d.ciudad, 40); c.direccion = texto_(d.direccion, 100);
    c.canchas = Math.max(0, Math.min(40, Number(d.canchas) || 0)) || null;
    c.telefono = texto_(d.telefono, 20); c.horario = texto_(d.horario, 60); c.actualizado = ahora_();
    guardar_('CLUBS', c);
    return limpio_(c);
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
      jugadores: [], partidos: [], creado: ahora_()
    };
    guardar_('RETAS', r);
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
    return limpio_(r);
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
    return true;
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
  soloAdmin_(yo);
  var tipos = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (!tipos[d.tipo]) falla_('Sube la imagen en JPG, PNG o WEBP.');
  var bytes = Utilities.base64Decode(String(d.base64 || ''));
  if (bytes.length > 1048576) falla_('La imagen pesa más de 1 MB.');
  var blob = Utilities.newBlob(bytes, d.tipo, 'banner_' + Date.now() + '.' + tipos[d.tipo]);
  var f = carpetaImagenes_().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { imagenId: f.getId() };
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

