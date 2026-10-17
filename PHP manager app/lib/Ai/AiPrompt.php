<?php

namespace SnippetManager\Ai;

use SnippetManager\SnippetManager;
use SnippetManager\SnippetStore;

// The system prompt, the same for every provider: what the app is and how to work in it
// (system_prompt.md), the snippet template, the current state, and config.yml's
// ai.systemPrompt - the user's own instructions - last.
class AiPrompt
{
  // $open: the snippet open in the editor, ['path', 'source'], [] when none
  public static function build( SnippetManager $manager, array $config, array $open = [] ) : string
  {
    $lib     = new AiLibrary($manager);
    $sources = $lib->labels();
    $prompt  = rtrim( file_get_contents(__DIR__ . '/system_prompt.md'));

    $prompt .= "\n\n## The snippet template\n\nsnippet_create starts a .yml snippet from it:\n\n```yml\n"
             . rtrim( file_get_contents(SnippetStore::TEMPLATE)) . "\n```";

    $prompt .= "\n\n## Now\n\n"
             . '- Today: ' . date('Y-m-d') . "\n"
             . '- Data set: ' . $manager->sources->getCurrentLabel() . ', sources: ' . implode(', ', $sources)
             . ($manager->tree->isMerged() ? ' (same-named folders merged)' : '') . "\n"
             . (! empty($open['path'])
                 ? "- Open in the editor (\"this snippet\"): {$open['path']}" . (count($sources) > 1 && ! empty($open['source']) ? " in source {$open['source']}" : '')
                 : '- No snippet is open');

    $own = trim( (string)($config['systemPrompt'] ?? ''));
    if( $own !== '' )
      $prompt .= "\n\n## The user's instructions\n\n$own";

    return $prompt;
  }
}
