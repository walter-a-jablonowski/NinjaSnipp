<?php

namespace SnippetManager;

use Symfony\Component\Yaml\Yaml;

// Per-user files in the user folder (e.g. users/default):
//   settings.yml          data sets, theme, colors, nav / render / edit options
//   search_history.json   list of recent queries
//   recent_snippets.json  data set label => list of recently opened snippets
class UserStore
{
  private string $dir;

  public function __construct( string $dir )
  {
    $this->dir = rtrim($dir, '/');
  }

  public function getSettings() : array
  {
    $file = "{$this->dir}/settings.yml";
    $settings = is_file($file) ? Yaml::parseFile($file) : [];
    return is_array($settings) ? $settings : [];
  }

  // Merges $changes into the stored settings (recursively, changes win) and returns the result
  public function updateSettings( array $changes ) : array
  {
    $merged = array_replace_recursive($this->getSettings(), $changes);

    if( file_put_contents("{$this->dir}/settings.yml", Yaml::dump($merged, 4, 2)) === false )
      throw new \RuntimeException('Failed to write settings');

    return $merged;
  }

  public function getSearchHistory() : array
  {
    return $this->readJson('search_history.json');
  }

  public function saveSearchHistory( array $history ) : void
  {
    $this->writeJson('search_history.json', $history, 'Failed to save search history');
  }

  public function getRecentSnippets( string $dataSet ) : array
  {
    return $this->readJson('recent_snippets.json')[$dataSet] ?? [];
  }

  // The list is kept per data set: each has its own files
  public function saveRecentSnippets( string $dataSet, array $recent ) : void
  {
    $all = $this->readJson('recent_snippets.json');
    $all[$dataSet] = $recent;
    $this->writeJson('recent_snippets.json', $all, 'Failed to save recent snippets');
  }

  private function readJson( string $name ) : array
  {
    $file = "{$this->dir}/$name";
    $data = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    return is_array($data) ? $data : [];
  }

  private function writeJson( string $name, array $data, string $errorMessage ) : void
  {
    if( ! is_dir($this->dir) )
      mkdir($this->dir, 0755, true);

    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if( file_put_contents("{$this->dir}/$name", $json) === false )
      throw new \RuntimeException($errorMessage);
  }
}
