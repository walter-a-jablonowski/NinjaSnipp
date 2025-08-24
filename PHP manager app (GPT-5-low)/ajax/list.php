<?php

use App\SnippetManager;

$in = $ctx['input'] ?? [];
$manager = new SnippetManager(__DIR__ . '/..');
$dp = (string)($in['dataPath'] ?? '');
if( $dp !== '' ) $manager->setCurrentDataPath($dp);
$sub = (string)($in['sub'] ?? '');
$items = $manager->listDirectory($sub);
return [ 'ok' => true ] + $items;
