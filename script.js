(function(){
"use strict";

  // ---------- Storage helpers ----------
  const LS_INSTR = "asistencia_qr_instructors";
  const LS_REC = "asistencia_qr_records";

  function loadJSON(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed;
    }catch(e){
      console.error("Error leyendo almacenamiento:", e);
      return fallback;
    }
  }
  function saveJSON(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }
    catch(e){ console.error("Error guardando almacenamiento:", e); }
  }

  let instructors = loadJSON(LS_INSTR, []);
  let records = loadJSON(LS_REC, []);

  const LS_ADMIN_HASH = "asistencia_qr_admin_hash";
  const SS_ADMIN_ON = "asistencia_qr_admin_session";
  const GRACE_MIN = 10; // minutos de tolerancia antes de marcar tarde/anticipado
  let isAdmin = sessionStorage.getItem(SS_ADMIN_ON) === '1';

  function simpleHash(str){
    // Ofuscación simple en el propio navegador. No es cifrado de nivel de
    // seguridad; sirve solo para evitar que cualquiera toque el panel por error.
    try{ return btoa(unescape(encodeURIComponent(str))); }
    catch(e){ return str; }
  }

  function uid(){
    return 'I' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
  }

  // ---------- Puntualidad ----------
  function toMinutes(hhmm){
    if(!hhmm || hhmm.indexOf(':') === -1) return null;
    const [h,m] = hhmm.split(':').map(Number);
    if(Number.isNaN(h) || Number.isNaN(m)) return null;
    return h*60+m;
  }

  function computePunctuality(record){
    const d = new Date(record.timestamp);
    const scanMinutes = d.getHours()*60 + d.getMinutes();

    if(record.type === 'entrada'){
      const scheduled = toMinutes(record.from);
      if(scheduled === null) return { label:'Ingreso registrado', cls:'ok' };
      const diff = scanMinutes - scheduled;
      if(diff <= GRACE_MIN) return { label:'A tiempo', cls:'ok' };
      return { label:`Tarde (+${diff} min)`, cls:'late' };
    }

    const scheduled = toMinutes(record.to);
    if(scheduled === null) return { label:'Salida registrada', cls:'ok' };
    const diff = scanMinutes - scheduled;
    if(diff < -GRACE_MIN) return { label:'Salida anticipada', cls:'early' };
    if(diff > GRACE_MIN) return { label:`Tiempo extra (+${diff} min)`, cls:'extra' };
    return { label:'A tiempo', cls:'ok' };
  }

  // ---------- Clock ----------
  function tickClock(){
    const now = new Date();
    document.getElementById('clockTime').textContent = now.toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    document.getElementById('clockDate').textContent = now.toLocaleDateString('es-PE', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- Tabs ----------
  const tabs = document.querySelectorAll('nav.tabs button');
  const views = document.querySelectorAll('.view');
  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      views.forEach(v=>v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-'+btn.dataset.view).classList.add('active');
      if(btn.dataset.view === 'instructors') renderInstructorList();
      if(btn.dataset.view === 'history') renderHistory();
      if(btn.dataset.view !== 'scan') stopCamera();
    });
  });

  // ---------- Registrar instructor ----------
  const form = document.getElementById('formInstructor');
  const badgePreview = document.getElementById('badgePreview');

  function renderBadge(instructor){
    badgePreview.innerHTML = `
      <div id="qr-render"></div>
      <div class="bname">${escapeHTML(instructor.name)}</div>
      <div class="bmeta">
        ${escapeHTML(instructor.career)}<br>
        ${escapeHTML(instructor.days || 'Horario no especificado')} · ${escapeHTML(instructor.from)}–${escapeHTML(instructor.to)}
        ${instructor.room ? '<br>Ambiente: '+escapeHTML(instructor.room) : ''}
      </div>
      <div class="btn-row">
        <button class="btn secondary" type="button" id="btnDownloadQR">Descargar QR</button>
      </div>
    `;
    // eslint-disable-next-line no-undef
    new QRCode(document.getElementById('qr-render'), {
      text: instructor.id,
      width: 220,
      height: 220,
      colorDark: "#000000",
      colorLight: "#FFFFFF",
      correctLevel: QRCode.CorrectLevel.H
    });
    setTimeout(()=>{
      const btn = document.getElementById('btnDownloadQR');
      if(!btn) return;
      btn.addEventListener('click', ()=>{
        const canvas = badgePreview.querySelector('canvas');
        if(!canvas) return;
        const link = document.createElement('a');
        link.download = `qr-${instructor.name.replace(/\s+/g,'_')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      });
    }, 50);
  }

  function escapeHTML(str){
    return String(str ?? '').replace(/[&<>"']/g, s => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[s]));
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const instructor = {
      id: uid(),
      name: document.getElementById('fName').value.trim(),
      career: document.getElementById('fCareer').value.trim(),
      days: document.getElementById('fDays').value.trim(),
      room: document.getElementById('fRoom').value.trim(),
      from: document.getElementById('fFrom').value,
      to: document.getElementById('fTo').value,
    };
    if(!instructor.name || !instructor.career || !instructor.from || !instructor.to) return;
    instructors.push(instructor);
    saveJSON(LS_INSTR, instructors);
    renderBadge(instructor);
    populateInstructorFilter();
    form.reset();
  });

  document.getElementById('btnClearForm').addEventListener('click', ()=> form.reset());

  // ---------- Instructores: listado ----------
  function renderInstructorList(){
    const list = document.getElementById('instrList');
    if(instructors.length === 0){
      list.innerHTML = '<li style="border:none; padding:30px 4px; color:var(--ink-soft); font-size:13.5px;">Aún no hay instructores registrados. Ve a la pestaña "Registrar instructor" para crear el primero.</li>';
      return;
    }
    list.innerHTML = instructors.map(ins => `
      <li>
        <div>
          <div class="iname">${escapeHTML(ins.name)}</div>
          <div class="imeta">${escapeHTML(ins.career)} · ${escapeHTML(ins.days || 'sin días definidos')} · ${escapeHTML(ins.from)}–${escapeHTML(ins.to)}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="icon-btn" data-view-qr="${ins.id}">Ver QR</button>
          <button class="icon-btn danger" data-del="${ins.id}">Eliminar</button>
        </div>
      </li>
    `).join('');

    list.querySelectorAll('[data-view-qr]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const ins = instructors.find(i=>i.id === btn.dataset.viewQr);
        if(!ins) return;
        document.querySelector('nav.tabs button[data-view="register"]').click();
        renderBadge(ins);
      });
    });
    list.querySelectorAll('[data-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!confirm('¿Eliminar a este instructor? No se borrará su historial ya registrado.')) return;
        instructors = instructors.filter(i=>i.id !== btn.dataset.del);
        saveJSON(LS_INSTR, instructors);
        renderInstructorList();
        populateInstructorFilter();
      });
    });
  }

  // ---------- Escaneo ----------
  const video = document.getElementById('video');
  const camStatus = document.getElementById('camStatus');
  const btnStart = document.getElementById('btnStartCam');
  const btnStop = document.getElementById('btnStopCam');
  const resultBox = document.getElementById('resultBox');

  let stream = null;
  let scanning = false;
  let lastScan = { id:null, time:0 };
  const scanCanvas = document.createElement('canvas');
  const scanCtx = scanCanvas.getContext('2d', { willReadFrequently:true });

  async function startCamera(){
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      scanning = true;
      btnStart.disabled = true;
      btnStop.disabled = false;
      camStatus.textContent = 'Cámara activa — buscando código QR…';
      requestAnimationFrame(scanLoop);
    }catch(err){
      camStatus.textContent = 'No se pudo acceder a la cámara. Revisa los permisos del navegador.';
      console.error(err);
    }
  }

  function stopCamera(){
    scanning = false;
    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream = null;
    }
    btnStart.disabled = false;
    btnStop.disabled = true;
    camStatus.textContent = 'Cámara detenida';
  }

  function scanLoop(){
    if(!scanning) return;
    if(video.readyState === video.HAVE_ENOUGH_DATA){
      scanCanvas.width = video.videoWidth;
      scanCanvas.height = video.videoHeight;
      scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
      const imgData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      // eslint-disable-next-line no-undef
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "dontInvert" });
      if(code && code.data){
        handleScan(code.data.trim());
      }
    }
    requestAnimationFrame(scanLoop);
  }

  function handleScan(scannedId){
    const now = Date.now();
    if(scannedId === lastScan.id && (now - lastScan.time) < 4000) return; // evita doble lectura
    lastScan = { id: scannedId, time: now };

    const instructor = instructors.find(i => i.id === scannedId);
    if(!instructor){
      showResult(null, null);
      camStatus.textContent = 'Código no reconocido. Este QR no corresponde a ningún instructor registrado.';
      return;
    }

    const today = new Date();
    const todayStr = todayISO(today);
    const todaysRecords = records.filter(r => r.instructorId === instructor.id && r.date === todayStr);
    const lastToday = todaysRecords[todaysRecords.length - 1];
    const type = (!lastToday || lastToday.type === 'salida') ? 'entrada' : 'salida';

    const record = {
      instructorId: instructor.id,
      name: instructor.name,
      career: instructor.career,
      schedule: `${instructor.from}–${instructor.to}`,
      from: instructor.from,
      to: instructor.to,
      type,
      date: todayStr,
      timestamp: today.toISOString(),
    };
    records.push(record);
    saveJSON(LS_REC, records);

    showResult(instructor, record);
    camStatus.textContent = 'Cámara activa — buscando código QR…';
  }

  function todayISO(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function showResult(instructor, record){
    resultBox.classList.remove('entrada','salida');
    if(!instructor){
      resultBox.innerHTML = '<span class="placeholder">Código QR no reconocido. Verifica que el instructor esté registrado.</span>';
      return;
    }
    resultBox.classList.add(record.type);
    const time = new Date(record.timestamp).toLocaleTimeString('es-PE', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    resultBox.innerHTML = `
      <span class="tag">${record.type === 'entrada' ? 'Ingreso registrado' : 'Salida registrada'}</span>
      <div class="rname">${escapeHTML(instructor.name)}</div>
      <div class="rmeta">
        ${escapeHTML(instructor.career)}<br>
        Horario: ${escapeHTML(instructor.from)}–${escapeHTML(instructor.to)} ${instructor.room ? '· '+escapeHTML(instructor.room) : ''}
      </div>
      <div class="rtime">${time}</div>
    `;
  }

  btnStart.addEventListener('click', startCamera);
  btnStop.addEventListener('click', stopCamera);

  // ---------- Escaneo desde foto / imagen subida ----------
  const fileInput = document.getElementById('qrFileInput');
  fileInput.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = ()=>{
      const photoCanvas = document.createElement('canvas');
      photoCanvas.width = img.naturalWidth;
      photoCanvas.height = img.naturalHeight;
      const photoCtx = photoCanvas.getContext('2d');
      photoCtx.drawImage(img, 0, 0);

      const imgData = photoCtx.getImageData(0, 0, photoCanvas.width, photoCanvas.height);
      // eslint-disable-next-line no-undef
      const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });

      if(code && code.data){
        handleScan(code.data.trim());
        camStatus.textContent = 'Código leído desde la foto.';
      } else {
        showResult(null, null);
        camStatus.textContent = 'No se encontró un código QR en la foto. Intenta con más luz, más cerca y sin que el QR salga cortado.';
      }
      URL.revokeObjectURL(objectUrl);
    };

    img.onerror = ()=>{
      camStatus.textContent = 'No se pudo abrir la imagen seleccionada.';
      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;
    fileInput.value = ''; // permite volver a elegir la misma foto si hace falta reintentar
  });

  // ---------- Historial ----------
  function populateInstructorFilter(){
    const sel = document.getElementById('filterInstructor');
    const current = sel.value;
    sel.innerHTML = '<option value="">Todos los instructores</option>' +
      instructors.map(i => `<option value="${i.id}">${escapeHTML(i.name)}</option>`).join('');
    sel.value = current;
  }

  function renderHistory(){
    const wrap = document.getElementById('historyTableWrap');
    const filterDate = document.getElementById('filterDate').value.trim();

    let filtered = [...records].sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
    if(filterDate) filtered = filtered.filter(r => r.date === filterDate);

    if(isAdmin){
      const filterId = document.getElementById('filterInstructor').value;
      if(filterId) filtered = filtered.filter(r => r.instructorId === filterId);
      renderHistoryAdmin(wrap, filtered);
    } else {
      renderHistoryPublic(wrap, filtered);
    }
  }

  function renderHistoryPublic(wrap, filtered){
    if(filtered.length === 0){
      wrap.innerHTML = '<div class="empty-state">Todavía no hay asistencia registrada.</div>';
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => {
            const p = computePunctuality(r);
            return `
            <tr>
              <td>${escapeHTML(r.name)}</td>
              <td>${escapeHTML(r.date)}</td>
              <td>${new Date(r.timestamp).toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit'})}</td>
              <td><span class="pill ${p.cls}">${escapeHTML(p.label)}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function renderHistoryAdmin(wrap, filtered){
    if(filtered.length === 0){
      wrap.innerHTML = '<div class="empty-state">No hay registros de asistencia todavía para este filtro.</div>';
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Instructor</th>
            <th>Carrera / curso</th>
            <th>Horario</th>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Tipo</th>
            <th>Puntualidad</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => {
            const p = computePunctuality(r);
            return `
            <tr>
              <td>${escapeHTML(r.name)}</td>
              <td>${escapeHTML(r.career)}</td>
              <td>${escapeHTML(r.schedule)}</td>
              <td>${escapeHTML(r.date)}</td>
              <td>${new Date(r.timestamp).toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
              <td><span class="pill ${r.type}">${r.type === 'entrada' ? 'Ingreso' : 'Salida'}</span></td>
              <td><span class="pill ${p.cls}">${escapeHTML(p.label)}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('filterInstructor').addEventListener('change', renderHistory);
  document.getElementById('filterDate').addEventListener('input', renderHistory);

  document.getElementById('btnExport').addEventListener('click', ()=>{
    if(records.length === 0) return;
    const header = ['Instructor','Carrera_Curso','Horario','Fecha','Hora','Tipo','Puntualidad'];
    const rows = [...records].sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp)).map(r => [
      r.name, r.career, r.schedule, r.date,
      new Date(r.timestamp).toLocaleTimeString('es-PE'),
      r.type === 'entrada' ? 'Ingreso' : 'Salida',
      computePunctuality(r).label
    ]);
    const csv = [header, ...rows].map(row =>
      row.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')
    ).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `asistencia_${todayISO(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btnClearHistory').addEventListener('click', ()=>{
    if(!confirm('¿Borrar todo el historial de asistencia? Esta acción no se puede deshacer.')) return;
    records = [];
    saveJSON(LS_REC, records);
    renderHistory();
  });

  // ---------- Acceso de administrador ----------
  const adminOverlay = document.getElementById('adminModalOverlay');
  const adminTitle = document.getElementById('adminModalTitle');
  const adminHint = document.getElementById('adminModalHint');
  const adminPassInput = document.getElementById('adminPassInput');
  const adminConfirmWrap = document.getElementById('adminConfirmWrap');
  const adminPassConfirm = document.getElementById('adminPassConfirm');
  const adminError = document.getElementById('adminModalError');
  const adminToggleBtn = document.getElementById('adminToggleBtn');
  const historyAdminControls = document.getElementById('historyAdminControls');

  function openAdminModal(){
    const hasPass = !!localStorage.getItem(LS_ADMIN_HASH);
    adminError.style.display = 'none';
    adminPassInput.value = '';
    adminPassConfirm.value = '';
    if(hasPass){
      adminTitle.textContent = 'Acceso de administrador';
      adminHint.textContent = 'Ingresa la contraseña de administrador para continuar.';
      adminConfirmWrap.style.display = 'none';
    } else {
      adminTitle.textContent = 'Crear contraseña de administrador';
      adminHint.textContent = 'Primera vez: define una contraseña para proteger "Registrar instructor", "Instructores" y el historial completo.';
      adminConfirmWrap.style.display = 'block';
    }
    adminOverlay.style.display = 'flex';
    adminPassInput.focus();
  }

  function closeAdminModal(){
    adminOverlay.style.display = 'none';
  }

  function updateAdminUI(){
    document.querySelectorAll('.admin-only-tab').forEach(el=>{
      el.style.display = isAdmin ? 'inline-block' : 'none';
    });
    historyAdminControls.style.display = isAdmin ? 'flex' : 'none';
    adminToggleBtn.textContent = isAdmin ? 'Cerrar sesión admin' : 'Acceso administrador';
    if(!isAdmin){
      const activeBtn = document.querySelector('nav.tabs button.active');
      if(activeBtn && (activeBtn.dataset.view === 'register' || activeBtn.dataset.view === 'instructors')){
        document.querySelector('nav.tabs button[data-view="scan"]').click();
      }
    }
    renderHistory();
  }

  adminToggleBtn.addEventListener('click', ()=>{
    if(isAdmin){
      isAdmin = false;
      sessionStorage.removeItem(SS_ADMIN_ON);
      updateAdminUI();
    } else {
      openAdminModal();
    }
  });

  document.getElementById('adminModalCancel').addEventListener('click', closeAdminModal);
  adminOverlay.addEventListener('click', (e)=>{ if(e.target === adminOverlay) closeAdminModal(); });

  document.getElementById('adminModalSubmit').addEventListener('click', ()=>{
    const hasPass = !!localStorage.getItem(LS_ADMIN_HASH);
    const pass = adminPassInput.value;

    if(!pass){
      adminError.textContent = 'Ingresa una contraseña.';
      adminError.style.display = 'block';
      return;
    }

    if(hasPass){
      const storedHash = localStorage.getItem(LS_ADMIN_HASH);
      if(simpleHash(pass) !== storedHash){
        adminError.textContent = 'Contraseña incorrecta.';
        adminError.style.display = 'block';
        return;
      }
    } else {
      if(pass.length < 4){
        adminError.textContent = 'Usa al menos 4 caracteres.';
        adminError.style.display = 'block';
        return;
      }
      if(pass !== adminPassConfirm.value){
        adminError.textContent = 'Las contraseñas no coinciden.';
        adminError.style.display = 'block';
        return;
      }
      localStorage.setItem(LS_ADMIN_HASH, simpleHash(pass));
    }

    isAdmin = true;
    sessionStorage.setItem(SS_ADMIN_ON, '1');
    closeAdminModal();
    updateAdminUI();
    document.querySelector('nav.tabs button[data-view="register"]').click();
  });

  [adminPassInput, adminPassConfirm].forEach(input=>{
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter') document.getElementById('adminModalSubmit').click();
    });
  });

  // ---------- Init ----------
  populateInstructorFilter();
  renderInstructorList();
  updateAdminUI();
})();
