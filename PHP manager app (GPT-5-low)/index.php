<?php
require __DIR__ . '/vendor/autoload.php';

use Symfony\Component\Yaml\Yaml;
use App\SnippetManager;

$basePath = __DIR__;
$manager = new SnippetManager($basePath);
$dataPaths = $manager->listDataPaths();
$currentPath = $dataPaths[0] ?? 'data';
$manager->setCurrentDataPath($currentPath);
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Snippet Manager</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="assets/style.css" rel="stylesheet">
  </head>
  <body>
    
    <header class="navbar navbar-dark bg-dark sticky-top shadow-sm">
      <div class="container-fluid">
        <div class="d-flex align-items-center gap-2">
          <div class="logo">🧩</div>
          <span class="navbar-brand mb-0 h1">Snippet Manager</span>
        </div>
        <div class="d-flex align-items-center gap-2 w-50">
          <input id="searchInput" class="form-control" placeholder="Search snippets... (fuzzy)" />
          <button id="searchBtn" class="btn btn-outline-light">Search</button>
        </div>
      </div>
    </header>

    <main class="container-fluid py-3">
      <div class="row g-3">
        <aside class="col-12 col-lg-4 col-xl-3">
          <div class="card shadow-sm">
            <div class="card-body">
              <div class="mb-3">
                <label class="form-label">Data folder</label>
                <select id="dataPathSelect" class="form-select"></select>
              </div>

              <ul class="nav nav-pills mb-3" id="leftTabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active" id="files-tab" data-bs-toggle="pill" data-bs-target="#files-pane" type="button" role="tab">Files</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link" id="recent-tab" data-bs-toggle="pill" data-bs-target="#recent-pane" type="button" role="tab">Recent</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link" id="results-tab" data-bs-toggle="pill" data-bs-target="#results-pane" type="button" role="tab">Results</button>
                </li>
              </ul>
              <div class="tab-content" id="leftTabsContent">
                <div class="tab-pane fade show active" id="files-pane" role="tabpanel">
                  <div class="d-flex gap-2 mb-2">
                    <button id="newSnippetBtn" class="btn btn-primary btn-sm">New Snippet</button>
                    <button id="newNoteBtn" class="btn btn-outline-primary btn-sm">New Note</button>
                  </div>
                  <div id="fileBreadcrumb" class="mb-2 small"></div>
                  <div id="fileList" class="list-group small"></div>
                </div>
                <div class="tab-pane fade" id="recent-pane" role="tabpanel">
                  <div id="recentList" class="list-group small"></div>
                </div>
                <div class="tab-pane fade" id="results-pane" role="tabpanel">
                  <div id="resultsList" class="list-group small"></div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section class="col-12 col-lg-8 col-xl-9">
          <div class="card shadow-sm">
            <div class="card-body">
              <ul class="nav nav-tabs" id="rightTabs" role="tablist">
                <li class="nav-item" role="presentation">
                  <button class="nav-link active" id="render-tab" data-bs-toggle="tab" data-bs-target="#render-pane" type="button" role="tab">Rendered</button>
                </li>
                <li class="nav-item" role="presentation">
                  <button class="nav-link" id="edit-tab" data-bs-toggle="tab" data-bs-target="#edit-pane" type="button" role="tab">Edit</button>
                </li>
              </ul>
              <div class="tab-content pt-3">
                <div class="tab-pane fade show active" id="render-pane" role="tabpanel">
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <div class="small text-muted" id="currentFileLabel">No file loaded</div>
                    <button id="copyBtn" class="btn btn-outline-secondary btn-sm">Copy</button>
                  </div>
                  <div id="renderedContent" class="rendered border rounded p-3"></div>
                </div>
                <div class="tab-pane fade" id="edit-pane" role="tabpanel">
                  <form id="editForm" class="vstack gap-3">
                    <input type="hidden" id="filePath" />
                    <input type="hidden" id="fileType" />

                    <div id="ymlFields">
                      <div class="row g-2 align-items-end">
                        <div class="col-8">
                          <label class="form-label">Name</label>
                          <input id="snippetNameEdit" class="form-control" placeholder="Snippet name" />
                        </div>
                        <div class="col-4">
                          <label class="form-label">sh</label>
                          <input id="snippetSh" class="form-control" placeholder="Short code" />
                        </div>
                      </div>
                      <div>
                        <label class="form-label">Usage</label>
                        <textarea id="snippetUsage" class="form-control" rows="4" placeholder="Usage, comments, samples..."></textarea>
                      </div>
                      <div>
                        <label class="form-label">Content</label>
                        <textarea id="snippetContent" class="form-control" rows="10" placeholder="Snippet content with {placeholders}"></textarea>
                      </div>
                    </div>

                    <div id="mdFields" class="d-none">
                      <div class="row g-2 align-items-end">
                        <div class="col-8">
                          <label class="form-label">File name</label>
                          <input id="mdFileName" class="form-control" placeholder="my-note.md" />
                        </div>
                      </div>
                      <div>
                        <label class="form-label">Content</label>
                        <textarea id="mdContent" class="form-control" rows="14" placeholder="# Markdown note..."></textarea>
                      </div>
                    </div>

                    <div class="d-flex gap-2">
                      <button id="saveSnippetBtn" type="button" class="btn btn-success">Save</button>
                      <button id="duplicateSnippetBtn" type="button" class="btn btn-outline-secondary">Duplicate</button>
                      <button id="deleteSnippetBtn" type="button" class="btn btn-outline-danger">Delete</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script>
      window.__DATA_PATHS__ = <?php echo json_encode($dataPaths); ?>;
      window.__CURRENT_PATH__ = <?php echo json_encode($currentPath); ?>;
    </script>
    <script src="assets/controller.js"></script>
  </body>
</html>
