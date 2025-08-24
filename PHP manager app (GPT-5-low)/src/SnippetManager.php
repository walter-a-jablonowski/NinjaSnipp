<?php

namespace App;

use Symfony\Component\Yaml\Yaml;

class SnippetManager
{
  private string $basePath;
  private array $dataPaths = [];
  private string $currentDataPath;
  private string $recentFile;

  public function __construct(string $basePath)
  {
    $this->basePath = str_replace('\\', '/', rtrim($basePath, '/'));
    $this->loadConfig();
    $this->ensureDataDirectories();
    $this->setCurrentDataPath($this->dataPaths[0] ?? 'data');

    $this->recentFile = $this->basePath . '/data/recent.yml';
    if( ! file_exists($this->recentFile) ) {
      $this->writeYaml($this->recentFile, [ 'recent' => [] ]);
    }
  }

  private function loadConfig() : void
  {
    $configFile = $this->basePath . '/config.yml';
    if( file_exists($configFile) ) {
      $cfg = Yaml::parseFile($configFile) ?? [];
      $paths = $cfg['data_paths'] ?? ['data'];
    }
    else {
      $paths = ['data'];
    }

    $norm = [];
    foreach( $paths as $p ) {
      $p = str_replace('\\', '/', $p);
      $p = trim($p, '/');
      $norm[] = $p;
    }
    $this->dataPaths = $norm;
  }

  private function ensureDataDirectories() : void
  {
    foreach( $this->dataPaths as $rel ) {
      $abs = $this->abs($rel);
      if( ! is_dir($abs) ) {
        @mkdir($abs, 0777, true);
      }
    }
  }

  private function abs(string $rel) : string
  {
    $rel = str_replace('\\', '/', trim($rel, '/'));
    return $this->basePath . '/' . $rel;
  }

  public function listDataPaths() : array
  {
    return $this->dataPaths;
  }

  public function getCurrentDataPath() : string
  {
    return $this->currentDataPath;
  }

  public function setCurrentDataPath(string $rel) : void
  {
    $rel = str_replace('\\', '/', trim($rel, '/'));
    if( ! in_array($rel, $this->dataPaths, true) ) {
      throw new \InvalidArgumentException("Invalid data path: {$rel}");
    }
    $this->currentDataPath = $rel;
  }

  public function listDirectory(string $sub = '') : array
  {
    $root = $this->abs($this->currentDataPath);
    $dir = $root . ($sub ? '/' . trim(str_replace('\\', '/', $sub), '/') : '');
    if( ! is_dir($dir) ) {
      throw new \RuntimeException("Directory not found: {$sub}");
    }
    $items = scandir($dir);
    $out = [ 'folders' => [], 'files' => [] ];
    foreach( $items as $it ) {
      if( $it === '.' || $it === '..' ) continue;
      $full = $dir . '/' . $it;
      if( is_dir($full) ) {
        $out['folders'][] = [ 'name' => $it, 'path' => trim($sub . '/' . $it, '/') ];
      }
      else if( preg_match('/\.(yml|yaml|md)$/i', $it) ) {
        $out['files'][] = [ 'name' => $it, 'path' => trim($sub . '/' . $it, '/') ];
      }
    }
    sort($out['folders']);
    sort($out['files']);
    return $out;
  }

  public function readSnippet(string $relPath) : array
  {
    $full = $this->pathInCurrent($relPath);
    $ext = strtolower(pathinfo($full, PATHINFO_EXTENSION));
    if( $ext === 'md' ) {
      $content = file_exists($full) ? file_get_contents($full) : '';
      $this->touchRecent($relPath);
      return [ 'type' => 'md', 'file' => $relPath, 'content' => $content ];
    }
    $data = file_exists($full) ? (Yaml::parseFile($full) ?? []) : [];
    $name = pathinfo($relPath, PATHINFO_FILENAME);
    $data['name'] = $name;
    $data['file'] = $relPath;
    $data['type'] = 'yml';
    $data['sh'] = $data['sh'] ?? '';
    $data['usage'] = $data['usage'] ?? '';
    $data['content'] = $data['content'] ?? '';
    $this->touchRecent($relPath);
    return $data;
  }

