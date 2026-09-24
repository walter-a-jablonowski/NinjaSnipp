<?php

namespace SnippetManager;

// Folder and file colors. Each folder keeps its own .sys/ninja.json:
//   { "color": "red", "fileColors": { "some file.yml": "blue" } }
// Colors are stored as palette names; the palette (settings folderColors / folderColorsDark)
// turns them into hex values. A stored hex value is legacy and used as is.
class ColorStore
{
  private Sources $sources;
  private array $palettes;          // ['light' => [name => hex], 'dark' => [...]]
  private string $theme;
  private array $cache = [];        // .sys/ninja.json path => decoded data, per request

  public function __construct( Sources $sources, array $settings )
  {
    $this->sources  = $sources;
    $this->theme    = (string)($settings['theme'] ?? 'light');
    $this->palettes = [
      'light' => $settings['folderColors'] ?? [],
      'dark'  => $settings['folderColorsDark'] ?? ($settings['folderColors'] ?? [])
    ];
  }

  public function getPalette( string $themeMode ) : array
  {
    return $this->palettes[$themeMode === 'dark' ? 'dark' : 'light'];
  }

  // Palette name => hex for the configured theme ("system" is resolved in the browser)
  public function resolve( ?string $colorName ) : ?string
  {
    if( $colorName === null )
      return null;

    if( strpos($colorName, '#') === 0 )
      return $colorName;

    return $this->getPalette($this->theme)[$colorName] ?? null;
  }

  public function getFolderColor( string $folderPath ) : ?string
  {
    $color = $this->read($folderPath)['color'] ?? null;
    return is_string($color) ? $color : null;
  }

  public function getFileColor( string $folderPath, string $fileName ) : ?string
  {
    $color = $this->read($folderPath)['fileColors'][$fileName] ?? null;
    return is_string($color) ? $color : null;
  }

  public function setFolderColor( string $relativePath, ?string $color, ?string $base = null ) : void
  {
    $folderPath = $this->locate($relativePath, 'folder', $base);

    $data = $this->read($folderPath);
    if( $color === null )
      unset($data['color']);
    else
      $data['color'] = $color;

    $this->write($folderPath, $data);
  }

  public function setFileColor( string $relativePath, ?string $color, ?string $base = null ) : void
  {
    $absPath  = $this->locate($relativePath, 'file', $base);
    $folder   = dirname($absPath);
    $fileName = basename($absPath);

    $data = $this->read($folder);
    if( ! isset($data['fileColors']) || ! is_array($data['fileColors']) )
      $data['fileColors'] = [];

    if( $color === null )
      unset($data['fileColors'][$fileName]);
    else
      $data['fileColors'][$fileName] = $color;

    if( empty($data['fileColors']) )
      unset($data['fileColors']);

    $this->write($folder, $data);
  }

  // Colors are keyed by file name, so a renamed file takes its entry along. A null
  // $newName drops the entry, so a deleted name does not hand its color to whatever
  // file takes that name next.
  public function moveFileColor( string $folderPath, string $oldName, ?string $newName ) : void
  {
    $data = $this->read($folderPath);
    if( ! isset($data['fileColors'][$oldName]) )
      return;

    if( $newName !== null )
      $data['fileColors'][$newName] = $data['fileColors'][$oldName];
    unset($data['fileColors'][$oldName]);

    if( empty($data['fileColors']) )
      unset($data['fileColors']);

    $this->write($folderPath, $data);
  }

  // Absolute path of an existing item (last source wins, or in $base only)
  private function locate( string $relativePath, string $type, ?string $base ) : string
  {
    $absPath = $this->sources->resolvePhysicalPath($relativePath, $type, $base);
    if( $absPath === null )
      throw new \RuntimeException("Failed to write $type color");

    return $absPath;
  }

  // Read once per request instead of once per file in the folder
  private function read( string $folderPath ) : array
  {
    $file = "$folderPath/.sys/ninja.json";

    if( ! array_key_exists($file, $this->cache) )
    {
      $data = is_file($file) ? json_decode(file_get_contents($file), true) : null;
      $this->cache[$file] = is_array($data) ? $data : [];
    }

    return $this->cache[$file];
  }

  private function write( string $folderPath, array $data ) : void
  {
    $sysDir = "$folderPath/.sys";
    if( ! is_dir($sysDir) )
      mkdir($sysDir, 0755, true);

    if( file_put_contents("$sysDir/ninja.json", json_encode($data, JSON_PRETTY_PRINT)) === false )
      throw new \RuntimeException('Failed to write color');

    $this->cache["$sysDir/ninja.json"] = $data;
  }
}
