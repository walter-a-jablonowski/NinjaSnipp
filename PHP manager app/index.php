<?php

use SnippetManager\Sources;
use SnippetManager\UserStore;

require_once 'vendor/autoload.php';
require_once 'lib/functions.php';


$appConfig = app_config();
$debug     = (bool)($appConfig['debug']['on'] ?? false);
$allBtns   = (bool)($appConfig['debug']['showAllFileBtns'] ?? false);

$settings     = ( new UserStore( APP_ROOT . '/' . user_dir()))->getSettings();
$initialTheme = $settings['theme'] ?? 'light';
$sources      = new Sources( $settings['dataPaths'] ?? ['data'], __DIR__);

// Optional URL param: select initial data folder by label key from config (e.g., ?data=Demo%201)
if( isset($_GET['data']) )
  $sources->select((string)$_GET['data']);

// Snippet columns, switchable via pills on mobile (one column at a time)
$fieldPanes = ['usage' => 'Usage', 'content' => 'Content'];

?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ninja</title>
  <link href="<?= asset_url('lib/ext/bootstrap.min.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('lib/ext/bootstrap-icons.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/theme.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/theme-dark.css') ?>" rel="stylesheet">
  <link href="<?= asset_url('styles/app.css') ?>" rel="stylesheet">
</head>
<body>
  <!-- Header -->
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary sticky-top">
    <div class="container-fluid">
      <button class="navbar-toggler ps-0 pe-0 me-2 d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarNav" aria-controls="sidebarNav" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="dropdown">
        <a class="navbar-brand d-flex align-items-center" href="#" data-bs-toggle="dropdown" aria-expanded="false">
          <i class="bi bi-code-square me-2 fs-4 d-none d-sm-inline"></i>
          <span class="fw-bold brand-full">Ninja</span>
          <span class="brand-full brand-source" id="brandDataLabel"><?= htmlspecialchars($sources->getCurrentLabel()) ?></span>
          <span class="fw-bold brand-short brand-source" id="brandDataLabelMobile"><?= htmlspecialchars($sources->getCurrentLabel()) ?></span>
          <i class="bi bi-chevron-down brand-chevron"></i>
        </a>
        <ul class="dropdown-menu" id="dataFolderDropdown" data-current="<?= htmlspecialchars($sources->getCurrentLabel()) ?>">
          <?php foreach( array_keys($sources->getDataSets()) as $label ): ?>
            <li>
              <a class="dropdown-item<?= $label === $sources->getCurrentLabel() ? ' active' : '' ?>" href="#" data-label="<?= htmlspecialchars($label) ?>">
                <?= htmlspecialchars($label) ?>
              </a>
            </li>
          <?php endforeach; ?>
        </ul>
      </div>
      
      <div class="navbar-nav ms-auto d-flex flex-row align-items-center gap-2">
        <div class="nav-item">
          <div class="input-group">
            <input type="text" class="form-control" id="searchInput" placeholder="Search ..." autocomplete="off">
            <button class="btn btn-outline-light" type="button" id="searchBtn">
              <i class="bi bi-search"></i>
            </button>
          </div>
        </div>
        <div class="nav-item">
          <button class="btn btn-outline-light" type="button" id="aiBtn">AI</button>
        </div>
        <div class="nav-item d-none d-lg-flex">
          <button class="btn btn-outline-light" type="button" id="themeToggleBtn" title="Toggle theme" aria-label="Toggle theme">
            <i class="bi bi-moon-stars"></i>
          </button>
        </div>
      </div>
    </div>
  </nav>

  <!-- Search History Dropdown -->
  <div id="searchHistory" class="dropdown-menu position-absolute" style="display: none; z-index: 1050;"></div>

  <div class="app-shell layout">
      <!-- Sidebar / Offcanvas (overlay on <lg, static on >=lg) -->
      <div class="app-sidebar">
        <div id="sidebarResizeHandle" title="Drag to resize · Double-click to reset"></div>
        <div class="offcanvas offcanvas-start offcanvas-lg" tabindex="-1" id="sidebarNav" aria-labelledby="sidebarNavLabel">
          <div class="offcanvas-header border-bottom">
            <h5 class="offcanvas-title" id="sidebarNavLabel">Navigation</h5>
            <button type="button" class="btn btn-sm btn-outline-secondary ms-auto me-2 d-lg-none" id="themeToggleSidebarBtn" title="Toggle theme" aria-label="Toggle theme">
              <i class="bi bi-moon-stars"></i>
            </button>
            <button type="button" class="btn-close d-lg-none" data-bs-dismiss="offcanvas" aria-label="Close"></button>
          </div>
          <div class="offcanvas-body p-0">
            <div class="p-3" id="sidebarInner">
              <!-- Tab Control -->
              <div class="d-flex align-items-center mb-1" id="sidebarTabsRow">
                <ul class="nav nav-pills gap-1 flex-lg-row flex-nowrap flex-grow-1" id="sidebarTabs" role="tablist">
                  <li class="nav-item" role="presentation">
                    <button class="nav-link small py-1 px-2 active" id="files-tab" data-bs-toggle="pill" data-bs-target="#files-pane" type="button" role="tab">
                      <i class="bi bi-folder me-2"></i>Files
                    </button>
                  </li>
                  <li class="nav-item" role="presentation">
                    <button class="nav-link small py-1 px-2" id="recent-tab" data-bs-toggle="pill" data-bs-target="#recent-pane" type="button" role="tab">
                      <i class="bi bi-clock-history me-2"></i>Recent
                    </button>
                  </li>
                  <!-- Add new snippet/folder -->
                  <li class="nav-item dropdown ms-auto">
                    <button class="nav-link small py-1 px-2" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="New...">
                      <i class="bi bi-list"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end">
                      <li>
                        <button class="dropdown-item small" id="newSnippetDropBtn">
                          <i class="bi bi-file-earmark-plus me-2"></i>New Snippet
                        </button>
                      </li>
                      <li>
                        <button class="dropdown-item small" id="newFolderDropBtn">
                          <i class="bi bi-folder-plus me-2"></i>New Folder
                        </button>
                      </li>
                      <li>
                        <button class="dropdown-item small" id="newLinkDropBtn">
                          <i class="bi bi-link-45deg me-2"></i>New Link
                        </button>
                      </li>
                    </ul>
                  </li>
                </ul>
              </div>

              <!-- Tab Content -->
              <div class="tab-content">
                <!-- Files & Folders Tab -->
                <div class="tab-pane fade show active" id="files-pane" role="tabpanel">
                  <!-- Action Buttons (debug only) -->
                  <div class="d-flex gap-2 mb-1" style="<?= ($debug && $allBtns) ? '' : 'display:none!important' ?>">
                    <?php if( $debug && $allBtns ): ?>
                      <button class="btn btn-sm btn-outline-secondary" id="backBtn" title="Back">
                        <i class="bi bi-arrow-left"></i>
                      </button>
                      <button class="btn btn-sm btn-success" id="newSnippetBtn" title="New Snippet">
                        <i class="bi bi-plus"></i>
                      </button>
                      <button class="btn btn-sm btn-primary" id="newFolderBtn" title="New Folder">
                        <i class="bi bi-folder-plus"></i>
                      </button>
                      <button class="btn btn-sm btn-warning" id="selectBtn" title="Select" disabled>
                        <i class="bi bi-list-check"></i>
                      </button>
                      <button class="btn btn-sm" id="bulkActionsBtn" title="Bulk actions" disabled>
                        Actions
                      </button>
                    <?php endif; ?>
                  </div>

                  <!-- File List -->
                  <div id="fileList" class="list-group">
                    <!-- Files will be loaded here -->
                  </div>
                </div>

                <!-- Recent Tab -->
                <div class="tab-pane fade" id="recent-pane" role="tabpanel">
                  <div id="recentList" class="list-group">
                    <!-- Recent snippets will be loaded here -->
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <main class="app-content px-3 pb-1">
        <div class="pt-3 d-flex flex-column h-100">
          <div id="editContent">
            <!-- Empty state (shown when no snippet selected) -->
            <div id="editEmptyState" class="text-center text-muted py-5">
              <i class="bi bi-file-text display-1"></i>
              <p class="mt-3">Select a snippet to edit or create a new one</p>
            </div>

            <!-- Static Edit Form (hidden by default; JS will populate)
                 data-type: yml | md, mobile-*-active: the one column shown on mobile -->
            <form id="editForm" class="snippet-form mobile-content-active" style="display: none;">

              <!-- Column headers: one per column on desktop, a single line on mobile
                   (pills, the visible column's buttons, file actions) -->
              <div class="row g-2" id="fieldHeaders">
                <div class="col-md-6 field-header" id="usageHeader">
                  <label class="form-label mb-0 d-none d-md-block">Usage</label>
                  <div class="field-pills nav nav-pills gap-1 d-md-none">
                    <?php foreach( $fieldPanes as $pane => $paneLabel ): ?>
                      <button type="button" class="nav-link small py-1 px-2<?= $pane === 'content' ? ' active' : '' ?>" data-pane="<?= $pane ?>"><?= $paneLabel ?></button>
                    <?php endforeach; ?>
                  </div>
                  <div class="field-actions">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="usageViewBtn" title="Show source" aria-label="Show source">
                      <i class="bi bi-code-slash"></i>
                    </button>
                  </div>
                </div>

                <div class="col-md-6 field-header" id="contentHeader">
                  <label for="snippetContent" class="form-label mb-0 d-none d-md-block" id="labelSnippetContent">Content</label>
                  <div class="field-actions">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="contentViewBtn" title="Show source" aria-label="Show source">
                      <i class="bi bi-code-slash"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-primary" id="copyRenderedBtn" title="Copy rendered" aria-label="Copy rendered" disabled>
                      <i class="bi bi-clipboard"></i>
                    </button>

                    <!-- File actions -->
                    <div class="file-actions">
                      <!-- Shown while the last autosave was refused; the reason is in the tooltip -->
                      <span id="autosaveStatus" class="autosave-status" style="display: none;" role="status">
                        <i class="bi bi-exclamation-triangle-fill"></i><span class="autosave-status-text ms-1">Not saved</span>
                      </span>
                      <!-- Hidden while autosave is on (unless the last autosave was refused) -->
                      <button type="button" class="btn btn-sm btn-primary" id="saveSnippetBtn" title="Save" aria-label="Save" style="display: none;">
                        <i class="bi bi-save"></i>
                      </button>
                      <div class="dropdown" id="snippetActionsDropdown" style="display: none;">
                        <button type="button" class="btn btn-sm btn-outline-warning btn-outline-accent dropdown-toggle-split" id="snippetActionsBtn" data-bs-toggle="dropdown" aria-expanded="false" title="More actions">
                          <i class="bi bi-three-dots-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                          <li>
                            <button class="dropdown-item" id="toggleLineWrapBtn" type="button">
                              <i class="bi bi-text-wrap me-2"></i>Toggle line wrap
                            </button>
                          </li>
                          <li>
                            <label class="dropdown-item d-flex align-items-center" for="autosaveSwitch">
                              <i class="bi bi-cloud-arrow-up me-2"></i>Autosave
                              <span class="form-switch ms-auto ps-3">
                                <input class="form-check-input m-0" type="checkbox" role="switch" id="autosaveSwitch">
                              </span>
                            </label>
                          </li>
                          <li><hr class="dropdown-divider"></li>
                          <li>
                            <button class="dropdown-item" id="duplicateSnippetBtn" type="button">
                              <i class="bi bi-files me-2"></i>Duplicate
                            </button>
                          </li>
                          <li><hr class="dropdown-divider"></li>
                          <li>
                            <button class="dropdown-item text-danger" id="deleteSnippetBtn" type="button">
                              <i class="bi bi-trash me-2"></i>Delete
                            </button>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Usage + Content: side by side on desktop, one at a time on mobile.
                   Each column shows its rendered version or its source (toggle in the header) -->
              <div class="row g-2" id="editFieldsRow">
                <!-- Usage (YAML-only) -->
                <div class="col-md-6 d-flex flex-column" id="fieldUsage">
                  <div class="d-flex align-items-center gap-1 mb-1" id="fieldShortScRow">
                    <input type="text" class="form-control form-control-sm flex-grow-1" id="snippetShort" placeholder="Short description">
                    <input type="text" class="form-control form-control-sm" id="snippetSc" placeholder="Short code">
                  </div>
                  <textarea class="form-control" id="snippetUsage" rows="3" placeholder="Usage..."></textarea>
                  <div id="renderUsage" class="usage-preview"></div>
                </div>

                <!-- Content -->
                <div class="col-md-6 d-flex flex-column" id="fieldContent">
                  <textarea class="form-control" id="snippetContent" rows="12" placeholder="Some {{ var }} snippet..." required></textarea>
                  <div id="inlineSnippet" class="inline-snippet"></div>
                  <!-- Markdown file: rendered preview -->
                  <div id="markdownPreview" class="markdown-preview"></div>
                </div>
              </div>
            </form>

            <!-- Choice menu for placeholders (shown on demand) -->
            <div id="phChoiceMenu" class="dropdown-menu" tabindex="-1"></div>
          </div>
        </div>
      </main>

      <!-- AI Chat Sidebar -->
      <aside class="app-ai-sidebar" id="aiSidebar">
        <div class="ai-sidebar-header border-bottom d-flex align-items-center justify-content-between px-3 d-lg-none">
          <span class="fw-semibold small"><i class="bi bi-stars me-2 text-primary"></i>AI Assistant</span>
          <button type="button" class="btn-close" id="aiSidebarClose" aria-label="Close"></button>
        </div>
        <div class="ai-messages" id="aiMessages">
          <div class="ai-msg ai-msg-user">
            <div class="ai-msg-bubble">How can I use this snippet manager for code templates?</div>
          </div>
          <div class="ai-msg ai-msg-ai">
            <div class="ai-msg-bubble">You can store and organize reusable code templates here. Create a snippet, add your code with <code>{{ variable }}</code> placeholders, then use the preview tab to fill in values interactively.</div>
          </div>
        </div>
        <div class="ai-input-area border-top p-2 pb-lg-3">
          <div class="input-group">
            <textarea class="form-control form-control-sm" id="aiInput" placeholder="Ask AI …" rows="2" style="resize: none;"></textarea>
            <button class="btn btn-primary btn-sm px-3" type="button" id="aiSendBtn">
              <i class="bi bi-send-fill"></i>
            </button>
          </div>
        </div>
      </aside>
  </div>

  <!-- Modals -->
  <!-- New Snippet Modal -->
  <div class="modal fade" id="newSnippetModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">New Snippet</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="newSnippetForm">
            <div class="mb-3">
              <label for="snippetName" class="form-label">Name</label>
              <input type="text" class="form-control" id="snippetName" required>
            </div>
            <div class="mb-3">
              <label for="snippetType" class="form-label">Type</label>
              <select class="form-select" id="snippetType">
                <option value="yml">YAML Snippet</option>
                <option value="md">Markdown File</option>
              </select>
            </div>
            <div class="mb-3" id="snippetBaseFolderRow">
              <label for="snippetBaseFolder" class="form-label">Source Folder</label>
              <select class="form-select" id="snippetBaseFolder"></select>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="createSnippetBtn">Create</button>
        </div>
      </div>
    </div>
  </div>

  <!-- New Folder Modal -->
  <div class="modal fade" id="newFolderModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">New Folder</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="newFolderForm">
            <div class="mb-3">
              <label for="folderName" class="form-label">Name</label>
              <input type="text" class="form-control" id="folderName" required>
            </div>
            <div class="mb-3" id="folderBaseFolderRow">
              <label for="folderBaseFolder" class="form-label">Source Folder</label>
              <select class="form-select" id="folderBaseFolder"></select>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="createFolderBtn">Create</button>
        </div>
      </div>
    </div>
  </div>

  <!-- New Link Modal -->
  <div class="modal fade" id="newLinkModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">New Link</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="newLinkForm">
            <div class="mb-3">
              <label for="linkTarget" class="form-label">Snippet or folder to link</label>
              <input type="text" class="form-control" id="linkTarget" required placeholder="e.g. error-handling">
              <div class="form-text">Name of an existing snippet or folder (at the data root). It is shown here as a link to the same element.</div>
            </div>
            <div class="mb-3" id="linkBaseFolderRow">
              <label for="linkBaseFolder" class="form-label">Source Folder</label>
              <select class="form-select" id="linkBaseFolder"></select>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="createLinkBtn">Create</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Rename Item Modal -->
  <div class="modal fade" id="renameItemModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Rename</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="renameItemForm">
            <div class="mb-3">
              <label for="renameNameInput" class="form-label">New Name</label>
              <input type="text" class="form-control" id="renameNameInput" required>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="confirmRenameBtn">Rename</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Duplicate Snippet Modal -->
  <div class="modal fade" id="duplicateSnippetModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Duplicate Snippet</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <form id="duplicateSnippetForm">
            <div class="mb-3">
              <label for="duplicateNameInput" class="form-label">New Name</label>
              <input type="text" class="form-control" id="duplicateNameInput" required>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="confirmDuplicateBtn">Duplicate</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Snippet Modal -->
  <div class="modal fade" id="deleteSnippetModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Delete Snippet</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete <strong id="deleteSnippetName"></strong>?</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="button" class="btn btn-danger" id="confirmDeleteBtn">Delete</button>
        </div>
      </div>
    </div>
  </div>

  <script>const APP_DEBUG = <?= json_encode($debug) ?>; const APP_SPECIAL = <?= json_encode((bool)($appConfig['special'] ?? false)) ?>; const APP_INITIAL_THEME = <?= json_encode($initialTheme) ?>;</script>
  <script src="<?= asset_url('lib/ext/bootstrap.bundle.min.js') ?>"></script>
  <script src="<?= asset_url('lib/ext/marked.min.js') ?>"></script>
  <script src="<?= asset_url('lib/functions.js') ?>"></script>
  <script src="<?= asset_url('controllers/file-tree.js') ?>"></script>
  <script src="<?= asset_url('controllers/editor.js') ?>"></script>
  <script src="<?= asset_url('controllers/render.js') ?>"></script>
  <script src="<?= asset_url('controllers/search.js') ?>"></script>
  <script src="<?= asset_url('controller.js') ?>"></script>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      new SnippetManager({ initialTheme: APP_INITIAL_THEME });
    });
  </script>
</body>
</html>
