/**
 * ============================================================================
 *  BACKEND (Google Apps Script) - App de Catálogo y Control de Comercio
 * ============================================================================
 *  Este script convierte tu Google Sheet en una mini API REST segura.
 *  La app de React NUNCA se conecta directo a Google Sheets: le habla a
 *  este script, y el script es el único que toca la hoja de cálculo (y,
 *  desde esta versión, también tu Google Drive para guardar fotos).
 *
 *  HOJAS REQUERIDAS EN EL SPREADSHEET:
 *   1) "Productos"  -> ID | Nombre | Categoria | Precio | Stock | StockMinimo | FotoURL | Disponible | Descripcion | Marca | Talla | Color | PrecioCompra | CodigoPropio | FechaCreacion | Orden
 *   2) "Pedidos"    -> ID | Fecha | Cliente | Telefono | Producto | ProductoID | Cantidad | Estado | Notas
 *   3) "Opciones"   -> Campo | Valor  (NO la tienes que crear a mano: se crea
 *                      sola la primera vez que agregas una opción predeterminada
 *                      desde el Dashboard, en "+ Agregar producto".)
 *
 *  NOTA sobre FotoURL: un producto puede tener VARIAS fotos. Se guardan en
 *  la misma celda de FotoURL, separadas por el símbolo "|" (por ejemplo:
 *  "https://.../foto1.jpg|https://.../foto2.jpg"). El catálogo las muestra
 *  como carrusel. No necesitas hacer nada especial: el Dashboard arma ese
 *  texto automáticamente cuando subes varias fotos arrastrándolas.
 *
 *  NOTA sobre Marca/Talla/Color/PrecioCompra/CodigoPropio/FechaCreacion: se
 *  agregaron DESPUÉS de las columnas originales (al final) para no romper
 *  hojas ya existentes. CodigoPropio es un código interno OPCIONAL que tú
 *  decides (por ejemplo "PLY-001"), aparte del ID automático de la app.
 *  FechaCreacion se llena SOLA cuando das de alta un producto nuevo — los
 *  productos que ya existían antes de esta versión se quedan sin fecha
 *  (se muestran con "—" en el Dashboard).
 *
 *  NOTA sobre Orden: columna nueva que guarda un número por producto, para
 *  saber en qué orden se debe ver dentro de su categoría en el catálogo
 *  público (y qué categoría se ve primero). Se actualiza sola cuando
 *  arrastras los productos en la pestaña "Orden del catálogo" del
 *  Dashboard — no hace falta llenarla a mano. Si un producto no tiene
 *  número ahí (por ejemplo los que ya existían antes de esta versión), se
 *  trata como si fuera 0 y simplemente se queda en el mismo orden en que
 *  ya estaba en la hoja.
 *
 *  NOTA sobre Telefono y CodigoPropio guardados como TEXTO: estas dos
 *  columnas se fuerzan a formato de texto cada vez que se escriben, para
 *  que Google Sheets no las convierta en números (lo cual rompía números
 *  como "0000000000" o códigos como "007", que perderían los ceros).
 *
 *  CONFIGURACIÓN DE SEGURIDAD (Project Settings > Script Properties):
 *   - PUBLIC_KEY : clave simple que la app pública manda en cada request.
 *                  No es secreta al 100% (viaja en el frontend), pero evita
 *                  que cualquiera en internet descubra la URL y la use.
 *   - ADMIN_KEY  : clave del dashboard de administración. Solo tú la
 *                  conoces. Protege ver pedidos con datos de clientes,
 *                  actualizar stock y subir fotos.
 *   - SPREADSHEET_ID : ID de tu Google Sheet (está en la URL de la hoja).
 *
 *  Cómo poner las Script Properties:
 *   Extensiones > Apps Script > ícono de engrane (Configuración del proyecto)
 *   > "Propiedades del script" > Agregar propiedad.
 *
 *  IMPORTANTE sobre el permiso de Google Drive: esta versión guarda las
 *  fotos que subas en una carpeta de tu Google Drive llamada "Fotos PyME
 *  App" (se crea sola la primera vez). Como es un permiso nuevo que el
 *  script no pedía antes, la PRIMERA VEZ tienes que autorizarlo a mano:
 *  en el editor de Apps Script, en el menú de funciones (junto al botón
 *  "Ejecutar"), elige la función "autorizarDrive" y dale "Ejecutar". Te va
 *  a pedir permiso — acéptalo. Después de eso, crea la nueva versión de
 *  implementación como siempre.
 * ============================================================================
 */

