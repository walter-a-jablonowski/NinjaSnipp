<?php

use SnippetManager\Sources;
use SnippetManager\UserStore;

require_once 'vendor/autoload.php';
require_once 'lib/functions.php';

// The Win app's popup ("Win app/dev/win_app_plan.md"): a snippet picker and a fill view, shown in
// a WebView2 by the Win app, which inserts the text where the user was typing. Opened in a normal
// browser it copies the text instead.

$settings = ( new UserStore( APP_ROOT . '/' . user_dir()))->getSettings();
$theme    = $settings['theme'] ?? 'light';
$sources  = new Sources( $settings['dataPaths'] ?? ['data'], __DIR__);

// Fill view tabs: the form (maybe and vars tables) first, the snippet with its inline placeholders
$fillTabs = ['form' => 'Form', 'snippet' => 'Snippet'];

?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ninja snippets</title>
  <script>
    // Theme as in the manager (light, dark or system), set before the page shows
    (() => {
      const pref = <?= json_encode($theme) ?>;
      const mode = pref === 'dark' || (pref !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', mode);
      document.documentElement.setAttribute('data-bs-theme', mode);
    })();
  </script>
  <link href="<?= asset_url('lib/ext/bootstrap.min.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('lib/ext/bootstrap-icons.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/theme.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/theme-dark.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/app.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/win.css') ?>" rel="stylesheet">
</head>
<body class="win-app">

  <!-- Picker -->
  <section id="pickView" class="win-view" hidden>
    <div class="win-bar">
      <input type="search" id="pickFilter" class="form-control form-control-sm" placeholder="Filter snippets ..." autocomplete="off" spellcheck="false" aria-label="Filter snippets">
      <select id="pickDataSet" class="form-select form-select-sm" aria-label="Data set">
        <option value="">All data sets</option>
        <?php foreach( array_keys($sources->getDataSets()) as $label ): ?>
          <option value="<?= htmlspecialchars($label) ?>"><?= htmlspecialchars($label) ?></option>
        <?php endforeach; ?>
      </select>
    </div>
    <div id="pickNote" class="win-note" hidden></div>
    <div id="pickList" class="win-list" role="listbox" aria-label="Snippets"></div>
    <div class="win-hint">↑↓ select · Enter insert · Esc close</div>
  </section>

  <!-- Fill view: placeholders and MAYBE blocks, the result editable -->
  <section id="fillView" class="win-view" hidden>
    <div class="win-bar">
      <button type="button" id="fillBack" class="btn btn-sm btn-outline-secondary" title="Back to the list" aria-label="Back to the list">
        <i class="bi bi-arrow-left"></i>
      </button>
      <div class="win-title">
        <span id="fillName"></span>
        <code id="fillSc"></code>
        <span id="fillDataSet" class="win-chip"></span>
      </div>
    </div>
    <div class="win-fill-body">
      <div id="fillShort" class="win-short"></div>
      <ul class="nav nav-tabs win-tabs" id="fillTabs" role="tablist">
        <?php foreach( $fillTabs as $tab => $label ): ?>
          <li class="nav-item" role="presentation">
            <button type="button" class="nav-link" data-tab="<?= $tab ?>" role="tab"><?= $label ?></button>
          </li>
        <?php endforeach; ?>
      </ul>
      <div class="win-tab-pane" data-pane="form">
        <div id="renderUsage" class="usage-preview"></div>
      </div>
      <div class="win-tab-pane" data-pane="snippet">
        <div id="inlineSnippet" class="inline-snippet"></div>
      </div>
      <div class="win-result-head">
        <label for="fillText">Result</label>
        <span id="fillEdited" hidden>
          edited by hand, changes in the form no longer apply ·
          <a href="#" id="fillReset">reset</a>
        </span>
      </div>
      <textarea id="fillText" class="form-control form-control-sm" rows="6" spellcheck="false"></textarea>
    </div>
    <div class="win-actions">
      <span class="win-hint">Ctrl+Enter insert · Esc close</span>
      <button type="button" id="fillCancel" class="btn btn-sm btn-secondary">Cancel</button>
      <button type="button" id="fillInsert" class="btn btn-sm btn-primary">Insert</button>
    </div>
  </section>

  <!-- Choice menu for placeholders (shown on demand) -->
  <div id="phChoiceMenu" class="dropdown-menu" tabindex="-1"></div>

  <div id="alertStack" class="alert-stack" aria-live="polite"></div>

  <script src="<?= asset_url('lib/ext/bootstrap.bundle.min.js') ?>"></script>
  <script src="<?= asset_url('lib/functions.js') ?>"></script>
  <script src="<?= asset_url('lib/snippet-form.js') ?>"></script>
  <script src="<?= asset_url('controllers/win.js') ?>"></script>
  <script>
    document.addEventListener('DOMContentLoaded', () => new WinController());
  </script>
</body>
</html>
