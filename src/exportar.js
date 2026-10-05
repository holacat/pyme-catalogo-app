// ============================================================================
// Descargas del panel: arma un archivo de Excel (.xlsx) y un PDF DE VERDAD,
// aquí mismo en el navegador, y los baja a la computadora o al celular.
// (2026-10-05, pedido por Claudia: "quiero una opción de descargar en formato
// PDF y Excel el inventario… y las entradas y salidas".)
//
// A propósito NO usa ninguna librería: este proyecto se edita desde la página
// de GitHub (sin "npm install"), y agregar un paquete nuevo es un riesgo de
// que Vercel ya no pueda construir la app. Un .xlsx es un ZIP con unos
// archivos de texto adentro, y un PDF sencillo también es texto; aquí se
// escriben los dos a mano.
//
// Lo que se usa desde afuera:
//   descargarExcel(nombreArchivo, hojas)
//   descargarPDF(nombreArchivo, opciones)
// (crearExcel / crearPDF hacen lo mismo pero regresan los bytes sin bajar
// nada; sirven para las pruebas.)
//
// Tipos de columna (los entienden los dos):
//   'texto'   → tal cual
//   'entero'  → número sin decimales (piezas)
//   'dinero'  → $1,234.50
//   'fecha'   → 05/10/2026
//   'fechaHora' → 05/10/2026 15:42
// ============================================================================

// ---------------------------------------------------------------------------
// Piezas compartidas
// ---------------------------------------------------------------------------

const CODIFICADOR = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function aBytesUtf8(texto) {
  if (CODIFICADOR) return CODIFICADOR.encode(texto);
  // Respaldo para un navegador muy viejo sin TextEncoder.
  const escapado = unescape(encodeURIComponent(texto));
  const bytes = new Uint8Array(escapado.length);
  for (let i = 0; i < escapado.length; i++) bytes[i] = escapado.charCodeAt(i);
  return bytes;
}

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function esFechaValida(valor) {
  return valor instanceof Date && !Number.isNaN(valor.getTime());
}

// Convierte lo que venga (Date, texto de fecha, número) en un Date, o null.
function aFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return esFechaValida(fecha) ? fecha : null;
}

function aNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function conMiles(numero, decimales) {
  const fijo = Math.abs(numero).toFixed(decimales);
  const [entero, fraccion] = fijo.split('.');
  const conComas = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${numero < 0 ? '-' : ''}${conComas}${fraccion ? `.${fraccion}` : ''}`;
}

// El texto con el que un valor se ve en el PDF (y en una celda de texto).
export function textoDeCelda(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (tipo === 'entero') {
    const n = aNumero(valor);
    return n === null ? String(valor) : conMiles(Math.round(n), 0);
  }
  if (tipo === 'dinero') {
    const n = aNumero(valor);
    if (n === null) return String(valor);
    return `$${conMiles(n, Number.isInteger(n) ? 0 : 2)}`;
  }
  if (tipo === 'fecha' || tipo === 'fechaHora') {
    const f = aFecha(valor);
    if (!f) return String(valor);
    const dia = `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}/${f.getFullYear()}`;
    return tipo === 'fecha' ? dia : `${dia} ${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;
  }
  return String(valor);
}