const SHEET_PRODUCTOS = 'Productos';
const SHEET_PEDIDOS = 'Pedidos';
const SHEET_OPCIONES = 'Opciones';
const CARPETA_FOTOS_PROP = 'DRIVE_FOLDER_ID';

// Columnas que SIEMPRE se guardan como texto plano, nunca como número, para
// que Google Sheets no les quite ceros a la izquierda ni las convierta en
// números gigantes/raros (teléfonos y códigos de producto).
const CAMPOS_TEXTO_FORZADO = ['Telefono', 'CodigoPropio'];

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getSpreadsheet_() {
  const id = getProp_('SPREADSHEET_ID');
  if (!id) throw new Error('Falta configurar SPREADSHEET_ID en Script Properties.');
  return SpreadsheetApp.openById(id);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isPublicAuthorized_(params) {
  const expected = getProp_('PUBLIC_KEY');
  if (!expected) return true; // si no configuraste clave pública, no la exige
  return params.key === expected;
}

function isAdminAuthorized_(params) {
  const expected = getProp_('ADMIN_KEY');
  if (!expected) return false; // sin ADMIN_KEY configurada, nadie es admin
  return params.adminKey === expected;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = values.slice(1);
  return rows
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

// Un producto sin categoría (celda vacía) se muestra bajo "Otros" en el
// catálogo y en el Dashboard. Esta función centraliza esa regla, para que
// comparar/buscar una categoría por su nombre (por ejemplo al renombrar,
// ocultar o borrar "Otros") funcione igual en todos lados.
function nombreCategoriaMostrada_(valorCelda) {
  return String(valorCelda || '').trim() || 'Otros';
}

// Lista de nombres de categoría que Claudia marcó como "ocultas" desde la
// pestaña "Orden del catálogo" (se guardan en la hoja "Opciones", con
// Campo = "categoriaOculta"). Mientras una categoría esté en esta lista,
// sus productos NO aparecen en el catálogo público — pero sus datos
// siguen intactos, y basta con "Mostrar" de nuevo para que reaparezcan.
function obtenerCategoriasOcultas_(ss) {
  const sheet = obtenerHojaOpciones_(ss);
  return sheetToObjects_(sheet)
    .filter((f) => String(f.Campo) === 'categoriaOculta')
    .map((f) => String(f.Valor || '').trim());
}

/**
 * Ordena una lista de productos (ya convertida a objetos) por categoría y,
 * dentro de cada categoría, por la columna "Orden". Así se arma el catálogo
 * público agrupado en "carruseles" por categoría, en el orden que Claudia
 * decidió arrastrando en el Dashboard.
 *
 * Reglas simples:
 *  - Un producto sin número en "Orden" (columna vacía, o la columna todavía
 *    ni existe en la hoja) se trata como si tuviera Orden = 0.
 *  - El orden es "estable": si dos productos empatan en su número de Orden,
 *    se quedan en el mismo orden en que ya estaban en la hoja (no se
 *    revuelven solos).
 *  - Las categorías mismas se acomodan según el menor número de Orden que
 *    tenga cualquiera de sus productos. Así, si arrastras un producto hasta
 *    el número 1 de su categoría, esa categoría completa puede subir en el
 *    catálogo, sin necesitar una columna aparte para "orden de categoría".
 */
function ordenarProductos_(productos) {
  // Antes de agrupar, invertimos el orden "natural" de la hoja (que va del
  // más viejo al más nuevo) para que, mientras un producto no tenga un
  // número de Orden distinto de otro (por ejemplo, ninguno se ha
  // arrastrado todavía), el catálogo público muestre primero los productos
  // más nuevos y hasta abajo los más viejos — igual que ya pasa en la
  // pestaña de Stock del Dashboard.
  const productosMasNuevosPrimero = productos.slice().reverse();

  const categorias = [];
  const porCategoria = {};

  productosMasNuevosPrimero.forEach((p) => {
    const cat = String(p.Categoria || '').trim();
    if (!porCategoria[cat]) {
      porCategoria[cat] = [];
      categorias.push(cat);
    }
    porCategoria[cat].push(p);
  });

  categorias.forEach((cat) => {
    porCategoria[cat].sort((a, b) => (Number(a.Orden) || 0) - (Number(b.Orden) || 0));
  });

  categorias.sort((catA, catB) => {
    const minA = Math.min.apply(null, porCategoria[catA].map((p) => Number(p.Orden) || 0));
    const minB = Math.min.apply(null, porCategoria[catB].map((p) => Number(p.Orden) || 0));
    return minA - minB;
  });

  const resultado = [];
  categorias.forEach((cat) => {
    porCategoria[cat].forEach((p) => resultado.push(p));
  });
  return resultado;
}

function findRowIndexById_(sheet, idColName, id) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idColName);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) return i + 1; // 1-based row number
  }
  return -1;
}

