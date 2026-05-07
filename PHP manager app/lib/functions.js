// Global helper functions for NinjaSnipp front-end
// Keep this file framework-agnostic and easy to read.

// API call helper. Always pass currentDataPath from the caller context.
async function apiCall(currentDataPath, action, data = {})
{
  try {
    const response = await fetch('ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, dataPath: currentDataPath, ...data })
    });
    return await response.json();
  }
  catch( error ) {
    console.error('API call failed:', error);
    return { success: false, message: 'Network error' };
  }
}

function showLoading(elementId)
{
  const element = document.getElementById(elementId);
  if( element ) element.classList.add('loading');
}

function hideLoading(elementId)
{
  const element = document.getElementById(elementId);
  if( element ) element.classList.remove('loading');
}

function showModal(modalId)
{
  try {
    const modal = new bootstrap.Modal(document.getElementById(modalId));
    modal.show();
  }
  catch(e) {
    // BS unavailable
  }
}

function activateTab(tabButtonId)
{
  const btn = document.getElementById(tabButtonId);
  if( ! btn ) return;
  try {
    const tab = new bootstrap.Tab(btn);
    tab.show();
  }
  catch(e) {
    // Nix if BS is unavailable
  }
}

function showSuccess(message)
{
  showAlert(message, 'success');
}

function showError(message)
{
  showAlert(message, 'danger');
}

function showAlert(message, type)
{
  const alertHtml = `
    <div class="alert alert-${type} alert-floating alert-dismissible fade show" role="alert">
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', alertHtml);
  setTimeout(() => {
    const alert = document.querySelector('.alert-floating');
    if( alert ) {
      try {
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();
      }
      catch(e) {
        alert.remove();
      }
    }
  }, 5000);
}

function escapeHtml(text)
{
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Wrapper: parse markdown, add .no-indent to <ul>, and unwrap <p> inside <li>
// (marked.js wraps loose-list items in <p>, causing extra spacing and blank lines on copy)
function parseMd( src )
{
  const html = marked.parse(src).replace(/<ul>/g, '<ul class="no-indent">');
  const tmp  = document.createElement('div');
  tmp.innerHTML = html;

  tmp.querySelectorAll('li').forEach(li => {
    const ps = Array.from(li.querySelectorAll(':scope > p'));
    ps.forEach((p, i) => {
      const frag = document.createDocumentFragment();
      while( p.firstChild ) frag.appendChild(p.firstChild);
      if( i < ps.length - 1 ) frag.appendChild(document.createElement('br'));
      p.replaceWith(frag);
    });
  });

  return tmp.innerHTML;
}

function timeAgo(timestamp)
{
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours   = Math.floor(diff / 3600000);
  const days    = Math.floor(diff / 86400000);
  if( minutes < 1 ) return 'Just now';
  if( minutes < 60 ) return `${minutes}m ago`;
  if( hours < 24 )   return `${hours}h ago`;
  return `${days}d ago`;
}
