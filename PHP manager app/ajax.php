<?php

use SnippetManager\SnippetManager;
use Symfony\Component\Yaml\Yaml;

require_once 'vendor/autoload.php';
require_once 'lib/functions.php';


header('Content-Type: application/json');

$input  = json_decode( file_get_contents('php://input'), true);
$action = $input['action'] ?? '';

$config  = Yaml::parseFile('users/default/settings.yml');
$manager = new SnippetManager( $config['dataPaths'] ?? ['data'], $config);
if( isset($config['nav']['foldersFirst']) )
  $manager->setFoldersFirst( (bool)$config['nav']['foldersFirst'] );

// Set current data path if provided, or ensure we're using the first path
if( isset($input['dataPath']) && !empty($input['dataPath']) )
  $manager->setCurrentDataPath($input['dataPath']);
else  // ensure we're using the first data path when no dataPath is provided
{
  $paths = $manager->getDataPaths(); // associative label => path
  $firstLabel = array_key_first($paths);
  if( $firstLabel !== null )
    $manager->setCurrentDataPath($paths[$firstLabel]);
}

$response = ['success' => false, 'message' => 'Unknown action'];

try {

  switch( $action )
  {
    case 'listFiles':
      $subPath = $input['subPath'] ?? '';
      $files = $manager->listFiles($subPath);
      $response = ['success' => true, 'files' => $files];
      break;

    case 'loadSnippet':
      $path = $input['path'] ?? '';
      error_log("Loading snippet: " . $path); // Debug log
      $snippet = $manager->loadSnippet($path);
      
      if( $snippet )
      {
        error_log("Snippet loaded successfully: " . $snippet['_name']); // Debug log
        $response = ['success' => true, 'snippet' => $snippet];
      }
      else
      {
        error_log("Snippet missing: " . $path); // Debug log
        $response = ['success' => false, 'message' => 'Snippet missing'];
      }
      break;

    case 'saveSnippet':
      $path = $input['path'] ?? '';
      $data = $input['data'] ?? [];
      
      if( $manager->saveSnippet($path, $data) )
        $response = ['success' => true, 'message' => 'Snippet saved successfully'];
      else
        $response = ['success' => false, 'message' => 'Failed to save snippet'];
      break;

    case 'deleteSnippet':
      $path = $input['path'] ?? '';
      
      if( $manager->deleteSnippet($path) )
        $response = ['success' => true, 'message' => 'Snippet deleted successfully'];
      else
        $response = ['success' => false, 'message' => 'Failed to delete snippet'];
      break;

    case 'duplicateSnippet':
      $sourcePath = $input['sourcePath'] ?? '';
      $targetPath = $input['targetPath'] ?? '';
      
      if( $manager->duplicateSnippet($sourcePath, $targetPath) )
        $response = ['success' => true, 'message' => 'Snippet duplicated successfully'];
      else
        $response = ['success' => false, 'message' => 'Failed to duplicate snippet'];
      break;

    case 'renameItem':
      $oldPath = $input['oldPath'] ?? '';
      $newPath = $input['newPath'] ?? '';
      $base    = rtrim($manager->getCurrentDataPath(), '/');

      // Build absolute paths
      $oldFull = $base . '/' . ltrim($oldPath, '/');
      $newFull = $base . '/' . ltrim($newPath, '/');

      // Basic validation
      if( $oldPath === '' || $newPath === '' ) {
        $response = ['success' => false, 'message' => 'Invalid parameters'];
        break;
      }

      // Ensure old exists and new does not
      if( ! file_exists($oldFull) ) {
        $response = ['success' => false, 'message' => 'Source does not exist'];
        break;
      }
      if( file_exists($newFull) ) {
        $response = ['success' => false, 'message' => 'Target already exists'];
        break;
      }

      // Ensure the target's parent directory exists (for nested renames)
      $parentDir = dirname($newFull);
      if( ! is_dir($parentDir) ) {
        if( ! mkdir($parentDir, 0755, true) ) {
          $response = ['success' => false, 'message' => 'Failed to prepare target directory'];
          break;
        }
      }

      if( @rename($oldFull, $newFull) )
        $response = ['success' => true, 'message' => 'Renamed successfully'];
      else
        $response = ['success' => false, 'message' => 'Failed to rename'];
      break;

    case 'searchSnippets':
      $query = $input['query'] ?? '';
      $results = $manager->searchSnippets($query);
      $response = ['success' => true, 'results' => $results];
      break;

    case 'renderSnippet':
      $snippet = $input['snippet'] ?? [];
      $placeholders = $input['placeholders'] ?? [];
      
      $rendered = $manager->renderSnippet($snippet, $placeholders);
      $response = ['success' => true, 'rendered' => $rendered];
      break;

    case 'composeContent':
      $snippet = $input['snippet'] ?? [];
      $composed = $manager->composeContent($snippet);
      $response = ['success' => true, 'composed' => $composed];
      break;

    case 'extractPlaceholders':
      $content = $input['content'] ?? '';
      $placeholders = $manager->extractPlaceholders($content);
      $response = ['success' => true, 'placeholders' => $placeholders];
      break;

    case 'createFolder':
      $folderPath = $input['folderPath'] ?? '';
      $fullPath = $manager->getCurrentDataPath() . '/' . $folderPath;
      
      if( ! is_dir($fullPath) && mkdir($fullPath, 0755, true) )
        $response = ['success' => true, 'message' => 'Folder created successfully'];
      else
        $response = ['success' => false, 'message' => 'Failed to create folder or folder already exists'];
      break;

    case 'setDataPath':
      $dataPath = $input['dataPath'] ?? '';
      
      if( $manager->setCurrentDataPath($dataPath) )
        $response = ['success' => true, 'message' => 'Data path changed successfully'];
      else
        $response = ['success' => false, 'message' => 'Invalid data path'];
      break;

    // --- User data: search history ---
    case 'getSearchHistory':
      $file = 'users/default/search_history.json';
      $history = read_json_file($file, []);
      $response = ['success' => true, 'data' => $history];
      break;

    case 'saveSearchHistory':
      $data = $input['data'] ?? [];
      $file = 'users/default/search_history.json';
      if( write_json_file($file, $data) )
        $response = ['success' => true];
      else
        $response = ['success' => false, 'message' => 'Failed to save search history'];
      break;

    // --- User data: recent snippets ---
    case 'getRecentSnippets':
      $file = 'users/default/recent_snippets.json';
      $allRecent = read_json_file($file, []);
      $currentDataLabel = $manager->getCurrentDataLabel();
      $recent = $allRecent[$currentDataLabel] ?? [];
      $response = ['success' => true, 'data' => $recent];
      break;

    case 'saveRecentSnippets':
      $data = $input['data'] ?? [];
      $file = 'users/default/recent_snippets.json';
      $allRecent = read_json_file($file, []);
      $currentDataLabel = $manager->getCurrentDataLabel();
      $allRecent[$currentDataLabel] = $data;
      if( write_json_file($file, $allRecent) )
        $response = ['success' => true];
      else
        $response = ['success' => false, 'message' => 'Failed to save recent snippets'];
      break;

    // --- User settings (YAML) ---
    case 'getUserSettings':
      $settingsFile = 'users/default/settings.yml';
      if( is_file($settingsFile) )
        $settings = Yaml::parseFile($settingsFile);
      else
        $settings = [];
      $response = ['success' => true, 'settings' => $settings];
      break;

    case 'setUserSettings':
      $settingsFile = 'users/default/settings.yml';
      $current = is_file($settingsFile) ? Yaml::parseFile($settingsFile) : [];
      $incoming = $input['settings'] ?? [];
      if( ! is_array($incoming) ) $incoming = [];
      // Merge recursively: incoming overrides current
      $merged = array_replace_recursive($current, $incoming);
      $yaml = Yaml::dump($merged, 4, 2);
      if( file_put_contents($settingsFile, $yaml) !== false )
        $response = ['success' => true, 'settings' => $merged];
      else
        $response = ['success' => false, 'message' => 'Failed to write settings'];
      break;

    default:
      $response = ['success' => false, 'message' => "Unknown action: $action"];
  }
}
catch( Exception $e ) {
  $response = ['success' => false, 'message' => 'Server error: ' . $e->getMessage()];
}

echo json_encode($response);
