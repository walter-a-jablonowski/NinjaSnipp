<?php

namespace SnippetManager;

// Composition root: builds the services of the app from the user settings.
//
//   sources   data sets, source folders and path rules
//   colors    folder and file colors
//   tree      the merged file tree (listing, links)
//   files     folder / link / rename / reorder operations
//   snippets  reading and writing snippet files
//   search    full-text search
//   renderer  includes, MAYBE blocks and placeholders
class SnippetManager
{
  public Sources $sources;
  public ColorStore $colors;
  public FileTree $tree;
  public FileOperations $files;
  public SnippetStore $snippets;
  public Search $search;
  public Renderer $renderer;

  public function __construct( array $settings, string $appRoot )
  {
    $this->sources  = new Sources( $settings['dataPaths'] ?? ['data'], $appRoot);
    $this->colors   = new ColorStore( $this->sources, $settings);
    $this->tree     = new FileTree( $this->sources, $this->colors,
                        (bool)($settings['nav']['foldersMerged'] ?? false),
                        (bool)($settings['nav']['foldersFirst'] ?? true));
    $this->files    = new FileOperations( $this->sources, $this->colors);
    $this->snippets = new SnippetStore( $this->sources, $this->colors);
    $this->search   = new Search( $this->tree, $this->snippets);
    $this->renderer = new Renderer( $this->sources, $this->tree, $this->snippets, $settings['render'] ?? []);
  }
}
