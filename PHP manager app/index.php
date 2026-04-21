<?php

use SnippetManager\SnippetManager;
use Symfony\Component\Yaml\Yaml;

require_once 'vendor/autoload.php';


$appConfig = Yaml::parseFile('config.yml');
$debug     = (bool) $appConfig['debug']['on'];
$allBtns   = (bool) $appConfig['debug']['showAllFileBtns'];

$config  = Yaml::parseFile('users/default/settings.yml');
$manager = new SnippetManager( $config['dataPaths'] ?? ['data'], $config);
if( isset($config['nav']['foldersFirst']) )
  $manager->setFoldersFirst( (bool)$config['nav']['foldersFirst'] );

// Optional URL param: select initial data folder by label key from config (e.g., ?data=Demo%201)
if( isset($_GET['data']) )
  $manager->setCurrentDataPath((string)$_GET['data']);

?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ninja</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css" rel="stylesheet">
  <link href="styles/theme.css?v=<?= time() ?>" rel="stylesheet">
  <link href="styles/app.css?v=<?= time() ?>" rel="stylesheet">
</head>
<body>
  <!-- Header -->
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary sticky-top">
    <div class="container-fluid">
      <button class="navbar-toggler ps-0 pe-0 me-2 d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarNav" aria-controls="sidebarNav" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>

      <a class="navbar-brand d-flex align-items-center" href="#">
        <i class="bi bi-code-square me-2 fs-4 d-none d-sm-inline"></i>
        <span class="fw-bold brand-full">Ninja</span>
        <span class="fw-bold brand-short">Ninja</span>
      </a>
      
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
      </div>
    </div>
  </nav>

  <!-- Search History Dropdown -->
  <div id="searchHistory" class="dropdown-menu position-absolute" style="display: none; z-index: 1050;"></div>

  <div class="app-shell layout">
      <!-- Sidebar / Offcanvas (overlay on <lg, static on >=lg) -->
      <div class="app-sidebar">
        <div class="offcanvas offcanvas-start offcanvas-lg" tabindex="-1" id="sidebarNav" aria-labelledby="sidebarNavLabel">
          <div class="offcanvas-header border-bottom">
            <h5 class="offcanvas-title" id="sidebarNavLabel">Navigation</h5>
            <button type="button" class="btn-close d-lg-none" data-bs-dismiss="offcanvas" aria-label="Close"></button>
          </div>
          <div class="offcanvas-body p-0">
            <div class="p-3" id="sidebarInner">
              <!-- Data Folder Selection -->
              <div class="mb-3">
                <select id="dataFolderSelect" class="form-select" title="Data folder">
                  <?php foreach( array_keys($manager->getDataPaths()) as $label ): ?>
                    <option value="<?= htmlspecialchars($label) ?>" <?= $label === $manager->getCurrentDataLabel() ? 'selected' : '' ?>>
                      <?= htmlspecialchars($label) ?>
                    </option>
                  <?php endforeach; ?>
                </select>
              </div>

              <!-- Tab Control -->
              <ul class="nav nav-pills mb-3 gap-1 flex-lg-row flex-nowrap" id="sidebarTabs" role="tablist">
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
              </ul>

              <!-- Tab Content -->
              <div class="tab-content">
                <!-- Files & Folders Tab -->
                <div class="tab-pane fade show active" id="files-pane" role="tabpanel">
                  <!-- Action Buttons (debug only) -->
                  <div class="d-flex gap-2 mb-3">
                    <?php if( $debug && $allBtns ): ?>
                      <button class="btn btn-sm btn-outline-secondary" id="backBtn" title="Back">
                        <i class="bi bi-arrow-left"></i>
                      </button>
                    <?php endif; ?>
                    <button class="btn btn-sm btn-success" id="newSnippetBtn" title="New Snippet">
                      <i class="bi bi-plus"></i>
                    </button>
                    <button class="btn btn-sm btn-primary" id="newFolderBtn" title="New Folder">
                      <i class="bi bi-folder-plus"></i>
                    </button>
                    <?php if( $debug && $allBtns ): ?>
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
          <!-- Content Tab Control -->
          <ul class="nav nav-tabs mb-2" id="contentTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <button id="render-tab" class="nav-link small py-1 px-2 active" data-bs-toggle="tab" data-bs-target="#render-pane" type="button" role="tab" disabled>
                <i class="bi bi-eye me-2"></i>Preview
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button id="edit-tab" class="nav-link small py-1 px-2" data-bs-toggle="tab" data-bs-target="#edit-pane" type="button" role="tab">
                <i class="bi bi-pencil me-2"></i>Edit
              </button>
            </li>
            <li class="nav-item ms-auto" role="presentation">
              <div class="d-flex gap-2 align-items-center">
                <div id="autosaveSwitchWrapper" class="form-check form-switch" title="autosave" style="display: none;">
                  <input class="form-check-input" type="checkbox" id="autosaveSwitch">
                </div>
                <button type="button" class="btn btn-sm btn-outline-secondary d-md-none" id="renderViewToggleBtn" title="Switch view" style="display: none;">
                  <i class="bi bi-card-text"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary" id="copyRenderedBtn" title="Copy rendered" aria-label="Copy rendered" style="display: none;" disabled>
                  <i class="bi bi-clipboard"></i>
                </button>
                <button type="button" class="btn btn-sm btn-primary" id="saveSnippetBtn" title="Save" aria-label="Save">
                  <i class="bi bi-save"></i>
                </button>
                <div class="dropdown" id="snippetActionsDropdown" style="display: none;">
                  <button type="button" class="btn btn-sm btn-outline-warning dropdown-toggle-split" id="snippetActionsBtn" data-bs-toggle="dropdown" aria-expanded="false" title="More actions" style="--bs-btn-color: #fd7e14; --bs-btn-border-color: #fd7e14; --bs-btn-hover-bg: #fd7e14; --bs-btn-hover-color: #fff; --bs-btn-hover-border-color: #fd7e14; --bs-btn-active-bg: #fd7e14; --bs-btn-active-color: #fff;">
                    <i class="bi bi-three-dots-vertical"></i>
                  </button>
                  <ul class="dropdown-menu dropdown-menu-end">
                    <li>
                      <button class="dropdown-item" id="toggleLineWrapBtn" type="button">
                        <i class="bi bi-text-wrap me-2"></i>Toggle line wrap
                      </button>
                    </li>
                    <li id="snippetActionsEditDivider"><hr class="dropdown-divider"></li>
                    <li id="snippetActionsEditGroup">
                      <button class="dropdown-item" id="duplicateSnippetBtn" type="button">
                        <i class="bi bi-files me-2"></i>Duplicate
                      </button>
                    </li>
                    <li><hr class="dropdown-divider" id="snippetActionsDeleteDivider"></li>
                    <li id="snippetActionsDeleteGroup">
                      <button class="dropdown-item text-danger" id="deleteSnippetBtn" type="button">
                        <i class="bi bi-trash me-2"></i>Delete
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
            </li>
          </ul>

          <!-- Content Tab Panes -->
          <div class="tab-content">
            <!-- Rendered Tab -->
            <div id="render-pane" class="tab-pane fade show active" role="tabpanel">
              <div id="renderContent">
                <div class="row g-2 render-snippet-active" id="renderRow">
                  <!-- Usage preview (left) -->
                  <div class="col-md-6" id="renderUsageCol">
                    <div id="renderUsage" class="usage-preview"></div>
                  </div>
                  <!-- Snippet (right) -->
                  <div class="col-md-6" id="renderSnippetCol">
                    <div id="inlineSnippet" class="inline-snippet"></div>
                  </div>
                </div>
                <!-- Markdown file: simple rendered preview -->
                <div id="markdownPreview" class="markdown-preview" style="display: none;"></div>
                <!-- Choice menu for placeholders (shown on demand) -->
                <div id="phChoiceMenu" class="dropdown-menu" tabindex="-1"></div>
              </div>
            </div>

            <!-- Edit Tab -->
            <div id="edit-pane" class="tab-pane fade" role="tabpanel">
              <div id="editContent">
                <!-- Empty state (shown when no snippet selected) -->
                <div id="editEmptyState" class="text-center text-muted py-5">
                  <i class="bi bi-file-text display-1"></i>
                  <p class="mt-3">Select a snippet to edit or create a new one</p>
                </div>

                <!-- Static Edit Form (hidden by default; JS will populate) -->
                <form id="editForm" class="snippet-form" style="display: none;">

                  <!-- Mobile pill switcher (YAML-only; d-md-none hides on desktop; JS toggles for YAML/MD) -->
                  <div class="align-items-center d-md-none mb-2" id="editFieldPills" style="display: none;">
                    <ul class="nav nav-pills gap-1" role="tablist">
                      <li class="nav-item">
                        <button class="nav-link small py-1 px-2" id="usageFieldPill" type="button">Usage</button>
                      </li>
                      <li class="nav-item">
                        <button class="nav-link small py-1 px-2 active" id="contentFieldPill" type="button">Content</button>
                      </li>
                    </ul>
                    <button type="button" class="btn btn-sm btn-link ms-auto p-0 text-muted" id="usagePreviewBtnMobile" title="Preview usage">
                      <i class="bi bi-eye"></i>
                    </button>
                  </div>

                  <!-- Usage + Content: side by side on desktop, switchable via pills on mobile -->
                  <div class="row g-2 mobile-content-active" id="editFieldsRow">
                    <!-- Usage (YAML-only) -->
                    <div class="col-md-6 d-flex flex-column" id="fieldUsage">
                      <div class="d-none d-md-flex justify-content-between align-items-center mb-1">
                        <label for="snippetUsage" class="form-label mb-0">Usage</label>
                        <button type="button" class="btn btn-sm btn-link p-0 text-muted d-none d-md-block" id="usagePreviewBtn" title="Preview usage">
                          <i class="bi bi-eye"></i>
                        </button>
                      </div>
                      <textarea class="form-control flex-grow-1" id="snippetUsage" rows="3" placeholder="Comments, usage and sample..."></textarea>
                      <div id="usagePreview" class="usage-preview flex-grow-1" style="display: none;"></div>
                      <!-- YAML-only: Short Code (no label) -->
                      <div id="fieldSc" class="mt-2">
                        <input type="text" title="Short code" class="form-control form-control-sm" id="snippetSc" placeholder="Short code, e.g. arr--">
                      </div>
                    </div>

                    <!-- Content -->
                    <div class="col-md-6 d-flex flex-column" id="fieldContent">
                      <label for="snippetContent" class="form-label mb-1" id="labelSnippetContent">Content</label>
                      <textarea class="form-control" id="snippetContent" rows="12" placeholder="Some {{ var }} snippet..." required></textarea>
                    </div>
                  </div>
                </form>
              </div>
            </div>
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
              <label for="folderName" class="form-label">Folder Name</label>
              <input type="text" class="form-control" id="folderName" required>
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

  <script>const APP_DEBUG = <?= json_encode($debug) ?>;</script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="lib/functions.js?v=<?= time() ?>"></script>
  <script src="controller.js?v=<?= time() ?>"></script>
</body>
</html>
