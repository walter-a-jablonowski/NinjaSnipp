<?php

namespace SnippetManager;

use Symfony\Component\Yaml\Yaml;

class SnippetManager
{
  private array $dataPaths;
  private string $currentDataPath;

  public function __construct( array $dataPaths = ['data'] )
  {
    $this->dataPaths = $dataPaths;
    $this->currentDataPath = $dataPaths[0];
    $this->ensureDataDirectories();
  }

  private function ensureDataDirectories() : void
  {
    foreach( $this->dataPaths as $path )
    {
      if( ! is_dir($path) )
        mkdir($path, 0755, true);
    }
  }

  public function getDataPaths() : array
  {
    return $this->dataPaths;
  }

  public function setCurrentDataPath( string $path ) : bool
  {
    if( in_array($path, $this->dataPaths) )
    {
      $this->currentDataPath = $path;
      return true;
    }
    return false;
  }

  public function getCurrentDataPath() : string
  {
    return $this->currentDataPath;
  }

  public function listFiles( string $subPath = '' ) : array
  {
    $fullPath = $this->currentDataPath . ($subPath ? "/$subPath" : '');
    
    if( ! is_dir($fullPath) )
      return [];

    $items = [];
    $files = scandir($fullPath);
    
    foreach( $files as $file )
    {
      if( $file === '.' || $file === '..' )
        continue;
        
      $filePath = "$fullPath/$file";
      $relativePath = $subPath ? "$subPath/$file" : $file;
      
      if( is_dir($filePath) )
      {
        $items[] = [
          'type' => 'folder',
          'name' => $file,
          'path' => $relativePath
        ];
      }
      elseif( pathinfo($file, PATHINFO_EXTENSION) === 'yml' || pathinfo($file, PATHINFO_EXTENSION) === 'md' )
      {
        $items[] = [
          'type' => 'file',
          'name' => pathinfo($file, PATHINFO_FILENAME),
          'extension' => pathinfo($file, PATHINFO_EXTENSION),
          'path' => $relativePath,
          'modified' => filemtime($filePath)
        ];
      }
    }
    
    // Sort folders first, then files
    usort($items, function($a, $b) {
      if( $a['type'] !== $b['type'] )
        return $a['type'] === 'folder' ? -1 : 1;
      return strcasecmp($a['name'], $b['name']);
    });
    
    return $items;
  }

  public function loadSnippet( string $path ) : ?array
  {
    $fullPath = $this->currentDataPath . "/$path";
    
    if( ! file_exists($fullPath) )
      return null;
      
    $extension = pathinfo($fullPath, PATHINFO_EXTENSION);
    
    if( $extension === 'yml' )
    {
      try {
        $content = file_get_contents($fullPath);
        $data = Yaml::parse($content);
        $data['_type'] = 'yml';
        $data['_name'] = pathinfo($path, PATHINFO_FILENAME);
        return $data;
      }
      catch( \Exception $e ) {
        return null;
      }
    }
    elseif( $extension === 'md' )
    {
      return [
        '_type' => 'md',
        '_name' => pathinfo($path, PATHINFO_FILENAME),
        'content' => file_get_contents($fullPath)
      ];
    }
    
    return null;
  }

  public function saveSnippet( string $path, array $data ) : bool
  {
    $fullPath = $this->currentDataPath . "/$path";
    $dir = dirname($fullPath);
    
    if( ! is_dir($dir) )
      mkdir($dir, 0755, true);
    
    try {
      if( $data['_type'] === 'yml' )
      {
        unset($data['_type'], $data['_name']);
        $yamlContent = Yaml::dump($data, 4, 2);
        return file_put_contents($fullPath, $yamlContent) !== false;
      }
      elseif( $data['_type'] === 'md' )
      {
        return file_put_contents($fullPath, $data['content']) !== false;
      }
    }
    catch( \Exception $e ) {
      return false;
    }
    
    return false;
  }

  public function deleteSnippet( string $path ) : bool
  {
    $fullPath = $this->currentDataPath . "/$path";
    
    if( file_exists($fullPath) )
      return unlink($fullPath);
      
    return false;
  }

  public function duplicateSnippet( string $sourcePath, string $targetPath ) : bool
  {
    $snippet = $this->loadSnippet($sourcePath);
    
    if( $snippet )
      return $this->saveSnippet($targetPath, $snippet);
      
    return false;
  }

  public function searchSnippets( string $query ) : array
  {
    $results = [];
    $this->searchInDirectory('', $query, $results);
    
    // Sort by relevance (exact matches first, then partial matches)
    usort($results, function($a, $b) use ($query) {
      $aScore = $this->calculateRelevanceScore($a, $query);
      $bScore = $this->calculateRelevanceScore($b, $query);
      return $bScore - $aScore;
    });
    
    return $results;
  }

