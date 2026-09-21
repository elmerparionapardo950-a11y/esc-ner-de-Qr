Asistencia QR - archivos separados
===================================

Archivos:
- index.html  -> estructura y contenido de la página
- style.css   -> todos los estilos
- script.js   -> toda la lógica (cámara, QR, admin, historial)

Cómo usarlo:
1. Guarda los 3 archivos (y este README si quieres) en la MISMA carpeta.
2. Abre index.html con doble clic en tu navegador.
3. Para que la cámara funcione, el navegador puede pedir permiso; en algunos
   navegadores la cámara solo funciona si abres el archivo por https:// o
   localhost, no como archivo local (file://). Si la cámara no carga al
   abrirlo directamente, prueba sirviéndolo con un servidor local simple,
   por ejemplo con Python: 
     python3 -m http.server 8000
   y luego entra desde el navegador a http://localhost:8000
