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

  function uid(){
    return 'I' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,6).toUpperCase();
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
    const filterId = document.getElementById('filterInstructor').value;
    const filterDate = document.getElementById('filterDate').value.trim();

    let filtered = [...records].sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
    if(filterId) filtered = filtered.filter(r => r.instructorId === filterId);
    if(filterDate) filtered = filtered.filter(r => r.date === filterDate);

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
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => `
            <tr>
              <td>${escapeHTML(r.name)}</td>
              <td>${escapeHTML(r.career)}</td>
              <td>${escapeHTML(r.schedule)}</td>
              <td>${escapeHTML(r.date)}</td>
              <td>${new Date(r.timestamp).toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
              <td><span class="pill ${r.type}">${r.type === 'entrada' ? 'Ingreso' : 'Salida'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  document.getElementById('filterInstructor').addEventListener('change', renderHistory);
  document.getElementById('filterDate').addEventListener('input', renderHistory);

  document.getElementById('btnExport').addEventListener('click', ()=>{
    if(records.length === 0) return;
    const header = ['Instructor','Carrera_Curso','Horario','Fecha','Hora','Tipo'];
    const rows = [...records].sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp)).map(r => [
      r.name, r.career, r.schedule, r.date,
      new Date(r.timestamp).toLocaleTimeString('es-PE'),
      r.type === 'entrada' ? 'Ingreso' : 'Salida'
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

  // ---------- Init ----------
  populateInstructorFilter();
  renderInstructorList();
  renderHistory();
})();
