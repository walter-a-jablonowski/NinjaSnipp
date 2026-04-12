<?php

namespace SnippetManager;

use Symfony\Component\Yaml\Yaml;

class SnippetManager
{
  // label => [path => color|null, ...]
  private array $dataPaths;
  // [['path' => string, 'color' => string|null], ...]
  private array $currentFolders;
  private string $currentDataLabel;
  private bool $foldersFirst = true;
  private array $config = [];

  public function __construct( array $dataPaths = ['data'], array $config = [] )
  {
    $normalized = [];

    foreach( $dataPaths as $key => $value )
    {
      if( is_string($key) )
      {
        $label = $key;

        if( is_string($value) )
        {
          // Old format: label => path
          $path = str_replace('\\', '/', $value);
          $normalized[$label] = [$path => null];
        }
        elseif( is_array($value) )
        {
          // New format: label => [path => color|null, ...]
          $folders = [];
          foreach( $value as $p => $color )
          {
            $p = str_replace('\\', '/', (string)$p);
            $folders[$p] = $color;
          }
          if( ! empty($folders) )
            $normalized[$label] = $folders;
        }
      }
      else
      {
        // Numeric key fallback: use path as label
        $path = is_string($value) ? str_replace('\\', '/', $value) : '';
        if( $path !== '' )
          $normalized[$path] = [$path => null];
      }
    }

    if( empty($normalized) )
      $normalized = ['data' => ['data' => null]];

    $this->dataPaths = $normalized;
    $this->config    = $config;

    $firstLabel = array_key_first($this->dataPaths);
    $this->currentDataLabel = $firstLabel;
    $this->currentFolders   = $this->buildFolders($firstLabel);

    $this->ensureDataDirectories();
  }

  // Build the current-folders array from a label
  private function buildFolders( string $label ) : array
  {
    $folders = [];
    foreach( $this->dataPaths[$label] as $path => $color )
      $folders[] = ['path' => $path, 'color' => $color];
    return $folders;
  }

  private function ensureDataDirectories() : void
  {
    foreach( $this->dataPaths as $folders )
      foreach( array_keys($folders) as $path )
        if( ! is_dir($path) )
          mkdir($path, 0755, true);
  }

  public function getDataPaths() : array
  {
    return $this->dataPaths;
  }

  public function setFoldersFirst( bool $foldersFirst ) : void
  {
    $this->foldersFirst = $foldersFirst;
  }

  public function setCurrentDataPath( string $label ) : bool
  {
    if( ! isset($this->dataPaths[$label]) )
      return false;

    $this->currentDataLabel = $label;
    $this->currentFolders   = $this->buildFolders($label);
    return true;
  }

  // Returns the first folder's path — used for write operations for now
  public function getCurrentDataPath() : string
  {
    return $this->currentFolders[0]['path'] ?? '';
  }

  public function getCurrentDataLabel() : string
  {
    return $this->currentDataLabel;
  }