/**
 * Escribe un valor en una celda. Si el nombre de columna está en
 * CAMPOS_TEXTO_FORZADO, primero pone el formato de la celda en "texto
 * plano" para que Sheets no intente adivinar que es un número.
 */
function escribirCelda_(sheet, fila, colIndex1based, nombreColumna, valor) {
  const rango = sheet.getRange(fila, colIndex1based);
  if (CAMPOS_TEXTO_FORZADO.indexOf(nombreColumna) !== -1) {
    rango.setNumberFormat('@');
  }
  rango.setValue(valor);
}

/**
 * Actualiza, en una sola fila (encontrada por ID), solo las columnas cuyo
 * nombre de encabezado aparece como llave en `valores`. Así podemos hacer
 * "actualizar producto" y "actualizar pedido" sin depender del orden de
 * las columnas, solo de los nombres de encabezado.
 */
function actualizarFilaPorId_(sheet, idColName, id, valores) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const row = findRowIndexById_(sheet, idColName, id);
  if (row === -1) return false;
  Object.keys(valores).forEach((campo) => {
    const col = headers.indexOf(campo);
    if (col !== -1) escribirCelda_(sheet, row, col + 1, campo, valores[campo]);
  });
  return true;
}

/**
 * Devuelve (o crea, la primera vez) la hoja "Opciones", donde se guardan
 * las opciones predeterminadas que Claudia arma a mano desde el Dashboard
 * (en "+ Agregar producto" > "Administrar opciones predeterminadas"). A
 * diferencia del historial de productos, esta lista NUNCA se llena sola:
 * solo tiene los valores que se agregaron a propósito con el botón de
 * "Agregar", así no se satura con valores usados una sola vez.
 */
function obtenerHojaOpciones_(ss) {
  let sheet = ss.getSheetByName(SHEET_OPCIONES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_OPCIONES);
    sheet.appendRow(['Campo', 'Valor']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Devuelve (o crea, la primera vez) la carpeta de Drive donde se guardan
 * las fotos subidas desde el Dashboard. El ID de la carpeta se guarda en
 * Script Properties para reusar siempre la misma carpeta.
 */
function getCarpetaFotos_() {
  const folderId = getProp_(CARPETA_FOTOS_PROP);
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      // si el ID guardado ya no es válido (se borró la carpeta a mano),
      // seguimos abajo y creamos una nueva.
    }
  }
  const folder = DriveApp.createFolder('Fotos PyME App');
  PropertiesService.getScriptProperties().setProperty(CARPETA_FOTOS_PROP, folder.getId());
  return folder;
}

