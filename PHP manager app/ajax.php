<?php

use SnippetManager\SnippetManager;
use Symfony\Component\Yaml\Yaml;

require_once 'vendor/autoload.php';


header('Content-Type: application/json');

$input  = json_decode( file_get_contents('php://input'), true);
$action = $input['action'] ?? '';

$config  = Yaml::parseFile('config.yml');
$manager = new SnippetManager( $config['dataPaths'] ?? ['data']);

// Set current data path if provided, otherwise ensure we're using the first path
if( isset($input['dataPath']) && !empty($input['dataPath']) )
  $manager->setCurrentDataPath($input['dataPath']);
else  // ensure we're using the first data path when no dataPath is provided
  $manager->setCurrentDataPath($manager->getDataPaths()[0]);

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

    default:
      $response = ['success' => false, 'message' => "Unknown action: $action"];
  }
}
catch( Exception $e ) {
  $response = ['success' => false, 'message' => 'Server error: ' . $e->getMessage()];
}

echo json_encode($response);
