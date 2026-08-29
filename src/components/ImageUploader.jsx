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
export default function ImageUploader({ adminKey, value, onChange }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [sobreZona, setSobreZona] = useState(false);
  const inputRef = useRef(null);

  async function subirArchivos(archivos) {
    setError('');
    const lista = Array.from(archivos || []);
    if (lista.length === 0) return;

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
        const resultado = await subirFoto({
          adminKey,
          nombreArchivo: archivo.name,
          tipoMime: archivo.type,
          datosBase64,
        });
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