/**
 * Ejecuta esta función UNA VEZ a mano desde el editor de Apps Script para
 * autorizar el permiso de Google Drive (necesario para subir fotos). No
 * hace nada más que "tocar" DriveApp para que aparezca el diálogo de
 * autorización.
 */
function autorizarDrive() {
  const carpeta = getCarpetaFotos_();
  Logger.log('Carpeta de fotos lista: ' + carpeta.getUrl());
}

/** ============ GET: lectura de datos ============ */
function doGet(e) {
  try {
    const params = e.parameter;
    const action = params.action;
    const ss = getSpreadsheet_();

    if (action === 'listarProductos') {
      if (!isPublicAuthorized_(params)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const categoriasOcultas = obtenerCategoriasOcultas_(ss);
      const productos = ordenarProductos_(
        sheetToObjects_(sheet)
          .filter(p => p.Disponible === true || String(p.Disponible).toUpperCase() === 'TRUE' || String(p.Disponible).toUpperCase() === 'SI')
          .filter(p => categoriasOcultas.indexOf(nombreCategoriaMostrada_(p.Categoria)) === -1)
      );
      return jsonOut_({ ok: true, productos: productos });
    }

    if (action === 'listarPedidos') {
      if (!isAdminAuthorized_(params)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const sheet = ss.getSheetByName(SHEET_PEDIDOS);
      return jsonOut_({ ok: true, pedidos: sheetToObjects_(sheet) });
    }

    if (action === 'listarProductosAdmin') {
      if (!isAdminAuthorized_(params)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      // OJO: aquí NO se usa ordenarProductos_ (el orden por categoría es
      // solo para el catálogo público). El Dashboard necesita el orden
      // "natural" de la hoja para poder mostrar los más nuevos arriba con
      // .reverse() en Stock. La pestaña de "Orden del catálogo" hace su
      // propio agrupado por categoría solo para esa vista, sin afectar aquí.
      return jsonOut_({ ok: true, productos: sheetToObjects_(sheet) });
    }

    if (action === 'alertas') {
      if (!isAdminAuthorized_(params)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const productos = sheetToObjects_(sheet);
      const bajoInventario = productos.filter(p => Number(p.Stock) <= Number(p.StockMinimo || 0));
      return jsonOut_({ ok: true, alertas: bajoInventario });
    }

    if (action === 'listarOpciones') {
      if (!isAdminAuthorized_(params)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const sheet = obtenerHojaOpciones_(ss);
      const filas = sheetToObjects_(sheet);
      // Se agrupan por Campo, por ejemplo: { categoria: ['Bolsas', 'Zapatos'], color: ['Rojo'] }
      const opciones = {};
      filas.forEach((f) => {
        const campo = String(f.Campo || '').trim();
        const valor = String(f.Valor || '').trim();
        if (!campo || !valor) return;
        if (!opciones[campo]) opciones[campo] = [];
        opciones[campo].push(valor);
      });
      return jsonOut_({ ok: true, opciones: opciones });
    }

    return jsonOut_({ ok: false, error: 'Acción no reconocida' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/** ============ POST: escritura de datos ============ */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const ss = getSpreadsheet_();

    if (action === 'crearPedido') {
      if (!isPublicAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      // OJO — MUY IMPORTANTE: cuando alguien pide varios productos juntos
      // (carrito), la app manda una solicitud de "crearPedido" por cada
      // producto, casi al mismo tiempo. Sin este candado (LockService), dos
      // de esas solicitudes podían "cruzarse": ambas agregaban su fila, pero
      // al buscar "cuál fue la última fila que agregué" (getLastRow) para
      // anotar ahí el teléfono, a veces una solicitud terminaba anotando el
      // teléfono en la fila que en realidad había agregado LA OTRA
      // solicitud — por eso a veces un pedido del carrito se quedaba sin
      // teléfono, o con el teléfono de otro producto. El candado obliga a
      // que, mientras una solicitud no haya terminado de agregar su fila Y
      // anotar su teléfono, ninguna otra pueda empezar — así nunca se cruzan.
      const bloqueo = LockService.getScriptLock();
      bloqueo.waitLock(30000); // espera hasta 30 segundos su turno, si hace falta
      try {
        const sheet = ss.getSheetByName(SHEET_PEDIDOS);
        const nuevoId = Utilities.getUuid().slice(0, 8);
        const fecha = new Date();

        // Dejamos el Teléfono vacío en el appendRow y lo escribimos aparte
        // ya con formato de texto forzado, para que no se convierta en número.
        sheet.appendRow([
          nuevoId,
          fecha,
          body.cliente || '',
          '',
          body.producto || '',
          body.productoId || '',
          body.cantidad || 1,
          'Pendiente',
          body.notas || ''
        ]);

        const filaNueva = sheet.getLastRow();
        const headersPedidos = sheet.getDataRange().getValues()[0];
        const colTelefono = headersPedidos.indexOf('Telefono') + 1;
        if (colTelefono > 0) escribirCelda_(sheet, filaNueva, colTelefono, 'Telefono', body.telefono || '');

        return jsonOut_({ ok: true, id: nuevoId });
      } finally {
        bloqueo.releaseLock();
      }
    }

    if (action === 'actualizarStock') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const row = findRowIndexById_(sheet, 'ID', body.productoId);
      if (row === -1) return jsonOut_({ ok: false, error: 'Producto no encontrado' });

      const headers = sheet.getDataRange().getValues()[0];
      const stockCol = headers.indexOf('Stock') + 1;
      sheet.getRange(row, stockCol).setValue(Number(body.nuevoStock));

      return jsonOut_({ ok: true });
    }

    if (action === 'actualizarPedido') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      const sheet = ss.getSheetByName(SHEET_PEDIDOS);
      const valores = {};
      if (body.estado !== undefined) valores['Estado'] = body.estado;
      if (body.cantidad !== undefined) valores['Cantidad'] = Number(body.cantidad) || 1;
      if (body.telefono !== undefined) valores['Telefono'] = body.telefono;
      if (body.notas !== undefined) valores['Notas'] = body.notas;

      const actualizado = actualizarFilaPorId_(sheet, 'ID', body.pedidoId, valores);
      if (!actualizado) return jsonOut_({ ok: false, error: 'Pedido no encontrado' });

      return jsonOut_({ ok: true });
    }

    if (action === 'crearProducto') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      // Mismo candado que en "crearPedido": evita que dos productos
      // agregados casi al mismo tiempo (por ejemplo, dos pestañas del
      // Dashboard abiertas) se crucen al calcular el Orden o al anotar el
      // CodigoPropio en la fila equivocada.
      const bloqueoProducto = LockService.getScriptLock();
      bloqueoProducto.waitLock(30000);
      try {
        const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
        const nuevoId = Utilities.getUuid().slice(0, 8);

        // El producto nuevo se manda al FINAL de su categoría por default (o
        // hasta arriba de todas, si es una categoría que no existía todavía).
        // Así no se mete sin querer en medio del orden que ya acomodaste a
        // mano — luego lo puedes arrastrar a donde quieras desde la pestaña
        // "Orden del catálogo" del Dashboard.
        const categoriaNueva = String(body.categoria || '').trim();
        const ordenesDeEsaCategoria = sheetToObjects_(sheet)
          .filter((p) => String(p.Categoria || '').trim() === categoriaNueva)
          .map((p) => Number(p.Orden) || 0);
        const nuevoOrden = ordenesDeEsaCategoria.length > 0 ? Math.max.apply(null, ordenesDeEsaCategoria) + 1 : 1;

        // Dejamos CodigoPropio vacío en el appendRow y lo escribimos aparte
        // ya con formato de texto forzado (para que "007" no se vuelva "7").
        // FechaCreacion y Orden sí se pueden meter directo: son un número y
        // una fecha reales, no un código que deba conservar ceros a la
        // izquierda.
        sheet.appendRow([
          nuevoId,
          body.nombre || '',
          body.categoria || '',
          Number(body.precio) || 0,
          Number(body.stock) || 0,
          Number(body.stockMinimo) || 0,
          body.fotoUrl || '',
          true,
          body.descripcion || '',
          body.marca || '',
          body.talla || '',
          body.color || '',
          Number(body.precioCompra) || 0,
          '',
          new Date(),
          nuevoOrden
        ]);

        const filaNueva = sheet.getLastRow();
        const headersProductos = sheet.getDataRange().getValues()[0];
        const colCodigo = headersProductos.indexOf('CodigoPropio') + 1;
        if (colCodigo > 0) escribirCelda_(sheet, filaNueva, colCodigo, 'CodigoPropio', body.codigoPropio || '');

        return jsonOut_({ ok: true, id: nuevoId });
      } finally {
        bloqueoProducto.releaseLock();
      }
    }

    if (action === 'actualizarProducto') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const valores = {};
      if (body.nombre !== undefined) valores['Nombre'] = body.nombre;
      if (body.categoria !== undefined) valores['Categoria'] = body.categoria;
      if (body.marca !== undefined) valores['Marca'] = body.marca;
      if (body.talla !== undefined) valores['Talla'] = body.talla;
      if (body.color !== undefined) valores['Color'] = body.color;
      if (body.precio !== undefined) valores['Precio'] = Number(body.precio) || 0;
      if (body.precioCompra !== undefined) valores['PrecioCompra'] = Number(body.precioCompra) || 0;
      if (body.stock !== undefined) valores['Stock'] = Number(body.stock) || 0;
      if (body.stockMinimo !== undefined) valores['StockMinimo'] = Number(body.stockMinimo) || 0;
      if (body.fotoUrl !== undefined) valores['FotoURL'] = body.fotoUrl;
      if (body.descripcion !== undefined) valores['Descripcion'] = body.descripcion;
      if (body.disponible !== undefined) valores['Disponible'] = body.disponible;
      if (body.codigoPropio !== undefined) valores['CodigoPropio'] = body.codigoPropio;
      if (body.orden !== undefined) valores['Orden'] = Number(body.orden) || 0;

      const actualizado = actualizarFilaPorId_(sheet, 'ID', body.productoId, valores);
      if (!actualizado) return jsonOut_({ ok: false, error: 'Producto no encontrado' });

      return jsonOut_({ ok: true });
    }

    if (action === 'actualizarOrdenMultiple') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      // body.cambios = [{ productoId, orden }, ...]. Se usa cuando Claudia
      // arrastra productos en el Dashboard: en vez de mandar una llamada
      // por cada producto que se recorrió, se manda UNA sola llamada con
      // todos los cambios juntos (más rápido y evita que se vea "trabado").
      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const colId = headers.indexOf('ID');
      const colOrden = headers.indexOf('Orden');
      if (colOrden === -1) {
        return jsonOut_({ ok: false, error: 'Falta la columna "Orden" en la hoja de Productos.' });
      }

      const cambios = Array.isArray(body.cambios) ? body.cambios : [];
      const mapaCambios = {};
      cambios.forEach((c) => { mapaCambios[String(c.productoId)] = Number(c.orden) || 0; });

      for (let i = 1; i < values.length; i++) {
        const id = String(values[i][colId]);
        if (Object.prototype.hasOwnProperty.call(mapaCambios, id)) {
          sheet.getRange(i + 1, colOrden + 1).setValue(mapaCambios[id]);
        }
      }

      return jsonOut_({ ok: true });
    }

    if (action === 'renombrarCategoria') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      const anterior = String(body.categoriaAnterior || '').trim();
      const nueva = String(body.categoriaNueva || '').trim();
      if (!nueva) return jsonOut_({ ok: false, error: 'Falta escribir el nuevo nombre de la categoría' });

      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const colCategoria = headers.indexOf('Categoria');
      let contador = 0;
      for (let i = 1; i < values.length; i++) {
        // OJO: usamos nombreCategoriaMostrada_ (no una comparación directa)
        // para que renombrar "Otros" también funcione — los productos de
        // "Otros" en realidad tienen la celda de Categoria VACÍA, no el
        // texto "Otros" (eso es solo cómo se les llama al mostrarlos).
        if (nombreCategoriaMostrada_(values[i][colCategoria]) === anterior) {
          sheet.getRange(i + 1, colCategoria + 1).setValue(nueva);
          contador++;
        }
      }

      // También renombramos la entrada en las opciones predeterminadas de
      // categoría (y en la lista de categorías ocultas, si estaba ahí),
      // para que una categoría vacía (recién creada, sin productos
      // todavía) también se pueda renombrar sin problema.
      const hojaOpciones = obtenerHojaOpciones_(ss);
      const valoresOpciones = hojaOpciones.getDataRange().getValues();
      const headersOpciones = valoresOpciones[0];
      const colCampoOp = headersOpciones.indexOf('Campo');
      const colValorOp = headersOpciones.indexOf('Valor');
      for (let i = 1; i < valoresOpciones.length; i++) {
        const campoOp = String(valoresOpciones[i][colCampoOp]);
        const valorOp = String(valoresOpciones[i][colValorOp]).trim();
        if ((campoOp === 'categoria' || campoOp === 'categoriaOculta') && valorOp === anterior) {
          hojaOpciones.getRange(i + 1, colValorOp + 1).setValue(nueva);
        }
      }

      return jsonOut_({ ok: true, actualizados: contador });
    }

    if (action === 'eliminarCategoria') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      const categoria = String(body.categoria || '').trim();
      const borrarProductos = !!body.borrarProductos;
      if (!categoria) return jsonOut_({ ok: false, error: 'Falta indicar qué categoría quitar o borrar' });

      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const colCategoria = headers.indexOf('Categoria');
      let contador = 0;

      if (borrarProductos) {
        // "Borrar la categoría CON todo y productos": se recorre de abajo
        // hacia arriba, porque al borrar una fila las de abajo recorren su
        // número hacia arriba — si fuéramos de arriba hacia abajo nos
        // saltaríamos filas sin querer (igual que en "eliminarOpcion").
        for (let i = values.length - 1; i >= 1; i--) {
          if (nombreCategoriaMostrada_(values[i][colCategoria]) === categoria) {
            sheet.deleteRow(i + 1);
            contador++;
          }
        }
      } else {
        // "Quitar la categoría SIN borrar productos": los productos se
        // quedan, solo se les vacía la Categoria (se van a "Otros").
        for (let i = 1; i < values.length; i++) {
          if (nombreCategoriaMostrada_(values[i][colCategoria]) === categoria) {
            sheet.getRange(i + 1, colCategoria + 1).setValue('');
            contador++;
          }
        }
      }

      // En ambos casos, quitamos esa categoría de las opciones
      // predeterminadas y de la lista de categorías ocultas (si estaba),
      // para que no se quede una categoría "fantasma" en esas listas.
      const hojaOpciones = obtenerHojaOpciones_(ss);
      const valoresOpciones = hojaOpciones.getDataRange().getValues();
      const headersOpciones = valoresOpciones[0];
      const colCampoOp = headersOpciones.indexOf('Campo');
      const colValorOp = headersOpciones.indexOf('Valor');
      for (let i = valoresOpciones.length - 1; i >= 1; i--) {
        const campoOp = String(valoresOpciones[i][colCampoOp]);
        const valorOp = String(valoresOpciones[i][colValorOp]).trim();
        if ((campoOp === 'categoria' || campoOp === 'categoriaOculta') && valorOp === categoria) {
          hojaOpciones.deleteRow(i + 1);
        }
      }

      return jsonOut_({ ok: true, afectados: contador, productosBorrados: borrarProductos });
    }

    if (action === 'eliminarProducto') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });

      const sheet = ss.getSheetByName(SHEET_PRODUCTOS);
      const row = findRowIndexById_(sheet, 'ID', body.productoId);
      if (row === -1) return jsonOut_({ ok: false, error: 'Producto no encontrado' });

      sheet.deleteRow(row);
      return jsonOut_({ ok: true });
    }

    if (action === 'agregarOpcion') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const campo = String(body.campo || '').trim();
      const valor = String(body.valor || '').trim();
      if (!campo || !valor) return jsonOut_({ ok: false, error: 'Falta el campo o el valor' });

      const sheet = obtenerHojaOpciones_(ss);
      const filas = sheetToObjects_(sheet);
      // No se agrega si ya existe (comparando sin importar mayúsculas/minúsculas),
      // para no llenar la lista con el mismo valor repetido.
      const yaExiste = filas.some(
        (f) => String(f.Campo) === campo && String(f.Valor).trim().toLowerCase() === valor.toLowerCase()
      );
      if (!yaExiste) sheet.appendRow([campo, valor]);
      return jsonOut_({ ok: true });
    }

    if (action === 'eliminarOpcion') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });
      const campo = String(body.campo || '').trim();
      const valor = String(body.valor || '').trim();

      const sheet = obtenerHojaOpciones_(ss);
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const colCampo = headers.indexOf('Campo');
      const colValor = headers.indexOf('Valor');
      // Se recorre de abajo hacia arriba: al borrar una fila, las de abajo
      // recorren su número hacia arriba, y si fuéramos de arriba hacia abajo
      // nos saltaríamos filas sin querer.
      for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][colCampo]) === campo && String(values[i][colValor]) === valor) {
          sheet.deleteRow(i + 1);
        }
      }
      return jsonOut_({ ok: true });
    }

    if (action === 'subirFoto') {
      if (!isAdminAuthorized_(body)) return jsonOut_({ ok: false, error: 'No autorizado' });
      if (!body.datosBase64) return jsonOut_({ ok: false, error: 'Falta la imagen' });

      const carpeta = getCarpetaFotos_();
      const datos = Utilities.base64Decode(body.datosBase64);
      const blob = Utilities.newBlob(datos, body.tipoMime || 'image/jpeg', body.nombreArchivo || 'foto.jpg');
      const archivo = carpeta.createFile(blob);
      archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      // OJO: NO usar "drive.google.com/uc?export=view" — Google lo ha ido
      // restringiendo y muchas veces no se muestra como imagen en sitios
      // externos. Este formato de "thumbnail" es el que sí funciona de
      // forma confiable para insertarse como <img> en otra página.
      const url = 'https://drive.google.com/thumbnail?id=' + archivo.getId() + '&sz=w1000';
      return jsonOut_({ ok: true, url: url });
    }

    return jsonOut_({ ok: false, error: 'Acción no reconocida' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/**
 * Función de utilidad: ejecútala UNA VEZ manualmente desde el editor de
 * Apps Script para crear las hojas y encabezados automáticamente si tu
 * Sheet está vacío.
 */
function inicializarHojas() {
  const ss = getSpreadsheet_();

  let productos = ss.getSheetByName(SHEET_PRODUCTOS);
  if (!productos) productos = ss.insertSheet(SHEET_PRODUCTOS);
  productos.clear();
  productos.appendRow(['ID', 'Nombre', 'Categoria', 'Precio', 'Stock', 'StockMinimo', 'FotoURL', 'Disponible', 'Descripcion', 'Marca', 'Talla', 'Color', 'PrecioCompra', 'CodigoPropio', 'FechaCreacion', 'Orden']);
  productos.setFrozenRows(1);

  let pedidos = ss.getSheetByName(SHEET_PEDIDOS);
  if (!pedidos) pedidos = ss.insertSheet(SHEET_PEDIDOS);
  pedidos.clear();
  pedidos.appendRow(['ID', 'Fecha', 'Cliente', 'Telefono', 'Producto', 'ProductoID', 'Cantidad', 'Estado', 'Notas']);
  pedidos.setFrozenRows(1);

  // La hoja de Opciones NO se limpia aquí a propósito: si ya tenías
  // opciones predeterminadas guardadas, no queremos borrarlas sin querer
  // cada vez que alguien ejecute esta función a mano.
  obtenerHojaOpciones_(ss);

  Logger.log('Hojas creadas correctamente.');
}