  public function listFiles( string $subPath = '' ) : array
  {
    // Merge files from all folders; later folders overwrite earlier ones on same path
    $merged = [];

    foreach( $this->currentFolders as $folder )
    {
      $items = $this->listFilesInFolder($folder['path'], $folder['color'], $subPath);
      foreach( $items as $item )
        $merged[$item['path']] = $item;
    }

    $items = array_values($merged);

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

  private function listFilesInFolder( string $basePath, ?string $color, string $subPath = '' ) : array
  {
    $fullPath = $basePath . ($subPath ? "/$subPath" : '');

    if( ! is_dir($fullPath) )
      return [];

    $items = [];
    $files = scandir($fullPath);

    foreach( $files as $file )
    {
      if( $file === '.' || $file === '..' )
        continue;

      $filePath     = "$fullPath/$file";
      $relativePath = $subPath ? "$subPath/$file" : $file;

      if( is_dir($filePath) )
      {
        $items[] = [
          'type'  => 'folder',
          'name'  => $file,
          'path'  => $relativePath,
          'color' => $color
        ];
      }
      elseif( strpos($file, 'INCLUDE') !== false )
      {
        $includeItems = $this->resolveIncludeFile($file, $relativePath, $subPath, $basePath, $color);
        $items = array_merge($items, $includeItems);
      }
      elseif( pathinfo($file, PATHINFO_EXTENSION) === 'yml' || pathinfo($file, PATHINFO_EXTENSION) === 'md' )
      {
        $items[] = [
          'type'      => 'file',
          'name'      => pathinfo($file, PATHINFO_FILENAME),
          'extension' => pathinfo($file, PATHINFO_EXTENSION),
          'path'      => $relativePath,
          'modified'  => filemtime($filePath),
          'color'     => $color
        ];
      }
    }

    return $items;
  }

  private function resolveIncludeFile( string $includeFileName, string $includeRelativePath, string $currentSubPath, string $basePath, ?string $color ) : array
  {
    $includePos = strpos($includeFileName, 'INCLUDE');
    if( $includePos === false )
      return [];

    $targetName = trim(substr($includeFileName, $includePos + 7)); // 7 = length of "INCLUDE"
    if( empty($targetName) )
      return [];

    // Virtual tree path: the position this item appears at in the tree (unique per location)
    $virtualPrefix = $currentSubPath ? "$currentSubPath/" : '';

    // Search order: current base folder first, then all other base folders
    $orderedFolders = [];
    foreach( $this->currentFolders as $f )
    {
      if( $f['path'] === $basePath )
        array_unshift($orderedFolders, $f);
      else
        $orderedFolders[] = $f;
    }

    foreach( $orderedFolders as $folder )
    {
      $base     = $folder['path'];
      $fullPath = "$base/$targetName";
      $itemColor = $folder['color'] ?? $color;

      // Included folder
      if( is_dir($fullPath) )
      {
        return [[
          'type'       => 'folder',
          'name'       => $targetName,
          'path'       => $virtualPrefix . $targetName,
          'fsPath'     => $targetName,
          'isIncluded' => true,
          'color'      => $itemColor
        ]];
      }

      // Included file (with extension)
      foreach( ['yml', 'md'] as $ext )
      {
        $filePath = "$base/$targetName.$ext";
        if( file_exists($filePath) )
        {
          return [[
            'type'       => 'file',
            'name'       => $targetName,
            'extension'  => $ext,
            'path'       => $virtualPrefix . $targetName . '.' . $ext,
            'fsPath'     => "$targetName.$ext",
            'modified'   => filemtime($filePath),
            'isIncluded' => true,
            'color'      => $itemColor
          ]];
        }
      }
    }

    return [];
  }

  private function getDirectoryContentsRecursively( string $dirPath, string $basePath ) : array
  {
    $items    = [];
    $fullPath = $basePath . "/$dirPath";

    if( ! is_dir($fullPath) )
      return [];

    $files = scandir($fullPath);

    foreach( $files as $file )
    {
      if( $file === '.' || $file === '..' )
        continue;

      $filePath     = "$fullPath/$file";
      $relativePath = "$dirPath/$file";

      if( is_dir($filePath) )
      {
        $items[] = [
          'type'       => 'folder',
          'name'       => $file,
          'path'       => $relativePath,
          'isIncluded' => true
        ];
        $subItems = $this->getDirectoryContentsRecursively($relativePath, $basePath);
        $items = array_merge($items, $subItems);
      }
      elseif( pathinfo($file, PATHINFO_EXTENSION) === 'yml' || pathinfo($file, PATHINFO_EXTENSION) === 'md' )
      {
        $items[] = [
          'type'       => 'file',
          'name'       => pathinfo($file, PATHINFO_FILENAME),
          'extension'  => pathinfo($file, PATHINFO_EXTENSION),
          'path'       => $relativePath,
          'modified'   => filemtime($filePath),
          'isIncluded' => true
        ];
      }
    }

    return $items;
  }

  public function loadSnippet( string $path ) : ?array
  {
    foreach( $this->currentFolders as $folder )
    {
      $fullPath = $folder['path'] . "/$path";

      if( ! file_exists($fullPath) )
        continue;

      $extension = pathinfo($fullPath, PATHINFO_EXTENSION);

      if( $extension === 'yml' )
      {
        try {
          $content = file_get_contents($fullPath);
          $data    = Yaml::parse($content);
          $data['_type'] = 'yml';
          $data['_name'] = pathinfo($path, PATHINFO_FILENAME);
          return $data;
        }
        catch( \Exception $e ) {
          continue;
        }
      }
      elseif( $extension === 'md' )
      {
        return [
          '_type'   => 'md',
          '_name'   => pathinfo($path, PATHINFO_FILENAME),
          'content' => file_get_contents($fullPath)
        ];
      }
    }

    return null;
  }

  public function saveSnippet( string $path, array $data ) : bool
  {
    $fullPath = $this->getCurrentDataPath() . "/$path";
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
        $data = $ordered + $data;
        $yamlContent = Yaml::dump($data, 4, 2, Yaml::DUMP_MULTI_LINE_LITERAL_BLOCK);
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
    $fullPath = $this->getCurrentDataPath() . "/$path";

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
        if( $this->matchesFolderQuery($item, $query) )
        {
          $results[] = [
            'path'    => $item['path'],
            'name'    => $item['name'],
            'type'    => 'folder',
            'snippet' => null
          ];
        }
        $this->searchInDirectory($item['path'], $query, $results);
      }
      else
      {
        $snippet = $this->loadSnippet($item['path']);

        if( $snippet && $this->matchesQuery($snippet, $query) )
        {
          $results[] = [
            'path'    => $item['path'],
            'name'    => $item['name'],
            'type'    => $snippet['_type'],
            'snippet' => $snippet
          ];
        }
      }
    }
  }

  private function matchesQuery( array $snippet, string $query ) : bool
  {
    $query = strtolower($query);

    if( strpos(strtolower($snippet['_name']), $query) !== false )
      return true;

    if( isset($snippet['sh']) && strpos(strtolower($snippet['sh']), $query) !== false )
      return true;

    if( isset($snippet['usage']) && strpos(strtolower($snippet['usage']), $query) !== false )
      return true;

    if( isset($snippet['content']) && strpos(strtolower($snippet['content']), $query) !== false )
      return true;

    return false;
  }

  private function matchesFolderQuery( array $folder, string $query ) : bool
  {
    return strpos(strtolower($folder['name']), strtolower($query)) !== false;
  }

  private function calculateRelevanceScore( array $result, string $query ) : int
  {
    $score = 0;
    $query = strtolower($query);

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

    $snippet = $result['snippet'];
    if( ! $snippet ) return 0;

    if( strtolower($snippet['_name']) === $query )
      $score += 100;
    elseif( strpos(strtolower($snippet['_name']), $query) === 0 )
      $score += 50;
    elseif( strpos(strtolower($snippet['_name']), $query) !== false )
      $score += 25;

    if( isset($snippet['sh']) && strtolower($snippet['sh']) === $query )
      $score += 75;
    elseif( isset($snippet['sh']) && strpos(strtolower($snippet['sh']), $query) !== false )
      $score += 20;

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
    $content = $this->processIncludes($content, false);
    $content = $this->processPlaceholders($content, $placeholders);

    return $content;
  }

  public function composeContent( array $snippet ) : string
  {
    if( ! isset($snippet['content']) )
      return '';

    $content = $snippet['content'];
    $content = $this->processIncludes($content, true);

    return $content;
  }

  private function processIncludes( string $content, bool $forInline ) : string
  {
    $content = $this->processMaybeBlocks($content, $forInline);

    return preg_replace_callback('/^(\s*)\{\{\s*include:\s*["\']([^"\']+)["\']\s*\}\}/m', function($matches) use ($forInline) {
      $indent      = $matches[1];
      $includeName = $matches[2];
      $includeSnippet = $this->findSnippetByName($includeName);

      if( $includeSnippet ) {
        $includedContent = $this->processIncludes($includeSnippet['content'] ?? '', $forInline);

        if( isset($this->config['render']['includedSameIndent']) && $this->config['render']['includedSameIndent'] ) {
          $lines = explode("\n", $includedContent);
          $indentedLines = array_map(function($line) use ($indent) {
            return $line === '' ? $line : $indent . $line;
          }, $lines);
          $includedContent = implode("\n", $indentedLines);
        }

        $includedContent = preg_replace('/(\r?\n)+$/', '', $includedContent);

        if( $forInline && isset($this->config['render']['highlightInclude']) && $this->config['render']['highlightInclude'] ) {
          $start = "<<<INC:START:{$includeName}>>>";
          $end   = "<<<INC:END>>>";
          return $start . $includedContent . $end;
        }

        return $includedContent;
      }

      return $matches[0];
    }, $content);
  }

  private function processMaybeBlocks( string $content, bool $forInline ) : string
  {
    $pattern = '/\{\{\s*MAYBE:\s*([^}]+)\s*\}\}(.*?)\{\{\s*END-MAYBE\s*\}\}/s';

    return preg_replace_callback($pattern, function($matches) use ($forInline) {
      $name         = trim($matches[1]);
      $blockContent = $matches[2];
      $blockContent = $this->processMaybeBlocks($blockContent, $forInline);

      if( $forInline ) {
        $start = "<<<MAYBE:START:{$name}>>>";
        $end   = "<<<MAYBE:END>>>";
        return $start . $blockContent . $end;
      }

      return $blockContent;
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
        return $this->loadSnippet($item['path']);
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
    return preg_replace_callback('/\{\{\s*([^}]*)\s*\}\}/', function($matches) use ($placeholders) {
      $token = trim($matches[1]);

      if( stripos($token, 'include:') === 0 )
        return $matches[0];

      if( preg_match('/^([A-Za-z0-9_.-]+)(?:=(.+))?$/', $token, $m) )
      {
        $name = $m[1];

        if( isset($placeholders[$name]) )
          return $placeholders[$name];

        if( isset($m[2]) )
        {
          $default = $m[2];

          if( strpos($default, '|') !== false )
          {
            $choices = array_map('trim', explode('|', $default));
            return $choices[0];
          }

          return $default;
        }

        return "{{{$name}}}";
      }

      return $matches[0];
    }, $content);
  }

  public function extractPlaceholders( string $content ) : array
  {
    $placeholders = [];
    preg_match_all('/\{\{\s*([^}]*)\s*\}\}/', $content, $matches);

    foreach( $matches[1] as $raw )
    {
      $token = trim($raw);

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
              'type'    => 'choice',
              'choices' => $choices,
              'default' => $choices[0] ?? ''
            ];
          }
          else
          {
            $placeholders[$name] = [
              'type'    => 'text',
              'default' => $default
            ];
          }
        }
        else
        {
          $placeholders[$name] = [
            'type'    => 'text',
            'default' => ''
          ];
        }
      }
    }

    return $placeholders;
  }
}
