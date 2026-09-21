Asistencia QR - archivos separados
===================================

Archivos:
- index.html  -> estructura y contenido de la página
- style.css   -> todos los estilos
- script.js   -> toda la lógica (cámara, QR, admin, historial)

Cómo usarlo:
1. Guarda los 3 archivos (y este README si quieres) en la MISMA carpeta.
2. Abre index.html con doble clic en tu navegador.
3. IMPORTANTE: la cámara (tanto "Iniciar cámara" como "Tomar foto") NO
   funciona si abres el archivo directamente con doble clic (file://),
   porque los navegadores bloquean el acceso a la cámara por seguridad
   en ese modo. La app ahora te avisa esto en pantalla si pasa.
   Para que la cámara funcione, tienes dos opciones:
     a) Súbelo a un hosting/servidor real (http/https).
     b) Ábrelo con un servidor local, por ejemplo con Python:
          python3 -m http.server 8000
        y entra desde el navegador a http://localhost:8000
   Mientras tanto, la opción "Sube una imagen guardada" dentro del
   modal de foto SÍ funciona incluso abriendo el archivo directamente.
