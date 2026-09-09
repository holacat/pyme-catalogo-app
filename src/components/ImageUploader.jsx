import { useRef, useState } from 'react';
import { subirFoto } from '../api.js';

const TAMANO_MAXIMO_MB = 5;

// Convierte un archivo a base64 puro (sin el prefijo "data:image/...;base64,")
// que es lo que espera nuestro backend de Apps Script.
function archivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      const resultado = lector.result || '';
      const base64 = String(resultado).split(',')[1] || '';
      resolve(base64);
    };
    lector.onerror = reject;
    lector.readAsDataURL(archivo);
  });
}

/**
 * Selector de fotos por arrastrar-y-soltar (o clic para buscar en el
 * explorador de archivos). Sube cada foto a Google Drive a través de
 * nuestro backend y guarda la lista de URLs resultantes.
 *
 * `value` es un arreglo de URLs ya subidas; `onChange(nuevoArreglo)` se
 * llama cada vez que se agrega o quita una foto.
 */
// Misma llave que usa Dashboard.jsx para guardar el token de sesión. La
// repetimos aquí (en vez de importarla) para poder leer el valor MÁS
// RECIENTE directamente de localStorage justo antes de subir cada foto,
// en lugar de confiar solo en el prop `sesionToken` que llegó de más
// arriba — ver la nota completa junto a `subirArchivos` de por qué.
const TOKEN_KEY_LOCAL = 'pyme_sesion_token';

export default function ImageUploader({ sesionToken, value, onChange }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [sobreZona, setSobreZona] = useState(false);
  const inputRef = useRef(null);

  async function subirArchivos(archivos) {
    setError('');
    const lista = Array.from(archivos || []);
    if (lista.length === 0) return;

    // OJO — bug reportado por Claudia (2026-09): en algunos celulares, subir
    // una foto desde "Fotos del producto" fallaba con "Falta iniciar
    // sesión" AUNQUE el resto del Dashboard seguía funcionando con sesión
    // activa (o sea, no era una sesión perdida de verdad). Para no
    // depender de que el prop `sesionToken` que llegó desde más arriba siga
    // siendo el más actualizado en ese preciso momento, leemos el valor
    // directamente de localStorage justo aquí, y solo si por alguna razón
    // no hay nada guardado ahí usamos el prop como respaldo. Si de todos
    // modos no hay token disponible, el mensaje de error incluye esa pista
    // para poder diagnosticarlo con más detalle la próxima vez.
    const tokenActual = localStorage.getItem(TOKEN_KEY_LOCAL) || sesionToken || '';

    const nuevasUrls = [];
    setSubiendo(true);
    try {
      for (const archivo of lista) {
        if (!archivo.type.startsWith('image/')) {
          setError(`"${archivo.name}" no es una imagen y no se subió.`);
          continue;
        }
        if (archivo.size > TAMANO_MAXIMO_MB * 1024 * 1024) {
          setError(`"${archivo.name}" pesa más de ${TAMANO_MAXIMO_MB}MB y no se subió.`);
          continue;
        }
        const datosBase64 = await archivoABase64(archivo);
        let resultado;
        try {
          resultado = await subirFoto({
            sesionToken: tokenActual,
            nombreArchivo: archivo.name,
            tipoMime: archivo.type,
            datosBase64,
          });
        } catch (errSubida) {
          // Pista de diagnóstico: si esto vuelve a pasar, este texto nos
          // dice si el celular SÍ tenía un token guardado en ese momento
          // (y el problema está entre el celular y el servidor) o si de
          // plano no había ningún token guardado (y el problema es que la
          // sesión se perdió de verdad).
          const pista = tokenActual
            ? 'sí había un token de sesión guardado en este celular en ese momento'
            : 'NO había ningún token de sesión guardado en este celular en ese momento';
          throw new Error(`${errSubida.message} — pista: ${pista}.`);
        }
        nuevasUrls.push(resultado.url);
      }
      if (nuevasUrls.length > 0) {
        onChange([...(value || []), ...nuevasUrls]);
      }
    } catch (err) {
      setError(`Error al subir la foto: ${err.message}`);
    } finally {
      setSubiendo(false);
    }
  }

  function handleQuitar(index) {
    const copia = [...(value || [])];
    copia.splice(index, 1);
    onChange(copia);
  }

  return (
    <div className="image-uploader">
      <div
        className={`dropzone ${sobreZona ? 'dropzone-activa' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setSobreZona(true); }}
        onDragLeave={() => setSobreZona(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobreZona(false);
          subirArchivos(e.dataTransfer.files);
        }}
      >
        {subiendo ? (
          <p>Subiendo foto(s)… un momento.</p>
        ) : (
          <p>📷 Arrastra tus fotos aquí, o haz clic para buscarlas en tu computadora o celular.</p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => subirArchivos(e.target.files)}
        />
      </div>

      {error && <p className="info-msg error">{error}</p>}

      {value && value.length > 0 && (
        <div className="uploader-thumbnails">
          {value.map((url, index) => (
            <div className="uploader-thumb" key={url + index}>
              <img src={url} alt={`Foto ${index + 1}`} />
              <button
                type="button"
                className="uploader-thumb-quitar"
                onClick={() => handleQuitar(index)}
                title="Quitar esta foto"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