  public function saveSnippet(array $payload) : array
  {
    $type = $payload['type'] ?? 'yml';
    $file = trim($payload['file'] ?? '', '/');

    if( $type === 'md' ) {
      $full = $this->pathInCurrent($file ?: ($payload['name'] ?? 'note') . '.md');
      $this->ensureParent($full);
      file_put_contents($full, (string)($payload['content'] ?? ''));
      $this->touchRecent($this->relToCurrent($full));
      return [ 'ok' => true, 'file' => $this->relToCurrent($full) ];
    }

    $name = trim((string)($payload['name'] ?? 'untitled'));
    $sh = (string)($payload['sh'] ?? '');
    $usage = (string)($payload['usage'] ?? '');
    $content = (string)($payload['content'] ?? '');

    $targetRel = $file ?: $this->safeName($name) . '.yml';
    $full = $this->pathInCurrent($targetRel);
    $this->ensureParent($full);
    $this->writeYaml($full, [ 'sh' => $sh, 'usage' => $usage, 'content' => $content ]);
    $this->touchRecent($this->relToCurrent($full));
    return [ 'ok' => true, 'file' => $this->relToCurrent($full) ];
  }

  public function delete(string $relPath) : array
  {
    $full = $this->pathInCurrent($relPath);
    if( is_dir($full) ) {
      $this->rrmdir($full);
      return [ 'ok' => true ];
    }
    if( file_exists($full) ) unlink($full);
    return [ 'ok' => true ];
  }

  public function duplicate(string $relPath, ?string $newName = null) : array
  {
    $full = $this->pathInCurrent($relPath);
    if( ! file_exists($full) ) throw new \RuntimeException('File not found');
    $pi = pathinfo($full);
    $base = $newName ? $this->safeName($newName) : ($pi['filename'] . '_copy');
    $ext = $pi['extension'] ?? 'yml';
    $target = $pi['dirname'] . '/' . $base . '.' . $ext;
    $i = 2;
    while( file_exists($target) ) {
      $target = $pi['dirname'] . '/' . $base . '_' . $i . '.' . $ext;
      $i++;
    }
    copy($full, $target);
    $rel = $this->relToCurrent($target);
    $this->touchRecent($rel);
    return [ 'ok' => true, 'file' => $rel ];
  }

  public function search(string $q) : array
  {
    $q = trim($q);
    if( $q === '' ) return [];
    $root = $this->abs($this->currentDataPath);

    $results = [];
    $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
    foreach( $rii as $file ) {
      if( $file->isDir() ) continue;
      $ext = strtolower($file->getExtension());
      if( ! in_array($ext, ['yml','yaml','md'], true) ) continue;
      $content = @file_get_contents($file->getPathname());
      if( $content === false ) continue;
      if( $this->fuzzyMatch($content, $q) || $this->fuzzyMatch($file->getFilename(), $q) ) {
        $results[] = [
          'path' => $this->relToCurrent($file->getPathname()),
          'name' => $file->getFilename(),
        ];
      }
    }
    return $results;
  }

  private function fuzzyMatch(string $hay, string $needle) : bool
  {
    $hay = mb_strtolower($hay);
    $needle = mb_strtolower($needle);
    if( strpos($hay, $needle) !== false ) return true; // simple contains

    // light fuzzy: all chars in order
    $i = 0;
    for( $j = 0; $j < strlen($hay) && $i < strlen($needle); $j++ ) {
      if( $hay[$j] === $needle[$i] ) $i++;
    }
    return $i === strlen($needle);
  }

  public function render(array $snippet, array $values = []) : array
  {
    if( ($snippet['type'] ?? 'yml') === 'md' ) {
      return [ 'html' => $this->escape($snippet['content'] ?? '') ];
    }
    $content = (string)($snippet['content'] ?? '');
    $html = $this->renderPlaceholders($content, $values);
    $html = $this->renderIncludes($html, $values);
    return [ 'html' => nl2br($this->escape($html)) ];
  }

  public function extractPlaceholders(string $content) : array
  {
    $ph = [];
    if( preg_match_all('/\{([a-zA-Z0-9_\-]+)(=([^\}|]+(?:\|[^\}]+)*))?\}/', $content, $m, PREG_SET_ORDER) ) {
      foreach( $m as $mm ) {
        $name = $mm[1];
        $spec = $mm[3] ?? '';
        $choices = [];
        $default = '';
        if( $spec !== '' ) {
          if( strpos($spec, '|') !== false ) {
            $choices = explode('|', $spec);
            $default = $choices[0] ?? '';
          }
          else {
            $default = $spec;
          }
        }
        $ph[] = [ 'name' => $name, 'default' => $default, 'choices' => $choices ];
      }
    }
    return $ph;
  }

