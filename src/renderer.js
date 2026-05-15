const state = { folderPath: '', rosterCsvPath: '', outputPath: '', gradingCalibration: 'supportive', processed: 0, success: 0, warning: 0, error: 0, total: 1 };
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function updateSummary() {
  $('processedCount').textContent = state.processed;
  $('successCount').textContent = state.success;
  $('warningCount').textContent = state.warning;
  $('errorCount').textContent = state.error;
  $('gradingProgress').max = Math.max(1, state.total || 1);
  $('gradingProgress').value = Math.min(state.processed, state.total || 1);
}

function addLog(type, student, message) {
  const container = $('log');
  const row = document.createElement('div');
  const normalizedType = String(type || 'INFO').toLowerCase();
  row.className = `log-row ${normalizedType}`;
  row.innerHTML = `
    <div class="log-time">${new Date().toLocaleTimeString()}</div>
    <div class="log-type">${escapeHtml(type || 'INFO')}</div>
    <div class="log-student">${escapeHtml(student || '-')}</div>
    <div class="log-message">${escapeHtml(message || '')}</div>
  `;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function resetRunStats(total = 1) {
  state.processed = 0;
  state.success = 0;
  state.warning = 0;
  state.error = 0;
  state.total = total;
  updateSummary();
}

window.graderApi.loadSettings().then(settings => {
  $('baseUrl').value = settings.baseUrl || '';
  $('model').value = settings.model || '';
  $('apiKey').value = settings.apiKey || '';
  $('gradingCalibration').value = settings.gradingCalibration || 'supportive';
  $('concurrencyLimit').value = settings.concurrencyLimit || 3;
  state.gradingCalibration = $('gradingCalibration').value;
  updateCalibrationNote();
});

$('folderBtn').onclick = async () => { const p = await window.graderApi.selectFolder(); if (p) { state.folderPath = p; $('folderPath').textContent = p; } };
$('csvBtn').onclick = async () => { const p = await window.graderApi.selectCsv(); if (p) { state.rosterCsvPath = p; $('csvPath').textContent = p; } };
$('outBtn').onclick = async () => { const p = await window.graderApi.selectOutput(); if (p) { state.outputPath = p; $('outPath').textContent = p; } };
$('clearLog').onclick = () => { $('log').innerHTML = ''; };


function updateCalibrationNote() {
  const value = $('gradingCalibration').value;
  state.gradingCalibration = value;
  const notes = {
    supportive: 'Supportive mode: appropriate for a chill summer pre-talk assignment. Students have not seen the talk yet, so thoughtful preparation and reasonable engagement should usually earn Excellent-level points.',
    balanced: 'Balanced mode: uses the rubric in a standard way. Excellent requires clear engagement, but minor missing depth may still lose points.',
    strict: 'Strict mode: reserves Excellent for very strong, specific, well-developed reflections with clear Industry 5.0 connections.'
  };
  $('calibrationNote').textContent = notes[value] || notes.supportive;
}

$('gradingCalibration').onchange = updateCalibrationNote;

$('saveSettings').onclick = async () => {
  await window.graderApi.saveSettings({
    baseUrl: $('baseUrl').value,
    model: $('model').value,
    apiKey: $('apiKey').value,
    gradingCalibration: $('gradingCalibration').value,
    concurrencyLimit: Number($('concurrencyLimit').value || 3)
  });
  addLog('SUCCESS', 'Settings', 'Settings saved locally, including the API key.');
};

window.graderApi.onProgress(p => {
  if (p.total) state.total = p.total;
  if (p.processed !== undefined) state.processed = p.processed;
  if (p.success !== undefined) state.success = p.success;
  if (p.warning !== undefined) state.warning = p.warning;
  if (p.error !== undefined) state.error = p.error;
  updateSummary();
  addLog(p.type || 'INFO', p.student || '', p.message || `${p.index || ''}/${p.total || ''}: ${p.fileName || ''} | ${p.status || ''}`);
});

$('runBtn').onclick = async () => {
  if (!state.folderPath || !state.rosterCsvPath || !state.outputPath || !$('apiKey').value) {
    addLog('ERROR', 'Setup', 'Missing submission folder, CSV, output path, or API key.');
    return;
  }
  $('runBtn').disabled = true;
  $('log').innerHTML = '';
  resetRunStats(1);
  addLog('INFO', 'Run', 'Starting grading run.');
  try {
    const result = await window.graderApi.gradeFolder({
      folderPath: state.folderPath,
      rosterCsvPath: state.rosterCsvPath,
      outputPath: state.outputPath,
      apiKey: $('apiKey').value,
      baseUrl: $('baseUrl').value,
      model: $('model').value,
      gradingCalibration: $('gradingCalibration').value
    });
    state.processed = result.count || state.processed;
    state.success = result.successes ?? Math.max(0, (result.count || 0) - (result.errors || 0));
    state.warning = result.warnings || 0;
    state.error = result.errors || 0;
    state.total = result.count || state.total;
    updateSummary();
    addLog('DONE', 'Run complete', `Output: ${result.outputPath}. Log output: ${result.logOutputPath || 'not created'}. Files processed: ${result.count}. Successful: ${state.success}. Warnings: ${state.warning}. Errors: ${state.error}.`);
  } catch (e) {
    state.error += 1;
    updateSummary();
    addLog('ERROR', 'Run failed', e.message || String(e));
  } finally {
    $('runBtn').disabled = false;
  }
};

addLog('INFO', 'System', 'Ready.');