// Baja unos bytes como archivo.
function bajarArchivo(nombreArchivo, bytes, tipoMime) {
  const blob = new Blob([bytes], { type: tipoMime });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  // Se limpia un momento después (si se quita de inmediato, algunos
  // navegadores de celular cancelan la descarga).
  setTimeout(() => {
    enlace.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

// Nombre de archivo sin caracteres que estorben en Windows / Android.
export function nombreDeArchivoSeguro(nombre) {
  return String(nombre || 'descarga')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'descarga';
}

// Fecha de hoy para el nombre del archivo: 2026-10-05
export function fechaParaArchivo(fecha = new Date()) {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

// ---------------------------------------------------------------------------
// ZIP (sin comprimir) — el "sobre" de un archivo .xlsx
// ---------------------------------------------------------------------------

let TABLA_CRC = null;
function crc32(bytes) {
  if (!TABLA_CRC) {
    TABLA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLA_CRC[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = TABLA_CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// archivos: [{ nombre: 'xl/workbook.xml', bytes: Uint8Array }]
function crearZip(archivos, fecha = new Date()) {
  const horaDos = ((fecha.getHours() & 31) << 11) | ((fecha.getMinutes() & 63) << 5) | ((fecha.getSeconds() >> 1) & 31);
  const fechaDos = (((fecha.getFullYear() - 1980) & 127) << 9) | (((fecha.getMonth() + 1) & 15) << 5) | (fecha.getDate() & 31);
  const piezas = [];
  const centrales = [];
  let posicion = 0;

  archivos.forEach((archivo) => {
    const nombre = aBytesUtf8(archivo.nombre);
    const datos = archivo.bytes;
    const crc = crc32(datos);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // firma
    local.setUint16(4, 20, true); // versión necesaria
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // sin comprimir
    local.setUint16(10, horaDos, true);
    local.setUint16(12, fechaDos, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    piezas.push(new Uint8Array(local.buffer), nombre, datos);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, horaDos, true);
    central.setUint16(14, fechaDos, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, datos.length, true);
    central.setUint32(24, datos.length, true);
    central.setUint16(28, nombre.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, posicion, true);
    centrales.push(new Uint8Array(central.buffer), nombre);

    posicion += 30 + nombre.length + datos.length;
  });

  const tamanoCentral = centrales.reduce((suma, p) => suma + p.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(4, 0, true);
  fin.setUint16(6, 0, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanoCentral, true);
  fin.setUint32(16, posicion, true);
  fin.setUint16(20, 0, true);

  const todo = piezas.concat(centrales, [new Uint8Array(fin.buffer)]);
  const total = todo.reduce((suma, p) => suma + p.length, 0);
  const salida = new Uint8Array(total);
  let cursor = 0;
  todo.forEach((p) => {
    salida.set(p, cursor);
    cursor += p.length;
  });
  return salida;
}

// ---------------------------------------------------------------------------
// EXCEL (.xlsx)
// ---------------------------------------------------------------------------

function escaparXml(texto) {
  return String(texto)
    // Caracteres de control que un XML no acepta.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 0 → A, 25 → Z, 26 → AA…
function letraDeColumna(indice) {
  let n = indice;
  let letras = '';
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}

// Fecha → "número de serie" de Excel, con la hora LOCAL de quien descarga.
function serieDeExcel(fecha) {
  const localMs = fecha.getTime() - fecha.getTimezoneOffset() * 60000;
  return (localMs - Date.UTC(1899, 11, 30)) / 86400000;
}

// Excel no deja estos caracteres en el nombre de una hoja, ni más de 31 letras.
function nombreDeHojaSeguro(nombre, usados) {
  let limpio = String(nombre || 'Hoja').replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let intento = limpio;
  let n = 2;
  while (usados.has(intento.toLowerCase())) {
    const sufijo = ` (${n})`;
    intento = limpio.slice(0, 31 - sufijo.length) + sufijo;
    n += 1;
  }
  usados.add(intento.toLowerCase());
  return intento;
}

// Estilos: el número es el lugar de cada uno en "cellXfs" (más abajo).
const ESTILO = { normal: 0, encabezado: 1, entero: 2, dinero: 3, fecha: 4, fechaHora: 5, titulo: 6, subtitulo: 7 };

const XML_ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3">' +
  '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
  '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/>' +
  '</numFmts>' +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="14"/><color rgb="FF14532D"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F7A4D"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right>' +
  '<top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="8">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function celdaTexto(referencia, texto, estilo) {
  if (texto === '') return `<c r="${referencia}" s="${estilo}"/>`;
  return `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(texto)}</t></is></c>`;
}

function celdaDeDato(referencia, valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return `<c r="${referencia}" s="${ESTILO.normal}"/>`;
  if (tipo === 'entero' || tipo === 'dinero') {
    const n = aNumero(valor);
    if (n !== null) return `<c r="${referencia}" s="${tipo === 'entero' ? ESTILO.entero : ESTILO.dinero}"><v>${n}</v></c>`;
  }
  if (tipo === 'fecha' || tipo === 'fechaHora') {
    const f = aFecha(valor);
    if (f) {
      const serie = serieDeExcel(f);
      // Solo fecha: se quita la hora, para que al filtrar por día funcione.
      const numero = tipo === 'fecha' ? Math.floor(serie) : Math.round(serie * 86400) / 86400;
      return `<c r="${referencia}" s="${tipo === 'fecha' ? ESTILO.fecha : ESTILO.fechaHora}"><v>${numero}</v></c>`;
    }
  }
  // Excel no acepta más de 32,767 letras en una celda.
  return celdaTexto(referencia, String(valor).slice(0, 32000), ESTILO.normal);
}

// Una hoja: { nombre, titulo, subtitulo, columnas: [{ titulo, tipo, ancho }], filas: [[…]] }
function xmlDeHoja(hoja) {
  const columnas = hoja.columnas || [];
  const filas = hoja.filas || [];
  const ultimaLetra = letraDeColumna(Math.max(0, columnas.length - 1));
  const partes = [];
  let renglon = 0;

  if (hoja.titulo) {
    renglon += 1;
    partes.push(`<row r="${renglon}" ht="22" customHeight="1">${celdaTexto(`A${renglon}`, hoja.titulo, ESTILO.titulo)}</row>`);
  }
  if (hoja.subtitulo) {
    renglon += 1;
    partes.push(`<row r="${renglon}">${celdaTexto(`A${renglon}`, hoja.subtitulo, ESTILO.subtitulo)}</row>`);
  }
  renglon += 1;
  const renglonEncabezado = renglon;
  partes.push(
    `<row r="${renglon}" ht="30" customHeight="1">${columnas
      .map((c, i) => celdaTexto(`${letraDeColumna(i)}${renglon}`, c.titulo || '', ESTILO.encabezado))
      .join('')}</row>`
  );
  filas.forEach((fila) => {
    renglon += 1;
    const numero = renglon;
    partes.push(
      `<row r="${numero}">${columnas
        .map((c, i) => celdaDeDato(`${letraDeColumna(i)}${numero}`, fila[i], c.tipo || 'texto'))
        .join('')}</row>`
    );
  });

  const anchos = columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, Number(c.ancho) || 14))}" customWidth="1"/>`)
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${ultimaLetra}${Math.max(renglon, 1)}"/>` +
    // El encabezado se queda fijo al bajar por la hoja.
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${renglonEncabezado}" topLeftCell="A${renglonEncabezado + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (anchos ? `<cols>${anchos}</cols>` : '') +
    `<sheetData>${partes.join('')}</sheetData>` +
    // Flechitas de filtro en el encabezado.
    (columnas.length > 0 ? `<autoFilter ref="A${renglonEncabezado}:${ultimaLetra}${Math.max(renglon, renglonEncabezado)}"/>` : '') +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    '<pageSetup orientation="landscape" fitToHeight="0"/>' +
    '</worksheet>'
  );
}

// hojas: [{ nombre, titulo, subtitulo, columnas, filas }] → Uint8Array (.xlsx)
export function crearExcel(hojas) {
  const lista = (hojas || []).filter(Boolean);
  if (lista.length === 0) throw new Error('No hay nada que poner en el Excel.');
  const usados = new Set();
  const nombres = lista.map((h) => nombreDeHojaSeguro(h.nombre, usados));

  const tipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    lista
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('') +
    '</Types>';

  const relsRaiz =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const libro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView/></bookViews>' +
    `<sheets>${nombres.map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    '</workbook>';

  const relsLibro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    lista
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('') +
    `<Relationship Id="rId${lista.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  const archivos = [
    { nombre: '[Content_Types].xml', bytes: aBytesUtf8(tipos) },
    { nombre: '_rels/.rels', bytes: aBytesUtf8(relsRaiz) },
    { nombre: 'xl/workbook.xml', bytes: aBytesUtf8(libro) },
    { nombre: 'xl/_rels/workbook.xml.rels', bytes: aBytesUtf8(relsLibro) },
    { nombre: 'xl/styles.xml', bytes: aBytesUtf8(XML_ESTILOS) },
  ].concat(lista.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, bytes: aBytesUtf8(xmlDeHoja(h)) })));

  return crearZip(archivos);
}

export function descargarExcel(nombreArchivo, hojas) {
  const bytes = crearExcel(hojas);
  bajarArchivo(
    `${nombreDeArchivoSeguro(nombreArchivo)}.xlsx`,
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
// Usa las dos letras que TODO lector de PDF trae de fábrica (Helvetica y
// Helvetica negrita), así el archivo no tiene que cargar ninguna fuente.
// Esas letras cubren el español completo (acentos, ñ, ¿ ¡), pero no emojis:
// esos se quitan del texto antes de escribirlo.

// Cuánto mide cada letra (en milésimas del tamaño de letra), códigos 32 a 126.
const ANCHOS_NORMAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ANCHOS_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// Signos fuera de ese rango: [ancho normal, ancho negrita].
const ANCHOS_EXTRA = {
  '¡': [333, 333], '¿': [611, 611], '°': [400, 400], 'º': [365, 365], 'ª': [370, 370],
  '«': [556, 556], '»': [556, 556], '·': [278, 278], '–': [556, 556], '—': [1000, 1000],
  '…': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500],
  '•': [350, 350], '€': [556, 556], '×': [584, 584], '±': [584, 584], '¢': [556, 556],
  '£': [556, 556], '©': [737, 737], '®': [737, 737], '™': [1000, 1000], 'ß': [611, 611],
  'æ': [889, 889], 'Æ': [1000, 1000], 'ø': [611, 611], 'Ø': [778, 778], '¬': [584, 584],
  '§': [556, 556], '¶': [537, 556], '½': [834, 834], '¼': [834, 834], '¾': [834, 834],
  'µ': [556, 611], '÷': [584, 584], '¨': [333, 333], '´': [333, 333],
};

// Letras de Windows-1252 que no están en su mismo lugar de Unicode.
const CODIGO_1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

// Deja solo lo que estas letras pueden escribir: quita emojis y símbolos
// raros (con el espacio que dejaban), y cambia saltos de línea por espacios.
export function textoParaPDF(texto) {
  let salida = '';
  const limpio = String(texto === null || texto === undefined ? '' : texto).replace(/[\r\n\t]+/g, ' ');
  for (const letra of limpio) {
    const codigo = letra.codePointAt(0);
    if (codigo >= 32 && codigo <= 126) salida += letra;
    else if (codigo >= 0xa0 && codigo <= 0xff) salida += codigo === 0xa0 ? ' ' : letra;
    else if (CODIGO_1252[letra] !== undefined) salida += letra;
    // Signos que la letra del PDF no trae, pero que tienen un equivalente
    // ("Stock: 20 → 26" se lee "Stock: 20 a 26").
    else if (letra === '→' || letra === '⇒' || letra === '➜') salida += 'a';
    else if (letra === '−') salida += '-';
    // Cualquier otra cosa (emoji, letras de otros alfabetos) se quita.
  }
  return salida.replace(/ {2,}/g, ' ').trim();
}

function anchoDeLetra(letra, negrita) {
  const codigo = letra.charCodeAt(0);
  const tabla = negrita ? ANCHOS_NEGRITA : ANCHOS_NORMAL;
  if (codigo >= 32 && codigo <= 126) return tabla[codigo - 32];
  if (ANCHOS_EXTRA[letra]) return ANCHOS_EXTRA[letra][negrita ? 1 : 0];
  // Letras con acento: miden lo mismo que la letra sin acento.
  const base = letra.normalize('NFD').charCodeAt(0);
  if (base >= 32 && base <= 126) return tabla[base - 32];
  return 556;
}

// Ancho de un texto (ya limpio) en puntos.
export function anchoDeTexto(texto, tamano, negrita) {
  let milesimas = 0;
  for (let i = 0; i < texto.length; i++) milesimas += anchoDeLetra(texto[i], negrita);
  return (milesimas * tamano) / 1000;
}

// Parte un texto en renglones que quepan en "anchoMaximo". Una palabra más
// larga que el renglón se corta donde haga falta. Si pasa de "maxRenglones",
// el último termina en "…".
function partirEnRenglones(texto, anchoMaximo, tamano, negrita, maxRenglones) {
  if (!texto) return [''];
  const renglones = [];
  let actual = '';
  const cabe = (t) => anchoDeTexto(t, tamano, negrita) <= anchoMaximo;

  texto.split(' ').forEach((palabra) => {
    let resto = palabra;
    if (actual && cabe(`${actual} ${resto}`)) {
      actual = `${actual} ${resto}`;
      return;
    }
    if (actual) {
      renglones.push(actual);
      actual = '';
    }
    // Palabra que no cabe ni sola: se corta en pedazos.
    while (resto && !cabe(resto)) {
      let n = resto.length - 1;
      while (n > 1 && !cabe(resto.slice(0, n))) n -= 1;
      renglones.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    actual = resto;
  });
  if (actual) renglones.push(actual);
  if (renglones.length === 0) renglones.push('');

  if (maxRenglones && renglones.length > maxRenglones) {
    const recortados = renglones.slice(0, maxRenglones);
    let ultimo = recortados[maxRenglones - 1];
    while (ultimo && !cabe(`${ultimo}…`)) ultimo = ultimo.slice(0, -1);
    recortados[maxRenglones - 1] = `${ultimo.trimEnd()}…`;
    return recortados;
  }
  return renglones;
}

// Texto → cadena hexadecimal de PDF, en Windows-1252.
function hexDePDF(texto) {
  let hex = '';
  for (let i = 0; i < texto.length; i++) {
    const letra = texto[i];
    const codigo = CODIGO_1252[letra] !== undefined ? CODIGO_1252[letra] : letra.charCodeAt(0);
    hex += (codigo <= 0xff ? codigo : 63).toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}

function n2(numero) {
  // Hasta 2 decimales, sin ceros de sobra.
  return String(Math.round(numero * 100) / 100);
}

function colorDePDF(hex) {
  const limpio = String(hex || '#000000').replace('#', '');
  const r = parseInt(limpio.slice(0, 2), 16) / 255;
  const g = parseInt(limpio.slice(2, 4), 16) / 255;
  const b = parseInt(limpio.slice(4, 6), 16) / 255;
  return `${n2(r)} ${n2(g)} ${n2(b)}`;
}

// Una hoja de PDF donde se puede escribir y dibujar. Las medidas van en
// puntos (72 por pulgada) y la "y" se cuenta DESDE ARRIBA, como en pantalla.
class PaginaPDF {
  constructor(ancho, alto) {
    this.ancho = ancho;
    this.alto = alto;
    this.ordenes = [];
  }

  // alinear: 'izquierda' | 'derecha' | 'centro' (respecto a x)
  texto(x, y, contenido, { tamano = 9, negrita = false, color = '#111827', alinear = 'izquierda' } = {}) {
    const limpio = textoParaPDF(contenido);
    if (!limpio) return;
    const ancho = anchoDeTexto(limpio, tamano, negrita);
    const inicio = alinear === 'derecha' ? x - ancho : alinear === 'centro' ? x - ancho / 2 : x;
    this.ordenes.push(
      `BT /${negrita ? 'F2' : 'F1'} ${n2(tamano)} Tf ${colorDePDF(color)} rg ${n2(inicio)} ${n2(this.alto - y)} Td ${hexDePDF(limpio)} Tj ET`
    );
  }

  rectangulo(x, y, ancho, alto, { relleno, borde, grosor = 0.5 } = {}) {
    const base = `${n2(x)} ${n2(this.alto - y - alto)} ${n2(ancho)} ${n2(alto)} re`;
    if (relleno && borde) this.ordenes.push(`${colorDePDF(relleno)} rg ${colorDePDF(borde)} RG ${n2(grosor)} w ${base} B`);
    else if (relleno) this.ordenes.push(`${colorDePDF(relleno)} rg ${base} f`);
    else if (borde) this.ordenes.push(`${colorDePDF(borde)} RG ${n2(grosor)} w ${base} S`);
  }

  linea(x1, y1, x2, y2, { color = '#d1d5db', grosor = 0.5 } = {}) {
    this.ordenes.push(
      `${colorDePDF(color)} RG ${n2(grosor)} w ${n2(x1)} ${n2(this.alto - y1)} m ${n2(x2)} ${n2(this.alto - y2)} l S`
    );
  }
}

// Junta las páginas en un archivo PDF. Regresa los bytes.
function armarPDF(paginas, { titulo = '', autor = '' } = {}) {
  const objetos = [];
  const agregar = (contenido) => {
    objetos.push(contenido);
    return objetos.length; // número de objeto (empiezan en 1)
  };

  const idCatalogo = agregar(''); // se llena al final
  const idPaginas = agregar('');
  const idLetra = agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const idNegrita = agregar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const idsDePagina = paginas.map((pagina) => {
    const flujo = pagina.ordenes.join('\n');
    const idContenido = agregar(`<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`);
    return agregar(
      `<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 ${n2(pagina.ancho)} ${n2(pagina.alto)}] ` +
        `/Resources << /Font << /F1 ${idLetra} 0 R /F2 ${idNegrita} 0 R >> >> /Contents ${idContenido} 0 R >>`
    );
  });

  objetos[idCatalogo - 1] = `<< /Type /Catalog /Pages ${idPaginas} 0 R >>`;
  objetos[idPaginas - 1] = `<< /Type /Pages /Kids [${idsDePagina.map((id) => `${id} 0 R`).join(' ')}] /Count ${idsDePagina.length} >>`;

  const ahora = new Date();
  const sello = `D:${ahora.getFullYear()}${dosDigitos(ahora.getMonth() + 1)}${dosDigitos(ahora.getDate())}${dosDigitos(ahora.getHours())}${dosDigitos(ahora.getMinutes())}${dosDigitos(ahora.getSeconds())}`;
  const idInfo = agregar(
    `<< /Title ${hexDePDF(textoParaPDF(titulo))} /Author ${hexDePDF(textoParaPDF(autor))} /Producer ${hexDePDF('Panel de administracion')} /CreationDate (${sello}) >>`
  );

  // Todo lo escrito hasta aquí es ASCII (los textos van en hexadecimal), así
  // que cada letra es exactamente un byte y las posiciones se pueden contar.
  let cuerpo = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const posiciones = [];
  objetos.forEach((contenido, i) => {
    posiciones.push(cuerpo.length);
    cuerpo += `${i + 1} 0 obj\n${contenido}\nendobj\n`;
  });
  const inicioTabla = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  posiciones.forEach((p) => {
    cuerpo += `${String(p).padStart(10, '0')} 00000 n \n`;
  });
  cuerpo += `trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R /Info ${idInfo} 0 R >>\nstartxref\n${inicioTabla}\n%%EOF\n`;

  const bytes = new Uint8Array(cuerpo.length);
  for (let i = 0; i < cuerpo.length; i++) bytes[i] = cuerpo.charCodeAt(i) & 0xff;
  return bytes;
}

// Tamaños de hoja, en puntos.
const HOJA_CARTA = { ancho: 612, alto: 792 };

// Un reporte con título y una tabla, de las páginas que hagan falta.
// opciones: {
//   titulo, subtitulo (texto o lista de renglones), notaPie,
//   horizontal (true = hoja acostada),
//   columnas: [{ titulo, tipo, peso (qué tan ancha, en proporción), alinear }],
//   filas: [[…]],
//   resumen: [{ etiqueta, valor }]  // cuadritos de totales debajo del título
// }
export function crearPDF(opciones) {
  const {
    titulo = 'Reporte',
    subtitulo = '',
    notaPie = '',
    horizontal = true,
    columnas = [],
    filas = [],
    resumen = [],
    autor = '',
  } = opciones || {};

  const anchoHoja = horizontal ? HOJA_CARTA.alto : HOJA_CARTA.ancho;
  const altoHoja = horizontal ? HOJA_CARTA.ancho : HOJA_CARTA.alto;
  const MARGEN = 30;
  const anchoUtil = anchoHoja - MARGEN * 2;
  const LETRA = 7.6;
  const LETRA_ENCABEZADO = 7.4;
  const ALTO_RENGLON = 9.6;
  const RELLENO = 3.2;
  const MAX_RENGLONES_POR_CELDA = 5;
  const VERDE = '#1f7a4d';
  const VERDE_OSCURO = '#14532d';

  // Anchos de columna según su "peso".
  const pesoTotal = columnas.reduce((suma, c) => suma + (Number(c.peso) || 1), 0) || 1;
  const anchos = columnas.map((c) => (anchoUtil * (Number(c.peso) || 1)) / pesoTotal);
  // Ninguna columna queda tan angosta que la palabra más larga de su título
  // se parta a la mitad ("Quedaro / n"): lo que le falte se le quita, parejo,
  // a las columnas a las que les sobra.
  const minimos = columnas.map((c) => {
    const palabras = textoParaPDF(c.titulo || '').split(' ');
    return Math.max(0, ...palabras.map((palabra) => anchoDeTexto(palabra, LETRA_ENCABEZADO, true))) + RELLENO * 2 + 1;
  });
  if (minimos.reduce((suma, m) => suma + m, 0) <= anchoUtil) {
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      let falta = 0;
      let sobra = 0;
      anchos.forEach((ancho, i) => {
        if (ancho < minimos[i]) falta += minimos[i] - ancho;
        else sobra += ancho - minimos[i];
      });
      if (falta < 0.01 || sobra <= 0) break;
      const quitar = Math.min(1, falta / sobra);
      anchos.forEach((ancho, i) => {
        anchos[i] = ancho < minimos[i] ? minimos[i] : ancho - (ancho - minimos[i]) * quitar;
      });
    }
  }
  const inicios = [];
  anchos.reduce((x, ancho) => {
    inicios.push(x);
    return x + ancho;
  }, MARGEN);
  const alineacion = columnas.map((c) => c.alinear || (c.tipo === 'entero' || c.tipo === 'dinero' ? 'derecha' : 'izquierda'));

  // Encabezado de la tabla (puede ocupar dos renglones).
  const titulosPartidos = columnas.map((c, i) =>
    partirEnRenglones(textoParaPDF(c.titulo || ''), anchos[i] - RELLENO * 2, LETRA_ENCABEZADO, true, 2)
  );
  const altoEncabezado = Math.max(1, ...titulosPartidos.map((t) => t.length)) * ALTO_RENGLON + RELLENO * 2;

  const paginas = [];
  let pagina = null;
  let y = 0;

  function dibujarEncabezadoDeTabla() {
    pagina.rectangulo(MARGEN, y, anchoUtil, altoEncabezado, { relleno: VERDE });
    titulosPartidos.forEach((renglones, i) => {
      const centro = inicios[i] + anchos[i] / 2;
      const arriba = y + (altoEncabezado - renglones.length * ALTO_RENGLON) / 2;
      renglones.forEach((texto, k) => {
        pagina.texto(centro, arriba + (k + 1) * ALTO_RENGLON - 2.6, texto, {
          tamano: LETRA_ENCABEZADO,
          negrita: true,
          color: '#ffffff',
          alinear: 'centro',
        });
      });
    });
    y += altoEncabezado;
  }

  function nuevaPagina(esLaPrimera) {
    pagina = new PaginaPDF(anchoHoja, altoHoja);
    paginas.push(pagina);
    y = MARGEN;
    if (esLaPrimera) {
      pagina.texto(MARGEN, y + 13, titulo, { tamano: 15, negrita: true, color: VERDE_OSCURO });
      y += 20;
      const renglonesSubtitulo = (Array.isArray(subtitulo) ? subtitulo : [subtitulo]).filter(Boolean);
      renglonesSubtitulo.forEach((renglon) => {
        partirEnRenglones(textoParaPDF(renglon), anchoUtil, 8.5, false, 3).forEach((parte) => {
          pagina.texto(MARGEN, y + 8.5, parte, { tamano: 8.5, color: '#4b5563' });
          y += 11.5;
        });
      });
      if (resumen.length > 0) {
        y += 3;
        const anchoCaja = Math.min(150, (anchoUtil - (resumen.length - 1) * 8) / resumen.length);
        resumen.forEach((dato, i) => {
          const x = MARGEN + i * (anchoCaja + 8);
          pagina.rectangulo(x, y, anchoCaja, 30, { relleno: '#f0f7f3', borde: '#b7d6c5' });
          pagina.texto(x + 7, y + 11, dato.etiqueta, { tamano: 7, color: '#4b5563' });
          pagina.texto(x + 7, y + 24, dato.valor, { tamano: 11, negrita: true, color: VERDE_OSCURO });
        });
        y += 36;
      }
      y += 5;
    } else {
      pagina.texto(MARGEN, y + 8, titulo, { tamano: 8.5, negrita: true, color: VERDE_OSCURO });
      y += 14;
    }
    if (columnas.length > 0) dibujarEncabezadoDeTabla();
  }

  const LIMITE_ABAJO = altoHoja - MARGEN - 16; // se deja lugar para el pie

  nuevaPagina(true);

  if (filas.length === 0) {
    pagina.texto(MARGEN + RELLENO, y + 16, 'No hay nada que mostrar con los filtros elegidos.', { tamano: 9, color: '#6b7280' });
    y += 24;
  }

  filas.forEach((fila, numeroDeFila) => {
    const celdas = columnas.map((c, i) =>
      partirEnRenglones(
        textoParaPDF(textoDeCelda(fila[i], c.tipo || 'texto')),
        anchos[i] - RELLENO * 2,
        LETRA,
        false,
        MAX_RENGLONES_POR_CELDA
      )
    );
    const altoFila = Math.max(1, ...celdas.map((c) => c.length)) * ALTO_RENGLON + RELLENO * 2;
    if (y + altoFila > LIMITE_ABAJO) nuevaPagina(false);

    if (numeroDeFila % 2 === 1) pagina.rectangulo(MARGEN, y, anchoUtil, altoFila, { relleno: '#f6f8f7' });
    celdas.forEach((renglones, i) => {
      const x =
        alineacion[i] === 'derecha'
          ? inicios[i] + anchos[i] - RELLENO
          : alineacion[i] === 'centro'
            ? inicios[i] + anchos[i] / 2
            : inicios[i] + RELLENO;
      renglones.forEach((texto, k) => {
        pagina.texto(x, y + RELLENO + (k + 1) * ALTO_RENGLON - 2.6, texto, { tamano: LETRA, alinear: alineacion[i] });
      });
    });
    y += altoFila;
    pagina.linea(MARGEN, y, MARGEN + anchoUtil, y, { color: '#e5e7eb', grosor: 0.4 });
  });

  // Pie de cada página (ya se sabe cuántas son).
  const totalPaginas = paginas.length;
  paginas.forEach((p, i) => {
    const yPie = altoHoja - MARGEN + 6;
    if (notaPie) p.texto(MARGEN, yPie, notaPie, { tamano: 7, color: '#6b7280' });
    p.texto(anchoHoja - MARGEN, yPie, `Página ${i + 1} de ${totalPaginas}`, { tamano: 7, color: '#6b7280', alinear: 'derecha' });
  });

  return armarPDF(paginas, { titulo, autor });
}

export function descargarPDF(nombreArchivo, opciones) {
  const bytes = crearPDF(opciones);
  bajarArchivo(`${nombreDeArchivoSeguro(nombreArchivo)}.pdf`, bytes, 'application/pdf');
}
