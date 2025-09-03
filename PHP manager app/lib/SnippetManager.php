<?php

namespace SnippetManager;

use Symfony\Component\Yaml\Yaml;

class SnippetManager
{
  private array $dataPaths; // associative: label => path
  private string $currentDataPath;
  private string $currentDataLabel;
  private bool $foldersFirst = true;
  private array $config = [];

  public function __construct( array $dataPaths = ['data'], array $config = [] )
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
    $this->config = $config;

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

  public function setFoldersFirst( bool $foldersFirst ) : void
  {
    $this->foldersFirst = $foldersFirst;
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
      elseif( strpos($file, 'INCLUDE') !== false )
      {
        // Handle INCLUDE files first - resolve the referenced file/folder
        $includeItems = $this->resolveIncludeFile($file, $relativePath, $subPath);
        $items = array_merge($items, $includeItems);
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
    
    // Sorting: folders-first (default) or by name only when configured
    if( $this->foldersFirst )
    {
      usort($items, function($a, $b) {
        if( $a['type'] !== $b['type'] )
          return $a['type'] === 'folder' ? -1 : 1;
        return strcasecmp($a['name'], $b['name']);
      });
    }
    else
    {
      usort($items, function($a, $b) {
        return strcasecmp($a['name'], $b['name']);
      });
    }
    
    return $items;
  }

  private function resolveIncludeFile( string $includeFileName, string $includeRelativePath, string $currentSubPath ) : array
  {
    // Extract the target path from the INCLUDE filename
    // Format: "anything INCLUDE target-path"
    $includePos = strpos($includeFileName, 'INCLUDE');
    if( $includePos === false )
      return [];
      
    $targetPath = trim(substr($includeFileName, $includePos + 7)); // 7 = length of "INCLUDE"
    if( empty($targetPath) )
      return [];
    
    // Build full path to the target (relative to data base, ins of current subpath)
    $targetFullPath = $this->currentDataPath . "/$targetPath";
    
    // Try different path variations
    $possiblePaths = [
      "$targetPath.yml",
      "$targetPath.md", 
      "common/$targetPath.yml",
      "common/$targetPath.md"
    ];
    
    $items = [];
    
    if( is_dir($targetFullPath) )
    {
      // If target is a directory, include it as a single folder entry
      $items[] = [
        'type' => 'folder',
        'name' => pathinfo($targetPath, PATHINFO_FILENAME),
        'path' => $targetPath,
        'isIncluded' => true
      ];
    }
    elseif( file_exists($targetFullPath) )
    {
      // If target is a file, include it
      $extension = pathinfo($targetPath, PATHINFO_EXTENSION);
      if( $extension === 'yml' || $extension === 'md' )
      {
        $items[] = [
          'type' => 'file',
          'name' => pathinfo($targetPath, PATHINFO_FILENAME),
          'extension' => $extension,
          'path' => $targetPath,
          'modified' => filemtime($targetFullPath),
          'isIncluded' => true // Mark as included for UI distinction
        ];
      }
    }
    else
    {
      // Try possible path variations
      foreach( $possiblePaths as $possiblePath )
      {
        $possibleFullPath = $this->currentDataPath . "/$possiblePath";
        
        if( file_exists($possibleFullPath) )
        {
          $extension = pathinfo($possiblePath, PATHINFO_EXTENSION);
          if( $extension === 'yml' || $extension === 'md' )
          {
            $items[] = [
              'type' => 'file',
              'name' => pathinfo($possiblePath, PATHINFO_FILENAME),
              'extension' => $extension,
              'path' => $possiblePath,
              'modified' => filemtime($possibleFullPath),
              'isIncluded' => true
            ];
            break;
          }
        }
      }
    }
    return $items;
  }

  private function getDirectoryContentsRecursively( string $dirPath ) : array
  {
    $items = [];
    $fullPath = $this->currentDataPath . "/$dirPath";
    
    if( ! is_dir($fullPath) )
      return [];
      
    $files = scandir($fullPath);
    
    foreach( $files as $file )
    {
      if( $file === '.' || $file === '..' )
        continue;
        
      $filePath = "$fullPath/$file";
      $relativePath = "$dirPath/$file";
      
      if( is_dir($filePath) )
      {
        // Add folder
        $items[] = [
          'type' => 'folder',
          'name' => $file,
          'path' => $relativePath,
          'isIncluded' => true
        ];
        
        // Recursively add folder contents
        $subItems = $this->getDirectoryContentsRecursively($relativePath);
        $items = array_merge($items, $subItems);
      }
      elseif( pathinfo($file, PATHINFO_EXTENSION) === 'yml' || pathinfo($file, PATHINFO_EXTENSION) === 'md' )
      {
        $items[] = [
          'type' => 'file',
          'name' => pathinfo($file, PATHINFO_FILENAME),
          'extension' => pathinfo($file, PATHINFO_EXTENSION),
          'path' => $relativePath,
          'modified' => filemtime($filePath),
          'isIncluded' => true
        ];
      }
    }
    
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
        // Ensure key order: sh, usage, content come first
        $ordered = [];
        foreach( ['sh', 'usage', 'content'] as $k )
        {
          if( array_key_exists($k, $data) )
          {
            $ordered[$k] = $data[$k];
            unset($data[$k]);
          }
        }
        // Append any remaining keys in their existing order
        $data = $ordered + $data;
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
        // Check if folder name matches query
        if( $this->matchesFolderQuery($item, $query) )
        {
          $results[] = [
            'path' => $item['path'],
            'name' => $item['name'],
            'type' => 'folder',
            'snippet' => null
          ];
        }
        
        // Continue searching in subdirectory
        $this->searchInDirectory($item['path'], $query, $results);
      }
      else
      {
        $snippet = $this->loadSnippet($item['path']);
        
        if( $snippet && $this->matchesQuery($snippet, $query) )
        {
          $results[] = [
            'path' => $item['path'],
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

  private function matchesFolderQuery( array $folder, string $query ) : bool
  {
    $query = strtolower($query);
    
    // Search in folder name
    if( strpos(strtolower($folder['name']), $query) !== false )
      return true;
      
    return false;
  }

  private function calculateRelevanceScore( array $result, string $query ) : int
  {
    $score = 0;
    $query = strtolower($query);
    
    // Handle folder results
    if( $result['type'] === 'folder' )
    {
      $name = strtolower($result['name']);
      if( $name === $query )
        $score += 80;
      elseif( strpos($name, $query) === 0 )
        $score += 40;
      elseif( strpos($name, $query) !== false )
        $score += 20;
      return $score;
    }
    
    // Handle file results
    $snippet = $result['snippet'];
    if( ! $snippet ) return 0;
    
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
    return preg_replace_callback('/^(\s*)\{\{\s*include:\s*["\']([^"\']+)["\']\s*\}\}/m', function($matches) {
      $indent = $matches[1];
      $includeName = $matches[2];
      $includeSnippet = $this->findSnippetByName($includeName);
      
      if( $includeSnippet ) {
        $includedContent = $this->processIncludes($includeSnippet['content'] ?? '');
        
        // Apply same indentation if config setting is enabled
        if( isset($this->config['render']['includedSameIndent']) && $this->config['render']['includedSameIndent'] ) {
          $lines = explode("\n", $includedContent);
          $indentedLines = array_map(function($line) use ($indent) {
            return $line === '' ? $line : $indent . $line;
          }, $lines);
          return implode("\n", $indentedLines);
        }
        
        return $includedContent;
      }
        
      return $matches[0]; // Return original if missing
    }, $content);
  }

  private function findSnippetByName( string $name ) : ?array
  {
    return $this->searchSnippetRecursively($name, '');
  }

  private function searchSnippetRecursively( string $name, string $subPath ) : ?array
  {
    $items = $this->listFiles($subPath);
    
    foreach( $items as $item )
    {
      if( $item['type'] === 'file' && $item['name'] === $name )
      {
        return $this->loadSnippet($item['path']);
      }
      elseif( $item['type'] === 'folder' )
      {
        $result = $this->searchSnippetRecursively($name, $item['path']);
        if( $result )
          return $result;
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

      // No valid placeholder per syntax: leave verbatim
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
      // else: no valid placeholder, skip
    }
    
    return $placeholders;
  }
}
