<?php

use App\SnippetManager;

$in = $ctx['input'] ?? [];
$manager = new SnippetManager(__DIR__ . '/..');
$dp = (string)($in['dataPath'] ?? '');
if( $dp !== '' ) $manager->setCurrentDataPath($dp);
$q = (string)($in['q'] ?? '');
$items = $manager->search($q);
return [ 'ok' => true, 'items' => $items ];