  private function renderPlaceholders(string $content, array $values) : string
  {
    return preg_replace_callback('/\{([a-zA-Z0-9_\-]+)(=([^\}|]+(?:\|[^\}]+)*))?\}/', function($m) use ($values) {
      $name = $m[1];
      $spec = $m[3] ?? '';
      $choices = [];
      $default = '';
      if( $spec !== '' ) {
        if( strpos($spec, '|') !== false ) {
          $choices = explode('|', $spec);
          $default = $choices[0] ?? '';
        }
        else {
          $default = $spec;
        }
      }
      $val = $values[$name] ?? $default;
      // interactive span for UI to tab through
      $data = [
        'name' => $name,
        'choices' => $choices,
        'default' => $default,
      ];
      $json = htmlspecialchars(json_encode($data), ENT_QUOTES, 'UTF-8');
      $text = $val !== '' ? $val : $default;
      return '<span class="ph" tabindex="0" contenteditable="true" data-ph="' . $json . '">' . $this->escape($text) . '</span>';
    }, $content);
  }

  private function renderIncludes(string $content, array $values) : string
  {
    return preg_replace_callback('/\{include:\s*"([^"]+)"\}/', function($m) use ($values) {
      $name = $m[1];
      // search file by filename in current data path
      $found = $this->findSnippetByName($name);
      if( ! $found ) return '';
      $data = $this->readSnippet($found);
      $html = $this->renderPlaceholders((string)($data['content'] ?? ''), $values);
      return $html;
    }, $content);
  }

  private function findSnippetByName(string $name) : ?string
  {
    $root = $this->abs($this->currentDataPath);
    $rii = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
    foreach( $rii as $file ) {
      if( $file->isDir() ) continue;
      $ext = strtolower($file->getExtension());
      if( ! in_array($ext, ['yml','yaml'], true) ) continue;
      if( $file->getBasename('.' . $ext) === $name ) {
        return $this->relToCurrent($file->getPathname());
      }
    }
    return null;
  }

  public function recent(int $limit = 20) : array
  {
    $data = file_exists($this->recentFile) ? (Yaml::parseFile($this->recentFile) ?? [ 'recent' => [] ]) : [ 'recent' => [] ];
    $list = $data['recent'] ?? [];
    return array_slice($list, 0, $limit);
  }

  private function touchRecent(string $relPath) : void
  {
    $data = file_exists($this->recentFile) ? (Yaml::parseFile($this->recentFile) ?? [ 'recent' => [] ]) : [ 'recent' => [] ];
    $list = $data['recent'] ?? [];
    $list = array_values(array_filter($list, fn($x) => $x['file'] !== $relPath));
    array_unshift($list, [ 'file' => $relPath, 'ts' => time(), 'dataPath' => $this->currentDataPath ]);
    $data['recent'] = array_slice($list, 0, 200);
    $this->writeYaml($this->recentFile, $data);
  }

  private function pathInCurrent(string $relPath) : string
  {
    $relPath = str_replace('\\', '/', trim($relPath, '/'));
    return $this->abs($this->currentDataPath) . '/' . $relPath;
  }

  private function relToCurrent(string $absPath) : string
  {
    $root = $this->abs($this->currentDataPath) . '/';
    $absPath = str_replace('\\', '/', $absPath);
    if( str_starts_with($absPath, $root) ) {
      return trim(substr($absPath, strlen($root)), '/');
    }
    return $absPath;
  }

  private function safeName(string $name) : string
  {
    $name = preg_replace('/[^a-zA-Z0-9_\-]+/', '_', $name);
    return trim($name, '_');
  }

  private function ensureParent(string $file) : void
  {
    $dir = dirname($file);
    if( ! is_dir($dir) ) @mkdir($dir, 0777, true);
  }

  private function rrmdir(string $dir) : void
  {
    if( ! is_dir($dir) ) return;
    $it = new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS);
    $files = new \RecursiveIteratorIterator($it, \RecursiveIteratorIterator::CHILD_FIRST);
    foreach( $files as $file ) {
      $file->isDir() ? @rmdir($file->getRealPath()) : @unlink($file->getRealPath());
    }
    @rmdir($dir);
  }

  private function writeYaml(string $file, array $data) : void
  {
    file_put_contents($file, Yaml::dump($data, 4, 2));
  }

  private function escape(string $s) : string
  {
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
  }
}
