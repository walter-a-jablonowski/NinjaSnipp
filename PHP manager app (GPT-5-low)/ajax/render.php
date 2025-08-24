<?php

use App\SnippetManager;

$in = $ctx['input'] ?? [];
$manager = new SnippetManager(__DIR__ . '/..');
$dp = (string)($in['dataPath'] ?? '');
if( $dp !== '' ) $manager->setCurrentDataPath($dp);
$snippet = $in['snippet'] ?? null;
if( ! is_array($snippet) ) throw new Exception('snippet required');
$rendered = $manager->render($snippet, $in['values'] ?? []);
return [ 'ok' => true ] + $rendered;
