<?php

// Tree listing, folders, links, renames, colors

/** @var SnippetManager\SnippetManager $manager */
/** @var array $appConfig */

$colorOf = fn( array $in ) => ($in['color'] ?? '') === '' ? null : (string)$in['color'];   // '' clears

return [

  'listFiles' => fn( array $in ) => [
    'success'          => true,
    'files'            => $manager->tree->listFiles( (string)($in['subPath'] ?? '')),
    'baseFolderLabels' => $manager->sources->getLabels()
  ],

  'createFolder' => function( array $in ) use ( $manager ) : array {
    $manager->files->createFolder( (string)($in['folderPath'] ?? ''), $in['targetBasePath'] ?? null);
    return ['success' => true, 'message' => 'Folder created successfully'];
  },

  'createLink' => function( array $in ) use ( $manager ) : array {
    $manager->files->createLink( (string)($in['linkPath'] ?? ''), $in['targetBasePath'] ?? null);
    return ['success' => true, 'message' => 'Link created successfully'];
  },

  'removeLink' => function( array $in ) use ( $manager ) : array {
    $bases = is_array($in['bases'] ?? null) ? $in['bases'] : null;
    $manager->files->removeLink( (string)($in['subPath'] ?? ''), (string)($in['target'] ?? ''), $bases);
    return ['success' => true, 'message' => 'Link removed successfully'];
  },

  'deleteFolder' => function( array $in ) use ( $manager ) : array {
    $manager->files->deleteFolder( (string)($in['path'] ?? ''), $in['targetBase'] ?? null);
    return ['success' => true, 'message' => 'Folder deleted successfully'];
  },

  // A merged folder is renamed in all of its sources at once ("bases"), so the manager can
  // refuse or undo it as a unit; anything else names its one source in "basePath"
  'renameItem' => function( array $in ) use ( $manager ) : array {
    $bases = is_array($in['bases'] ?? null) && ! empty($in['bases']) ? $in['bases'] : [$in['basePath'] ?? null];
    $manager->files->rename( (string)($in['oldPath'] ?? ''), (string)($in['newPath'] ?? ''), $bases);
    return ['success' => true, 'message' => 'Renamed successfully'];
  },

  'batchRename' => function( array $in ) use ( $manager ) : array {
    $ops     = is_array($in['ops'] ?? null) ? $in['ops'] : [];
    $changed = $manager->files->batchRename( (string)($in['subPath'] ?? ''), $ops);
    return ['success' => true, 'message' => $changed ? 'Reordered' : 'Nothing to reorder'];
  },

  'setFolderColor' => function( array $in ) use ( $manager, $colorOf ) : array {
    if( ($in['folderPath'] ?? '') === '' )
      return ['success' => false, 'message' => 'Missing folderPath'];

    $manager->colors->setFolderColor( (string)$in['folderPath'], $colorOf($in), $in['targetBase'] ?? null);
    return ['success' => true];
  },

  'setFileColor' => function( array $in ) use ( $manager, $colorOf ) : array {
    if( ($in['filePath'] ?? '') === '' )
      return ['success' => false, 'message' => 'Missing filePath'];

    $manager->colors->setFileColor( (string)$in['filePath'], $colorOf($in), $in['basePath'] ?? null);
    return ['success' => true];
  },

  // Local-only convenience; the UI hides it unless config.yml sets special
  'openInExplorer' => function( array $in ) use ( $manager, $appConfig ) : array {
    if( empty($appConfig['special']) )
      return ['success' => false, 'message' => 'Not available'];

    $type = ($in['itemType'] ?? '') === 'folder' ? 'folder' : 'file';

    // Only a configured source is accepted as base: a full path from the client would put
    // arbitrary text into the command line below
    $fullPath = $manager->sources->resolvePhysicalPath( (string)($in['path'] ?? ''), $type, $in['basePath'] ?? null);
    if( $fullPath === null )
      return ['success' => false, 'message' => 'Path not found'];

    $winPath = escapeshellarg(str_replace('/', '\\', $fullPath));
    $select  = $type === 'folder' ? '' : '/select,';
    pclose(popen("start \"\" explorer.exe $select$winPath", 'r'));

    return ['success' => true];
  }
];
