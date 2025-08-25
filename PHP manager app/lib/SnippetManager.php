<?php

namespace SnippetManager;

use Symfony\Component\Yaml\Yaml;

class SnippetManager
{
  private array $dataPaths; // associative: label => path
  private string $currentDataPath;
  private string $currentDataLabel;

  public function __construct( array $dataPaths = ['data'] )
  {
    // Normalize into associative array label => path
    $normalized = [];
    foreach( $dataPaths as $key => $value )
    {
      if( is_string($key) ) // keyed config: label => path
      {
        $label = $key;
        $path  = $value;
      }
      else // numeric keys: use path as label (fallback)
      {
        $label = is_string($value) ? $value : (string)$key;
        $path  = is_string($value) ? $value : '';
      }

      if( $path === '' ) continue;
      // Normalize separators to forward slashes
      $path = str_replace('\\', '/', $path);
      $normalized[$label] = $path;
    }

    if( empty($normalized) )
      $normalized = ['data' => 'data'];

    $this->dataPaths = $normalized;

    // Initialize current selection to first entry
    $firstLabel = array_key_first($this->dataPaths);
    $this->currentDataLabel = $firstLabel;
    $this->currentDataPath  = $this->dataPaths[$firstLabel];

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
    // Returns associative label => path
    return $this->dataPaths;
  }

  public function setCurrentDataPath( string $pathOrLabel ) : bool
  {
    // Accept either a label or a path
    if( isset($this->dataPaths[$pathOrLabel]) )
    {
      $this->currentDataLabel = $pathOrLabel;
      $this->currentDataPath  = $this->dataPaths[$pathOrLabel];
      return true;
    }

    // Try to match by path value
    foreach( $this->dataPaths as $label => $path )
    {
      if( $path === $pathOrLabel )
      {
        $this->currentDataLabel = $label;
        $this->currentDataPath  = $path;
        return true;
      }
    }

    return false;
  }

  public function getCurrentDataPath() : string
  {
    return $this->currentDataPath;
  }

  public function getCurrentDataLabel() : string
  {
    return $this->currentDataLabel;
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

  public function composeContent( array $snippet ) : string
  {
    if( ! isset($snippet['content']) )
      return '';

    $content = $snippet['content'];

    // Resolve includes only; placeholders remain intact for inline editing
    $content = $this->processIncludes($content);

    return $content;
  }

  private function processIncludes( string $content ) : string
  {
    // Double-brace include: {{ include: "Snippet name" }} (allow inner spaces)
    return preg_replace_callback('/\{\{\s*include:\s*["\']([^"\']+)["\']\s*\}\}/', function($matches) {
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
    // Double-brace placeholders: {{ name }}, {{ name=default }}, {{ name=a|b|c }}
    return preg_replace_callback('/\{\{\s*([^}]*)\s*\}\}/', function($matches) use ($placeholders) {
      $token = trim($matches[1]);

      // Skip include directives (handled elsewhere)
      if( stripos($token, 'include:') === 0 )
        return $matches[0];

      // name: [A-Za-z0-9_.-]+; default/choices: any chars (no '}}' inside single token)
      if( preg_match('/^([A-Za-z0-9_.-]+)(?:=(.+))?$/', $token, $m) )
      {
        $name = $m[1];

        if( isset($placeholders[$name]) )
          return $placeholders[$name];

        if( isset($m[2]) )
        {
          $default = $m[2];

          // Handle choices (pipe-separated)
          if( strpos($default, '|') !== false )
          {
            $choices = array_map('trim', explode('|', $default));
            return $choices[0]; // first choice as default
          }

          return $default; // text default
        }

        // Simple placeholder without provided value: keep as-is with double braces
        return "{{{$name}}}";
      }

      // Not a valid placeholder per syntax: leave verbatim
      return $matches[0];
    }, $content);
  }

  public function extractPlaceholders( string $content ) : array
  {
    $placeholders = [];
    // Double-brace tokens only
    preg_match_all('/\{\{\s*([^}]*)\s*\}\}/', $content, $matches);
    
    foreach( $matches[1] as $raw )
    {
      $token = trim($raw);

      // Skip includes
      if( stripos($token, 'include:') === 0 )
        continue;

      if( preg_match('/^([A-Za-z0-9_.-]+)(?:=(.+))?$/', $token, $m) )
      {
        $name = $m[1];

        if( isset($m[2]) )
        {
          $default = $m[2];
          if( strpos($default, '|') !== false )
          {
            $choices = array_map('trim', explode('|', $default));
            $placeholders[$name] = [
              'type' => 'choice',
              'choices' => $choices,
              'default' => $choices[0] ?? ''
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
          $placeholders[$name] = [
            'type' => 'text',
            'default' => ''
          ];
        }
      }
      // else: not a valid placeholder, skip
    }
    
    return $placeholders;
  }
}
