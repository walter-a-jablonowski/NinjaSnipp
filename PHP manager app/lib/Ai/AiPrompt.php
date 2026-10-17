<?php

namespace SnippetManager\Ai;

use SnippetManager\SnippetManager;
use SnippetManager\SnippetStore;

// The system prompt, the same for every provider: what the app is and how to work in it
// (system_prompt.md), the snippet template, the current state, the sidebar's mode, web
// search, and config.yml's ai.systemPrompt - the user's own instructions - last.
class AiPrompt
{
  // $open: the snippet open in the editor, ['path', 'source'], [] when none
  // $mode: ask (changes wait for the user's accept) | apply (accepted at once, one undo)
  public static function build( SnippetManager $manager, array $config, array $open = [], string $mode = 'ask', bool $webSearch = false ) : string
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

    // The tools still only propose; the sidebar applies them. Without this the model keeps
    // asking for a review nobody is going to do.
    if( $mode === 'apply' )
      $prompt .= "\n\n## Mode: just do it\n\n"
               . "The user set the sidebar to apply your proposals as soon as your answer is complete; one Undo takes "
               . "them all back. Call the write tools as always (they still answer proposed_pending_user_approval). "
               . "In your reply say what you changed, do not ask for a review.";

    if( $webSearch )
      $prompt .= "\n\n## Web search\n\n"
               . "You can search the web when a request needs outside information, e.g. current best practice for "
               . "prompting a model, or what a tool named in a snippet does. Cite what you used as links.";

    $own = trim( (string)($config['systemPrompt'] ?? ''));
    if( $own !== '' )
      $prompt .= "\n\n## The user's instructions\n\n$own";

    return $prompt;
  }
}
