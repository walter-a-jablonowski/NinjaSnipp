<?php

use App\SnippetManager;

$in = $ctx['input'] ?? [];
$manager = new SnippetManager(__DIR__ . '/..');
$dp = (string)($in['dataPath'] ?? '');
if( $dp !== '' ) $manager->setCurrentDataPath($dp);
$res = $manager->saveSnippet($in);
return [ 'ok' => true ] + $res;