  private function searchInDirectory( string $subPath, string $query, array &$results ) : void
  {
    $items = $this->listFiles($subPath);
    
    foreach( $items as $item )
    {
      if( $item['type'] === 'folder' )
      {
        $this->searchInDirectory($item['path'], $query, $results);
      }
      else
      {
        $snippet = $this->loadSnippet($item['path'] . '.' . $item['extension']);
        
        if( $snippet && $this->matchesQuery($snippet, $query) )
        {
          $results[] = [
            'path' => $item['path'] . '.' . $item['extension'],
            'name' => $item['name'],
            'type' => $snippet['_type'],
            'snippet' => $snippet
          ];
        }
      }
    }
  }

  private function matchesQuery( array $snippet, string $query ) : bool
  {
    $query = strtolower($query);
    
    // Search in name
    if( strpos(strtolower($snippet['_name']), $query) !== false )
      return true;
      
    // Search in short code
    if( isset($snippet['sh']) && strpos(strtolower($snippet['sh']), $query) !== false )
      return true;
      
    // Search in usage
    if( isset($snippet['usage']) && strpos(strtolower($snippet['usage']), $query) !== false )
      return true;
      
    // Search in content
    if( isset($snippet['content']) && strpos(strtolower($snippet['content']), $query) !== false )
      return true;
      
    return false;
  }

  private function calculateRelevanceScore( array $result, string $query ) : int
  {
    $score = 0;
    $query = strtolower($query);
    $snippet = $result['snippet'];
    
    // Exact name match gets highest score
    if( strtolower($snippet['_name']) === $query )
      $score += 100;
    elseif( strpos(strtolower($snippet['_name']), $query) === 0 )
      $score += 50;
    elseif( strpos(strtolower($snippet['_name']), $query) !== false )
      $score += 25;
      
    // Short code match
    if( isset($snippet['sh']) && strtolower($snippet['sh']) === $query )
      $score += 75;
    elseif( isset($snippet['sh']) && strpos(strtolower($snippet['sh']), $query) !== false )
      $score += 20;
      
    // Content matches
    if( isset($snippet['usage']) && strpos(strtolower($snippet['usage']), $query) !== false )
      $score += 10;
    if( isset($snippet['content']) && strpos(strtolower($snippet['content']), $query) !== false )
      $score += 5;
      
    return $score;
  }

  public function renderSnippet( array $snippet, array $placeholders = [] ) : string
  {
    if( ! isset($snippet['content']) )
      return '';
      
    $content = $snippet['content'];
    
    // Handle includes first
    $content = $this->processIncludes($content);
    
    // Handle placeholders
    $content = $this->processPlaceholders($content, $placeholders);
    
    return $content;
  }

  private function processIncludes( string $content ) : string
  {
    return preg_replace_callback('/\{include:\s*["\']([^"\']+)["\']\s*\}/', function($matches) {
      $includeName = $matches[1];
      $includeSnippet = $this->findSnippetByName($includeName);
      
      if( $includeSnippet )
        return $this->processIncludes($includeSnippet['content'] ?? '');
        
      return $matches[0]; // Return original if missing
    }, $content);
  }

  private function findSnippetByName( string $name ) : ?array
  {
    $items = $this->listFiles();
    
    foreach( $items as $item )
    {
      if( $item['type'] === 'file' && $item['name'] === $name )
      {
        return $this->loadSnippet($item['path'] . '.' . $item['extension']);
      }
    }
    
    return null;
  }

  private function processPlaceholders( string $content, array $placeholders ) : string
  {
    return preg_replace_callback('/\{([^}]+)\}/', function($matches) use ($placeholders) {
      $placeholder = $matches[1];
      
      // Check if it's a placeholder with default value or choices
      if( strpos($placeholder, '=') !== false )
      {
        list($name, $default) = explode('=', $placeholder, 2);
        $name = trim($name);
        
        if( isset($placeholders[$name]) )
          return $placeholders[$name];
          
        // Handle choices (pipe-separated)
        if( strpos($default, '|') !== false )
        {
          $choices = explode('|', $default);
          return trim($choices[0]); // Return first choice as default
        }
        
        return $default;
      }
      
      // Simple placeholder
      return $placeholders[$placeholder] ?? "{$placeholder}";
    }, $content);
  }

  public function extractPlaceholders( string $content ) : array
  {
    $placeholders = [];
    
    preg_match_all('/\{([^}]+)\}/', $content, $matches);
    
    foreach( $matches[1] as $match )
    {
      if( strpos($match, 'include:') === 0 )
        continue; // Skip includes
        
      if( strpos($match, '=') !== false )
      {
        list($name, $default) = explode('=', $match, 2);
        $name = trim($name);
        
        if( strpos($default, '|') !== false )
        {
          $choices = array_map('trim', explode('|', $default));
          $placeholders[$name] = [
            'type' => 'choice',
            'choices' => $choices,
            'default' => $choices[0]
          ];
        }
        else
        {
          $placeholders[$name] = [
            'type' => 'text',
            'default' => $default
          ];
        }
      }
      else
      {
        $placeholders[$match] = [
          'type' => 'text',
          'default' => ''
        ];
      }
    }
    
    return $placeholders;
  }
}
