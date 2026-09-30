/**
 * API client for the Synthetic Data Platform backend.
 * All API calls go through this module.
 */

const API_BASE = '/api';

/**
 * Generic fetch wrapper with error handling.
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${res.status}: ${res.statusText}`);
    }

    return res;
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      throw new Error('Cannot connect to backend. Is the server running?');
    }
    throw err;
  }
}

async function jsonRequest(endpoint, options = {}) {
  const res = await request(endpoint, options);
  return res.json();
}

async function blobRequest(endpoint, options = {}) {
  const res = await request(endpoint, options);
  return res.blob();
}

/** Download a blob as a file, prompting the user for location when supported */
async function downloadBlob(blob, filename, mimeType) {
  const finalBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;
  const ext = filename.split('.').pop().toLowerCase();

  // Try modern File System Access API (prompts user for Save As location)
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const typeAccept = {};
      typeAccept[mimeType || 'application/octet-stream'] = [`.${ext}`];
      
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: `${ext.toUpperCase()} File (*.${ext})`,
            accept: typeAccept,
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(finalBlob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') {
        // User deliberately cancelled Save As dialog
        return;
      }
      console.warn('showSaveFilePicker failed or unsupported, using standard download:', err);
    }
  }

  // Fallback to standard <a> download
  const url = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }, 60000);
}

// ── Health ──
export async function checkHealth() {
  return jsonRequest('/health');
}

// ── Tabular ──
export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  return jsonRequest('/v1/tabular/profile', {
    method: 'POST',
    body: formData,
  });
}

export async function generateTabular(config) {
  return jsonRequest('/v1/tabular/generate', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function exportTabular(config) {
  const fmt = (config.format || 'csv').toLowerCase();
  const blob = await blobRequest('/v1/tabular/export', {
    method: 'POST',
    body: JSON.stringify({ ...config, format: fmt }),
  });

  let filename = 'synthetia_data.csv';
  let mimeType = 'text/csv';

  if (fmt === 'excel' || fmt === 'xlsx') {
    filename = 'synthetia_data.xlsx';
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (fmt === 'json') {
    filename = 'synthetia_data.json';
    mimeType = 'application/json';
  } else {
    filename = 'synthetia_data.csv';
    mimeType = 'text/csv';
  }

  downloadBlob(blob, filename, mimeType);
}

export async function getQualityReport(config) {
  return jsonRequest('/v1/tabular/quality', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function getFidelityReport(config) {
  return jsonRequest('/quality/report', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// ── Sample Datasets ──
export async function listSamples() {
  return jsonRequest('/samples');
}

export async function loadSample(name) {
  return jsonRequest(`/samples/${name}/load`, {
    method: 'POST',
  });
}

// ── Relational ──
export async function getRelationalSampleInfo() {
  return jsonRequest('/relational/sample');
}

export async function learnRelational(data) {
  if (data instanceof FormData) {
    return jsonRequest('/relational/learn', {
      method: 'POST',
      body: data,
    });
  }
  return jsonRequest('/relational/learn', {
    method: 'POST',
    body: JSON.stringify(data || { use_sample: true }),
  });
}

export async function generateRelational(config) {
  return jsonRequest('/v1/relational/generate', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function exportRelational(config) {
  const fmt = (config.format || 'zip').toLowerCase();
  const blob = await blobRequest('/v1/relational/export', {
    method: 'POST',
    body: JSON.stringify({ ...config, format: fmt }),
  });
  const ext = fmt === 'sql' ? 'sql' : 'zip';
  const mimeType = fmt === 'sql' ? 'text/plain' : 'application/zip';
  downloadBlob(blob, `synthetia_relational.${ext}`, mimeType);
}

// ── Documents ──
export async function generateInvoice(config) {
  return jsonRequest('/v1/documents/invoice/generate', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function exportInvoice(config) {
  const blob = await blobRequest('/v1/documents/invoice/export', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  const fmt = (config.format || 'pdf').toLowerCase();
  const isZip = config.count > 1;
  const ext = isZip ? 'zip' : fmt === 'json' ? 'json' : 'pdf';
  const mimeType = isZip
    ? 'application/zip'
    : fmt === 'json'
    ? 'application/json'
    : 'application/pdf';
  downloadBlob(blob, `invoice.${ext}`, mimeType);
}

export async function generateStatement(config) {
  return jsonRequest('/v1/documents/statement/generate', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function exportStatement(config) {
  const fmt = (config.format || 'pdf').toLowerCase();
  const blob = await blobRequest('/v1/documents/statement/export', {
    method: 'POST',
    body: JSON.stringify({ ...config, format: fmt }),
  });
  const ext = fmt === 'csv' ? 'csv' : fmt === 'json' ? 'json' : 'pdf';
  const mimeType =
    fmt === 'csv'
      ? 'text/csv;charset=utf-8'
      : fmt === 'json'
      ? 'application/json'
      : 'application/pdf';
  downloadBlob(blob, `bank_statement.${ext}`, mimeType);
}

// ── Clone / Mimic Document from PDF ──
export async function cloneDocument(file, seed = 42) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('seed', seed);
  return jsonRequest('/v1/documents/clone', {
    method: 'POST',
    body: formData,
  });
}

// ── AI ──
export async function inferSchema(description) {
  return jsonRequest('/v1/ai/infer-schema', {
    method: 'POST',
    body: JSON.stringify({ description }),
  });
}

export async function getEdgeCases(schema) {
  return jsonRequest('/v1/ai/edge-cases', {
    method: 'POST',
    body: JSON.stringify({ schema }),
  });
}

// ── Admin ──
export async function adminAuth(secret) {
  return jsonRequest('/v1/admin/auth', {
    method: 'POST',
    body: JSON.stringify({ secret }),
  });
}

export async function getAdminHealth() {
  return jsonRequest('/v1/admin/health');
}

export async function getAuditLog() {
  return jsonRequest('/v1/admin/audit-log');
}

export async function generateApiKey(label) {
  return jsonRequest('/v1/admin/api-keys/generate', {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export async function listApiKeys() {
  return jsonRequest('/v1/admin/api-keys');
}

export async function revokeApiKey(key) {
  return jsonRequest('/v1/admin/api-keys/revoke', {
    method: 'POST',
    body: JSON.stringify({ key }),
  });
}
